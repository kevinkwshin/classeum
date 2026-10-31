// The game host, one per server process: owns the live session, runs its clock, keeps track of
// every open screen, and pushes each one its role's view (over /api/stream). Records live in store.ts.
import { createHash, randomInt } from 'node:crypto';
import type { AvatarLook, AvatarOnField, CustomQuestion, FieldPoint, GrammarItem, GrammarTab, Phase, PublicQuestion, Question, RevealInfo, Round, StudentSummary, Word, WrongNote } from '@/lib/types';
import { DEFAULT_LOOK, EYE_STYLES, HAIR_COLORS, HAIR_STYLES, normalizeLook, SKIN_TONES } from '@/lib/avatar';
import { ATTENDANCE_UNLOCKS, ITEMS, QUIZ_REWARD_ITEMS, STAMPS_PER_UNLOCK, itemById } from '@/lib/items';
import { hashString, MAX_TEXT_ANSWER, mulberry32, normalizeAnswer, shortDate, todayKey } from '@/lib/text';
import { zoneOf } from '@/lib/field';
import { db, flush, newId, save, type EventRec, type RequestRec, type ResponseRec, type SessionSummaryRec, type StudentRec, type AgoraRec, type TopicRec } from './store';
import { generateEvent, spreadAnswers } from './generate';
import { answerLabelOf, correctLabelOf } from './answers';
import { GRAMMAR_TABS, gradeGrammar } from './grammar';
import { compareNames } from './stats';
import type { ImportIssue } from './excel';
import { lanAddress, qrSvg } from './lan';
import { addAgora, deleteAgora, displayAgora, dropAnswer, dropClassRuns, dropStudentAnswers, editAgora, findTopic, flipCard, lessonOf, putAnswer, resetCards, revealCards, setReward, setSettings, studentAgora, studentNotes, teacherAgora, toggleStar, type AgoraInput, type AgoraLive } from './agora';

export type Role = 'teacher' | 'display' | 'student';

export interface Client {
  role: Role;
  tokenHash?: string;
  /**
   * Names this stream in its phone's heartbeats, so they keep only this one alive: not a second tab, and not
   * a stream a Wi-Fi roam left half-open. Pages from before heartbeats send none.
   */
  streamId?: string;
  send: (payload: unknown) => void;
  /**
   * Ends the stream from the server side: an older duplicate of the same phone, or a phone that stopped
   * beating. The page stays closed until the student looks at it again.
   */
  close?: () => void;
  /** Ends the stream quietly when the server is stopping; the screen reconnects once it is back. */
  end?: () => void;
}

const INTRO_MS = 600;
// The first question of each round gets a 3·2·1 on the projector and phones.
const FIRST_INTRO_MS = 3000;
/** The first grammar question after the words opens with an '이제 문법!' card. */
const GRAMMAR_INTRO_MS = 2500;
// Long enough for the landing and the 펑 / cheer reactions to play out.
const REVEAL_MS = 4000;
const REVEAL_LONG_MS = 6000;
const CHECKPOINT_MS = 6000;
/** The projector's 놀이 방법 demo in the lobby (its captions are timed on the projector). */
const HOWTO_MS = 12000;
const RETRY_INTRO_MS = 3000;
const BLOCK = 10;
/** A request lapses 2 minutes after its phone stops waiting (left the page, screen off), or after 15 minutes at most. */
const REQUEST_TTL_MS = 2 * 60 * 1000;
const REQUEST_MAX_MS = 15 * 60 * 1000;
const MAX_PRACTICE_PER_QUESTION = 5;
/** Seconds per question when the Excel 시간(초) cell is blank (단답형 gets at least 20). */
const DEFAULT_SECONDS = 10;
/** A teacher click or key within this long after a phase change is taken as meant for the phase before. */
const CLICK_GUARD_MS = 1000;
/** Friends' characters per phone result: one row on a small phone. */
const FRIENDS_SHOWN = 9;
/** Two tabs on one phone are fine; a third replaces the oldest. */
const MAX_STREAMS_PER_DEVICE = 2;
/** Phones beat every 15 s while looked at; one silent this long is locked, out of range or off. */
const BEAT_TIMEOUT_MS = 40_000;
const SWEEP_MS = 5_000;
const ANIMALS = ['여우', '부엉이', '사슴', '고래', '펭귄', '다람쥐', '거북', '판다', '수달', '코알라', '호랑이', '토끼'];
/** A phone may write its 아고라 answer this often: enough to fix a typo or two, not to flood every screen. */
const AGORA_WRITES = 5;
const AGORA_WINDOW_MS = 10_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface StudentResult {
  connected: number;
  correct: number;
}

interface Live {
  id: string;
  eventId: string;
  /** The class in the room today; only its students join, register and count. */
  classId: string;
  startedAt: number;
  phase: Phase;
  round: Round;
  list: Question[];
  index: number;
  seq: number;
  phaseEndsAt: number | null;
  movingStartedAt: number;
  /** Early close waits a few seconds after a resume too, not only after the question opens. */
  resumedAt: number;
  paused: { remaining: number } | null;
  /** Set when the pause came from covering the projector, so uncovering resumes on its own. */
  pausedByBlank: boolean;
  blank: boolean;
  nameLabels: boolean;
  /** The projector plays a "Yeah!" cheer at a reveal where someone got it right. */
  sound: boolean;
  /** Soft background music on the projector in the lobby and on the results. */
  music: boolean;
  autoAdvance: boolean;
  joined: Set<string>;
  positions: Map<string, FieldPoint>;
  moveCounter: Map<string, number>;
  texts: Map<string, string>;
  /** Students who pressed 제출 for their text; auto-saved drafts don't count as done. */
  textFinal: Set<string>;
  /** Newest text number per student, so a late draft can't overwrite a newer answer. */
  textCounter: Map<string, number>;
  lastMoveAt: number;
  /** When 건너뛰기 last worked, so a double click or a quick second S can't skip the next question too. */
  lastSkipAt: number;
  /** When the current phase began; a click or key meant for the phase before must not act on this one. */
  phaseAt: number;
  /** When the current question began (its intro); 건너뛰기 counts from here, since intro and moving are one question. */
  questionAt: number;
  reveal: RevealInfo | null;
  /** This question's answers; `streak` is the student's run of right answers after it, `broke` the run it just ended. */
  choices: Map<string, { choice: number; correct: boolean; text?: string; streak: number; broke: number }>;
  /** Right answers in a row per student this session (private to each phone). */
  streak: Map<string, number>;
  bestStreak: Map<string, number>;
  /** Who got this question right, shuffled per question, so each phone's friends row is a slice of it. */
  correctOrder: string[];
  /** At the end: the questions the class missed most first, with who missed them (worked out once, in finish()). */
  hardest: HardestRow[];
  /** Main-round scored questions: how many got them right, and the wrong answer most of the others gave. */
  mainStats: Map<string, { correct: number; total: number; wordKey?: string; topWrong?: string }>;
  perStudent: Map<string, StudentResult>;
  checkpoint: { kind: 'block' | 'retry'; accuracy: number; done: number; total: number } | null;
  summary: { accuracy: number; rewarded: number; judged: number } | null;
  studentSummary: Map<string, StudentSummary>;
  /** Students whose attendance stamp was added by this session (not earlier the same day). */
  stamped: Set<string>;
  mainCount: number;
  /** The main round's questions: the event's, minus the types left out in the lobby. */
  mainList: Question[];
  /** Types left out in the lobby ('오늘 낼 문제'). */
  off: Set<Section>;
  /** The 10-question rest (관문); the teacher can switch it off in the lobby. */
  breaks: boolean;
  /** Main-round questions passed over with 건너뛰기 or 다음 유형: not asked, so not in the reward count either. */
  skipped: Set<string>;
  /** While the projector plays the 놀이 방법 demo (lobby only): when it ends, or 0. */
  howtoUntil: number;
}

/** The kinds of question an event asks, in the order they come: words, the four 문법 tabs, an older file's 문항. */
export type Section = 'words' | GrammarTab | 'bonus';
const SECTIONS: Section[] = ['words', ...GRAMMAR_TABS, 'bonus'];
const SECTION_LABEL: Record<Section, string> = { words: '단어', 고르기: '문법 고르기', 쓰기: '문법 쓰기', 고치기: '문법 고치기', 배열: '문법 배열', bonus: '보너스 문항' };
const sectionOf = (q: Question): Section => (q.wordKey ? 'words' : q.grammar ? q.grammar.tab : 'bonus');
/** Questions as the teacher wrote them: a 고치기 row's find and fix are one (and so is a row whose fix alone is left). */
const rowsOf = (list: Question[]) => new Set(list.map((q) => q.id.replace(/:(find|fix)$/, ''))).size;
/** About a minute for the summary, and another for the retry round when it is on and has words to ask. */
const estimateSecOf = (questions: Question[], retryRound?: boolean) =>
  Math.round(questions.reduce((sum, q) => sum + playSeconds(q), 0) + 60 + (retryRound && questions.some((q) => q.wordKey) ? 60 : 0));

type Generated = ReturnType<typeof generateEvent>;

interface Draft {
  id: string;
  createdAt: number;
  groups: { name: string; words: Word[]; grammar: GrammarItem[]; custom: CustomQuestion[] }[];
  /** What the teacher previewed, reused as-is when the events are created. */
  generated: Map<string, Generated>;
  roster: { className: string; number: number; name: string }[];
  issues: ImportIssue[];
  /** The uploaded Excel file's name, kept on the events it makes. */
  fileName?: string;
  /** Typed in the teacher screen ([직접 작성하기]) rather than uploaded. */
  typed?: boolean;
}

/** Names as students type them: Hangul or Latin letters, spaces, '·', '.', '-'; at most 20. */
const NAME_RE = /^[가-힣A-Za-z][가-힣A-Za-z .·-]{0,19}$/;

export function cleanName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** 김 하윤 and 김하윤 are the same name when matching a registration to the roster. */
function nameKey(name: string): string {
  return cleanName(name).replace(/\s/g, '').toLowerCase();
}

/** What every unregistered phone shares in one push, built once instead of per phone. */
interface RegistrationContext {
  open: boolean;
  latest: Map<string, RequestRec>;
  /** The classes a phone can register in: just today's class while a lobby or quiz is on. */
  classes: { id: string; name: string }[];
}

/** Own keys only, so ids like 'constructor' or '__proto__' sent by a phone never match. */
function own<T>(table: Record<string, T>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

function className(classId: string | undefined): string {
  return own(db().classes, classId)?.name ?? '';
}

/** '3', '3반' and '3 반' all mean the same class when matching names from a 명단 sheet. */
function sameClassName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/반$/, '');
  return norm(a) === norm(b);
}

function byClassAndNumber(a: StudentRec, b: StudentRec): number {
  return compareNames(className(a.classId), className(b.classId)) || a.number - b.number;
}

function publicQuestion(q: Question, seq: number): PublicQuestion {
  return {
    seq,
    mode: q.mode,
    modeLabel: q.modeLabel,
    prompt: q.prompt,
    options: q.options.map((o) => o.label),
    kind: q.mode === 'CUSTOM_TEXT' ? 'text' : 'field',
    seconds: q.seconds,
    grammar: q.grammar,
  };
}

/** Word and grammar questions count toward accuracy, rewards and streaks; the 문항 sheet's bonus questions don't. */
function scored(q: Question | null | undefined): boolean {
  return !!q && (!!q.wordKey || !!q.grammar);
}

/** Scored questions the session set out to ask: the main round's, minus the ones skipped. */
function plannedOf(live: { mainList: Question[]; skipped: Set<string> }): number {
  return live.mainList.filter((q) => scored(q) && !live.skipped.has(q.id)).length;
}

/** Seconds a question takes in class with its reveal: most answer a word in under 9 s, a grammar question takes longer. */
function playSeconds(q: Question): number {
  return (q.grammar ? Math.round(q.seconds * 0.8) : Math.min(q.seconds, 9)) + 4;
}

/** One scored question at the end: the class's share of right answers, and the students who missed it with their answers. */
type HardestRow = { id: string; kind: string; text: string; answer: string; accuracy: number; total: number; topWrong: string | null; missed: { number: number; name: string; mine: string }[] };

class Hub {
  clients = new Set<Client>();
  /** Last heartbeat per student stream. Pages from before heartbeats never send one, so they are never swept. */
  private beats = new WeakMap<Client, number>();
  private sweeper: NodeJS.Timeout | null = null;
  /** When each pending request's phone was last seen waiting, for expireRequests. */
  private requestSeen = new Map<string, number>();
  live: Live | null = null;
  drafts = new Map<string, Draft>();
  joinUrl = '';
  qr = '';
  private ticker: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private lastPush = 0;
  /** The open 아고라 (see AgoraLive): a topic for one class, from its 대기실 to [아고라 닫기]. In memory only, like the arena. */
  agoraLive: AgoraLive | null = null;
  /** Closes writing when the 입력 시간 runs out. */
  private agoraTimeout: NodeJS.Timeout | null = null;
  /** Ends the 대기실's 놀이 방법 demo. */
  private agoraHowtoTimeout: NodeJS.Timeout | null = null;
  /** When each student wrote lately, for AGORA_WRITES. */
  private agoraWrites = new Map<string, number[]>();

  // ---------- connections ----------

  async ensureJoinUrl(port: string) {
    const url = `http://${lanAddress()}:${port}/play`;
    if (url !== this.joinUrl) {
      this.joinUrl = url;
      this.qr = await qrSvg(url);
    }
  }

  /**
   * Why a new student stream is refused, or null. A phone that already has a stream is
   * always let in (it replaces its oldest one), so only fresh unregistered phones can be
   * turned away, once there are far more of them than the class could account for.
   */
  admitStudent(tokenHash: string): string | null {
    const d = db();
    if (d.devices[tokenHash]) return null;
    let unregistered = 0;
    for (const c of this.clients) {
      if (c.role !== 'student' || !c.tokenHash) continue;
      if (c.tokenHash === tokenHash) return null;
      if (!d.devices[c.tokenHash]) unregistered++;
    }
    const limit = Math.max(64, 2 * Object.keys(d.students).length + 16);
    return unregistered >= limit ? '접속이 너무 많아요. 잠시 뒤에 다시 열어 주세요.' : null;
  }

  /** Students can pick their name only while the teacher or projector screen is open. */
  registrationOpen(): boolean {
    for (const c of this.clients) if (c.role === 'teacher' || c.role === 'display') return true;
    return false;
  }

  addClient(c: Client) {
    const openBefore = this.registrationOpen();
    if (c.role === 'student' && c.tokenHash) {
      // The browser reconnects a dropped EventSource by itself with the same stream id, and one EventSource has one
      // live connection, so an older stream with that id is already abandoned (and its heartbeats would keep it).
      if (c.streamId) {
        for (const x of [...this.clients]) {
          if (x.role === 'student' && x.tokenHash === c.tokenHash && x.streamId === c.streamId) {
            this.clients.delete(x);
            x.end?.();
          }
        }
      }
      // A reconnecting phone often opens its new stream before the old one is noticed as gone.
      const same = [...this.clients].filter((x) => x.role === 'student' && x.tokenHash === c.tokenHash);
      for (const old of same.slice(0, Math.max(0, same.length - (MAX_STREAMS_PER_DEVICE - 1)))) {
        this.clients.delete(old);
        old.close?.();
      }
    }
    this.clients.add(c);
    const sid = c.tokenHash ? db().devices[c.tokenHash]?.studentId : undefined;
    const joinedBefore = sid ? !!this.live?.joined.has(sid) : true;
    // A student of the open 아고라's class comes in: the 대기실 and the classmates' phones show them too.
    const agora = this.agoraLive;
    const newInRoom = !!sid && !!agora && !!db().students[sid]?.look && db().students[sid]?.classId === agora.classId && !agora.joined.has(sid);
    if (sid) this.touchStudent(sid);
    this.pushOne(c);
    // A new connection only changes the teacher's and projector's lists, unless it just joined (the arena or the
    // 아고라 room) or it opened registration for the phones still waiting to pick a name.
    const joinedNow = sid !== undefined && !joinedBefore && !!this.live?.joined.has(sid);
    this.schedulePush(joinedNow || newInRoom || openBefore !== this.registrationOpen());
  }

  /** Ends every open stream, so a stopping server doesn't wait for phones and screens to hang up. */
  closeAll() {
    for (const c of [...this.clients]) c.end?.();
  }

  removeClient(c: Client) {
    const openBefore = this.registrationOpen();
    if (!this.clients.delete(c)) return;
    this.schedulePush(openBefore !== this.registrationOpen());
  }

  /** A phone's page is open and looked at. Sent every 15 s by every phone, so it saves and pushes nothing. */
  beat(tokenHash: string, streamId: string) {
    if (!streamId) return;
    const now = Date.now();
    for (const c of this.clients) if (c.streamId === streamId && c.tokenHash === tokenHash) this.beats.set(c, now);
    this.sweeper ??= setInterval(() => this.sweep(), SWEEP_MS).unref();
  }

  /**
   * Ends the streams of phones that stopped beating. TCP keeps a vanished phone's stream open for minutes,
   * and all that time it counts as connected: early close waits for it and the counts are off.
   */
  private sweep() {
    const cutoff = Date.now() - BEAT_TIMEOUT_MS;
    for (const c of [...this.clients]) {
      const at = this.beats.get(c);
      if (at === undefined || at >= cutoff) continue;
      this.removeClient(c);
      c.close?.();
    }
  }

  studentOf(tokenHash?: string): StudentRec | undefined {
    if (!tokenHash) return undefined;
    const sid = db().devices[tokenHash]?.studentId;
    return own(db().students, sid);
  }

  connectedStudents(): Set<string> {
    const out = new Set<string>();
    for (const c of this.clients) {
      const s = this.studentOf(c.tokenHash);
      if (s) out.add(s.id);
    }
    return out;
  }

  private touchStudent(studentId: string) {
    const dev = Object.values(db().devices).find((d) => d.studentId === studentId);
    if (dev) dev.lastSeen = Date.now();
    if (this.live && db().students[studentId]?.look) this.join(studentId);
  }

  private join(studentId: string) {
    const live = this.live;
    if (!live || live.phase === 'summary') return;
    if (db().students[studentId]?.classId !== live.classId) return;
    if (!live.joined.has(studentId)) {
      live.joined.add(studentId);
      // The day's footprint comes with the quiz itself, so a lobby closed before 퀴즈 시작 stamps nothing.
      if (live.phase !== 'lobby' && this.stampAttendance(studentId)) live.stamped.add(studentId);
    }
  }

  // ---------- pushing views ----------

  /**
   * Immediate pushes go to every screen. Throttled pushes (position updates while
   * moving) only refresh the teacher and the projector; phones keep their own position.
   */
  schedulePush(immediate: boolean) {
    if (immediate) {
      if (this.pushTimer) clearTimeout(this.pushTimer);
      this.pushTimer = null;
      this.pushAll(true);
      return;
    }
    if (this.pushTimer) return;
    const wait = Math.max(0, 300 - (Date.now() - this.lastPush));
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushAll(false);
    }, wait);
  }

  private pushAll(includeStudents: boolean) {
    this.lastPush = Date.now();
    this.notePresent();
    const teacher = this.teacherView();
    const display = this.displayView();
    let reg: RegistrationContext | undefined;
    const getReg = () => (reg ??= this.registrationContext());
    for (const c of this.clients) {
      if (c.role === 'teacher') c.send(teacher);
      else if (c.role === 'display') c.send(display);
      else if (includeStudents) c.send(this.studentView(c.tokenHash, getReg));
    }
  }

  pushOne(c: Client) {
    this.notePresent();
    if (c.role === 'teacher') c.send(this.teacherView());
    else if (c.role === 'display') c.send(this.displayView());
    else c.send(this.studentView(c.tokenHash));
  }

  private currentQuestion(): Question | null {
    const live = this.live;
    if (!live || live.index < 0 || live.index >= live.list.length) return null;
    return live.list[live.index];
  }

  /** The type being asked now, how many of its questions are left to ask, and what comes after it (null: the results). */
  private sectionInfo(): { key: Section; label: string; left: number; next: string | null } | null {
    const live = this.live;
    if (!live || live.round !== 'main' || live.index < 0 || live.index >= live.list.length) return null;
    const sec = sectionOf(live.list[live.index]);
    const from = live.phase === 'intro' || live.phase === 'moving' ? live.index : live.index + 1;
    let end = live.index + 1;
    while (end < live.list.length && sectionOf(live.list[end]) === sec) end++;
    const next = end < live.list.length ? SECTION_LABEL[sectionOf(live.list[end])] : db().events[live.eventId]?.retryRound && this.retryWords().length > 0 ? '다시 도전' : null;
    return { key: sec, label: SECTION_LABEL[sec], left: rowsOf(live.list.slice(from, end)), next };
  }

  /** The current question is the first grammar question after the words. */
  private grammarStarts(): boolean {
    const live = this.live;
    if (!live || live.round !== 'main' || live.index < 1) return false;
    return !!live.list[live.index]?.grammar && !live.list[live.index - 1]?.grammar;
  }

  private sessionPublic() {
    const live = this.live;
    if (!live) return null;
    const q = this.currentQuestion();
    const event = db().events[live.eventId];
    const showQuestion = live.phase === 'intro' || live.phase === 'moving' || live.phase === 'reveal';
    return {
      id: live.id,
      eventName: event?.name ?? '',
      classId: live.classId,
      className: className(live.classId),
      phase: live.phase,
      round: live.round,
      index: live.index,
      grammarStart: live.phase === 'intro' && this.grammarStarts(),
      total: live.list.length,
      mainCount: live.mainCount,
      question: showQuestion && q ? publicQuestion(q, live.seq) : null,
      phaseEndsAt: live.phaseEndsAt,
      paused: !!live.paused,
      pausedRemaining: live.paused?.remaining ?? null,
      checkpoint: live.checkpoint,
      summary: live.summary,
      reward: event ? { ...event.reward, itemName: itemById(event.reward.itemId)?.name ?? '' } : null,
    };
  }

  private movingCounts() {
    const live = this.live!;
    const q = this.currentQuestion();
    const connected = this.connectedStudents();
    const participants = [...live.joined].filter((id) => connected.has(id));
    const counts = q ? q.options.map(() => 0) : [];
    let settled = 0;
    for (const id of participants) {
      if (q?.mode === 'CUSTOM_TEXT') {
        if (live.textFinal.has(id)) settled++;
        continue;
      }
      const z = q ? zoneOf(live.positions.get(id) ?? { x: 0.5, y: 0.5 }, q.options.length) : -1;
      if (z >= 0) {
        settled++;
        counts[z]++;
      }
    }
    return { participants, counts, settled };
  }

  private avatarsOnField(): AvatarOnField[] {
    const live = this.live;
    if (!live) return [];
    const students = db().students;
    return [...live.joined]
      .map((id) => students[id])
      .filter(Boolean)
      .map((s) => ({ studentId: s.id, number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined), point: live.positions.get(s.id) ?? { x: 0.5, y: 0.5 } }));
  }

  displayView() {
    const live = this.live;
    const base = { role: 'display', serverNow: Date.now(), joinUrl: this.joinUrl, qr: this.qr, session: this.sessionPublic() };
    if (!live) {
      const now = this.agoraNow();
      return { ...base, agora: now && this.agoraLive ? displayAgora(now.agora, now.topic, this.agoraLive) : null };
    }
    const counts = live.phase === 'moving' ? this.movingCounts() : null;
    const howto = live.phase === 'lobby' && live.howtoUntil > Date.now();
    return {
      ...base,
      blank: live.blank,
      nameLabels: live.nameLabels,
      sound: live.sound,
      music: live.music,
      howto,
      howtoAt: howto ? live.howtoUntil - HOWTO_MS : null,
      lobby: live.phase === 'lobby' ? { avatars: this.avatarsOnField(), connected: this.connectedStudents().size, joined: live.joined.size } : null,
      settled: counts ? counts.settled : 0,
      participants: counts ? counts.participants.length : live.joined.size,
      reveal: live.phase === 'reveal' ? live.reveal : null,
      parade:
        live.phase === 'summary'
          ? this.avatarsOnField().map(({ studentId, look }) => ({ studentId, look, rewarded: !!live.studentSummary.get(studentId)?.reward }))
          : null,
    };
  }

  teacherView() {
    const d = db();
    const live = this.live;
    const connected = this.connectedStudents();
    const deviceOf = new Map(Object.values(d.devices).map((dev) => [dev.studentId, dev]));
    const students = Object.values(d.students)
      .sort(byClassAndNumber)
      .map((s) => {
        const device = deviceOf.get(s.id);
        return {
          id: s.id,
          classId: s.classId,
          number: s.number,
          name: s.name,
          hasDevice: !!device,
          lastSeen: device?.lastSeen ?? null,
          connected: connected.has(s.id),
          joined: !!live?.joined.has(s.id),
          stamps: d.attendance[s.id]?.length ?? 0,
          look: s.look,
        };
      });
    const auto = this.autoApprovable();
    const requests = Object.values(d.requests)
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r.id,
        className: className(r.classId),
        number: r.number,
        name: r.name,
        ...(({ kind, note, bound, records, at }) => ({ kind, note, bound, records, holder: kind === 'conflict' ? at?.name ?? '' : '' }))(this.classify(r)),
        auto: auto.has(r.id),
        symbol: r.symbol,
        createdAt: r.createdAt,
      }));
    const classes = Object.values(d.classes)
      .sort((a, b) => compareNames(a.name, b.name))
      .map((c) => {
        const mine = students.filter((s) => s.classId === c.id);
        return { id: c.id, name: c.name, students: mine.length, devices: mine.filter((s) => s.hasDevice).length };
      });
    const sessionsOf = new Map<string, SessionSummaryRec[]>();
    for (const s of d.sessions) sessionsOf.set(s.eventId, [...(sessionsOf.get(s.eventId) ?? []), s]);
    const events = Object.values(d.events)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({
        id: e.id,
        name: e.name,
        createdAt: e.createdAt,
        count: e.questions.length,
        warnings: e.warnings,
        reward: e.reward,
        estimateSec: estimateSecOf(e.questions, e.retryRound),
        seconds: mostCommon(e.questions.map((q) => q.seconds)),
        fileName: e.fileName ?? null,
        typed: !!e.typed,
        retryRound: !!e.retryRound,
        played: sessionsOf.get(e.id)?.length ?? 0,
        classRuns: classRuns(e, sessionsOf.get(e.id) ?? []),
      }));
    let liveDetail = null;
    if (live) {
      const q = this.currentQuestion();
      const counts = live.phase === 'moving' ? this.movingCounts() : null;
      const unsettled = counts
        ? counts.participants
            .filter((id) => (q?.mode === 'CUSTOM_TEXT' ? !live.textFinal.has(id) : zoneOf(live.positions.get(id) ?? { x: 0.5, y: 0.5 }, q?.options.length ?? 4) < 0))
            .map((id) => d.students[id])
            .filter(Boolean)
            .map((s) => ({ number: s.number, name: s.name }))
        : [];
      const answered = [...live.mainStats.values()].reduce((a, s) => ({ c: a.c + s.correct, t: a.t + s.total }), { c: 0, t: 0 });
      liveDetail = {
        ...this.sessionPublic(),
        blank: live.blank,
        nameLabels: live.nameLabels,
        sound: live.sound,
        music: live.music,
        howto: live.phase === 'lobby' && live.howtoUntil > Date.now(),
        autoAdvance: live.autoAdvance,
        joined: live.joined.size,
        connected: [...live.joined].filter((id) => connected.has(id)).length,
        current: q ? { ...q } : null,
        counts: counts?.counts ?? null,
        settled: counts?.settled ?? 0,
        participants: counts?.participants.length ?? 0,
        unsettled,
        reveal: live.reveal,
        accuracySoFar: answered.t ? answered.c / answered.t : null,
        // For the 종료 confirmation: word questions finished (counting one being answered now) and planned.
        // (종료 during 'moving' locks the current question, so it counts; in intro it doesn't.)
        mainDone: live.mainStats.size + (live.round === 'main' && live.phase === 'moving' && scored(q) ? 1 : 0),
        mainPlanned: plannedOf(live),
        // For 다음 유형: what is being asked now, how many of it are left (this one too until it is answered), and what comes next.
        section: this.sectionInfo(),
        // The lobby's 오늘 낼 문제: each type with how many rows it has and whether it is in.
        plan:
          live.phase === 'lobby'
            ? {
                sections: SECTIONS.map((key) => ({ key, label: SECTION_LABEL[key], count: rowsOf(db().events[live.eventId]?.questions.filter((q) => sectionOf(q) === key) ?? []), on: !live.off.has(key) })).filter((x) => x.count > 0),
                estimateSec: estimateSecOf(live.mainList, db().events[live.eventId]?.retryRound),
                breaks: live.breaks,
              }
            : null,
        remainingSec: Math.round(live.list.slice(live.index + 1).reduce((s, x) => s + playSeconds(x), 0)),
        hardest: live.phase === 'summary' ? live.hardest : null,
      };
    }
    // For the setup guide: whether a projector screen is open, and how many phones (registered or not) are connected.
    const displayOn = [...this.clients].some((c) => c.role === 'display');
    const phones = new Set([...this.clients].filter((c) => c.role === 'student' && c.tokenHash).map((c) => c.tokenHash)).size;
    return { role: 'teacher', serverNow: Date.now(), joinUrl: this.joinUrl, qr: this.qr, classes, students, requests, events, live: liveDetail, displayOn, phones, agora: teacherAgora(this.agoraLive) };
  }

  private registrationContext(): RegistrationContext {
    const d = db();
    const open = this.registrationOpen();
    const latest = new Map<string, RequestRec>();
    for (const r of Object.values(d.requests)) {
      const prev = latest.get(r.tokenHash);
      if (!prev || r.createdAt >= prev.createdAt) latest.set(r.tokenHash, r);
    }
    if (!open) return { open, latest, classes: [] };
    const today = this.todayClass();
    const classes = Object.values(d.classes)
      .filter((c) => !today || c.id === today)
      .sort((a, b) => compareNames(a.name, b.name))
      .map((c) => ({ id: c.id, name: c.name }));
    return { open, latest, classes };
  }

  studentView(tokenHash?: string, getReg: () => RegistrationContext = () => this.registrationContext()) {
    const d = db();
    const base = { role: 'student', serverNow: Date.now() };
    const student = this.studentOf(tokenHash);
    if (!student) {
      const reg = getReg();
      const req = tokenHash ? reg.latest.get(tokenHash) : undefined;
      return {
        ...base,
        me: null,
        // Only what this phone typed itself; no other student's name ever reaches an unregistered phone.
        request: req ? { status: req.status, reason: req.reason, symbol: req.symbol, className: className(req.classId), number: req.number, name: req.name } : null,
        registrationOpen: reg.open,
        classes: reg.classes,
      };
    }
    // A quiz or an 아고라 for another class is none of this phone's business: it sees neither.
    const now = this.agoraNow();
    const lessonFor = this.live?.classId ?? this.agoraLive?.classId;
    const elsewhere = lessonFor && lessonFor !== student.classId ? className(lessonFor) : null;
    const live = elsewhere ? null : this.live;
    const me = {
      id: student.id,
      className: className(student.classId),
      number: student.number,
      name: student.name,
      look: student.look,
      inventory: student.inventory,
      stamps: d.attendance[student.id]?.length ?? 0,
    };
    const last = d.lastSummary[student.id];
    const lastNotes = last && (!live || live.phase === 'lobby') ? { eventName: last.eventName, at: last.at, wrong: last.wrong, practice: last.practice } : null;
    if (!live) {
      const agora = now && this.agoraLive && !elsewhere ? studentAgora(now.agora, now.topic, this.agoraLive, student.id) : null;
      // 내 답 노트 goes with the home screen only, so the class's answers coming in don't resend it to every phone.
      return { ...base, me, session: null, lastNotes, elsewhere, agora, agoraNotes: agora ? null : studentNotes(student.id) };
    }
    const q = this.currentQuestion();
    const mine = live.choices.get(student.id);
    let result = null;
    if (live.phase === 'reveal' && q && live.reveal) {
      const choice = mine?.choice ?? -1;
      result = {
        choice,
        correct: !!mine?.correct,
        correctLabel: live.reveal.correctLabel,
        fill: live.reveal.fill,
        mineLabel: choice >= 0 ? q.options[choice]?.label : mine?.text ?? null,
        feedback: choice >= 0 && choice !== q.answerIndex ? q.options[choice]?.feedback : undefined,
        explanation: q.explanation,
        counted: !!mine,
        streak: mine?.streak ?? 0,
        broke: mine?.broke ?? 0,
        friends: mine ? this.correctFriends(student.id, q.mode === 'CUSTOM_TEXT') : { total: 0, looks: [] },
      };
    }
    return {
      ...base,
      me,
      session: this.sessionPublic(),
      joined: live.joined.has(student.id),
      myPoint: live.phase === 'moving' || live.phase === 'intro' ? live.positions.get(student.id) ?? null : null,
      myText: live.texts.get(student.id) ?? null,
      myTextFinal: live.textFinal.has(student.id),
      result,
      mySummary: live.phase === 'summary' ? live.studentSummary.get(student.id) ?? null : null,
      lastNotes,
    };
  }

  /** Classmates who got this question right, as characters only (no names), for the phone's result. */
  private correctFriends(selfId: string, text: boolean): { total: number; looks: AvatarLook[] } {
    const d = db();
    const others = this.live!.correctOrder.filter((id) => id !== selfId);
    // The projector never shows who typed what, so a text question sends only the count.
    const shown = text ? [] : others.slice(0, FRIENDS_SHOWN);
    return { total: others.length, looks: shown.map((id) => normalizeLook(d.students[id]?.look ?? undefined)) };
  }

  // ---------- registration ----------

  /**
   * First visit: the student types 반, 번호 and 이름. The request is matched against the roster
   * (if the teacher entered one) and waits for the teacher's approval either way.
   */
  requestRegistration(tokenHash: string, input: { classId: string; number: number; name: string }) {
    const d = db();
    if (!this.registrationOpen()) throw new Error('선생님 화면이 켜져 있을 때 등록할 수 있어요.');
    if (d.devices[tokenHash]) throw new Error('이 기기는 이미 등록되어 있어요.');
    const cls = own(d.classes, input.classId);
    if (!cls) throw new Error('반을 골라 주세요.');
    const today = this.todayClass();
    if (today && cls.id !== today) throw new Error(`지금은 ${className(today)} 수업이라 그 반만 등록할 수 있어요.`);
    const number = Number(input.number);
    if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('번호는 1~99 사이로 써 주세요.');
    const name = cleanName(String(input.name ?? ''));
    if (!NAME_RE.test(name)) throw new Error('이름은 한글이나 영어로 써 주세요.');
    for (const r of Object.values(d.requests)) {
      if (r.tokenHash === tokenHash && r.status === 'pending') {
        r.status = 'expired';
        r.reason = 'cancelled';
      }
    }
    const pending = Object.values(d.requests).filter((r) => r.status === 'pending');
    if (pending.length >= Math.max(60, 3 * Object.keys(d.students).length)) throw new Error('대기 중인 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
    if (pending.filter((r) => r.classId === cls.id && r.number === number).length >= 3) throw new Error('이 번호로 온 요청이 너무 많아요. 선생님께 말해 주세요.');
    const seat = this.classify({ classId: cls.id, number, name });
    const id = newId('req');
    const taken = new Set(pending.map((r) => r.symbol));
    let symbol = '';
    for (let i = 0; i < 50 && (!symbol || taken.has(symbol)); i++) symbol = `${ANIMALS[randomInt(ANIMALS.length)]} ${randomInt(10, 100)}`;
    if (taken.has(symbol)) {
      symbol = '';
      outer: for (const animal of ANIMALS) {
        for (let n = 10; n < 100; n++) {
          if (!taken.has(`${animal} ${n}`)) {
            symbol = `${animal} ${n}`;
            break outer;
          }
        }
      }
      if (!symbol) throw new Error('대기 중인 요청이 너무 많아요.');
    }
    d.requests[id] = { id, tokenHash, classId: cls.id, number, name, kind: seat.kind, studentId: seat.at?.id ?? '', symbol, createdAt: Date.now(), status: 'pending' };
    save();
    this.schedulePush(true);
  }

  /**
   * How a registration compares with the roster as it is NOW (the teacher may have pasted or
   * edited it since the student asked), plus what the teacher should know before approving.
   */
  private classify(r: { classId: string; number: number; name: string }) {
    const d = db();
    const classmates = Object.values(d.students).filter((x) => x.classId === r.classId);
    const at = classmates.find((x) => x.number === r.number);
    const bound = !!at && Object.values(d.devices).some((v) => v.studentId === at.id);
    // Anything that would pass to another person if this seat were renamed.
    const records = !!at && (!!at.look || at.inventory.length > 0 || (d.attendance[at.id]?.length ?? 0) > 0 || !!d.lastSummary[at.id]);
    const sameName = classmates.find((x) => x !== at && nameKey(x.name) === nameKey(r.name));
    let kind: RequestRec['kind'] = 'new';
    if (at && nameKey(at.name) === nameKey(r.name)) kind = bound ? 'replace' : 'match';
    else if (at) kind = 'conflict';
    const notes: string[] = [];
    if (kind === 'conflict') notes.push(`명단의 ${r.number}번은 ${at!.name}`, ...(bound ? ['그 학생 폰 등록됨'] : []));
    if (sameName) notes.push(`같은 이름이 ${sameName.number}번에 있어요`);
    return { kind, at, bound, records, note: notes.join(' · ') };
  }

  cancelRegistration(tokenHash: string) {
    for (const r of Object.values(db().requests)) {
      if (r.tokenHash === tokenHash && r.status !== 'approved') {
        r.status = 'expired';
        r.reason = 'cancelled';
      }
    }
    save();
    this.schedulePush(true);
  }

  /** `shownKind` is what the teacher's screen showed; if the roster changed since, nothing happens silently. */
  decideRequest(requestId: string, approve: boolean, shownKind?: string) {
    const d = db();
    const r = own(d.requests, requestId);
    if (!r || r.status !== 'pending') return;
    if (!approve) {
      r.status = 'rejected';
      save();
      this.schedulePush(true);
      return;
    }
    const cls = own(d.classes, r.classId);
    if (!cls) throw new Error('그 반이 없어졌어요. 거절해 주세요.');
    const { kind, at } = this.classify(r);
    // Approvals always say what the teacher saw; an old screen that doesn't is asked to reload.
    if (shownKind === undefined) throw new Error('선생님 화면을 새로 고친 뒤 다시 승인해 주세요.');
    if (shownKind !== kind) throw new Error('명단이 바뀌었어요. 요청을 다시 확인해 주세요.');
    r.kind = kind;
    let studentId: string;
    if (!at) {
      studentId = newId('stu');
      d.students[studentId] = { id: studentId, classId: r.classId, number: r.number, name: r.name, look: null, inventory: [], createdAt: Date.now() };
    } else {
      // A different name at that number is renamed only on a conflict the teacher saw and approved.
      if (kind === 'conflict') at.name = r.name;
      studentId = at.id;
    }
    r.status = 'approved';
    r.studentId = studentId;
    // One permanent device per student: approving a new one releases the old one.
    for (const [hash, dev] of Object.entries(d.devices)) {
      if (dev.studentId === studentId) delete d.devices[hash];
    }
    d.devices[r.tokenHash] = { studentId, createdAt: Date.now(), lastSeen: Date.now() };
    // Other requests for the same seat are settled by this one.
    for (const other of Object.values(d.requests)) {
      if (other !== r && other.status === 'pending' && other.classId === r.classId && other.number === r.number) {
        other.status = 'expired';
        other.reason = 'taken';
      }
    }
    if (d.students[studentId]?.look) this.join(studentId);
    save();
    this.schedulePush(true);
  }

  /**
   * Approves what needs no checking: a roster match without a phone, or a new number nobody
   * else asked for. Phone changes, number clashes and look-alike wrong numbers wait for the
   * teacher, and during a lobby or quiz only today's class is approved.
   */
  /**
   * Requests [모두 승인] takes, with the kind they were taken as: roster matches and new students, one per seat,
   * today's class during a session, and nothing with a note (a same name at another number may be a student
   * who already has a seat). The rest wait for the teacher one by one.
   */
  private autoApprovable(): Map<string, 'match' | 'new'> {
    const pending = Object.values(db().requests).filter((r) => r.status === 'pending');
    const today = this.todayClass();
    const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    const perSeat = new Map<string, number>();
    // Two phones asking with one name at two numbers: one of them is likely a typo, like a same name already on the roster.
    const perName = new Map<string, number>();
    for (const r of pending) {
      count(perSeat, `${r.classId}:${r.number}`);
      count(perName, `${r.classId}:${nameKey(r.name)}`);
    }
    const out = new Map<string, 'match' | 'new'>();
    for (const r of pending) {
      const { kind, note } = this.classify(r);
      if (kind !== 'match' && kind !== 'new') continue;
      if (perSeat.get(`${r.classId}:${r.number}`) !== 1 || perName.get(`${r.classId}:${nameKey(r.name)}`) !== 1) continue;
      if (today && r.classId !== today) continue;
      if (note) continue;
      out.set(r.id, kind);
    }
    return out;
  }

  approveAllSimple(): number {
    let n = 0;
    for (const [id, kind] of this.autoApprovable()) {
      // Each approval can change the roster the next one is judged against.
      const r = db().requests[id];
      if (!r || r.status !== 'pending') continue;
      const now = this.classify(r);
      if (now.kind !== kind || now.note) continue;
      try {
        this.decideRequest(id, true, kind);
        n++;
      } catch {
        // The roster changed under it; leave it for the teacher.
      }
    }
    return n;
  }

  revokeDevice(studentId: string) {
    const d = db();
    for (const [hash, dev] of Object.entries(d.devices)) {
      if (dev.studentId === studentId) delete d.devices[hash];
    }
    this.live?.joined.delete(studentId);
    save();
    this.schedulePush(true);
  }

  setLook(tokenHash: string, raw: Partial<AvatarLook>) {
    const s = this.studentOf(tokenHash);
    if (!s) throw new Error('등록된 기기가 아니에요.');
    // Only known fields with known values; item slots only with items this student owns.
    const prev = normalizeLook(s.look ?? undefined) as unknown as Record<string, string>;
    const next: Record<string, string> = { ...prev };
    // Free choices only from their lists, so a made-up value can't draw a broken character on everyone's screen.
    const free: Record<string, { id: string }[]> = { skin: SKIN_TONES, hair: HAIR_COLORS, hairStyle: HAIR_STYLES, eyes: EYE_STYLES };
    for (const key of Object.keys(DEFAULT_LOOK)) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value !== 'string' || value.length > 32) continue;
      if (Object.hasOwn(free, key)) {
        if (free[key].some((o) => o.id === value)) next[key] = value;
      } else if (value === (DEFAULT_LOOK as unknown as Record<string, string>)[key]) next[key] = value;
      else if (ITEMS.some((item) => item.slot === key && item.value === value && s.inventory.includes(item.id))) next[key] = value;
    }
    s.look = normalizeLook(next as unknown as Partial<AvatarLook>);
    this.join(s.id);
    save();
    this.schedulePush(true);
  }

  // ---------- classes ----------

  addClass(name: string): string {
    const d = db();
    const clean = name.trim().slice(0, 20);
    if (!clean) throw new Error('반 이름을 써 주세요.');
    if (Object.values(d.classes).some((c) => c.name === clean)) throw new Error(`'${clean}'은 이미 있어요.`);
    const id = newId('cls');
    d.classes[id] = { id, name: clean, createdAt: Date.now() };
    save();
    this.schedulePush(true);
    return id;
  }

  renameClass(classId: string, name: string) {
    const d = db();
    const clean = name.trim().slice(0, 20);
    if (!own(d.classes, classId) || !clean) throw new Error('반 이름을 써 주세요.');
    if (Object.values(d.classes).some((c) => c.id !== classId && c.name === clean)) throw new Error(`'${clean}'은 이미 있어요.`);
    d.classes[classId].name = clean;
    save();
    this.schedulePush(true);
  }

  /** Deletes a class; with `withStudents` its students go too (the teacher confirmed that). */
  deleteClass(classId: string, withStudents = false) {
    const d = db();
    if (!own(d.classes, classId)) return;
    if (this.live?.classId === classId) throw new Error('수업 중인 반은 지울 수 없어요. 아레나를 먼저 닫아 주세요.');
    if (this.agoraLive?.classId === classId) throw new Error('아고라가 열려 있는 반은 지울 수 없어요. 아고라를 먼저 닫아 주세요.');
    const students = Object.values(d.students).filter((s) => s.classId === classId);
    if (students.length && !withStudents) throw new Error('학생이 있는 반이에요. 학생도 함께 지울지 확인해 주세요.');
    this.removeStudents(students.map((s) => s.id));
    for (const r of Object.values(d.requests)) {
      if (r.status === 'pending' && r.classId === classId) {
        r.status = 'expired';
        r.reason = 'gone';
      }
    }
    dropClassRuns(classId);
    delete d.classes[classId];
    save();
    this.schedulePush(true);
  }

  /** End of term or new phones: every student of the class registers again (records stay). */
  revokeClass(classId: string): number {
    const d = db();
    let n = 0;
    for (const [hash, dev] of Object.entries(d.devices)) {
      if (d.students[dev.studentId]?.classId !== classId) continue;
      delete d.devices[hash];
      this.live?.joined.delete(dev.studentId);
      n++;
    }
    save();
    this.schedulePush(true);
    return n;
  }

  /** Adds or renames students of one class from lines like "3 김하윤"; other classes are untouched. */
  /**
   * Adds roster lines to a class. The paste box renames a seat whose name differs ('같은 번호는 이름을 바꿔요');
   * an Excel 명단 sheet passes rename: false, so a weekly file can't quietly hand a registered student's
   * phone, character and stamps to another name (rosterConflicts warns about those rows instead).
   */
  setRoster(classId: string, lines: string, { rename = true }: { rename?: boolean } = {}) {
    const d = db();
    if (!own(d.classes, classId)) throw new Error('반을 먼저 골라 주세요.');
    const byNumber = new Map(Object.values(d.students).filter((s) => s.classId === classId).map((s) => [s.number, s]));
    let added = 0;
    for (const line of lines.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)[\s.,)\t]+(.+)$/);
      if (!m) continue;
      const number = Number(m[1]);
      const name = m[2].trim();
      // Students can only type 1-99 when they register, so other numbers could never be matched.
      if (number < 1 || number > 99) continue;
      const existing = byNumber.get(number);
      if (existing) {
        if (rename) existing.name = name;
      } else {
        const id = newId('stu');
        d.students[id] = { id, classId, number, name, look: null, inventory: [], createdAt: Date.now() };
        byNumber.set(number, d.students[id]);
        added++;
      }
    }
    save();
    this.schedulePush(true);
    return added;
  }

  removeStudent(studentId: string) {
    this.removeStudents([studentId]);
  }

  /**
   * Takes students off the roster with their phone, character, saved notes, attendance and 아고라 answers.
   * Past answers stay in the class's word statistics. Not while their class is mid-quiz.
   */
  removeStudents(studentIds: string[]): number {
    const d = db();
    const live = this.live;
    const ids = studentIds.filter((id) => own(d.students, id));
    if (live && live.phase !== 'lobby' && live.phase !== 'summary' && ids.some((id) => d.students[id].classId === live.classId)) {
      throw new Error('퀴즈가 진행 중인 반의 학생은 지울 수 없어요.');
    }
    // Other phones' requests for these seats stay; classify() shows them as new students now.
    for (const id of ids) {
      for (const [hash, dev] of Object.entries(d.devices)) if (dev.studentId === id) delete d.devices[hash];
      live?.joined.delete(id);
      this.agoraLive?.joined.delete(id);
      this.agoraWrites.delete(id);
      delete d.lastSummary[id];
      delete d.attendance[id];
      delete d.students[id];
    }
    dropStudentAnswers(ids);
    save();
    this.schedulePush(true);
    return ids.length;
  }

  // ---------- 아고라 ----------

  /** A change to the 아고라 records (agora.ts): saved, and every screen gets its new view. */
  changeAgora<T>(change: () => T): T {
    const out = change();
    save();
    this.schedulePush(true);
    return out;
  }

  /** A new 아고라 (agoraId null), or a changed one; not the open one, whose topics are on screen. Returns its id. */
  saveAgora(agoraId: string | null, input: AgoraInput): string {
    if (agoraId !== null && this.agoraLive?.agoraId === agoraId) throw new Error('열려 있는 아고라는 고칠 수 없어요. 아고라를 닫은 뒤 고쳐 주세요.');
    return this.changeAgora(() => {
      if (agoraId === null) return addAgora(input);
      editAgora(agoraId, input);
      return agoraId;
    });
  }

  /** 이번 아고라 보상: the item a ⭐ gives from now on. */
  setAgoraReward(agoraId: string, itemId: string) {
    this.changeAgora(() => setReward(agoraId, itemId));
  }

  /** An 아고라 goes with its answers, but not while it is open. */
  removeAgora(agoraId: string) {
    if (this.agoraLive?.agoraId === agoraId) throw new Error('열려 있는 아고라는 지울 수 없어요. 아고라를 닫은 뒤 지워 주세요.');
    this.changeAgora(() => deleteAgora(agoraId));
  }

  /** The open session's 아고라 and the topic up, if any. */
  private agoraNow(): { agora: AgoraRec; topic: TopicRec } | undefined {
    const live = this.agoraLive;
    const agora = live ? own(db().agoras, live.agoraId) : undefined;
    const topic = live && agora ? agora.topics[live.index] : undefined;
    return agora && topic ? { agora, topic } : undefined;
  }

  /** The class whose lesson is on (the arena's or the 아고라's): only it registers new phones. */
  private todayClass(): string | undefined {
    return this.live?.classId ?? this.agoraLive?.classId;
  }

  /** The session's class's students who are connected now come in (agoraJoin). */
  private notePresent() {
    if (!this.agoraLive) return;
    for (const id of this.connectedStudents()) this.agoraJoin(id);
  }

  /**
   * A student of the session's class with a character comes in, as into an arena lobby: they show in the 대기실 and
   * keep a card, and once the 대기실 is over they get the day's footprint (a 대기실 closed before [쓰기 시작] stamps
   * nothing).
   */
  private agoraJoin(studentId: string) {
    const live = this.agoraLive;
    const s = db().students[studentId];
    if (!live || !s?.look || s.classId !== live.classId || live.joined.has(studentId)) return;
    live.joined.add(studentId);
    if (live.phase !== 'lobby') this.stampAttendance(studentId);
  }

  /**
   * [대기실 열기] for a lesson, or [다시 보기] (`review`) for a class that did it before: the 아고라 opens for one class,
   * as an arena lobby does. The projector shows the QR, the first topic (or the lesson looked at again) and who has
   * come in, and the class's phones wait. Not while the arena or another 아고라 is open.
   */
  openAgora(agoraId: string, classId: string, review = false) {
    const d = db();
    const a = own(d.agoras, agoraId);
    if (!a?.topics.length) throw new Error('그 아고라가 없어졌어요. 화면을 새로 고쳐 주세요.');
    if (!own(d.classes, classId)) throw new Error('오늘 반을 골라 주세요.');
    const lesson = review ? lessonOf(a, classId) : null;
    if (review && lesson === null) throw new Error('이 반은 이 아고라에 쓴 답이 없어요.');
    if (this.live) throw new Error('아레나가 열려 있어요. 아레나를 닫은 뒤 열어 주세요.');
    if (this.agoraLive) throw new Error('아고라가 이미 열려 있어요. 닫은 뒤 다시 열어 주세요.');
    resetCards(a, classId);
    this.agoraLive = {
      agoraId: a.id,
      classId,
      review: lesson,
      index: 0,
      wrote: new Set(),
      phase: 'lobby',
      reveal: 'hidden',
      page: 0,
      pages: 1,
      music: true,
      timer: null,
      joined: new Set(),
      howtoAt: null,
      id: newId('agl'),
      rewarded: new Map(),
    };
    // As when an arena lobby opens: other classes' requests can't be approved during this class.
    for (const r of Object.values(d.requests)) {
      if (r.status === 'pending' && r.classId !== classId) {
        r.status = 'expired';
        r.reason = 'class';
      }
    }
    this.notePresent();
    save();
    this.schedulePush(true);
  }

  /**
   * [쓰기 시작]: the first topic from the 대기실, a later one from its 준비. In 다시 보기, [함께 보기] instead puts up the
   * class's answers to the first topic, hidden. Leaving the 대기실, everyone in gets the day's footprint.
   */
  startAgora() {
    const live = this.agoraLive;
    const now = this.agoraNow();
    if (!live || !now) return;
    const fromLobby = live.phase === 'lobby';
    if (live.review !== null) {
      if (!fromLobby) return;
      live.phase = 'closed';
    } else {
      if (!fromLobby && live.phase !== 'ready') return;
      this.startWriting(now.agora, now.topic);
    }
    if (fromLobby) {
      this.stopHowto();
      for (const id of live.joined) this.stampAttendance(id);
    }
    save();
    this.schedulePush(true);
  }

  /** [다시 쓰기] in 다시 보기: the topic up opens for writing again, each phone starting from its own answer. */
  rewriteAgora() {
    const live = this.agoraLive;
    const now = this.agoraNow();
    if (!live || !now || live.review === null || live.phase !== 'closed') return;
    this.startWriting(now.agora, now.topic);
    save();
    this.schedulePush(true);
  }

  /** Students write to the topic up: its 입력 시간 starts, and a lesson becomes this class's latest run of the 아고라. */
  private startWriting(a: AgoraRec, t: TopicRec) {
    const live = this.agoraLive;
    if (!live) return;
    live.phase = 'writing';
    live.wrote.add(t.id);
    if (live.review === null) a.runs[live.classId] = Date.now();
    this.startTimer(t);
  }

  /** [지금 마감], or the end of the 입력 시간: no more writing or changing. The answers stay up to be shown and talked about. */
  closeAgora() {
    const live = this.agoraLive;
    if (!live || live.phase !== 'writing') return;
    this.stopTimer();
    live.phase = 'closed';
    save();
    this.schedulePush(true);
  }

  /**
   * [다음 주제] or [건너뛰기]: the next topic comes up, closing writing on this one if it was open (its answers stay). In
   * a lesson it comes up to be read first (준비), and after the last topic comes the 끝; in 다시 보기 the class's
   * answers to it come up hidden, and the last topic has no next.
   */
  nextAgoraTopic() {
    const live = this.agoraLive;
    const now = this.agoraNow();
    if (!live || !now || live.phase === 'lobby' || live.phase === 'end') return;
    const last = live.index >= now.agora.topics.length - 1;
    if (last && live.review !== null) return;
    this.stopTimer();
    live.reveal = 'hidden';
    live.page = 0;
    live.pages = 1;
    if (last) live.phase = 'end';
    else {
      live.index += 1;
      live.phase = live.review !== null ? 'closed' : 'ready';
    }
    save();
    this.schedulePush(true);
  }

  /** [아고라 닫기], or [대기실 닫기]: the projector goes back to its QR and the phones to their home screen. */
  endAgora() {
    this.clearAgora();
    save();
    this.schedulePush(true);
  }

  private clearAgora() {
    this.stopTimer();
    this.stopHowto();
    this.agoraLive = null;
  }

  /** [놀이 방법] in the 대기실: the arena's 12 seconds of demo on the projector. Pressed again it starts over. */
  agoraHowto() {
    const live = this.agoraLive;
    if (!live || live.phase !== 'lobby') return;
    this.stopHowto();
    live.howtoAt = Date.now();
    this.agoraHowtoTimeout = setTimeout(() => {
      this.agoraHowtoTimeout = null;
      live.howtoAt = null;
      this.schedulePush(true);
    }, HOWTO_MS);
    this.schedulePush(true);
  }

  /** The demo never covers writing, and stops with the 대기실. */
  private stopHowto() {
    if (this.agoraHowtoTimeout) clearTimeout(this.agoraHowtoTimeout);
    this.agoraHowtoTimeout = null;
    if (this.agoraLive) this.agoraLive.howtoAt = null;
  }

  /** The topic up has its cards on screen (being written, or answers looked at): the times answers can be shown. */
  private agoraBoard() {
    const live = this.agoraLive;
    const now = this.agoraNow();
    return live && now && (live.phase === 'writing' || live.phase === 'closed') ? { live, topic: now.topic } : undefined;
  }

  /** [전체 공개] / [전체 비공개] while a topic's cards are up. The projector starts again from its first page. */
  revealAgora(isPublic: boolean) {
    const board = this.agoraBoard();
    if (!board) return;
    board.live.reveal = isPublic ? 'public' : 'hidden';
    if (isPublic) revealCards(board.topic, board.live.classId);
    board.live.page = 0;
    save();
    this.schedulePush(true);
  }

  /**
   * The teacher clicks an answer, on the teacher screen (by student) or on the projector (by number, as its cards
   * carry no ids): just that answer is shown or hidden. A student without an answer has nothing to flip.
   */
  flipAgoraCard(who: { studentId?: string; number?: number }) {
    const d = db();
    const board = this.agoraBoard();
    if (!board) return;
    const { live, topic } = board;
    const student = who.studentId !== undefined ? own(d.students, who.studentId) : Object.values(d.students).find((s) => s.classId === live.classId && s.number === who.number);
    const a = student?.classId === live.classId ? own(d.topicAnswers[topic.id] ?? {}, student.id) : undefined;
    if (!a) return;
    flipCard(live.reveal, a);
    save();
    this.schedulePush(true);
  }

  /**
   * The teacher's ⭐ on a student's answer to the topic up, from the teacher screen, while its cards are up: given, or
   * taken back (toggleStar). A student without an answer has nothing to praise.
   */
  starAgoraCard(studentId: string) {
    const d = db();
    const board = this.agoraBoard();
    const agora = this.agoraNow()?.agora;
    if (!board || !agora) return;
    const student = own(d.students, studentId);
    const a = student?.classId === board.live.classId ? own(d.topicAnswers[board.topic.id] ?? {}, student.id) : undefined;
    if (!a) return;
    toggleStar(agora, board.live, a, studentId);
    save();
    this.schedulePush(true);
  }

  /** The teacher deletes one answer, today's or an earlier lesson's; while writing is open, its student can write again. */
  removeAgoraCard(topicId: string, studentId: string) {
    const found = findTopic(topicId);
    if (!found) return;
    dropAnswer(found.topic, studentId);
    save();
    this.schedulePush(true);
  }

  /** 열 and 순서 of the topic up. They stay with the topic for next time, and the projector starts from its first page. */
  agoraSettings(input: { columns?: unknown; sort?: unknown }) {
    const live = this.agoraLive;
    const now = this.agoraNow();
    if (!live || !now || live.phase === 'end') return;
    setSettings(now.topic, input);
    live.page = 0;
    save();
    this.schedulePush(true);
  }

  /** ◀ ▶ on the teacher screen and ←/→ on the projector: one page on, or back. */
  turnAgoraPage(dir: number) {
    const live = this.agoraLive;
    if (!live || !Number.isFinite(dir)) return;
    live.page = clamp(live.page + Math.sign(dir), 0, live.pages - 1);
    this.schedulePush(true);
  }

  /** How many pages the projector's cards take at its size; it measures them and says whenever that changes. */
  setAgoraPages(count: number) {
    const live = this.agoraLive;
    if (!live || !Number.isFinite(count)) return;
    const pages = clamp(Math.round(count), 1, 99);
    if (pages === live.pages) return;
    live.pages = pages;
    live.page = Math.min(live.page, pages - 1);
    this.schedulePush(true);
  }

  /** The song's switch on the teacher screen. */
  toggleAgoraMusic() {
    if (!this.agoraLive) return;
    this.agoraLive.music = !this.agoraLive.music;
    this.schedulePush(true);
  }

  /** [+1분] / [−1분] while students write. Never below ten seconds left: closing now is what [지금 마감] is for. */
  adjustAgoraTime(minutes: number) {
    const live = this.agoraLive;
    const timer = live?.timer;
    if (!live || live.phase !== 'writing' || !timer || !Number.isFinite(minutes)) return;
    timer.endsAt = Math.max(Date.now() + 10_000, timer.endsAt + Math.round(clamp(minutes, -10, 10)) * 60_000);
    this.armTimer();
    this.schedulePush(true);
  }

  /** The topic's 입력 시간, counted from now; none for a topic without a limit. */
  private startTimer(t: TopicRec) {
    this.stopTimer();
    if (!this.agoraLive || !t.minutes) return;
    const now = Date.now();
    this.agoraLive.timer = { startedAt: now, endsAt: now + t.minutes * 60_000 };
    this.armTimer();
  }

  /** At the end of the 입력 시간 writing closes by itself, as if the teacher had pressed [지금 마감]. */
  private armTimer() {
    if (this.agoraTimeout) clearTimeout(this.agoraTimeout);
    this.agoraTimeout = null;
    const timer = this.agoraLive?.timer;
    if (!timer) return;
    this.agoraTimeout = setTimeout(() => {
      this.agoraTimeout = null;
      this.closeAgora();
    }, Math.max(0, timer.endsAt - Date.now()));
  }

  private stopTimer() {
    if (this.agoraTimeout) clearTimeout(this.agoraTimeout);
    this.agoraTimeout = null;
    if (this.agoraLive) this.agoraLive.timer = null;
  }

  /** A student's answer to the topic up, new or changed; changed in 다시 쓰기, it keeps its 처음 답. */
  answerTopic(tokenHash: string, topicId: string, text: unknown) {
    const { student, topic, live } = this.agoraWriter(tokenHash, topicId);
    putAnswer(topic, student.id, text, live.review !== null);
    this.agoraJoin(student.id);
    save();
    this.schedulePush(true);
  }

  /** A student takes back their answer; not in 다시 쓰기, where the answer being changed is last lesson's. */
  unanswerTopic(tokenHash: string, topicId: string) {
    const { student, topic, live } = this.agoraWriter(tokenHash, topicId);
    if (live.review !== null) throw new Error('다시 쓰기에서는 지울 수 없어요. 고쳐서 제출해 주세요.');
    dropAnswer(topic, student.id);
    save();
    this.schedulePush(true);
  }

  /**
   * Who may write, checked here and never on the phone: an approved phone, writing to the topic up after
   * [쓰기 시작] and before 마감, from the session's class, at most AGORA_WRITES times in AGORA_WINDOW_MS. The topic's
   * id comes along, so an answer typed while the teacher moved on doesn't land on the next topic.
   */
  private agoraWriter(tokenHash: string, topicId: string) {
    const student = this.studentOf(tokenHash);
    if (!student) throw new Error('등록된 기기가 아니에요.');
    const live = this.agoraLive;
    const topic = this.agoraNow()?.topic;
    if (!live || !topic || topic.id !== topicId) throw new Error('주제가 바뀌었어요. 화면을 확인해 주세요.');
    if (live.classId !== student.classId) throw new Error('우리 반 주제가 아니에요.');
    if (live.phase === 'lobby' || live.phase === 'ready') throw new Error('선생님이 시작하면 쓸 수 있어요.');
    if (live.phase !== 'writing') throw new Error('마감됐어요.');
    const now = Date.now();
    // An answer that lands in the last instant, before the timer has closed writing.
    if (live.timer && now > live.timer.endsAt) throw new Error('시간이 끝났어요.');
    const recent = (this.agoraWrites.get(student.id) ?? []).filter((at) => now - at < AGORA_WINDOW_MS);
    if (recent.length >= AGORA_WRITES) throw new Error('조금 있다가 다시 해 주세요.');
    recent.push(now);
    this.agoraWrites.set(student.id, recent);
    return { student, topic, live };
  }

  private stampAttendance(studentId: string) {
    const d = db();
    const days = (d.attendance[studentId] ??= []);
    const today = todayKey();
    if (days.includes(today)) return false;
    days.push(today);
    const s = d.students[studentId];
    // One item per 5 footprints; anything already earned but missing (the rule used to be every 10) is caught up too.
    const earned = ATTENDANCE_UNLOCKS.slice(0, Math.floor(days.length / STAMPS_PER_UNLOCK));
    for (const unlock of earned) {
      if (!s || s.inventory.includes(unlock)) continue;
      s.inventory.push(unlock);
      d.rewards.push({ sessionId: this.live?.id ?? '', eventId: this.live?.eventId ?? '', studentId, itemId: unlock, reason: 'attendance', at: Date.now() });
    }
    save();
    return true;
  }

  // ---------- events ----------

  /** `title` is typed in [직접 작성하기]; an upload passes its file name instead. */
  makeDraft(result: { words: Word[]; grammar: GrammarItem[]; questions: CustomQuestion[]; roster: { className: string; number: number; name: string }[]; issues: ImportIssue[] }, fileName?: string, title?: string) {
    // Only the name as shown in the teacher's file picker: no folders, no control characters, not too long.
    const cleanFile = fileName?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || undefined;
    // Rows without a 세트 make an event named after the file ('3주차 단어장'), or after the day if the name is unknown.
    // Cut by characters, not UTF-16 units, so an emoji at the cut isn't left half there.
    const cut = (s: string) => Array.from(s.trim()).slice(0, 40).join('');
    const defaultName = (title && cut(title)) || (cleanFile && cut(cleanFile.replace(/\.xlsx?$/i, ''))) || `${shortDate()} 퀴즈`;
    const groups = new Map<string, { words: Word[]; grammar: GrammarItem[]; custom: CustomQuestion[] }>();
    const group = (name: string) => {
      if (!groups.has(name)) groups.set(name, { words: [], grammar: [], custom: [] });
      return groups.get(name)!;
    };
    for (const w of result.words) group(w.set || defaultName).words.push(w);
    // Grammar and 문항 rows without a 세트 join the words' quiz when there is just one (decided once, so the order of the
    // rows doesn't matter). Without words, they join the grammar's 세트 when every grammar row has the same one.
    const grammarSets = new Set(result.grammar.map((g) => g.set ?? ''));
    const target =
      groups.size === 1 ? [...groups.keys()][0] : groups.size === 0 && grammarSets.size === 1 && !grammarSets.has('') ? [...grammarSets][0] : defaultName;
    for (const g of result.grammar) group(g.set || target).grammar.push(g);
    for (const q of result.questions) group(q.set || target).custom.push(q);
    const draft: Draft = { id: newId('draft'), createdAt: Date.now(), groups: [...groups].map(([name, g]) => ({ name, ...g })), generated: new Map(), roster: result.roster, issues: result.issues, fileName: cleanFile, typed: title !== undefined };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  /** Old words help as distractors, minus anything this upload is replacing (even ones now 보관/검토). */
  private bankFor(draft: Draft) {
    const uploaded = new Set(draft.groups.flatMap((g) => g.words.map((w) => w.key)));
    return Object.values(db().words).filter((w) => !uploaded.has(w.key));
  }

  private generateFor(draft: Draft, g: Draft['groups'][number]): Generated {
    const cached = draft.generated.get(g.name);
    if (cached) return cached;
    const others = draft.groups.filter((x) => x !== g).flatMap((x) => x.words.filter((w) => w.status === '사용'));
    const gen = generateEvent({ words: g.words, grammar: g.grammar, custom: g.custom, bank: [...this.bankFor(draft), ...others], askedBefore: this.askedWords(), seed: hashString(draft.id + g.name), defaultSeconds: DEFAULT_SECONDS });
    draft.generated.set(g.name, gen);
    return gen;
  }

  previewDraft(draft: Draft) {
    return draft.groups.map((g) => {
      const gen = this.generateFor(draft, g);
      return {
        name: g.name,
        wordCount: g.words.filter((w) => w.status === '사용').length,
        reviewCount: g.words.filter((w) => w.status === '검토').length,
        customCount: g.custom.length,
        grammarCount: g.grammar.filter((x) => x.status === '사용').length,
        // Rows of each 문법 tab, in the order they are asked.
        grammarByTab: Object.fromEntries(GRAMMAR_TABS.map((t) => [t, g.grammar.filter((x) => x.status === '사용' && x.tab === t).length])),
        questions: gen.questions.map((q) => ({ prompt: q.prompt, modeLabel: q.modeLabel, options: q.options.map((o) => o.label), answerIndex: q.answerIndex, answers: q.answers })),
        warnings: gen.warnings,
      };
    });
  }

  private askedWords(): Set<string> {
    const set = new Set<string>();
    for (const r of db().responses) if (r.wordKey) set.add(r.wordKey);
    return set;
  }

  /** 명단 rows whose seat already holds someone else; they are left as they are, and the upload preview says so. */
  rosterConflicts(roster: { className: string; number: number; name: string }[]): string[] {
    const d = db();
    const out: string[] = [];
    for (const r of roster) {
      const cls = Object.values(d.classes).find((c) => sameClassName(c.name, r.className));
      const at = cls && Object.values(d.students).find((x) => x.classId === cls.id && x.number === r.number);
      if (at && nameKey(at.name) !== nameKey(r.name)) {
        out.push(`${cls.name} ${r.number}번에 이미 ${at.name} 학생이 있어서 ${r.name}(으)로 바꾸지 않아요. 바꾸려면 학생 탭의 명단 칸에 붙여 넣으세요.`);
      }
    }
    return out;
  }

  createEvents(draftId: string): string[] {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error('업로드한 파일을 다시 올려 주세요.');
    const d = db();
    const ids: string[] = [];
    for (const g of draft.groups) {
      // Words are saved even when a group makes no event (all 검토 or 보관), so retiring words works.
      for (const w of g.words) d.words[w.key] = w;
      const id = newId('evt');
      const gen = this.generateFor(draft, g);
      if (gen.questions.length === 0) continue;
      const existing = new Set(Object.values(d.events).map((e) => e.name));
      let name = g.name;
      for (let k = 2; existing.has(name); k++) name = `${g.name} (${k})`;
      // Rotate through the catalog so the teacher only has to change the reward, not pick one.
      const nextItem = QUIZ_REWARD_ITEMS[Object.keys(d.events).length % QUIZ_REWARD_ITEMS.length];
      d.events[id] = {
        id,
        name,
        createdAt: Date.now(),
        questions: gen.questions,
        retry: gen.retry,
        warnings: gen.warnings,
        reward: { itemId: nextItem.id, challengePct: 70, growthPp: 10 },
        fileName: draft.fileName,
        typed: draft.typed,
      };
      ids.push(id);
    }
    // A 명단 sheet fills each 반 by name, creating classes that don't exist yet.
    const byClass = new Map<string, string[]>();
    for (const r of draft.roster) byClass.set(r.className, [...(byClass.get(r.className) ?? []), `${r.number} ${r.name}`]);
    for (const [name, lines] of byClass) {
      const existing = Object.values(d.classes).find((c) => sameClassName(c.name, name));
      this.setRoster(existing ? existing.id : this.addClass(/^\d+$/.test(name) ? `${name}반` : name), lines.join('\n'), { rename: false });
    }
    this.drafts.delete(draftId);
    save();
    this.schedulePush(true);
    return ids;
  }

  deleteEvent(eventId: string) {
    if (this.live?.eventId === eventId) throw new Error('진행 중인 이벤트는 지울 수 없어요.');
    delete db().events[eventId];
    save();
    this.schedulePush(true);
  }

  setRetryRound(eventId: string, on: boolean) {
    const e = db().events[eventId];
    if (!e) throw new Error('이벤트를 찾을 수 없어요.');
    e.retryRound = on;
    save();
    this.schedulePush(true);
  }

  setReward(eventId: string, itemId: string, challengePct: number, growthPp: number) {
    const e = db().events[eventId];
    if (!e || !itemById(itemId)) throw new Error('이벤트나 아이템을 찾을 수 없어요.');
    e.reward = { itemId, challengePct: clamp(challengePct, 30, 100), growthPp: clamp(growthPp, 1, 50) };
    save();
    this.schedulePush(true);
  }

  // ---------- live session ----------

  openLobby(eventId: string, classId: string) {
    const event = own(db().events, eventId);
    if (!event) throw new Error('이벤트를 찾을 수 없어요.');
    if (!own(db().classes, classId)) throw new Error('오늘 수업할 반을 골라 주세요.');
    // Requests for other classes can't be approved during this class.
    for (const r of Object.values(db().requests)) {
      if (r.status === 'pending' && r.classId !== classId) {
        r.status = 'expired';
        r.reason = 'class';
      }
    }
    if (this.live && this.live.phase !== 'summary') throw new Error('이미 진행 중인 아레나가 있어요.');
    // The projector is the arena's now: an open 아고라 is closed (the teacher screen asked first).
    if (this.agoraLive) {
      this.clearAgora();
      save();
    }
    this.live = {
      id: newId('ses'),
      eventId,
      classId,
      startedAt: Date.now(),
      phase: 'lobby',
      round: 'main',
      list: event.questions,
      index: -1,
      seq: 0,
      phaseEndsAt: null,
      movingStartedAt: 0,
      resumedAt: 0,
      paused: null,
      pausedByBlank: false,
      blank: false,
      // Names under the avatars at the reveal; the teacher can switch them off for a gentler reveal.
      nameLabels: true,
      sound: true,
      music: true,
      autoAdvance: true,
      joined: new Set(),
      positions: new Map(),
      moveCounter: new Map(),
      texts: new Map(),
      textFinal: new Set(),
      textCounter: new Map(),
      lastMoveAt: 0,
      lastSkipAt: 0,
      phaseAt: 0,
      questionAt: 0,
      reveal: null,
      choices: new Map(),
      streak: new Map(),
      bestStreak: new Map(),
      correctOrder: [],
      mainStats: new Map(),
      perStudent: new Map(),
      checkpoint: null,
      summary: null,
      hardest: [],
      studentSummary: new Map(),
      stamped: new Set(),
      mainCount: event.questions.length,
      mainList: event.questions,
      off: new Set(),
      breaks: true,
      skipped: new Set(),
      howtoUntil: 0,
    };
    for (const id of this.connectedStudents()) if (db().students[id]?.look) this.join(id);
    this.startTicker();
    this.schedulePush(true);
  }

  closeSession() {
    this.live = null;
    this.stopTicker();
    this.schedulePush(true);
  }

  private startTicker() {
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), 100);
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  start() {
    const live = this.live;
    if (!live || live.phase !== 'lobby') return;
    for (const id of live.joined) if (this.stampAttendance(id)) live.stamped.add(id);
    live.howtoUntil = 0;
    live.round = 'main';
    live.index = 0;
    this.beginQuestion();
  }

  private beginQuestion() {
    const live = this.live!;
    live.seq++;
    live.phase = 'intro';
    live.positions = new Map();
    live.moveCounter = new Map();
    live.texts = new Map();
    live.textFinal = new Set();
    live.textCounter = new Map();
    live.phaseAt = live.questionAt = Date.now();
    live.choices = new Map();
    live.correctOrder = [];
    live.reveal = null;
    live.checkpoint = null;
    live.phaseEndsAt = Date.now() + (live.index === 0 ? FIRST_INTRO_MS : this.grammarStarts() ? GRAMMAR_INTRO_MS : INTRO_MS);
    this.schedulePush(true);
  }

  tick() {
    const live = this.live;
    if (!live) return;
    if (live.howtoUntil && Date.now() >= live.howtoUntil) {
      live.howtoUntil = 0;
      this.schedulePush(true);
    }
    if (live.blank) {
      // A deadline set while covered (Enter, 다음, Space) waits too, until the screen is uncovered.
      if (!live.paused && live.phaseEndsAt !== null) {
        live.paused = { remaining: Math.max(0, live.phaseEndsAt - Date.now()) };
        live.phaseEndsAt = null;
        live.pausedByBlank = true;
        this.schedulePush(true);
      }
      return;
    }
    if (live.paused || live.phaseEndsAt === null) {
      if (live?.phase === 'moving' && !live.paused) this.maybeEarlyClose();
      return;
    }
    const now = Date.now();
    if (live.phase === 'moving') {
      if (now >= live.phaseEndsAt) this.lock();
      else this.maybeEarlyClose();
      return;
    }
    if (now < live.phaseEndsAt) return;
    if (live.phase === 'intro') {
      const q = this.currentQuestion()!;
      live.phase = 'moving';
      live.phaseAt = now;
      live.movingStartedAt = now;
      live.lastMoveAt = now;
      live.phaseEndsAt = now + q.seconds * 1000;
      this.schedulePush(true);
    } else if (live.phase === 'reveal' || live.phase === 'checkpoint') {
      this.advance();
    }
  }

  private maybeEarlyClose() {
    const live = this.live!;
    const now = Date.now();
    // Wait until the class has had a fair look, and until nobody has moved for 1.5 s.
    if (now - live.movingStartedAt < 4000 || now - live.resumedAt < 3000 || now - live.lastMoveAt < 1500) return;
    const { participants, settled } = this.movingCounts();
    if (participants.length > 0 && settled === participants.length) this.lock();
  }

  private lock() {
    const live = this.live!;
    const q = this.currentQuestion();
    if (!q) return;
    const now = Date.now();
    const connected = this.connectedStudents();
    const counted = [...live.joined].filter((id) => connected.has(id) || live.positions.has(id) || live.texts.has(id));
    // Streaks follow the scored questions only (main-round words and grammar), like the score beside them on the summary.
    const counts = live.round === 'main' && scored(q);
    const zoneCounts = q.options.map(() => 0);
    let correct = 0;
    let unanswered = 0;
    const textWrong = new Map<string, number>();
    for (const id of counted) {
      let choice = -1;
      let ok = false;
      let text: string | undefined;
      if (q.mode === 'CUSTOM_TEXT') {
        text = live.texts.get(id);
        if (text) {
          const typed = normalizeAnswer(text);
          ok = q.grammar ? gradeGrammar(q, text) : (q.answers ?? []).some((a) => normalizeAnswer(a) === typed);
          if (!ok) textWrong.set(typed, (textWrong.get(typed) ?? 0) + 1);
        } else unanswered++;
      } else {
        choice = zoneOf(live.positions.get(id) ?? { x: 0.5, y: 0.5 }, q.options.length);
        if (choice >= 0) zoneCounts[choice]++;
        else unanswered++;
        ok = choice === q.answerIndex;
      }
      if (ok) correct++;
      const prevStreak = live.streak.get(id) ?? 0;
      const streak = ok ? prevStreak + 1 : 0;
      if (counts) {
        live.streak.set(id, streak);
        if (streak > (live.bestStreak.get(id) ?? 0)) live.bestStreak.set(id, streak);
      }
      live.choices.set(id, { choice, correct: ok, text, streak: counts ? streak : 0, broke: counts && !ok ? prevStreak : 0 });
      db().responses.push({ sessionId: live.id, eventId: live.eventId, questionId: q.id, wordKey: q.wordKey, round: live.round, studentId: id, choice, text, correct: ok, at: now });
      // The 문항 sheet's bonus questions don't count toward accuracy or rewards (grammar does).
      if (counts) {
        const r = live.perStudent.get(id) ?? { connected: 0, correct: 0 };
        r.connected++;
        if (ok) r.correct++;
        live.perStudent.set(id, r);
      }
    }
    live.correctOrder = [...live.choices].filter(([, c]) => c.correct).map(([id]) => id).sort((x, y) => hashString(x + live.seq) - hashString(y + live.seq));
    const accuracy = counted.length ? correct / counted.length : 0;
    // Only words come back in the retry round (buildRetry reads wordKey); grammar is in the stats for the rest. The
    // most common wrong answer is for the teacher's list at the end: a box, or typing several students gave.
    if (counts) {
      const wrongZone = zoneCounts.reduce((best, n, i) => (i !== q.answerIndex && n > 0 && (best < 0 || n > zoneCounts[best]) ? i : best), -1);
      const typed = [...textWrong].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
      live.mainStats.set(q.id, { correct, total: counted.length, wordKey: q.wordKey, topWrong: q.mode === 'CUSTOM_TEXT' ? typed : q.options[wrongZone]?.label });
    }
    let topWrong: RevealInfo['topWrong'];
    if (accuracy < 0.6 && q.mode !== 'CUSTOM_TEXT') {
      let best = -1;
      zoneCounts.forEach((n, i) => {
        if (i !== q.answerIndex && n > 0 && (best < 0 || n > zoneCounts[best])) best = i;
      });
      if (best >= 0) topWrong = { label: q.options[best].label, feedback: q.options[best].feedback };
    }
    const long = accuracy < 0.6 && counted.length > 0;
    live.reveal = {
      correctIndex: q.answerIndex,
      correctLabel: correctLabelOf(q),
      zoneCounts,
      unanswered,
      accuracy,
      topWrong,
      explanation: q.explanation,
      // Only students who took part in this question; someone whose phone died isn't shown asleep.
      avatars: this.avatarsOnField().filter((a) => counted.includes(a.studentId)),
      // Only answers several students gave, so nobody's own typo ends up on the projector.
      textWrong: q.mode === 'CUSTOM_TEXT' ? [...textWrong].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t) : undefined,
      long,
      fill: q.fill,
    };
    live.phase = 'reveal';
    live.phaseAt = now;
    live.phaseEndsAt = live.autoAdvance ? now + (long ? REVEAL_LONG_MS : REVEAL_MS) : null;
    save();
    this.schedulePush(true);
  }

  private advance() {
    const live = this.live!;
    if (live.phase === 'reveal' && live.round === 'main') {
      const done = live.index + 1;
      const remaining = live.list.length - done;
      if (live.breaks && done % BLOCK === 0 && remaining >= 3) {
        const stats = [...live.mainStats.values()];
        const c = stats.reduce((a, s) => a + s.correct, 0);
        const t = stats.reduce((a, s) => a + s.total, 0);
        live.phase = 'checkpoint';
        live.phaseAt = Date.now();
        live.checkpoint = { kind: 'block', accuracy: t ? c / t : 0, done, total: live.list.length };
        live.phaseEndsAt = live.autoAdvance ? Date.now() + CHECKPOINT_MS : null;
        this.schedulePush(true);
        return;
      }
    }
    if (live.phase === 'checkpoint' && live.checkpoint?.kind === 'block') {
      live.checkpoint = null;
    } else if (live.phase === 'checkpoint' && live.checkpoint?.kind === 'retry') {
      live.checkpoint = null;
      live.index = 0;
      this.beginQuestion();
      return;
    }
    if (live.index + 1 < live.list.length) {
      live.index++;
      this.beginQuestion();
      return;
    }
    this.endOfList();
  }

  /** Past the round's last question: the 다시 도전 round when it is on and has words to ask, otherwise the results. */
  private endOfList() {
    const live = this.live!;
    if (live.round === 'main' && db().events[live.eventId]?.retryRound) {
      const retry = this.buildRetry();
      if (retry.length > 0) {
        live.round = 'retry';
        live.list = retry;
        live.index = -1;
        live.phase = 'checkpoint';
        live.phaseAt = Date.now();
        live.checkpoint = { kind: 'retry', accuracy: 0, done: 0, total: retry.length };
        live.phaseEndsAt = live.autoAdvance ? Date.now() + RETRY_INTRO_MS : null;
        this.schedulePush(true);
        return;
      }
    }
    this.finish();
  }

  /** Words most of the class missed (under 70%) so far: what the 다시 도전 round would ask. */
  private retryWords() {
    return [...this.live!.mainStats.entries()].filter(([, s]) => s.wordKey && s.total > 0 && s.correct / s.total < 0.7);
  }

  private buildRetry(): Question[] {
    const live = this.live!;
    const event = db().events[live.eventId];
    const list = this.retryWords()
      .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)
      .slice(0, 5)
      .map(([qid, s]) => event.retry[s.wordKey!] ?? live.list.find((q) => q.id === qid)!)
      .filter(Boolean);
    // Answers were placed one by one at upload; spread them again in the order played (copies, so the event is untouched).
    return spreadAnswers(list, mulberry32(hashString(live.id))).map((q) => ({ ...q, id: `${q.id}#retry` }));
  }

  private finish() {
    const live = this.live!;
    if (live.phase === 'summary') return;
    const d = db();
    const event = d.events[live.eventId];
    const mainCount = live.mainStats.size;
    // Ended early (종료) before half the scored questions: answers are kept, but nobody is judged for rewards. The
    // questions left out in the lobby or skipped were never going to be asked, so they don't count.
    const planned = plannedOf(live);
    const shortQuiz = mainCount < Math.ceil(planned / 2);
    const history = new Map<string, number[]>();
    for (const s of d.sessions) {
      for (const p of s.perStudent) {
        if (!p.judged || p.connected === 0) continue;
        history.set(p.studentId, [...(history.get(p.studentId) ?? []), p.correct / p.connected]);
      }
    }
    let rewarded = 0;
    let judgedCount = 0;
    let totalCorrect = 0;
    let totalConnected = 0;
    const perStudent: { studentId: string; connected: number; correct: number; judged: boolean }[] = [];
    // This session's answers and attendance unlocks per student, in one pass over the semester's records.
    const answersOf = new Map<string, ResponseRec[]>();
    for (const x of d.responses) {
      if (x.sessionId !== live.id || x.round === 'practice') continue;
      const list = answersOf.get(x.studentId);
      if (list) list.push(x);
      else answersOf.set(x.studentId, [x]);
    }
    const unlockedOf = new Map<string, string[]>();
    for (const x of d.rewards) {
      if (x.sessionId !== live.id || x.reason !== 'attendance') continue;
      const list = unlockedOf.get(x.studentId);
      if (list) list.push(x.itemId);
      else unlockedOf.set(x.studentId, [x.itemId]);
    }
    // Only a student who answered something this time gets their saved notes replaced.
    const tookPart = new Set([...answersOf].filter(([, list]) => list.some((x) => x.choice >= 0 || !!x.text)).map(([id]) => id));
    for (const id of live.joined) {
      const s = d.students[id];
      if (!s) continue;
      const r = live.perStudent.get(id) ?? { connected: 0, correct: 0 };
      totalCorrect += r.correct;
      totalConnected += r.connected;
      const judged = !shortQuiz && mainCount > 0 && r.connected >= Math.ceil(mainCount / 2);
      perStudent.push({ studentId: id, connected: r.connected, correct: r.correct, judged });
      let reward: StudentSummary['reward'] = null;
      if (judged) {
        judgedCount++;
        const acc = r.correct / r.connected;
        const past = history.get(id) ?? [];
        const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
        // Integer and rounded comparisons, so 7/10 at a 70% bar counts.
        const challenge = r.correct * 100 >= event.reward.challengePct * r.connected;
        const growth = avg !== null && Math.round(acc * 10000) >= Math.round(avg * 10000) + event.reward.growthPp * 100;
        if (challenge || growth) {
          const alreadyOwned = s.inventory.includes(event.reward.itemId);
          if (!alreadyOwned) s.inventory.push(event.reward.itemId);
          reward = { itemId: event.reward.itemId, reason: challenge ? 'challenge' : 'growth', alreadyOwned };
          d.rewards.push({ sessionId: live.id, eventId: live.eventId, studentId: id, itemId: event.reward.itemId, reason: reward.reason, at: Date.now() });
          rewarded++;
        }
      }
      const summary: StudentSummary = {
        mainCorrect: r.correct,
        mainTotal: r.connected,
        judged,
        reward,
        stampAdded: live.stamped.has(id),
        shortQuiz,
        bestStreak: live.bestStreak.get(id) ?? 0,
        unlocked: unlockedOf.get(id) ?? [],
        ...this.wrongNotes(id, event, answersOf.get(id) ?? []),
      };
      live.studentSummary.set(id, summary);
      if (tookPart.has(id)) d.lastSummary[id] = { ...summary, sessionId: live.id, eventId: live.eventId, eventName: event.name, at: Date.now() };
    }
    // A run stopped before anyone answered a word question leaves no empty column in the stats.
    if (mainCount > 0 && tookPart.size > 0) d.sessions.push({ id: live.id, eventId: live.eventId, classId: live.classId, startedAt: live.startedAt, endedAt: Date.now(), mainCount, planned, perStudent });
    live.summary = { accuracy: totalConnected ? totalCorrect / totalConnected : 0, rewarded, judged: judgedCount };
    live.hardest = this.hardest();
    // A screen covered with B would otherwise hide the class summary, and the summary has no cover button.
    live.blank = false;
    live.pausedByBlank = false;
    live.phase = 'summary';
    live.phaseEndsAt = null;
    live.index = -1;
    flush();
    this.schedulePush(true);
  }

  /**
   * The quiz's scored questions for the teacher at the end, what the class missed most first (then in play order),
   * each with the students who missed it and what they answered (shown when the teacher opens the row).
   */
  private hardest(): HardestRow[] {
    const live = this.live!;
    const d = db();
    const order = new Map(live.mainList.map((q, i) => [q.id, i]));
    const missedOf = new Map<string, ResponseRec[]>();
    for (const r of d.responses) {
      if (r.sessionId !== live.id || r.round !== 'main' || r.correct) continue;
      const list = missedOf.get(r.questionId);
      if (list) list.push(r);
      else missedOf.set(r.questionId, [r]);
    }
    return [...live.mainStats]
      .flatMap(([id, s]) => {
        const q = live.mainList.find((x) => x.id === id);
        if (!q || s.total === 0) return [];
        const missed = (missedOf.get(id) ?? [])
          .flatMap((r) => {
            const st = Object.hasOwn(d.students, r.studentId) ? d.students[r.studentId] : undefined;
            return st ? [{ number: st.number, name: st.name, mine: answerLabelOf(q, r) }] : [];
          })
          .sort((a, b) => a.number - b.number);
        return [{ id, kind: q.modeLabel, text: q.prompt, answer: q.noteLabel ?? correctLabelOf(q), accuracy: s.correct / s.total, total: s.total, topWrong: s.topWrong ?? null, missed }];
      })
      .sort((a, b) => a.accuracy - b.accuracy || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  /** `answers`: the student's main and retry answers this session, oldest first (finish() groups them in one pass). */
  private wrongNotes(studentId: string, event: EventRec, answers?: ResponseRec[]): { wrong: WrongNote[]; practice: Question[] } {
    const live = this.live!;
    const d = db();
    answers ??= d.responses.filter((r) => r.sessionId === live.id && r.studentId === studentId && r.round !== 'practice');
    const latest = new Map<string, ResponseRec>();
    for (const r of answers) {
      const base = r.questionId.replace(/#retry$/, '');
      latest.set(r.wordKey ?? base, r);
    }
    const notes: { note: WrongNote; practice?: Question; rate: number }[] = [];
    for (const r of latest.values()) {
      if (r.correct) continue;
      const q = [...event.questions, ...Object.values(event.retry)].find((x) => x.id === r.questionId.replace(/#retry$/, ''));
      if (!q) continue;
      // Retry copies have their answers re-placed, so read the choice against the copy that was played.
      const shown = live.list.find((x) => x.id === r.questionId) ?? q;
      const word = r.wordKey ? d.words[r.wordKey] : undefined;
      const stats = live.mainStats.get(q.id);
      const p = (r.wordKey && event.retry[r.wordKey]) || q;
      notes.push({
        // The class's share of right answers on it this session; one without a count (a bonus question) goes last.
        rate: stats && stats.total > 0 ? stats.correct / stats.total : 1,
        practice: p.mode !== 'CUSTOM_TEXT' ? p : undefined,
        note: {
          questionId: q.id,
          wordKey: r.wordKey,
          spelling: word?.spelling,
          meaning: word?.meaning,
          prompt: q.prompt,
          // A 고치기 find step's answer is the wrong word; the note shows it with its fix ('fastly → fast').
          correctLabel: q.noteLabel ?? correctLabelOf(q),
          ko: q.grammar?.ko,
          rule: q.grammar ? q.explanation : undefined,
          mineLabel: answerLabelOf(shown, r),
          feedback: r.choice >= 0 ? shown.options[r.choice]?.feedback : undefined,
          example: word?.example?.replace(/[[\]]/g, ''),
          exampleMeaning: word?.exampleMeaning,
        },
      });
    }
    // What the class found hardest comes first (the lowest share of right answers); equal ones keep the play order.
    notes.sort((a, b) => a.rate - b.rate);
    return { wrong: notes.map((x) => x.note), practice: notes.flatMap((x) => (x.practice ? [x.practice] : [])) };
  }

  // ---------- inputs during play ----------

  move(tokenHash: string, seq: number, point: FieldPoint, n: number) {
    const live = this.live;
    const s = this.studentOf(tokenHash);
    if (!live || !s || live.phase !== 'moving' || live.paused || seq !== live.seq || !live.joined.has(s.id)) return false;
    // Concurrent POSTs can arrive out of order; keep only the newest position.
    const last = live.moveCounter.get(s.id) ?? -1;
    if (Number.isFinite(n) && n <= last) return false;
    live.moveCounter.set(s.id, n);
    const p = { x: clamp(point.x, 0.02, 0.98), y: clamp(point.y, 0.02, 0.98) };
    live.positions.set(s.id, p);
    live.lastMoveAt = Date.now();
    this.schedulePush(false);
    return true;
  }

  submitText(tokenHash: string, seq: number, value: string, final: boolean, n: number) {
    const live = this.live;
    const s = this.studentOf(tokenHash);
    if (!live || !s || live.phase !== 'moving' || live.paused || seq !== live.seq || !live.joined.has(s.id)) return false;
    if (Number.isFinite(n)) {
      if (n <= (live.textCounter.get(s.id) ?? -1)) return false;
      live.textCounter.set(s.id, n);
    }
    const text = value.slice(0, MAX_TEXT_ANSWER);
    const prev = live.texts.get(s.id);
    live.texts.set(s.id, text);
    // A draft of the very same text (an autosave landing after 제출) keeps the answer submitted.
    if (final) live.textFinal.add(s.id);
    else if (prev !== text) live.textFinal.delete(s.id);
    live.lastMoveAt = Date.now();
    this.schedulePush(false);
    return true;
  }

  /** Practice only counts for the student's own latest notes, a few tries per question. */
  recordPractice(tokenHash: string, questionId: string, choice: number) {
    const s = this.studentOf(tokenHash);
    if (!s) return;
    const d = db();
    const last = d.lastSummary[s.id];
    if (!last) return;
    const q = last.practice.find((x) => x.id === questionId);
    if (!q || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
    const tries = d.responses.filter((r) => r.round === 'practice' && r.sessionId === last.sessionId && r.studentId === s.id && r.questionId === questionId).length;
    if (tries >= MAX_PRACTICE_PER_QUESTION) return;
    d.responses.push({ sessionId: last.sessionId, eventId: last.eventId, questionId, wordKey: q.wordKey, round: 'practice', studentId: s.id, choice, correct: choice === q.answerIndex, at: Date.now() });
    save();
  }

  // ---------- teacher controls ----------

  control(action: string) {
    const live = this.live;
    if (!live) return;
    const now = Date.now();
    // 오늘 낼 문제 in the lobby: 'section:words', 'section:고르기', …; the last type in can't be left out.
    // 'skip-section:<type>' carries the type the teacher confirmed.
    const [verb, arg] = action.startsWith('skip-section:') ? ['skip-section', action.slice('skip-section:'.length)] : [action, ''];
    if (action.startsWith('section:')) {
      const key = action.slice('section:'.length) as Section;
      const event = db().events[live.eventId];
      if (live.phase !== 'lobby' || !event || !SECTIONS.includes(key)) return;
      const off = new Set(live.off);
      if (off.has(key)) off.delete(key);
      else off.add(key);
      const list = event.questions.filter((q) => !off.has(sectionOf(q)));
      if (list.length === 0) return;
      live.off = off;
      live.mainList = live.list = list;
      live.mainCount = list.length;
      this.schedulePush(true);
      return;
    }
    switch (verb) {
      case 'start':
        this.start();
        return;
      case 'pause':
        live.pausedByBlank = false;
        if (!live.paused && live.phaseEndsAt) {
          live.paused = { remaining: Math.max(0, live.phaseEndsAt - now) };
          live.phaseEndsAt = null;
        } else if (!live.paused && live.phase !== 'lobby' && live.phase !== 'summary') {
          live.paused = { remaining: 0 };
        }
        break;
      case 'resume':
        live.pausedByBlank = false;
        this.resume(now);
        break;
      case 'close-now':
        if (live.phase === 'moving' && now - live.phaseAt >= CLICK_GUARD_MS) {
          live.paused = null;
          this.lock();
          return;
        }
        break;
      case 'add-time':
        if (live.phase === 'moving') {
          if (live.paused) live.paused.remaining += 5000;
          else if (live.phaseEndsAt) live.phaseEndsAt += 5000;
        }
        break;
      case 'skip-section': {
        // 다음 유형 ('skip-section:<type>'): the rest of this type is passed over, and the next type begins (or the
        // retry round or the results, after the last one). If the quiz has moved on to another type since the teacher
        // confirmed, nothing is skipped (the quiz stays paused, as the confirm left it).
        if (live.round !== 'main' || now - live.lastSkipAt < 800) break;
        if (now - (live.phase === 'moving' ? live.questionAt : live.phaseAt) < CLICK_GUARD_MS) break;
        if (live.phase !== 'intro' && live.phase !== 'moving' && live.phase !== 'reveal' && live.phase !== 'checkpoint') break;
        const sec = sectionOf(live.list[live.index]);
        if (sec !== arg) break;
        let end = live.index + 1;
        while (end < live.list.length && sectionOf(live.list[end]) === sec) end++;
        // The question on screen is skipped too, unless it has been answered already.
        for (let i = live.phase === 'intro' || live.phase === 'moving' ? live.index : live.index + 1; i < end; i++) live.skipped.add(live.list[i].id);
        live.lastSkipAt = now;
        live.paused = null;
        live.reveal = null;
        live.checkpoint = null;
        if (end < live.list.length) {
          live.index = end;
          this.beginQuestion();
        } else {
          live.index = live.list.length - 1;
          this.endOfList();
        }
        return;
      }
      case 'breaks':
        if (live.phase === 'lobby') live.breaks = !live.breaks;
        break;
      case 'skip':
        // A double click or a quick second S would land on the question that just began; ignore it.
        if (now - live.lastSkipAt < 800) break;
        if (now - (live.phase === 'moving' ? live.questionAt : live.phaseAt) < CLICK_GUARD_MS) break;
        if (live.phase === 'intro' || live.phase === 'moving' || live.phase === 'reveal' || live.phase === 'checkpoint') live.lastSkipAt = now;
        if (live.phase === 'intro' || live.phase === 'moving') {
          if (live.round === 'main') live.skipped.add(live.list[live.index].id);
          live.paused = null;
          live.phase = 'reveal';
          live.reveal = null;
          this.advance();
          return;
        }
        if (live.phase === 'reveal' || live.phase === 'checkpoint') {
          live.paused = null;
          this.advance();
          return;
        }
        break;
      case 'next':
        // The 다음 button takes the place of 지금 정답 공개, so a double click must not skip the reveal.
        if ((live.phase === 'reveal' || live.phase === 'checkpoint') && now - live.phaseAt >= CLICK_GUARD_MS) {
          live.paused = null;
          this.advance();
          return;
        }
        break;
      case 'end':
        live.pausedByBlank = false;
        if (live.phase !== 'lobby' && live.phase !== 'summary') {
          live.paused = null;
          if (live.phase === 'moving') this.lock();
          this.finish();
          return;
        }
        break;
      case 'skip-retry':
        if (live.round === 'retry' && live.phase !== 'summary') {
          live.paused = null;
          if (live.phase === 'moving') this.lock();
          this.finish();
          return;
        }
        break;
      case 'blank':
        live.blank = !live.blank;
        // Covering the screen stops every clock, so nothing moves on behind it; uncovering picks up again.
        if (live.blank && !live.paused && live.phaseEndsAt !== null) {
          live.paused = { remaining: Math.max(0, live.phaseEndsAt - now) };
          live.phaseEndsAt = null;
          live.pausedByBlank = true;
        } else if (!live.blank && live.pausedByBlank) {
          live.pausedByBlank = false;
          this.resume(now);
        }
        break;
      case 'names':
        live.nameLabels = !live.nameLabels;
        break;
      case 'sound':
        live.sound = !live.sound;
        break;
      case 'music':
        live.music = !live.music;
        break;
      case 'howto':
        // Pressed again it starts over; it never covers a question.
        if (live.phase === 'lobby') live.howtoUntil = now + HOWTO_MS;
        break;
      case 'auto':
        live.autoAdvance = !live.autoAdvance;
        if (live.autoAdvance && live.phaseEndsAt === null && !live.paused && (live.phase === 'reveal' || live.phase === 'checkpoint')) {
          live.phaseEndsAt = now + REVEAL_MS;
        } else if (!live.autoAdvance && (live.phase === 'reveal' || live.phase === 'checkpoint')) {
          // Turning it off stops the countdown already running; the teacher presses 다음.
          live.phaseEndsAt = null;
          if (live.paused) live.paused.remaining = 0;
        }
        break;
    }
    this.schedulePush(true);
  }

  private resume(now: number) {
    const live = this.live!;
    if (!live.paused) return;
    const rem = live.paused.remaining;
    if (live.phase === 'moving') {
      live.phaseEndsAt = now + Math.max(rem, 3000);
      live.resumedAt = now;
      // Phones remount after the pause screen; start the move and text ordering over.
      live.moveCounter = new Map();
      live.textCounter = new Map();
    } else if (live.phase === 'intro' || rem > 0) {
      live.phaseEndsAt = now + rem;
    } else {
      // Paused with no countdown left (자동 진행 was off, or just ran out): show the reveal again before moving on.
      live.phaseEndsAt = live.autoAdvance ? now + (live.phase === 'checkpoint' ? CHECKPOINT_MS : REVEAL_MS) : null;
    }
    live.paused = null;
  }

  expireRequests() {
    const now = Date.now();
    const d = db();
    let changed = false;
    // A student still looking at the waiting screen keeps their request alive while the teacher gets to it.
    const waiting = new Set([...this.clients].filter((c) => c.role === 'student' && c.tokenHash).map((c) => c.tokenHash));
    for (const [id, r] of Object.entries(d.requests)) {
      if (r.status === 'pending' && waiting.has(r.tokenHash)) this.requestSeen.set(id, now);
      const seen = this.requestSeen.get(id) ?? r.createdAt;
      if (r.status !== 'pending') this.requestSeen.delete(id);
      if (r.status === 'pending' && (now - seen > REQUEST_TTL_MS || now - r.createdAt > REQUEST_MAX_MS)) {
        r.status = 'expired';
        r.reason = 'timeout';
        changed = true;
      } else if (r.status !== 'pending' && now - r.createdAt > 24 * 60 * 60 * 1000) {
        delete d.requests[id];
        changed = true;
      }
    }
    if (changed) {
      save();
      this.schedulePush(true);
    }
  }
}

/**
 * Which classes have played an event: the latest run's day and class accuracy, how many runs, and whether that
 * run was cut short (fewer than half the word questions, like the reward rule). Deleted classes are left out.
 */
function classRuns(e: EventRec, sessions: SessionSummaryRec[]) {
  const classes = db().classes;
  const planned = e.questions.filter(scored).length;
  const out = new Map<string, { classId: string; last: number; runs: number; accuracy: number; partial: boolean }>();
  for (const s of [...sessions].sort((a, b) => a.endedAt - b.endedAt)) {
    if (!own(classes, s.classId)) continue;
    const connected = s.perStudent.reduce((n, p) => n + p.connected, 0);
    const correct = s.perStudent.reduce((n, p) => n + p.correct, 0);
    const prev = out.get(s.classId);
    out.set(s.classId, { classId: s.classId, last: s.endedAt, runs: (prev?.runs ?? 0) + 1, accuracy: connected ? correct / connected : 0, partial: s.mainCount < Math.ceil((s.planned ?? planned) / 2) });
  }
  return [...out.values()];
}

/** The value that appears most often (the first one on a tie), for an event's usual question time. */
function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].reduce((best, cur) => (cur[1] > best[1] ? cur : best), [0, 0])[0];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

const g = globalThis as unknown as { __classeumHub?: Hub };
export function hub(): Hub {
  if (!g.__classeumHub) {
    g.__classeumHub = new Hub();
    setInterval(() => g.__classeumHub?.expireRequests(), 10_000);
    // Ctrl+C (or the next \`npm run class\`) saves and ends every phone, projector and teacher stream, so the
    // server stops at once; left alone, Next waits for those connections to drop and the terminal looks stuck.
    const stop = () => {
      try {
        flush();
      } catch {
        // Nothing more to save than what the store already wrote.
      }
      g.__classeumHub?.closeAll();
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // Closing the console window: Windows reports it as SIGHUP and ends the process at once unless it is handled.
    process.once('SIGHUP', stop);
  }
  return g.__classeumHub;
}

// The game host for the local prototype: owns the live session, runs the clock,
// and pushes role-specific views to every connected screen.
import { createHash, randomInt } from 'node:crypto';
import type { AvatarLook, AvatarOnField, CustomQuestion, FieldPoint, Phase, PublicQuestion, Question, RevealInfo, Round, StudentSummary, Word, WrongNote } from '@/lib/types';
import { DEFAULT_LOOK, EYE_STYLES, HAIR_COLORS, HAIR_STYLES, normalizeLook, SKIN_TONES } from '@/lib/avatar';
import { ATTENDANCE_UNLOCKS, ITEMS, QUIZ_REWARD_ITEMS, STAMPS_PER_UNLOCK, itemById } from '@/lib/items';
import { hashString, MAX_TEXT_ANSWER, mulberry32, normalizeAnswer, shortDate, todayKey } from '@/lib/text';
import { db, flush, newId, save, type EventRec, type RequestRec, type SessionSummaryRec, type StudentRec } from './store';
import { generateEvent, spreadAnswers } from './generate';
import type { ImportIssue } from './excel';
import { lanAddress, qrSvg } from './lan';

export type Role = 'teacher' | 'display' | 'student';

export interface Client {
  role: Role;
  tokenHash?: string;
  send: (payload: unknown) => void;
  /** Ends the stream from the server side (an older duplicate of the same phone). */
  close?: () => void;
  /** Ends the stream quietly when the server is stopping; the screen reconnects once it is back. */
  end?: () => void;
}

export const START_HALF_W = 0.09;
export const START_HALF_H = 0.13;
const INTRO_MS = 600;
// The first question of each round gets a 3·2·1 on the projector and phones.
const FIRST_INTRO_MS = 3000;
// Long enough for the landing and the 펑 / cheer reactions to play out.
const REVEAL_MS = 4000;
const REVEAL_LONG_MS = 6000;
const CHECKPOINT_MS = 6000;
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
const ANIMALS = ['여우', '부엉이', '사슴', '고래', '펭귄', '다람쥐', '거북', '판다', '수달', '코알라', '호랑이', '토끼'];

export function zoneOf(p: FieldPoint, optionCount: number): number {
  if (Math.abs(p.x - 0.5) < START_HALF_W && Math.abs(p.y - 0.5) < START_HALF_H) return -1;
  if (optionCount === 2) return p.x < 0.5 ? 0 : 1;
  const z = (p.y < 0.5 ? 0 : 2) + (p.x < 0.5 ? 0 : 1);
  return z < optionCount ? z : -1;
}

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
  mainStats: Map<string, { correct: number; total: number; wordKey?: string }>;
  perStudent: Map<string, StudentResult>;
  checkpoint: { kind: 'block' | 'retry'; accuracy: number; done: number; total: number } | null;
  summary: { accuracy: number; rewarded: number; judged: number } | null;
  studentSummary: Map<string, StudentSummary>;
  /** Students whose attendance stamp was added by this session (not earlier the same day). */
  stamped: Set<string>;
  mainCount: number;
}

type Generated = ReturnType<typeof generateEvent>;

interface Draft {
  id: string;
  createdAt: number;
  groups: { name: string; words: Word[]; custom: CustomQuestion[] }[];
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
  return className(a.classId).localeCompare(className(b.classId), 'ko', { numeric: true }) || a.number - b.number;
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
  };
}

class Hub {
  clients = new Set<Client>();
  /** When each pending request's phone was last seen waiting, for expireRequests. */
  private requestSeen = new Map<string, number>();
  live: Live | null = null;
  drafts = new Map<string, Draft>();
  joinUrl = '';
  qr = '';
  private ticker: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private lastPush = 0;

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
    if (sid) this.touchStudent(sid);
    this.pushOne(c);
    // A new connection only changes the teacher's and projector's lists, unless it just joined
    // or it opened registration for the phones still waiting to pick a name.
    const joinedNow = sid !== undefined && !joinedBefore && !!this.live?.joined.has(sid);
    this.schedulePush(joinedNow || openBefore !== this.registrationOpen());
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
    if (c.role === 'teacher') c.send(this.teacherView());
    else if (c.role === 'display') c.send(this.displayView());
    else c.send(this.studentView(c.tokenHash));
  }

  private currentQuestion(): Question | null {
    const live = this.live;
    if (!live || live.index < 0 || live.index >= live.list.length) return null;
    return live.list[live.index];
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
    if (!live) return base;
    const counts = live.phase === 'moving' ? this.movingCounts() : null;
    return {
      ...base,
      blank: live.blank,
      nameLabels: live.nameLabels,
      sound: live.sound,
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
      .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
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
        // About a minute for the summary, and another for the retry round when it is on.
        estimateSec: Math.round(e.questions.reduce((sum, q) => sum + Math.min(q.seconds, 9) + 4, 0) + 60 + (e.retryRound ? 60 : 0)),
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
        mainDone: live.mainStats.size + (live.round === 'main' && live.phase === 'moving' && q?.wordKey ? 1 : 0),
        mainPlanned: db().events[live.eventId]?.questions.filter((x) => x.wordKey).length ?? 0,
        remainingSec: Math.round(live.list.slice(live.index + 1).reduce((s, x) => s + Math.min(x.seconds, 9) + 4, 0)),
      };
    }
    return { role: 'teacher', serverNow: Date.now(), joinUrl: this.joinUrl, qr: this.qr, classes, students, requests, events, live: liveDetail, items: ITEMS };
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
    const today = this.live?.classId;
    const classes = Object.values(d.classes)
      .filter((c) => !today || c.id === today)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
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
    // A quiz for another class is none of this phone's business: it sees no session.
    const elsewhere = this.live && this.live.classId !== student.classId ? className(this.live.classId) : null;
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
    if (!live) return { ...base, me, session: null, lastNotes, elsewhere };
    const q = this.currentQuestion();
    const mine = live.choices.get(student.id);
    let result = null;
    if (live.phase === 'reveal' && q && live.reveal) {
      const choice = mine?.choice ?? -1;
      result = {
        choice,
        correct: !!mine?.correct,
        correctLabel: live.reveal.correctLabel,
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
    if (this.live && cls.id !== this.live.classId) throw new Error(`지금은 ${className(this.live.classId)} 수업이라 그 반만 등록할 수 있어요.`);
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
      if (this.live && r.classId !== this.live.classId) continue;
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
    const students = Object.values(d.students).filter((s) => s.classId === classId);
    if (students.length && !withStudents) throw new Error('학생이 있는 반이에요. 학생도 함께 지울지 확인해 주세요.');
    this.removeStudents(students.map((s) => s.id));
    for (const r of Object.values(d.requests)) {
      if (r.status === 'pending' && r.classId === classId) {
        r.status = 'expired';
        r.reason = 'gone';
      }
    }
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
   * Takes students off the roster with their phone, character, saved notes and attendance.
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
      delete d.lastSummary[id];
      delete d.attendance[id];
      delete d.students[id];
    }
    save();
    this.schedulePush(true);
    return ids.length;
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
  makeDraft(result: { words: Word[]; questions: CustomQuestion[]; roster: { className: string; number: number; name: string }[]; issues: ImportIssue[] }, fileName?: string, title?: string) {
    // Only the name as shown in the teacher's file picker: no folders, no control characters, not too long.
    const cleanFile = fileName?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || undefined;
    // Rows without a 세트 make an event named after the file ('3주차 단어장'), or after the day if the name is unknown.
    const defaultName = title?.trim().slice(0, 40) || cleanFile?.replace(/\.xlsx?$/i, '').trim().slice(0, 40) || `${shortDate()} 퀴즈`;
    const groups = new Map<string, { words: Word[]; custom: CustomQuestion[] }>();
    for (const w of result.words) {
      const name = w.set || defaultName;
      if (!groups.has(name)) groups.set(name, { words: [], custom: [] });
      groups.get(name)!.words.push(w);
    }
    for (const q of result.questions) {
      const name = q.set || (groups.size === 1 ? [...groups.keys()][0] : defaultName);
      if (!groups.has(name)) groups.set(name, { words: [], custom: [] });
      groups.get(name)!.custom.push(q);
    }
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
    const gen = generateEvent({ words: g.words, custom: g.custom, bank: [...this.bankFor(draft), ...others], askedBefore: this.askedWords(), seed: hashString(draft.id + g.name), defaultSeconds: DEFAULT_SECONDS });
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
        wordKeys: g.words.map((w) => w.key),
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
      studentSummary: new Map(),
      stamped: new Set(),
      mainCount: event.questions.length,
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
    live.phaseEndsAt = Date.now() + (live.index === 0 ? FIRST_INTRO_MS : INTRO_MS);
    this.schedulePush(true);
  }

  tick() {
    const live = this.live;
    if (!live) return;
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
    // Streaks follow the scored questions only (main-round words), like the score beside them on the summary.
    const scored = live.round === 'main' && !!q.wordKey;
    const zoneCounts = q.options.map(() => 0);
    let correct = 0;
    let unanswered = 0;
    const textWrong = new Map<string, number>();
    const event = db().events[live.eventId];
    for (const id of counted) {
      let choice = -1;
      let ok = false;
      let text: string | undefined;
      if (q.mode === 'CUSTOM_TEXT') {
        text = live.texts.get(id);
        if (text) {
          const typed = normalizeAnswer(text);
          ok = (q.answers ?? []).some((a) => normalizeAnswer(a) === typed);
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
      if (scored) {
        live.streak.set(id, streak);
        if (streak > (live.bestStreak.get(id) ?? 0)) live.bestStreak.set(id, streak);
      }
      live.choices.set(id, { choice, correct: ok, text, streak: scored ? streak : 0, broke: scored && !ok ? prevStreak : 0 });
      db().responses.push({ sessionId: live.id, eventId: live.eventId, questionId: q.id, wordKey: q.wordKey, round: live.round, studentId: id, choice, text, correct: ok, at: now });
      // Hand-written bonus questions don't count toward accuracy, rewards or the retry round.
      if (live.round === 'main' && q.wordKey) {
        const r = live.perStudent.get(id) ?? { connected: 0, correct: 0 };
        r.connected++;
        if (ok) r.correct++;
        live.perStudent.set(id, r);
      }
    }
    live.correctOrder = [...live.choices].filter(([, c]) => c.correct).map(([id]) => id).sort((x, y) => hashString(x + live.seq) - hashString(y + live.seq));
    const accuracy = counted.length ? correct / counted.length : 0;
    if (live.round === 'main' && q.wordKey) live.mainStats.set(q.id, { correct, total: counted.length, wordKey: q.wordKey });
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
      correctLabel: q.mode === 'CUSTOM_TEXT' ? (q.answers ?? [])[0] ?? '' : q.options[q.answerIndex]?.label ?? '',
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
    };
    live.phase = 'reveal';
    live.phaseAt = now;
    live.phaseEndsAt = live.autoAdvance ? now + (long ? REVEAL_LONG_MS : REVEAL_MS) : null;
    void event;
    save();
    this.schedulePush(true);
  }

  private advance() {
    const live = this.live!;
    if (live.phase === 'reveal' && live.round === 'main') {
      const done = live.index + 1;
      const remaining = live.list.length - done;
      if (done % BLOCK === 0 && remaining >= 3) {
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

  private buildRetry(): Question[] {
    const live = this.live!;
    const event = db().events[live.eventId];
    const list = [...live.mainStats.entries()]
      .filter(([, s]) => s.wordKey && s.total > 0 && s.correct / s.total < 0.7)
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
    // Ended early (종료) before half the word questions: answers are kept, but nobody is judged for rewards.
    const planned = db().events[live.eventId]?.questions.filter((q) => q.wordKey).length ?? mainCount;
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
    // Only a student who answered something this time gets their saved notes replaced.
    const tookPart = new Set(d.responses.filter((x) => x.sessionId === live.id && x.round !== 'practice' && (x.choice >= 0 || !!x.text)).map((x) => x.studentId));
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
        unlocked: d.rewards.filter((x) => x.sessionId === live.id && x.studentId === id && x.reason === 'attendance').map((x) => x.itemId),
        ...this.wrongNotes(id, event),
      };
      live.studentSummary.set(id, summary);
      if (tookPart.has(id)) d.lastSummary[id] = { ...summary, sessionId: live.id, eventId: live.eventId, eventName: event.name, at: Date.now() };
    }
    // A run stopped before anyone answered a word question leaves no empty column in the stats.
    if (mainCount > 0 && tookPart.size > 0) d.sessions.push({ id: live.id, eventId: live.eventId, classId: live.classId, startedAt: live.startedAt, endedAt: Date.now(), mainCount, perStudent });
    live.summary = { accuracy: totalConnected ? totalCorrect / totalConnected : 0, rewarded, judged: judgedCount };
    // A screen covered with B would otherwise hide the class summary, and the summary has no cover button.
    live.blank = false;
    live.pausedByBlank = false;
    live.phase = 'summary';
    live.phaseEndsAt = null;
    live.index = -1;
    flush();
    this.schedulePush(true);
  }

  private wrongNotes(studentId: string, event: EventRec): { wrong: WrongNote[]; practice: Question[] } {
    const live = this.live!;
    const d = db();
    const latest = new Map<string, (typeof d.responses)[number]>();
    for (const r of d.responses) {
      if (r.sessionId !== live.id || r.studentId !== studentId || r.round === 'practice') continue;
      const base = r.questionId.replace(/#retry$/, '');
      latest.set(r.wordKey ?? base, r);
    }
    const wrong: WrongNote[] = [];
    const practice: Question[] = [];
    for (const r of latest.values()) {
      if (r.correct) continue;
      const q = [...event.questions, ...Object.values(event.retry)].find((x) => x.id === r.questionId.replace(/#retry$/, ''));
      if (!q) continue;
      // Retry copies have their answers re-placed, so read the choice against the copy that was played.
      const shown = live.list.find((x) => x.id === r.questionId) ?? q;
      const word = r.wordKey ? d.words[r.wordKey] : undefined;
      wrong.push({
        questionId: q.id,
        wordKey: r.wordKey,
        spelling: word?.spelling,
        meaning: word?.meaning,
        prompt: q.prompt,
        correctLabel: q.mode === 'CUSTOM_TEXT' ? (q.answers ?? [])[0] ?? '' : q.options[q.answerIndex]?.label ?? '',
        mineLabel: r.choice >= 0 ? shown.options[r.choice]?.label ?? '' : r.text ?? (q.mode === 'CUSTOM_TEXT' ? '(못 썼어요)' : '(못 골랐어요)'),
        feedback: r.choice >= 0 ? shown.options[r.choice]?.feedback : undefined,
        example: word?.example?.replace(/[[\]]/g, ''),
        exampleMeaning: word?.exampleMeaning,
      });
      const p = (r.wordKey && event.retry[r.wordKey]) || q;
      if (p.mode !== 'CUSTOM_TEXT') practice.push(p);
    }
    return { wrong, practice };
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
    switch (action) {
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
      case 'skip':
        // A double click or a quick second S would land on the question that just began; ignore it.
        if (now - live.lastSkipAt < 800) break;
        if (now - (live.phase === 'moving' ? live.questionAt : live.phaseAt) < CLICK_GUARD_MS) break;
        if (live.phase === 'intro' || live.phase === 'moving' || live.phase === 'reveal' || live.phase === 'checkpoint') live.lastSkipAt = now;
        if (live.phase === 'intro' || live.phase === 'moving') {
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
  const planned = e.questions.filter((q) => q.wordKey).length;
  const out = new Map<string, { classId: string; last: number; runs: number; accuracy: number; partial: boolean }>();
  for (const s of [...sessions].sort((a, b) => a.endedAt - b.endedAt)) {
    if (!own(classes, s.classId)) continue;
    const connected = s.perStudent.reduce((n, p) => n + p.connected, 0);
    const correct = s.perStudent.reduce((n, p) => n + p.correct, 0);
    const prev = out.get(s.classId);
    out.set(s.classId, { classId: s.classId, last: s.endedAt, runs: (prev?.runs ?? 0) + 1, accuracy: connected ? correct / connected : 0, partial: s.mainCount < Math.ceil(planned / 2) });
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
  }
  return g.__classeumHub;
}

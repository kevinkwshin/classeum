// 아고라: a few topics a class answers in writing, one after another, as an arena event is a few questions. The records
// live in store.ts; this keeps them in shape (what the teacher may type, the answers students send), tidies up after
// deleted classes and students, and builds what each screen gets. An 아고라 is made once and opened for one class at a
// time, the way an arena event is: the session (대기실, each topic's 준비, 쓰기 and 마감, then the 끝) is the hub's
// (Hub.openAgora, Hub.answerTopic), and it saves and pushes every screen its new view after each change. Each 아고라
// has a reward item, which a student gets for the teacher's ⭐ on one of their answers (toggleStar). A topic is 작문
// (students answer its question) or 받아쓰기 (they write down a sentence the teacher's laptop reads aloud): the
// sentence reaches no screen but the teacher's until [정답 공개], and each phone then compares its own answer with it.
import { ANSWER_MAX, COLUMN_CHOICES, DEFAULT_MINUTES, MINUTE_CHOICES, NOTE_MAX, TITLE_MAX, TOPIC_MAX, TOPICS_MAX, type AgoraPhase, type TopicReveal, type TopicSort } from '@/lib/agora';
import { normalizeLook } from '@/lib/avatar';
import { gradeDictation } from '@/lib/dictation';
import { QUIZ_REWARD_ITEMS, itemById } from '@/lib/items';
import type { AvatarLook, ItemDef } from '@/lib/types';
import { csvText } from './csv';
import { db, newId, rewardItemAt, type AgoraRec, type TopicAnswerRec, type TopicRec } from './store';

/** Own keys only, so ids like 'constructor' or '__proto__' sent by a screen never match. */
function own<T>(table: Record<string, T>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Characters as people count them: an emoji is one. */
const length = (s: string) => [...s].length;

/**
 * Text as it is kept: NFC, tabs as spaces, no control or invisible characters (a right-to-left override would turn a
 * line around on the projector), and at most one empty line in a row.
 */
export function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, '')
    .replace(/[  ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every 아고라, the newest first, as the arena lists its events. */
function agoraList(): AgoraRec[] {
  return Object.values(db().agoras).sort((a, b) => b.createdAt - a.createdAt);
}

/** A topic by its id, with the 아고라 it belongs to. */
export function findTopic(topicId: string): { agora: AgoraRec; topic: TopicRec } | undefined {
  for (const agora of Object.values(db().agoras)) {
    const topic = agora.topics.find((t) => t.id === topicId);
    if (topic) return { agora, topic };
  }
  return undefined;
}

export interface TopicInput {
  /** One of the 아고라's topics, for a row the teacher changed; left out for a new row. */
  id?: unknown;
  /** 'dictation' for 받아쓰기, whose `text` is the sentence to read aloud; anything else is 작문. */
  kind?: unknown;
  text?: unknown;
  note?: unknown;
  columns?: unknown;
  sort?: unknown;
  /** 입력 시간 in minutes, or null for no limit. */
  minutes?: unknown;
}

export interface AgoraInput {
  title?: unknown;
  /** The rows of the teacher's table, in order. */
  topics?: unknown;
}

/**
 * One row the teacher typed, checked (`n` is its row, for the message); a setting left out keeps the topic's own, or
 * the default. A 받아쓰기 row's sentence goes in `dictation`, never in `text`, and it has no 보조 설명.
 */
function topicFields(input: TopicInput, n: number, prev?: TopicRec): Omit<TopicRec, 'id'> {
  const dictation = input.kind === 'dictation';
  const text = cleanText(input.text);
  if (!text) throw new Error(dictation ? `${n}번 줄의 받아쓰기 문장을 써 주세요.` : `${n}번 줄의 주제(질문)를 써 주세요.`);
  if (length(text) > TOPIC_MAX) throw new Error(dictation ? `${n}번 줄: 받아쓰기 문장은 ${TOPIC_MAX}자까지 쓸 수 있어요.` : `${n}번 줄: 주제는 ${TOPIC_MAX}자까지 쓸 수 있어요.`);
  const note = dictation ? '' : cleanText(input.note);
  if (length(note) > NOTE_MAX) throw new Error(`${n}번 줄: 보조 설명은 ${NOTE_MAX}자까지 쓸 수 있어요.`);
  const columns = (COLUMN_CHOICES as readonly number[]).includes(Number(input.columns)) ? Number(input.columns) : (prev?.columns ?? 2);
  const sort: TopicSort = input.sort === 'number' || input.sort === 'time' ? input.sort : (prev?.sort ?? 'number');
  // A new 받아쓰기 has no time limit unless the teacher picks one: the teacher closes it when everyone has heard.
  const minutes =
    input.minutes === null ? null : (MINUTE_CHOICES as readonly number[]).includes(Number(input.minutes)) ? Number(input.minutes) : prev ? prev.minutes : dictation ? null : DEFAULT_MINUTES;
  return dictation ? { text: '', note, columns, sort, minutes, dictation: text } : { text, note, columns, sort, minutes };
}

/** Whether any student has answered a topic, in any class. */
function hasAnswers(t: TopicRec): boolean {
  return Object.keys(db().topicAnswers[t.id] ?? {}).length > 0;
}

/**
 * The teacher's title and table, checked. A row carrying the id of one of this 아고라's topics changes that topic, so
 * its answers stay; a row without one is a new topic. Rows left empty are rows the teacher didn't use.
 */
function agoraFields(input: AgoraInput, prev?: AgoraRec): { title: string; topics: TopicRec[] } {
  const title = cleanText(input.title).replace(/\s*\n\s*/g, ' ');
  if (!title) throw new Error('제목을 써 주세요.');
  if (length(title) > TITLE_MAX) throw new Error(`제목은 ${TITLE_MAX}자까지 쓸 수 있어요.`);
  const rows = (Array.isArray(input.topics) ? (input.topics as unknown[]) : [])
    .map((r, i) => ({ r: (r !== null && typeof r === 'object' ? r : {}) as TopicInput, n: i + 1 }))
    .filter(({ r }) => cleanText(r.text) || cleanText(r.note));
  if (!rows.length) throw new Error('주제를 하나 이상 써 주세요.');
  if (rows.length > TOPICS_MAX) throw new Error(`주제는 ${TOPICS_MAX}개까지 넣을 수 있어요.`);
  const taken = new Set<string>();
  const topics = rows.map(({ r, n }) => {
    const old = prev?.topics.find((t) => t.id === r.id && !taken.has(t.id));
    if (old) taken.add(old.id);
    const fields = topicFields(r, n, old);
    // Answers to a 받아쓰기 were written to its sentence: once there are any, the sentence and the kind stay.
    if (old && old.dictation !== fields.dictation && hasAnswers(old)) {
      throw new Error(`${n}번 줄: 답이 있는 받아쓰기는 문장이나 종류를 바꿀 수 없어요. 새 줄에 써 주세요.`);
    }
    return { id: old?.id ?? newId('top'), ...fields };
  });
  return { title, topics };
}

/** A new 아고라, for any class to open. */
export function addAgora(input: AgoraInput): string {
  const id = newId('ago');
  const agoras = db().agoras;
  agoras[id] = { id, ...agoraFields(input), runs: {}, reward: { itemId: rewardItemAt(Object.keys(agoras).length) }, createdAt: Date.now() };
  return id;
}

/** 이번 아고라 보상: one of the items a quiz can reward (attendance items are earned by coming). */
export function setReward(agoraId: string, itemId: string) {
  const a = own(db().agoras, agoraId);
  if (!a) throw new Error('그 아고라가 없어졌어요. 화면을 새로 고쳐 주세요.');
  if (!QUIZ_REWARD_ITEMS.some((i) => i.id === itemId)) throw new Error('그 아이템은 보상으로 고를 수 없어요.');
  a.reward = { itemId };
}

/** The 아고라's reward item; one the catalog no longer has falls back to its first. */
export function rewardItem(a: AgoraRec): ItemDef {
  const item = itemById(a.reward?.itemId ?? '');
  return item && QUIZ_REWARD_ITEMS.includes(item) ? item : QUIZ_REWARD_ITEMS[0];
}

/** A changed 아고라: a topic left out of the table goes with its answers. */
export function editAgora(agoraId: string, input: AgoraInput) {
  const d = db();
  const a = own(d.agoras, agoraId);
  if (!a) throw new Error('그 아고라가 없어졌어요. 화면을 새로 고쳐 주세요.');
  const { title, topics } = agoraFields(input, a);
  for (const t of a.topics) if (!topics.some((x) => x.id === t.id)) delete d.topicAnswers[t.id];
  // A topic taken out, or a sentence changed (it had no answers yet), has been shown to no class.
  const same = new Set(topics.filter((x) => a.topics.some((t) => t.id === x.id && t.dictation === x.dictation)).map((x) => x.id));
  if (a.released) for (const [classId, ids] of Object.entries(a.released)) a.released[classId] = ids.filter((id) => same.has(id));
  a.title = title;
  a.topics = topics;
}

/** An 아고라 goes with its topics' answers. */
export function deleteAgora(agoraId: string) {
  const d = db();
  const a = own(d.agoras, agoraId);
  if (!a) return;
  for (const t of a.topics) delete d.topicAnswers[t.id];
  delete d.agoras[agoraId];
}

/** A deleted class leaves no runs behind; its students' answers go with them (dropStudentAnswers). */
export function dropClassRuns(classId: string) {
  for (const a of Object.values(db().agoras)) {
    delete a.runs[classId];
    if (a.released) delete a.released[classId];
  }
}

/** Students taken off the roster take their answers with them. */
export function dropStudentAnswers(studentIds: string[]) {
  for (const answers of Object.values(db().topicAnswers)) for (const id of studentIds) delete answers[id];
}

/**
 * A student's answer, cleaned and checked (the hub checks who may write); a changed one keeps its first time and its
 * card setting and its ⭐. Changed in 다시 쓰기 (`rewrite`), it keeps what it said before as its 처음 답, the first time only.
 */
export function putAnswer(t: TopicRec, studentId: string, raw: unknown, rewrite = false) {
  const text = cleanText(raw);
  if (!text) throw new Error('답을 써 주세요.');
  if (length(text) > ANSWER_MAX) throw new Error(`답은 ${ANSWER_MAX}자까지 쓸 수 있어요.`);
  const answers = (db().topicAnswers[t.id] ??= {});
  const prev = own(answers, studentId);
  const now = Date.now();
  const first = prev?.first ?? (rewrite ? prev?.text : undefined);
  const next: TopicAnswerRec = { text, shown: prev?.shown ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now };
  // Changed back to what it first said, there is nothing to show beside it.
  if (first !== undefined && first !== text) next.first = first;
  // The teacher's ⭐ stays with the answer through changes, as its reward does.
  if (prev?.star) next.star = true;
  // So do a 받아쓰기's answer at its first 마감 and the teacher's 정답 인정 of it, which the statistics count.
  if (prev?.closed !== undefined) next.closed = prev.closed;
  if (prev?.accepted) next.accepted = true;
  answers[studentId] = next;
}

export function dropAnswer(t: TopicRec, studentId: string) {
  const answers = db().topicAnswers[t.id];
  if (answers && own(answers, studentId)) delete answers[studentId];
}

/** One class's answers to a topic. */
function classAnswers(t: TopicRec, classId: string): TopicAnswerRec[] {
  return classAnswerEntries(t, classId).map(([, a]) => a);
}

/**
 * The first 마감 of a 받아쓰기 for a class: each answer is kept as it stands (`closed`), which is what the statistics
 * count; an answer that was already closed in an earlier lesson keeps its first one. A topic skipped or closed while
 * students wrote never gets here, so its answers count as unfinished.
 */
export function closeDictation(t: TopicRec, classId: string) {
  if (t.dictation === undefined) return;
  for (const x of classAnswers(t, classId)) x.closed ??= x.text;
}

/** [정답 공개] of a 받아쓰기: the class has been shown its sentence, from now on also in 내 답 노트. */
export function releaseDictation(a: AgoraRec, t: TopicRec, classId: string) {
  const ids = ((a.released ??= {})[classId] ??= []);
  if (!ids.includes(t.id)) ids.push(t.id);
}

/** Whether a class has been shown a 받아쓰기's sentence. */
function isReleased(a: AgoraRec, t: TopicRec, classId: string | undefined): boolean {
  return classId !== undefined && !!a.released?.[classId]?.includes(t.id);
}

/** The teacher's 정답 인정 of a student's closed 받아쓰기 answer, given or taken back. */
export function acceptAnswer(t: TopicRec, studentId: string, accepted: boolean) {
  const x = own(db().topicAnswers[t.id] ?? {}, studentId);
  if (t.dictation === undefined || x?.closed === undefined) return;
  if (accepted) x.accepted = true;
  else delete x.accepted;
}

/**
 * When a class did an 아고라, for 다시 보기: its run, or its latest answer for one from before runs were kept; null when
 * the class has no answer to look at again.
 */
export function lessonOf(a: AgoraRec, classId: string): number | null {
  const times = a.topics.flatMap((t) => classAnswers(t, classId).map((x) => x.createdAt));
  if (!times.length) return null;
  return a.runs[classId] ?? Math.max(...times);
}

/** A new session starts with every card of the class following it; cards shown or hidden one by one last time let go. */
export function resetCards(a: AgoraRec, classId: string) {
  for (const t of a.topics) for (const x of classAnswers(t, classId)) x.shown = null;
}

/** [전체 공개] lets go of cards shown one by one (every card shows now); a card hidden on its own stays hidden. */
export function revealCards(t: TopicRec, classId: string) {
  for (const a of classAnswers(t, classId)) if (a.shown === true) a.shown = null;
}

/** 열 and 순서 of the topic up, which stay with it for next time; a value that isn't one of the choices changes nothing. */
export function setSettings(t: TopicRec, input: { columns?: unknown; sort?: unknown }) {
  if ((COLUMN_CHOICES as readonly number[]).includes(Number(input.columns))) t.columns = Number(input.columns);
  if (input.sort === 'number' || input.sort === 'time') t.sort = input.sort;
}

/**
 * The teacher clicks an answer: it flips from what shows now. A card that ends up as the session would show it anyway
 * follows the session again; one that differs keeps its own setting.
 */
export function flipCard(reveal: TopicReveal, a: TopicAnswerRec) {
  setCardShown(reveal, a, !isShown(reveal, a));
}

/** Shows or hides one answer whatever [전체 공개] says; as the session's own setting, it follows that again. */
export function setCardShown(reveal: TopicReveal, a: TopicAnswerRec, visible: boolean) {
  a.shown = visible === (reveal === 'public') ? null : visible;
}

/** Whether an answer's text shows: the card's own setting, or else the session's. */
export function isShown(reveal: TopicReveal, a: TopicAnswerRec): boolean {
  return a.shown === null ? reveal === 'public' : a.shown;
}

/** A student's card on the projector and the class's phones. */
export interface RoomCard {
  number: number;
  name: string;
  look: AvatarLook;
  sent: boolean;
  /** Only when the answer shows; otherwise it is left out here, so it never reaches a screen. */
  text?: string;
  /** The teacher's ⭐, which shows whether the answer does or not. */
  star?: true;
}

/** The 입력 시간 running (server clock); null when the topic has no limit or writing is over. */
export type AgoraTimer = { startedAt: number; endsAt: number } | null;

/**
 * The 아고라 session the hub keeps, in memory only like the arena's: the 아고라 open for one class, a lesson or 다시
 * 보기 of one done before, the topic up and its phase, whether answers show, the projector's page out of the pages its
 * cards take (the projector measures them and says), whether the song plays, the 입력 시간, the class's students who
 * have come in, and when the 대기실's 놀이 방법 demo began (server clock; null when it isn't playing).
 */
export interface AgoraLive {
  agoraId: string;
  classId: string;
  /** 다시 보기: when the class did the 아고라, looked at again with no writing unless the teacher opens 다시 쓰기; null for a lesson. */
  review: number | null;
  /** The topic up, by its place in the 아고라. */
  index: number;
  /** The topics students have written to in this session ([쓰기 시작] or [다시 쓰기]), by id. */
  wrote: Set<string>;
  phase: AgoraPhase;
  reveal: TopicReveal;
  page: number;
  pages: number;
  music: boolean;
  timer: AgoraTimer;
  joined: Set<string>;
  howtoAt: number | null;
  /** Names this session in the reward records. */
  id: string;
  /** The students this session has rewarded for a ⭐, with what they got: once each. */
  rewarded: Map<string, Praise>;
  /** When the teacher last gave a ⭐ (server clock; 0 before the first), so the projector claps for each one. */
  praisedAt: number;
  /** The cards on each of the projector's pages, by student number, as it measured them; [] until it says. */
  pageNumbers: number[][];
  /** 받아쓰기: when the teacher's laptop started reading the sentence (server clock) and about how long it takes; null otherwise. */
  listening: { at: number; ms: number } | null;
}

/** A reward for a ⭐: the item, whether the student already had it (then nothing new reaches their 보관함), and when. */
export interface Praise {
  itemId: string;
  alreadyOwned: boolean;
  at: number;
}

/**
 * The teacher's ⭐ on an answer, given or taken back. The mark stays with the answer (on its card, and in 다시 보기
 * and 내 답 노트). A student's first ⭐ in a session gives them the 아고라's reward then and there, into their 보관함
 * unless they have it already; taking the ⭐ back takes only the mark, never the reward.
 */
export function toggleStar(a: AgoraRec, live: AgoraLive, x: TopicAnswerRec, studentId: string) {
  if (x.star) {
    delete x.star;
    return;
  }
  x.star = true;
  // Applause for every ⭐ given, a reward or not; taking one back is quiet.
  live.praisedAt = Date.now();
  const d = db();
  const s = own(d.students, studentId);
  if (!s || live.rewarded.has(studentId)) return;
  const item = rewardItem(a);
  const alreadyOwned = s.inventory.includes(item.id);
  if (!alreadyOwned) s.inventory.push(item.id);
  const at = Date.now();
  d.rewards.push({ sessionId: live.id, eventId: a.id, studentId, itemId: item.id, reason: 'praise', at });
  live.rewarded.set(studentId, { itemId: item.id, alreadyOwned, at });
}

/**
 * A topic's cards: the class's students with an answer and, once students have written to it in this session,
 * everyone who came in too (so 다시 보기 shows last lesson's answers alone until 다시 쓰기), by number or by when they
 * first answered. This is the only way answers reach the projector and the phones.
 */
export function roomCards(t: TopicRec, live: AgoraLive): RoomCard[] {
  const d = db();
  const answers = d.topicAnswers[t.id] ?? {};
  const wrote = live.wrote.has(t.id);
  // A student who hasn't answered goes after those who have, by number.
  const firstAt = (id: string) => own(answers, id)?.createdAt ?? Infinity;
  return Object.values(d.students)
    .filter((s) => s.classId === live.classId && ((wrote && live.joined.has(s.id)) || own(answers, s.id)))
    .sort((a, b) => (t.sort === 'time' ? firstAt(a.id) - firstAt(b.id) : 0) || a.number - b.number)
    .map((s) => {
      const a = own(answers, s.id);
      const card: RoomCard = { number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined), sent: !!a };
      // A 받아쓰기 answer stays on its own phone: a right one is the sentence itself, and a wrong one is no one else's business.
      if (a && t.dictation === undefined && isShown(live.reveal, a)) card.text = a.text;
      if (a?.star) card.star = true;
      return card;
    });
}

/** Who has come in, for the 대기실 and the 끝 on the projector. */
function joinedStudents(live: AgoraLive) {
  const students = db().students;
  return [...live.joined]
    .map((id) => own(students, id))
    .filter((s) => s !== undefined)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined) }));
}

/**
 * The 끝 of a lesson: how many answers the class wrote, how many of each topic's cards sent one (a topic it never
 * wrote to was skipped), and everyone who came in. Counts only, never an answer.
 */
function endSummary(a: AgoraRec, live: AgoraLive) {
  const topics = a.topics.map((t) => {
    const kind = kindOf(t);
    if (!live.wrote.has(t.id)) return { text: t.text, kind, sent: 0, of: 0, skipped: true };
    const cards = roomCards(t, live);
    return { text: t.text, kind, sent: cards.filter((c) => c.sent).length, of: cards.length, skipped: false };
  });
  const students = db().students;
  const parade = [...live.joined]
    .map((id) => own(students, id))
    .filter((s) => s !== undefined)
    .sort((x, y) => x.number - y.number)
    .map((s) => ({ number: s.number, look: normalizeLook(s.look ?? undefined), rewarded: live.rewarded.has(s.id) }));
  return { answers: topics.reduce((n, t) => n + t.sent, 0), rewarded: live.rewarded.size, topics, parade };
}

/** What the 대기실 and the phones show of the reward: the item and its name. */
function rewardView(a: AgoraRec) {
  const item = rewardItem(a);
  return { itemId: item.id, name: item.name };
}

const onBoard = (phase: AgoraPhase) => phase === 'writing' || phase === 'closed';

const kindOf = (t: TopicRec) => (t.dictation === undefined ? ('writing' as const) : ('dictation' as const));

/**
 * A topic as the projector and the phones show it. A 받아쓰기 has no text: its sentence comes as `answer`, and only
 * once [정답 공개] has shown it in this session.
 */
function screenTopic(t: TopicRec, live: AgoraLive) {
  if (t.dictation === undefined) return { id: t.id, kind: 'writing' as const, text: t.text, note: t.note };
  return { id: t.id, kind: 'dictation' as const, text: '', note: '', ...(live.reveal === 'public' ? { answer: t.dictation } : {}) };
}

/** What the projector gets: the 대기실's crowd, the topic up and its cards, or the 끝. `t` is the topic up. */
export function displayAgora(a: AgoraRec, t: TopicRec, live: AgoraLive) {
  return {
    phase: live.phase,
    className: own(db().classes, live.classId)?.name ?? '',
    title: a.title,
    review: live.review,
    index: live.index,
    count: a.topics.length,
    reward: rewardView(a),
    topic: { ...screenTopic(t, live), minutes: t.minutes, columns: t.columns, sort: t.sort },
    reveal: live.reveal,
    listening: live.listening,
    joined: live.phase === 'lobby' ? joinedStudents(live) : [],
    cards: onBoard(live.phase) ? roomCards(t, live) : [],
    page: live.page,
    music: live.music,
    timer: live.timer,
    howtoAt: live.phase === 'lobby' ? live.howtoAt : null,
    praisedAt: live.praisedAt,
    end: live.phase === 'end' ? endSummary(a, live) : null,
  };
}

/**
 * A student's own answers to an 아고라's topics, in order: only the topics they answered. A 받아쓰기 comes with its
 * sentence (`answer`) once their class has been shown it.
 */
function myAnswers(a: AgoraRec, studentId: string) {
  const d = db();
  const classId = own(d.students, studentId)?.classId;
  return a.topics.flatMap((t, i) => {
    const x = own(d.topicAnswers[t.id] ?? {}, studentId);
    if (!x) return [];
    const answer = t.dictation !== undefined && isReleased(a, t, classId) ? t.dictation : null;
    return [{ n: i + 1, kind: kindOf(t), topic: t.text, answer, text: x.text, first: x.first ?? null, star: !!x.star }];
  });
}

/** When a student wrote to an 아고라, the day of the lesson for 내 답 노트: their latest first answer to one of its topics. */
function answeredAt(a: AgoraRec, studentId: string): number {
  const answers = db().topicAnswers;
  return Math.max(0, ...a.topics.map((t) => own(answers[t.id] ?? {}, studentId)?.createdAt ?? 0));
}

/**
 * What a student of the session's class gets: the topic up, their own answer whether it shows or not, the class's
 * cards while students write or look at answers, and at the 끝 their own answers of the day.
 */
export function studentAgora(a: AgoraRec, t: TopicRec, live: AgoraLive, studentId: string) {
  const mine = own(db().topicAnswers[t.id] ?? {}, studentId);
  return {
    phase: live.phase,
    title: a.title,
    review: live.review,
    index: live.index,
    count: a.topics.length,
    reward: rewardView(a),
    topic: screenTopic(t, live),
    reveal: live.reveal,
    listening: live.listening,
    mine: mine ? { text: mine.text, first: mine.first ?? null, at: mine.createdAt, star: !!mine.star } : null,
    /** The reward this student got for a ⭐ in this session, for the box that opens on their phone. */
    praise: live.rewarded.get(studentId) ?? null,
    cards: onBoard(live.phase) ? roomCards(t, live) : [],
    timer: live.timer,
    end: live.phase === 'end' ? myAnswers(a, studentId) : null,
  };
}

/** 내 답 노트: every 아고라 a student answered, the latest first, with their own answers and never anyone else's. */
export function studentNotes(studentId: string) {
  return agoraList()
    .map((a) => ({ id: a.id, title: a.title, count: a.topics.length, at: answeredAt(a, studentId), topics: myAnswers(a, studentId) }))
    .filter((n) => n.topics.length > 0)
    .sort((x, y) => y.at - x.at);
}

/**
 * An answer as the teacher screen has it: all of it, whether it shows or not, with its 처음 답 and ⭐, and for
 * 받아쓰기 its answer at the first 마감 and the teacher's 정답 인정.
 */
function teacherAnswer(studentId: string, x: TopicAnswerRec) {
  return { studentId, text: x.text, first: x.first ?? null, star: !!x.star, shown: x.shown, createdAt: x.createdAt, updatedAt: x.updatedAt, closed: x.closed ?? null, accepted: !!x.accepted };
}

/**
 * One class's answers to each topic of an 아고라, by topic id: what the teacher screen fetches when it shows them (the
 * 답 card), and what the open session's console gets. Null for an 아고라 that isn't there.
 */
export function teacherAnswers(agoraId: string, classId: string): Record<string, ReturnType<typeof teacherAnswer>[]> | null {
  const d = db();
  const a = own(d.agoras, agoraId);
  if (!a) return null;
  return Object.fromEntries(a.topics.map((t) => [t.id, classAnswerEntries(t, classId).map(([studentId, x]) => teacherAnswer(studentId, x))]));
}

function classAnswerEntries(t: TopicRec, classId: string): [string, TopicAnswerRec][] {
  const d = db();
  return Object.entries(d.topicAnswers[t.id] ?? {}).filter(([studentId]) => own(d.students, studentId)?.classId === classId);
}

/** A number for one answer as it stands (its writer's class, text, 처음 답, ⭐ and card setting), summed into an 아고라's answersKey. */
function answerPrint(studentId: string, classId: string | undefined, topicId: string, x: TopicAnswerRec): number {
  const s = `${studentId}|${classId ?? ''}|${topicId}|${x.updatedAt}|${x.text.length}|${x.first?.length ?? -1}|${x.star ? 1 : 0}|${x.shown}|${x.closed?.length ?? -1}|${x.accepted ? 1 : 0}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The teacher screen's 아고라: every one, the newest first, with the classes that did it and, of its answers, only
 * numbers: how many each class wrote to each topic, how many of a class wrote at all, and the class's last lesson.
 * The texts go out only for the open session's class and when the teacher opens an 아고라's answers (teacherAnswers),
 * so a semester of answers doesn't travel with every change. `answersKey` changes whenever one of its answers does,
 * which tells an open answer list to fetch again.
 */
export function teacherAgora(live: AgoraLive | null) {
  const d = db();
  const agoras = agoraList().map((a) => {
    const writers: Record<string, Set<string>> = {};
    const latest: Record<string, number> = {};
    let print = 0;
    let total = 0;
    const topics = a.topics.map((t) => {
      const counts: Record<string, number> = {};
      const entries = Object.entries(d.topicAnswers[t.id] ?? {});
      for (const [studentId, x] of entries) {
        const classId = own(d.students, studentId)?.classId;
        print = (print + answerPrint(studentId, classId, t.id, x)) >>> 0;
        if (!classId) continue;
        counts[classId] = (counts[classId] ?? 0) + 1;
        (writers[classId] ??= new Set()).add(studentId);
        latest[classId] = Math.max(latest[classId] ?? 0, x.createdAt);
      }
      total += entries.length;
      return { id: t.id, text: t.text, note: t.note, columns: t.columns, sort: t.sort, minutes: t.minutes, dictation: t.dictation ?? null, counts, total: entries.length };
    });
    return {
      id: a.id,
      title: a.title,
      createdAt: a.createdAt,
      runs: Object.entries(a.runs)
        .filter(([classId]) => own(d.classes, classId))
        .map(([classId, at]) => ({ classId, at })),
      reward: { itemId: rewardItem(a).id },
      topics,
      writers: Object.fromEntries(Object.entries(writers).map(([classId, ids]) => [classId, ids.size])),
      // As lessonOf: the class's last run, or its latest answer in an 아고라 from before runs were kept.
      lessons: Object.fromEntries(Object.entries(latest).map(([classId, at]) => [classId, a.runs[classId] ?? at])),
      released: a.released ?? {},
      answersKey: `${total}.${print.toString(36)}`,
    };
  });
  const session = live && {
    agoraId: live.agoraId,
    classId: live.classId,
    className: own(d.classes, live.classId)?.name ?? '',
    review: live.review,
    index: live.index,
    phase: live.phase,
    reveal: live.reveal,
    page: live.page,
    pages: live.pages,
    music: live.music,
    timer: live.timer && { ...live.timer },
    joined: [...live.joined],
    wrote: [...live.wrote],
    rewarded: [...live.rewarded.keys()],
    praisedAt: live.praisedAt,
    pageNumbers: live.pageNumbers,
    howto: live.howtoAt !== null,
    // The console's cards, writers and stars: this class's answers to the open 아고라, the only texts that travel.
    answers: teacherAnswers(live.agoraId, live.classId) ?? {},
  };
  return { agoras, live: session };
}

/**
 * One class's 받아쓰기 results, for Excel: each 받아쓰기 topic and each student of the class, with the answer at the
 * first 마감 (what the statistics count) and how it went, and the answer as it is now. Null when either is gone.
 */
export function dictationCsv(agoraId: string, classId: string): { name: string; csv: string } | null {
  const d = db();
  const a = own(d.agoras, agoraId);
  const c = own(d.classes, classId);
  if (!a || !c) return null;
  const students = Object.values(d.students)
    .filter((s) => s.classId === classId)
    .sort((x, y) => x.number - y.number);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows = a.topics.flatMap((t, i) => {
    const target = t.dictation;
    if (target === undefined) return [];
    return students.map((s) => {
      const x = own(d.topicAnswers[t.id] ?? {}, s.id);
      const first = x?.closed !== undefined ? gradeDictation(target, x.closed) : null;
      const now = x ? gradeDictation(target, x.text) : null;
      // 중단: answered, but the topic was skipped or the 아고라 closed before 마감, so it isn't counted.
      const result = !x ? '안 냄' : !first ? '중단' : x.accepted ? '정답 인정' : first.perfect ? '정답' : '틀림';
      return [c.name, s.number, s.name, i + 1, target, x?.closed ?? '', result, first ? pct(first.accuracy) : '', x?.text ?? '', now ? pct(now.accuracy) : ''];
    });
  });
  const header = ['반', '번호', '이름', '주제', '받아쓰기 문장', '처음 답(첫 마감)', '결과', '처음 답 단어 정확도', '지금 답', '지금 답 단어 정확도'];
  return { name: `받아쓰기-${c.name}-${a.title}.csv`, csv: csvText([header, ...rows]) };
}

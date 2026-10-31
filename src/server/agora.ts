// 아고라: a few topics a class answers in writing, one after another, as an arena event is a few questions. The records
// live in store.ts; this keeps them in shape (what the teacher may type, the answers students send), tidies up after
// deleted classes and students, and builds what each screen gets. An 아고라 is made once and opened for one class at a
// time, the way an arena event is: the session (대기실, each topic's 준비, 쓰기 and 마감, then the 끝) is the hub's
// (Hub.openAgora, Hub.answerTopic), and it saves and pushes every screen its new view after each change.
import { ANSWER_MAX, COLUMN_CHOICES, DEFAULT_MINUTES, MINUTE_CHOICES, NOTE_MAX, TITLE_MAX, TOPIC_MAX, TOPICS_MAX, type AgoraPhase, type TopicReveal, type TopicSort } from '@/lib/agora';
import { normalizeLook } from '@/lib/avatar';
import type { AvatarLook } from '@/lib/types';
import { db, newId, type AgoraRec, type TopicAnswerRec, type TopicRec } from './store';

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

/** One row the teacher typed, checked (`n` is its row, for the message); a setting left out keeps the topic's own, or the default. */
function topicFields(input: TopicInput, n: number, prev?: TopicRec) {
  const text = cleanText(input.text);
  if (!text) throw new Error(`${n}번 줄의 주제(질문)를 써 주세요.`);
  if (length(text) > TOPIC_MAX) throw new Error(`${n}번 줄: 주제는 ${TOPIC_MAX}자까지 쓸 수 있어요.`);
  const note = cleanText(input.note);
  if (length(note) > NOTE_MAX) throw new Error(`${n}번 줄: 보조 설명은 ${NOTE_MAX}자까지 쓸 수 있어요.`);
  const columns = (COLUMN_CHOICES as readonly number[]).includes(Number(input.columns)) ? Number(input.columns) : (prev?.columns ?? 2);
  const sort: TopicSort = input.sort === 'number' || input.sort === 'time' ? input.sort : (prev?.sort ?? 'number');
  const minutes =
    input.minutes === null ? null : (MINUTE_CHOICES as readonly number[]).includes(Number(input.minutes)) ? Number(input.minutes) : prev ? prev.minutes : DEFAULT_MINUTES;
  return { text, note, columns, sort, minutes };
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
    return { id: old?.id ?? newId('top'), ...topicFields(r, n, old) };
  });
  return { title, topics };
}

/** A new 아고라, for any class to open. */
export function addAgora(input: AgoraInput): string {
  const id = newId('ago');
  db().agoras[id] = { id, ...agoraFields(input), runs: {}, createdAt: Date.now() };
  return id;
}

/** A changed 아고라: a topic left out of the table goes with its answers. */
export function editAgora(agoraId: string, input: AgoraInput) {
  const d = db();
  const a = own(d.agoras, agoraId);
  if (!a) throw new Error('그 아고라가 없어졌어요. 화면을 새로 고쳐 주세요.');
  const { title, topics } = agoraFields(input, a);
  for (const t of a.topics) if (!topics.some((x) => x.id === t.id)) delete d.topicAnswers[t.id];
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
  for (const a of Object.values(db().agoras)) delete a.runs[classId];
}

/** Students taken off the roster take their answers with them. */
export function dropStudentAnswers(studentIds: string[]) {
  for (const answers of Object.values(db().topicAnswers)) for (const id of studentIds) delete answers[id];
}

/**
 * A student's answer, cleaned and checked (the hub checks who may write); a changed one keeps its first time and its
 * card setting. Changed in 다시 쓰기 (`rewrite`), it keeps what it said before as its 처음 답, the first time only.
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
  answers[studentId] = next;
}

export function dropAnswer(t: TopicRec, studentId: string) {
  const answers = db().topicAnswers[t.id];
  if (answers && own(answers, studentId)) delete answers[studentId];
}

/** One class's answers to a topic. */
function classAnswers(t: TopicRec, classId: string): TopicAnswerRec[] {
  const d = db();
  return Object.entries(d.topicAnswers[t.id] ?? {})
    .filter(([studentId]) => own(d.students, studentId)?.classId === classId)
    .map(([, a]) => a);
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
  const next = !isShown(reveal, a);
  a.shown = next === (reveal === 'public') ? null : next;
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
      if (a && isShown(live.reveal, a)) card.text = a.text;
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
    if (!live.wrote.has(t.id)) return { text: t.text, sent: 0, of: 0, skipped: true };
    const cards = roomCards(t, live);
    return { text: t.text, sent: cards.filter((c) => c.sent).length, of: cards.length, skipped: false };
  });
  return { answers: topics.reduce((n, t) => n + t.sent, 0), topics, parade: joinedStudents(live).map((s) => ({ number: s.number, look: s.look })) };
}

const onBoard = (phase: AgoraPhase) => phase === 'writing' || phase === 'closed';

/** What the projector gets: the 대기실's crowd, the topic up and its cards, or the 끝. `t` is the topic up. */
export function displayAgora(a: AgoraRec, t: TopicRec, live: AgoraLive) {
  return {
    phase: live.phase,
    className: own(db().classes, live.classId)?.name ?? '',
    title: a.title,
    review: live.review,
    index: live.index,
    count: a.topics.length,
    topic: { id: t.id, text: t.text, note: t.note, minutes: t.minutes, columns: t.columns, sort: t.sort },
    reveal: live.reveal,
    joined: live.phase === 'lobby' ? joinedStudents(live) : [],
    cards: onBoard(live.phase) ? roomCards(t, live) : [],
    page: live.page,
    music: live.music,
    timer: live.timer,
    howtoAt: live.phase === 'lobby' ? live.howtoAt : null,
    end: live.phase === 'end' ? endSummary(a, live) : null,
  };
}

/** A student's own answers to an 아고라's topics, in order: only the topics they answered. */
function myAnswers(a: AgoraRec, studentId: string) {
  const answers = db().topicAnswers;
  return a.topics.flatMap((t, i) => {
    const x = own(answers[t.id] ?? {}, studentId);
    return x ? [{ n: i + 1, topic: t.text, text: x.text, first: x.first ?? null }] : [];
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
    topic: { id: t.id, text: t.text, note: t.note },
    reveal: live.reveal,
    mine: mine ? { text: mine.text, first: mine.first ?? null, at: mine.createdAt } : null,
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
 * The teacher screen's 아고라: every one, the newest first, with the classes that did it and every answer to its
 * topics (a few lessons' worth, so all of it), and the open session.
 */
export function teacherAgora(live: AgoraLive | null) {
  const d = db();
  const agoras = agoraList().map((a) => ({
    id: a.id,
    title: a.title,
    createdAt: a.createdAt,
    runs: Object.entries(a.runs)
      .filter(([classId]) => own(d.classes, classId))
      .map(([classId, at]) => ({ classId, at })),
    topics: a.topics.map((t) => ({
      id: t.id,
      text: t.text,
      note: t.note,
      columns: t.columns,
      sort: t.sort,
      minutes: t.minutes,
      answers: Object.entries(d.topicAnswers[t.id] ?? {}).map(([studentId, x]) => ({ studentId, text: x.text, first: x.first ?? null, shown: x.shown, createdAt: x.createdAt, updatedAt: x.updatedAt })),
    })),
  }));
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
    howto: live.howtoAt !== null,
  };
  return { agoras, live: session };
}

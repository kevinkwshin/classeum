// 아고라: topics a class answers in writing, and the answers. The records live in store.ts; this keeps them in shape
// (what the teacher may type, the answers students send), tidies up after deleted classes and
// students, and builds what each screen gets. A topic is made once and opened for one class at a time, the way an
// arena event is: the session (대기실, 쓰기, 마감) is the hub's (Hub.openAgora, Hub.answerTopic), and it saves and
// pushes every screen its new view after each change.
import { ANSWER_MAX, COLUMN_CHOICES, DEFAULT_MINUTES, MINUTE_CHOICES, NOTE_MAX, TOPIC_MAX, type AgoraPhase, type TopicReveal, type TopicSort } from '@/lib/agora';
import { normalizeLook } from '@/lib/avatar';
import type { AvatarLook } from '@/lib/types';
import { db, newId, type TopicAnswerRec, type TopicRec } from './store';

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

/** Every topic, the newest first, as the arena lists its events. */
function topicList(): TopicRec[] {
  return Object.values(db().topics).sort((a, b) => b.createdAt - a.createdAt);
}

export interface TopicInput {
  text?: unknown;
  note?: unknown;
  columns?: unknown;
  sort?: unknown;
  /** 입력 시간 in minutes, or null for no limit. */
  minutes?: unknown;
}

/** What the teacher typed, checked; a setting left out keeps the topic's own (or the default for a new one). */
function topicFields(input: TopicInput, prev?: TopicRec) {
  const text = cleanText(input.text);
  if (!text) throw new Error('주제를 써 주세요.');
  if (length(text) > TOPIC_MAX) throw new Error(`주제는 ${TOPIC_MAX}자까지 쓸 수 있어요.`);
  const note = cleanText(input.note);
  if (length(note) > NOTE_MAX) throw new Error(`보조 설명은 ${NOTE_MAX}자까지 쓸 수 있어요.`);
  const columns = (COLUMN_CHOICES as readonly number[]).includes(Number(input.columns)) ? Number(input.columns) : (prev?.columns ?? 2);
  const sort: TopicSort = input.sort === 'number' || input.sort === 'time' ? input.sort : (prev?.sort ?? 'number');
  const minutes =
    input.minutes === null ? null : (MINUTE_CHOICES as readonly number[]).includes(Number(input.minutes)) ? Number(input.minutes) : prev ? prev.minutes : DEFAULT_MINUTES;
  return { text, note, columns, sort, minutes };
}

/** A new topic, for any class to open. */
export function addTopic(input: TopicInput): string {
  const id = newId('top');
  db().topics[id] = { id, ...topicFields(input), runs: {}, createdAt: Date.now() };
  return id;
}

export function editTopic(topicId: string, input: TopicInput) {
  const t = own(db().topics, topicId);
  if (!t) throw new Error('그 주제가 없어졌어요. 화면을 새로 고쳐 주세요.');
  Object.assign(t, topicFields(input, t));
}

/** A topic goes with its answers. */
export function deleteTopic(topicId: string) {
  const d = db();
  if (!own(d.topics, topicId)) return;
  delete d.topics[topicId];
  delete d.topicAnswers[topicId];
}

/** A deleted class leaves no runs behind; its students' answers go with them (dropStudentAnswers). */
export function dropClassRuns(classId: string) {
  for (const t of Object.values(db().topics)) delete t.runs[classId];
}

/** Students taken off the roster take their answers with them. */
export function dropStudentAnswers(studentIds: string[]) {
  for (const answers of Object.values(db().topicAnswers)) for (const id of studentIds) delete answers[id];
}

/** A student's answer, cleaned and checked (the hub checks who may write); a changed one keeps its first time and its card setting. */
export function putAnswer(t: TopicRec, studentId: string, raw: unknown) {
  const text = cleanText(raw);
  if (!text) throw new Error('답을 써 주세요.');
  if (length(text) > ANSWER_MAX) throw new Error(`답은 ${ANSWER_MAX}자까지 쓸 수 있어요.`);
  const answers = (db().topicAnswers[t.id] ??= {});
  const prev = own(answers, studentId);
  const now = Date.now();
  answers[studentId] = { text, shown: prev?.shown ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now };
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

/** A new session starts with every card of the class following it; cards shown or hidden one by one last time let go. */
export function resetCards(t: TopicRec, classId: string) {
  for (const a of classAnswers(t, classId)) a.shown = null;
}

/** [전체 공개] lets go of cards shown one by one (every card shows now); a card hidden on its own stays hidden. */
export function revealCards(t: TopicRec, classId: string) {
  for (const a of classAnswers(t, classId)) if (a.shown === true) a.shown = null;
}

/** 입력 시간, 열 and 순서, which stay with the topic for next time; a value that isn't one of the choices changes nothing. */
export function setSettings(t: TopicRec, input: { minutes?: unknown; columns?: unknown; sort?: unknown }) {
  if (input.minutes === null) t.minutes = null;
  else if ((MINUTE_CHOICES as readonly number[]).includes(Number(input.minutes))) t.minutes = Number(input.minutes);
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
 * The 아고라 session the hub keeps, in memory only like the arena's: the topic open for one class and its phase
 * (대기실, 쓰기, 마감), whether answers show, the projector's page out of the pages its cards take (the projector
 * measures them and says), whether the song plays, the 입력 시간, and the class's students who have come in.
 */
export interface AgoraLive {
  topicId: string;
  classId: string;
  phase: AgoraPhase;
  reveal: TopicReveal;
  page: number;
  pages: number;
  music: boolean;
  timer: AgoraTimer;
  joined: Set<string>;
}

/**
 * The cards once writing starts: the class's students who have come in and anyone of the class with an answer, by
 * number or by when they first answered. This is the only way answers reach the projector and the phones.
 */
export function roomCards(t: TopicRec, live: AgoraLive): RoomCard[] {
  const d = db();
  const answers = d.topicAnswers[t.id] ?? {};
  // A student who hasn't answered goes after those who have, by number.
  const firstAt = (id: string) => own(answers, id)?.createdAt ?? Infinity;
  return Object.values(d.students)
    .filter((s) => s.classId === live.classId && (live.joined.has(s.id) || own(answers, s.id)))
    .sort((a, b) => (t.sort === 'time' ? firstAt(a.id) - firstAt(b.id) : 0) || a.number - b.number)
    .map((s) => {
      const a = own(answers, s.id);
      const card: RoomCard = { number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined), sent: !!a };
      if (a && isShown(live.reveal, a)) card.text = a.text;
      return card;
    });
}

/** Who has come in, for the 대기실 on the projector. */
function joinedStudents(live: AgoraLive) {
  const students = db().students;
  return [...live.joined]
    .map((id) => own(students, id))
    .filter((s) => s !== undefined)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined) }));
}

/** What the projector gets: in the 대기실 the topic and who has come in, then the cards. */
export function displayAgora(t: TopicRec, live: AgoraLive) {
  const lobby = live.phase === 'lobby';
  return {
    phase: live.phase,
    className: own(db().classes, live.classId)?.name ?? '',
    topic: { id: t.id, text: t.text, note: t.note, minutes: t.minutes, columns: t.columns, sort: t.sort },
    reveal: live.reveal,
    joined: lobby ? joinedStudents(live) : [],
    cards: lobby ? [] : roomCards(t, live),
    page: live.page,
    music: live.music,
    timer: live.timer,
  };
}

/** What a student of the session's class gets: the topic, their own answer whether it shows or not, and the class's cards once writing starts. */
export function studentAgora(t: TopicRec, live: AgoraLive, studentId: string) {
  const mine = own(db().topicAnswers[t.id] ?? {}, studentId);
  return {
    phase: live.phase,
    topic: { id: t.id, text: t.text, note: t.note },
    reveal: live.reveal,
    mine: mine ? { text: mine.text } : null,
    cards: live.phase === 'lobby' ? [] : roomCards(t, live),
    timer: live.timer,
  };
}

/**
 * The teacher screen's 아고라: every topic, the newest first, with the classes that did it and every answer (a few
 * lessons' worth, so all of it), and the open session.
 */
export function teacherAgora(live: AgoraLive | null) {
  const d = db();
  const topics = topicList().map((t) => ({
    id: t.id,
    text: t.text,
    note: t.note,
    columns: t.columns,
    sort: t.sort,
    minutes: t.minutes,
    createdAt: t.createdAt,
    runs: Object.entries(t.runs)
      .filter(([classId]) => own(d.classes, classId))
      .map(([classId, at]) => ({ classId, at })),
    answers: Object.entries(d.topicAnswers[t.id] ?? {}).map(([studentId, a]) => ({ studentId, text: a.text, shown: a.shown, createdAt: a.createdAt, updatedAt: a.updatedAt })),
  }));
  const session = live && {
    topicId: live.topicId,
    classId: live.classId,
    className: own(d.classes, live.classId)?.name ?? '',
    phase: live.phase,
    reveal: live.reveal,
    page: live.page,
    pages: live.pages,
    music: live.music,
    timer: live.timer && { ...live.timer },
    joined: [...live.joined],
  };
  return { topics, live: session };
}

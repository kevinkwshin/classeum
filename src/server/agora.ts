// 아고라: topics a class answers in writing, and the answers. The records live in store.ts; this keeps them in shape
// (what the teacher may type, each class's order, copies for other classes, the answers students send), tidies up
// after deleted classes and students, and builds what each screen gets. Which topic is on screen, and who may write,
// is the hub's (Hub.showTopic, Hub.answerTopic); it saves and pushes every screen its new view after each change.
import { ANSWER_MAX, COLUMN_CHOICES, DEFAULT_MINUTES, MINUTE_CHOICES, NOTE_MAX, TOPIC_MAX, type TopicSort } from '@/lib/agora';
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

/** A class's topics in the teacher's order. */
function topicsOf(classId: string): TopicRec[] {
  return Object.values(db().topics)
    .filter((t) => t.classId === classId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

const nextOrder = (classId: string) => topicsOf(classId).reduce((last, t) => Math.max(last, t.order + 1), 0);

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

/** A new topic at the end of the class's list, 대기 until the teacher puts it up. */
export function addTopic(classId: string, input: TopicInput): string {
  const d = db();
  if (!own(d.classes, classId)) throw new Error('반을 먼저 골라 주세요.');
  const id = newId('top');
  d.topics[id] = { id, classId, ...topicFields(input), order: nextOrder(classId), status: 'draft', reveal: 'hidden', createdAt: Date.now() };
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

/** The class's topics in the order given; ids that aren't the class's are ignored, and any left out follow in their old order. */
export function orderTopics(classId: string, topicIds: string[]) {
  const mine = topicsOf(classId);
  const given = topicIds.map((id) => mine.find((t) => t.id === id)).filter((t): t is TopicRec => !!t);
  [...new Set([...given, ...mine])].forEach((t, i) => {
    t.order = i;
  });
}

/** The same topic, 대기 and without answers, at the end of each other class picked; returns how many classes got it. */
export function copyTopic(topicId: string, classIds: string[]): number {
  const d = db();
  const t = own(d.topics, topicId);
  if (!t) throw new Error('그 주제가 없어졌어요. 화면을 새로 고쳐 주세요.');
  let copied = 0;
  for (const classId of new Set(classIds)) {
    if (classId === t.classId || !own(d.classes, classId)) continue;
    const id = newId('top');
    d.topics[id] = { id, classId, text: t.text, note: t.note, columns: t.columns, sort: t.sort, minutes: t.minutes, order: nextOrder(classId), status: 'draft', reveal: 'hidden', createdAt: Date.now() };
    copied++;
  }
  if (!copied) throw new Error('복사할 다른 반을 골라 주세요.');
  return copied;
}

/** A deleted class takes its topics and their answers with it. */
export function dropClassTopics(classId: string) {
  const d = db();
  for (const t of Object.values(d.topics)) {
    if (t.classId !== classId) continue;
    delete d.topics[t.id];
    delete d.topicAnswers[t.id];
  }
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

/** Whether an answer's text shows: the card's own setting, or else the topic's. */
export function isShown(t: TopicRec, a: TopicAnswerRec): boolean {
  return a.shown === null ? t.reveal === 'public' : a.shown;
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

/**
 * The cards for a topic on screen: the class's students who have been in the room while it was up (`present`) and
 * anyone with an answer on it, by number or by when they first answered. This is the only way answers reach the
 * projector and the phones.
 */
export function roomCards(t: TopicRec, present: ReadonlySet<string>): RoomCard[] {
  const d = db();
  const answers = d.topicAnswers[t.id] ?? {};
  // A student who hasn't answered goes after those who have, by number.
  const firstAt = (id: string) => own(answers, id)?.createdAt ?? Infinity;
  return Object.values(d.students)
    .filter((s) => s.classId === t.classId && (present.has(s.id) || own(answers, s.id)))
    .sort((a, b) => (t.sort === 'time' ? firstAt(a.id) - firstAt(b.id) : 0) || a.number - b.number)
    .map((s) => {
      const a = own(answers, s.id);
      const card: RoomCard = { number: s.number, name: s.name, look: normalizeLook(s.look ?? undefined), sent: !!a };
      if (a && isShown(t, a)) card.text = a.text;
      return card;
    });
}

/** The 입력 시간 running for the topic on screen (server clock); null when it has no limit or is closed. */
export type AgoraTimer = { startedAt: number; endsAt: number } | null;

/** What the projector gets of the topic on screen. */
export function displayAgora(t: TopicRec, present: ReadonlySet<string>, page: number, timer: AgoraTimer) {
  return {
    topic: { id: t.id, text: t.text, note: t.note, className: own(db().classes, t.classId)?.name ?? '', status: t.status, reveal: t.reveal, columns: t.columns, sort: t.sort },
    cards: roomCards(t, present),
    page,
    timer,
  };
}

/** What a student of the topic's class gets: the topic, their own answer whether it shows or not, and the class's cards. */
export function studentAgora(t: TopicRec, studentId: string, present: ReadonlySet<string>, timer: AgoraTimer) {
  const mine = own(db().topicAnswers[t.id] ?? {}, studentId);
  return {
    topic: { id: t.id, text: t.text, note: t.note, status: t.status, reveal: t.reveal },
    mine: mine ? { text: mine.text } : null,
    cards: roomCards(t, present),
    timer,
  };
}

/**
 * The teacher screen's 아고라: every class's topics with every answer (a few lessons' worth, so all of it), the topic
 * on screen, and who has been in its room.
 */
export function teacherAgora(screen: { topicId: string; page: number; timer: AgoraTimer } | null, present: ReadonlySet<string>) {
  const d = db();
  const topics = Object.values(d.topics)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((t) => ({
      id: t.id,
      classId: t.classId,
      text: t.text,
      note: t.note,
      columns: t.columns,
      sort: t.sort,
      minutes: t.minutes,
      status: t.status,
      reveal: t.reveal,
      createdAt: t.createdAt,
      answers: Object.entries(d.topicAnswers[t.id] ?? {}).map(([studentId, a]) => ({ studentId, text: a.text, shown: a.shown, createdAt: a.createdAt, updatedAt: a.updatedAt })),
    }));
  return { topics, screen: screen && { ...screen, timer: screen.timer && { ...screen.timer } }, present: [...present] };
}

// 아고라: topics a class answers in writing, and the answers. The records live in store.ts; this keeps them in shape
// (what the teacher may type, each class's order, copies for other classes) and tidies up after deleted classes and
// students. The hub saves and pushes every screen its new view after each change (Hub.changeAgora).
import { COLUMN_CHOICES, NOTE_MAX, TOPIC_MAX, type TopicSort } from '@/lib/agora';
import { db, newId, type TopicRec } from './store';

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
  return { text, note, columns, sort };
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
    d.topics[id] = { id, classId, text: t.text, note: t.note, columns: t.columns, sort: t.sort, order: nextOrder(classId), status: 'draft', reveal: 'hidden', createdAt: Date.now() };
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

/** The teacher screen's 아고라: every class's topics with every answer. A few lessons' worth, so all of it. */
export function teacherAgora() {
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
      status: t.status,
      reveal: t.reveal,
      createdAt: t.createdAt,
      answers: Object.entries(d.topicAnswers[t.id] ?? {}).map(([studentId, a]) => ({ studentId, text: a.text, shown: a.shown, createdAt: a.createdAt, updatedAt: a.updatedAt })),
    }));
  return { topics };
}

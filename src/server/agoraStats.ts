// 아고라 통계: one class's record across every 아고라, as the arena's 통계 has quizzes. 받아쓰기 is scored the way the
// 답 card does it: the answer at its first 마감 (`closed`), 정답 being perfect or 정답 인정, and the word accuracy as
// graded (정답 인정 keeps its own). An answer never closed (the topic skipped or closed while writing) is 중단, and no
// answer is no record: neither counts as 0. 작문 is counted, never scored. One answer per student and topic is all
// there is, so these are not per-lesson marks. Fetched by the teacher screen when it shows them, never streamed.
import { dictationKey, gradeDictation, type DictationWord } from '@/lib/dictation';
import { csvText } from './csv';
import { compareNames } from './stats';
import { db, type AgoraRec, type TopicAnswerRec, type TopicRec } from './store';

const own = <T>(table: Record<string, T>, key: string | undefined): T | undefined => (key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined);

/** A word missed or written differently, and in how many answers (one answer counts a word once). */
export interface MissedWord {
  word: string;
  count: number;
}

/** One student's 받아쓰기 of one sentence. */
export interface DictationEntry {
  topicId: string;
  /** '아고라 제목 · 주제 3'. */
  label: string;
  sentence: string;
  /** When the class did it (its first answer), for order. */
  at: number;
  result: 'right' | 'accepted' | 'wrong' | 'stopped';
  /** The word accuracy at the first 마감; null for 중단. */
  accuracy: number | null;
  /** The answer at the first 마감, or as it is for 중단. */
  answer: string;
  /** The sentence's words, each heard right or not; null for 중단. */
  marked: DictationWord[] | null;
}

export interface AgoraStudentStats {
  id: string;
  number: number;
  name: string;
  /** 작문 topics written to (as the answers stand). */
  writing: number;
  /** Answers with a ⭐ on them now (작문 and 받아쓰기). */
  stars: number;
  /** 받아쓰기 at a first 마감: right (정답 or 정답 인정) of graded, how many were 정답 인정, and the accuracy over them. */
  dictation: { right: number; graded: number; accepted: number; accuracy: number | null; stopped: number };
  entries: DictationEntry[];
  missed: MissedWord[];
}

export interface AgoraSentenceStats {
  topicId: string;
  label: string;
  sentence: string;
  at: number;
  right: number;
  graded: number;
  accuracy: number | null;
  /** Words two or more students missed or wrote differently (정답 인정 answers left out). */
  missed: MissedWord[];
}

export interface AgoraStats {
  students: AgoraStudentStats[];
  sentences: AgoraSentenceStats[];
  /** Over every graded answer of the class (not an average of averages). */
  class: { right: number; graded: number; accuracy: number | null };
}

interface Done {
  a: AgoraRec;
  t: TopicRec;
  label: string;
  at: number;
  answers: Map<string, TopicAnswerRec>;
}

/** The class's topics, any with an answer from one of its students, in the order the class first answered them. */
function classTopics(classId: string, mine: Set<string>): Done[] {
  const d = db();
  const done: Done[] = [];
  for (const a of Object.values(d.agoras)) {
    a.topics.forEach((t, i) => {
      const answers = new Map(Object.entries(d.topicAnswers[t.id] ?? {}).filter(([id]) => mine.has(id)));
      if (answers.size === 0) return;
      done.push({ a, t, label: a.topics.length > 1 ? `${a.title} · 주제 ${i + 1}` : a.title, at: Math.min(...[...answers.values()].map((x) => x.createdAt)), answers });
    });
  }
  return done.sort((x, y) => x.at - y.at);
}

/** The target words a closed answer got wrong, each once; none for 정답 인정. */
function missedIn(target: string, x: TopicAnswerRec): string[] {
  if (x.closed === undefined || x.accepted) return [];
  return [...new Set(gradeDictation(target, x.closed).target.filter((w) => !w.ok).map((w) => dictationKey(w.word)))].filter(Boolean);
}

function tally(words: string[], least = 1): MissedWord[] {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n >= least)
    .map(([word, count]) => ({ word, count }))
    .sort((x, y) => y.count - x.count || compareNames(x.word, y.word));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);

/** The class's record over every 아고라: each student, each 받아쓰기 sentence, and the class as a whole. */
export function agoraStats(classId: string): AgoraStats | null {
  const d = db();
  if (!own(d.classes, classId)) return null;
  const students = Object.values(d.students).filter((s) => s.classId === classId).sort((x, y) => x.number - y.number);
  const done = classTopics(classId, new Set(students.map((s) => s.id)));
  const dictation = done.filter((x) => x.t.dictation !== undefined);
  const sentences = dictation.map(({ t, label, at, answers }) => {
    const target = t.dictation ?? '';
    const graded = [...answers.values()].filter((x) => x.closed !== undefined).map((x) => ({ x, g: gradeDictation(target, x.closed ?? '') }));
    return {
      topicId: t.id,
      label,
      sentence: target,
      at,
      right: graded.filter(({ x, g }) => x.accepted || g.perfect).length,
      graded: graded.length,
      accuracy: mean(graded.map(({ g }) => g.accuracy)),
      missed: tally([...answers.values()].flatMap((x) => missedIn(target, x)), 2),
    };
  });
  const all: number[] = [];
  let classRight = 0;
  const rows = students.map((s) => {
    const entries: DictationEntry[] = [];
    for (const { t, label, at, answers } of dictation) {
      const x = answers.get(s.id);
      if (!x) continue;
      const target = t.dictation ?? '';
      if (x.closed === undefined) {
        entries.push({ topicId: t.id, label, sentence: target, at, result: 'stopped', accuracy: null, answer: x.text, marked: null });
        continue;
      }
      const g = gradeDictation(target, x.closed);
      entries.push({ topicId: t.id, label, sentence: target, at, result: x.accepted ? 'accepted' : g.perfect ? 'right' : 'wrong', accuracy: g.accuracy, answer: x.closed, marked: g.target });
    }
    const graded = entries.filter((e) => e.accuracy !== null);
    const right = graded.filter((e) => e.result === 'right' || e.result === 'accepted').length;
    all.push(...graded.map((e) => e.accuracy ?? 0));
    classRight += right;
    return {
      id: s.id,
      number: s.number,
      name: s.name,
      writing: done.filter((x) => x.t.dictation === undefined && x.answers.has(s.id)).length,
      stars: done.filter((x) => x.answers.get(s.id)?.star).length,
      dictation: { right, graded: graded.length, accepted: graded.filter((e) => e.result === 'accepted').length, accuracy: mean(graded.map((e) => e.accuracy ?? 0)), stopped: entries.length - graded.length },
      entries,
      missed: tally(dictation.flatMap(({ t, answers }) => (answers.has(s.id) ? missedIn(t.dictation ?? '', answers.get(s.id)!) : []))).slice(0, 8),
    };
  });
  return { students: rows, sentences, class: { right: classRight, graded: all.length, accuracy: mean(all) } };
}

/** The class's 받아쓰기 for Excel: a row per student and sentence the class did, oldest first; no answer is 안 냄. */
export function agoraStatsCsv(classId: string): { name: string; csv: string } | null {
  const d = db();
  const c = own(d.classes, classId);
  if (!c) return null;
  const students = Object.values(d.students).filter((s) => s.classId === classId).sort((x, y) => x.number - y.number);
  const dictation = classTopics(classId, new Set(students.map((s) => s.id))).filter((x) => x.t.dictation !== undefined);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows = students.flatMap((s) =>
    dictation.map(({ a, t, answers }) => {
      const target = t.dictation ?? '';
      const x = answers.get(s.id);
      const first = x?.closed !== undefined ? gradeDictation(target, x.closed) : null;
      const now = x ? gradeDictation(target, x.text) : null;
      const result = !x ? '안 냄' : !first ? '중단' : x.accepted ? '정답 인정' : first.perfect ? '정답' : '틀림';
      return [c.name, s.number, s.name, a.title, a.topics.indexOf(t) + 1, target, x?.closed ?? '', result, first ? pct(first.accuracy) : '', x?.text ?? '', now ? pct(now.accuracy) : ''];
    }),
  );
  // The 아고라's own 받아쓰기 file's columns, with which 아고라 each sentence is from.
  const header = ['반', '번호', '이름', '아고라', '주제', '받아쓰기 문장', '처음 답(첫 마감)', '결과', '처음 답 단어 정확도', '지금 답', '지금 답 단어 정확도'];
  return { name: `받아쓰기-${c.name}.csv`, csv: csvText([header, ...rows]) };
}

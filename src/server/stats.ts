// Per-student and per-question statistics for the teacher, computed from stored responses.
import type { Question } from '@/lib/types';
import { normalizeAnswer } from '@/lib/text';
import { answerLabelOf, correctLabelOf } from './answers';
import { db, type ResponseRec } from './store';
import { csvText } from './csv';

/** Class names in the order people expect ('2반' before '10반'). One collator: localeCompare with options builds one per call. */
export const compareNames = new Intl.Collator('ko', { numeric: true }).compare;

export interface StudentStats {
  id: string;
  classId: string;
  className: string;
  number: number;
  name: string;
  attendance: number;
  sessions: { sessionId: string; eventName: string; date: number; accuracy: number | null }[];
  average: number | null;
  missed: { word: string; count: number }[];
  fixed: string[];
  rewards: number;
}

/** One row of 문제별: a word, or a grammar question. */
export interface QuestionStats {
  /** A word's key, or a grammar question's id. */
  key: string;
  /** 단어, or how the grammar question asked (알맞은 말, 빈칸 쓰기, 고쳐 쓰기 …). */
  kind: string;
  /** The word, or the grammar question as it was asked. */
  text: string;
  /** The word's meaning, or the grammar question's right answer. */
  answer: string;
  attempts: number;
  accuracy: number;
  /** The wrong answer given most: a choice, or something written that two or more wrote. */
  topWrong: string | null;
}

/** A 문제별 row with what its Excel file adds: who missed it, with what, and the quizzes it was in. */
interface QuestionRow extends QuestionStats {
  correct: number;
  missed: { studentId: string; answers: string[] }[];
  events: string[];
}

/** One class's students and questions, or everyone when classId is empty. */
export function computeStats(classId?: string): { students: StudentStats[]; questions: QuestionStats[] } {
  const d = db();
  const sessions = [...d.sessions].filter((ses) => !classId || ses.classId === classId).sort((a, b) => a.startedAt - b.startedAt);
  const classSessions = new Set(sessions.map((ses) => ses.id));
  // Each student's answers and rewards in one pass, not one pass over the whole semester per student.
  const answersOf = new Map<string, ResponseRec[]>();
  for (const r of d.responses) {
    if (!r.wordKey || r.round === 'practice') continue;
    const list = answersOf.get(r.studentId);
    if (list) list.push(r);
    else answersOf.set(r.studentId, [r]);
  }
  const rewardsOf = new Map<string, number>();
  for (const r of d.rewards) rewardsOf.set(r.studentId, (rewardsOf.get(r.studentId) ?? 0) + 1);
  const students: StudentStats[] = Object.values(d.students)
    .filter((s) => !classId || s.classId === classId)
    .sort((a, b) => compareNames(d.classes[a.classId]?.name ?? '', d.classes[b.classId]?.name ?? '') || a.number - b.number)
    .map((s) => {
      // Only the sessions of the student's own class count, so other classes' quizzes aren't "missed".
      const perSession = sessions.filter((ses) => ses.classId === s.classId).map((ses) => {
        const p = ses.perStudent.find((x) => x.studentId === s.id);
        return {
          sessionId: ses.id,
          eventName: d.events[ses.eventId]?.name ?? '삭제된 이벤트',
          date: ses.startedAt,
          accuracy: p && p.connected > 0 ? p.correct / p.connected : null,
        };
      });
      const accs = perSession.map((x) => x.accuracy).filter((x): x is number => x !== null);
      const mine = answersOf.get(s.id) ?? [];
      const missCount = new Map<string, number>();
      const firstWrong = new Map<string, number>();
      const lastResult = new Map<string, { correct: boolean; at: number }>();
      for (const r of mine) {
        const k = r.wordKey!;
        if (!r.correct) {
          missCount.set(k, (missCount.get(k) ?? 0) + 1);
          if (!firstWrong.has(k)) firstWrong.set(k, r.at);
        }
        lastResult.set(k, { correct: r.correct, at: r.at });
      }
      const label = (k: string) => d.words[k]?.spelling ?? k;
      const fixed = [...firstWrong.keys()].filter((k) => {
        const last = lastResult.get(k);
        return last && last.correct && last.at > (firstWrong.get(k) ?? 0);
      });
      return {
        id: s.id,
        classId: s.classId,
        className: d.classes[s.classId]?.name ?? '',
        number: s.number,
        name: s.name,
        attendance: d.attendance[s.id]?.length ?? 0,
        sessions: perSession,
        average: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
        missed: [...missCount].filter(([k]) => !fixed.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ word: label(k), count: n })),
        fixed: fixed.map(label).slice(0, 8),
        rewards: rewardsOf.get(s.id) ?? 0,
      };
    });

  const questions = questionRows(classSessions).map((q) => ({ key: q.key, kind: q.kind, text: q.text, answer: q.answer, attempts: q.attempts, accuracy: q.accuracy, topWrong: q.topWrong }));
  return { students, questions };
}

/**
 * Every scored question answered in these sessions' main rounds, most missed first. A word is one row for all the ways
 * it was asked, as the word bank writes it; a grammar question is a row of its own (its id is the same row in any
 * event), as its event wrote it, so a deleted event's grammar drops out.
 */
function questionRows(sessions: Set<string>): QuestionRow[] {
  const d = db();
  const byEvent = new Map<string, Map<string, Question>>();
  const questionOf = (eventId: string, id: string): Question | undefined => {
    let questions = byEvent.get(eventId);
    if (!questions) {
      questions = new Map((Object.hasOwn(d.events, eventId) ? d.events[eventId].questions : []).map((q) => [q.id, q]));
      byEvent.set(eventId, questions);
    }
    return questions.get(id);
  };
  type Tally = { row: QuestionRow; picked: Map<string, number>; written: Map<string, { text: string; count: number }>; misses: Map<string, string[]>; events: Set<string> };
  const tallies = new Map<string, Tally>();
  for (const r of d.responses) {
    if (r.round !== 'main' || !sessions.has(r.sessionId)) continue;
    const q = questionOf(r.eventId, r.questionId);
    const key = r.wordKey ?? r.questionId;
    let t = tallies.get(key);
    if (!t) {
      const word = r.wordKey && Object.hasOwn(d.words, r.wordKey) ? d.words[r.wordKey] : undefined;
      const head = r.wordKey
        ? { kind: '단어', text: word?.spelling ?? r.wordKey, answer: word?.meaning ?? '' }
        : q?.grammar
          ? { kind: q.modeLabel, text: q.prompt, answer: q.noteLabel ?? correctLabelOf(q) }
          : null;
      // Bonus questions aren't scored, and a deleted event's grammar has no words left to show.
      if (!head) continue;
      t = { row: { key, ...head, attempts: 0, correct: 0, accuracy: 0, topWrong: null, missed: [], events: [] }, picked: new Map(), written: new Map(), misses: new Map(), events: new Set() };
      tallies.set(key, t);
    }
    t.row.attempts++;
    if (Object.hasOwn(d.events, r.eventId)) t.events.add(d.events[r.eventId].name);
    if (r.correct) {
      t.row.correct++;
      continue;
    }
    if (r.choice >= 0) {
      const label = q?.options[r.choice]?.label;
      if (label) t.picked.set(label, (t.picked.get(label) ?? 0) + 1);
    } else if (r.text) {
      // Written answers count as one when they read the same, as at the reveal.
      const same = normalizeAnswer(r.text);
      const w = t.written.get(same);
      if (w) w.count++;
      else t.written.set(same, { text: r.text, count: 1 });
    }
    const mine = q ? answerLabelOf(q, r) : (r.text ?? '');
    const answers = t.misses.get(r.studentId) ?? [];
    if (mine && !answers.includes(mine)) answers.push(mine);
    t.misses.set(r.studentId, answers);
  }
  return [...tallies.values()]
    .map(({ row, picked, written, misses, events }) => {
      // A written answer is "많이 낸" only when two or more wrote it, as at the reveal.
      const counts = [...[...picked].map(([label, n]) => ({ label, n })), ...[...written.values()].filter((w) => w.count >= 2).map((w) => ({ label: w.text, n: w.count }))];
      const top = counts.sort((a, b) => b.n - a.n)[0];
      return { ...row, accuracy: row.attempts ? row.correct / row.attempts : 0, topWrong: top?.label ?? null, missed: [...misses].map(([studentId, answers]) => ({ studentId, answers })), events: [...events] };
    })
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
}

export interface QuizMistakes {
  sessionId: string;
  eventName: string;
  date: number;
  /** The student's scored questions that quiz and how many they got right. */
  total: number;
  correct: number;
  /** In play order: the question, what the student answered, the right answer, and whether 다시 도전 fixed it. */
  wrong: { questionId: string; kind: string; text: string; mine: string; answer: string; fixedInRetry: boolean }[];
  /** The quiz's event was deleted, so its questions can't be shown. */
  gone: boolean;
}

/** One student's quizzes, the latest first, each with the questions they got wrong (words and grammar). */
export function studentMistakes(studentId: string): QuizMistakes[] {
  const d = db();
  const mine = d.responses.filter((r) => r.studentId === studentId);
  return d.sessions
    .filter((ses) => ses.perStudent.some((p) => p.studentId === studentId))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((ses) => {
      const p = ses.perStudent.find((x) => x.studentId === studentId)!;
      const event = Object.hasOwn(d.events, ses.eventId) ? d.events[ses.eventId] : undefined;
      const answers = mine.filter((r) => r.sessionId === ses.id);
      // A word got right in 다시 도전 (the retry copy may have its own id, so by word).
      const fixed = new Set(answers.filter((r) => r.round === 'retry' && r.correct && r.wordKey).map((r) => r.wordKey));
      const order = new Map((event?.questions ?? []).map((q, i) => [q.id, i]));
      const wrong = answers
        .filter((r) => r.round === 'main' && !r.correct)
        .flatMap((r) => {
          const q = event?.questions.find((x) => x.id === r.questionId);
          // Scored questions only (words and grammar), as in the score beside them.
          if (!q || (!q.wordKey && !q.grammar)) return [];
          return [{ questionId: q.id, kind: q.modeLabel, text: q.prompt, mine: answerLabelOf(q, r), answer: q.noteLabel ?? correctLabelOf(q), fixedInRetry: !!r.wordKey && fixed.has(r.wordKey) }];
        })
        .sort((a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0));
      return { sessionId: ses.id, eventName: event?.name ?? '삭제된 이벤트', date: ses.startedAt, total: p.connected, correct: p.correct, wrong, gone: !event };
    });
}

/**
 * [문제별 엑셀로]: one class's questions (everyone's when classId is empty), most missed first, with who missed each and
 * what they answered (each different wrong answer once), and the quizzes it was in. CSV with a BOM, which Excel opens.
 */
export function questionsCsv(classId?: string): { name: string; csv: string } {
  const d = db();
  const sessions = new Set(d.sessions.filter((ses) => !classId || ses.classId === classId).map((ses) => ses.id));
  const student = (id: string) => (Object.hasOwn(d.students, id) ? d.students[id] : undefined);
  const className = (id: string | undefined) => (id && Object.hasOwn(d.classes, id) ? d.classes[id].name : '');
  const who = (id: string) => {
    const s = student(id);
    return s ? `${classId ? '' : `${className(s.classId)} `}${s.number} ${s.name}` : '(지운 학생)';
  };
  const header = ['유형', '문제', '정답', '정답률', '맞힌 수', '푼 수', '많이 낸 오답', '틀린 학생', '나온 퀴즈'];
  const rows = questionRows(sessions).map((q) => [
    q.kind,
    q.text,
    q.answer,
    `${Math.round(q.accuracy * 100)}%`,
    q.correct,
    q.attempts,
    q.topWrong ?? '',
    q.missed
      .map((m) => ({ ...m, s: student(m.studentId) }))
      .sort((a, b) => (!a.s || !b.s ? (a.s ? -1 : b.s ? 1 : 0) : compareNames(className(a.s.classId), className(b.s.classId)) || a.s.number - b.s.number))
      // "(못 골랐어요)" goes in the brackets as it reads, not in brackets of its own.
      .map((m) => `${who(m.studentId)}${m.answers.length ? `(${m.answers.map((x) => (/^\(.*\)$/.test(x) ? x.slice(1, -1) : x)).join(' / ')})` : ''}`)
      .join(', '),
    q.events.join(', '),
  ]);
  return { name: `${classId ? className(classId) : '전체 반'} 문제별 통계.csv`, csv: csvText([header, ...rows]) };
}

/** Who a student is, for their 오답 노트 page and file: null when they're gone. */
export function studentLabel(studentId: string): { className: string; number: number; name: string } | null {
  const d = db();
  if (!Object.hasOwn(d.students, studentId)) return null;
  const s = d.students[studentId];
  return { className: Object.hasOwn(d.classes, s.classId) ? d.classes[s.classId].name : '', number: s.number, name: s.name };
}

/** [엑셀로] in a student's 퀴즈별 틀린 문제: every quiz's wrong questions, the latest quiz first. */
export function studentMistakesCsv(studentId: string): { name: string; csv: string } | null {
  const who = studentLabel(studentId);
  if (!who) return null;
  const header = ['퀴즈', '날짜', '유형', '문제', '학생 답', '정답', '다시 도전'];
  const rows = studentMistakes(studentId).flatMap((quiz) =>
    quiz.wrong.map((w) => [quiz.eventName, new Date(quiz.date).toLocaleDateString('ko-KR'), w.kind, w.text, w.mine, w.answer, w.fixedInRetry ? '맞힘' : '']),
  );
  return { name: `${who.className} ${who.number} ${who.name} 틀린 문제.csv`, csv: csvText([header, ...rows]) };
}

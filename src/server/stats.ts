// Per-student and per-word statistics for the teacher, computed from stored responses.
import { db, type ResponseRec } from './store';

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

export interface WordStats {
  key: string;
  word: string;
  meaning: string;
  attempts: number;
  accuracy: number;
  topWrong: string | null;
}

/** One class's students and words, or everyone when classId is empty. */
export function computeStats(classId?: string): { students: StudentStats[]; words: WordStats[] } {
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

  const byWord = new Map<string, { attempts: number; correct: number; wrongLabels: Map<string, number> }>();
  for (const r of d.responses) {
    if (!r.wordKey || r.round !== 'main') continue;
    if (classId && !classSessions.has(r.sessionId)) continue;
    const w = byWord.get(r.wordKey) ?? { attempts: 0, correct: 0, wrongLabels: new Map() };
    w.attempts++;
    if (r.correct) w.correct++;
    else if (r.choice >= 0) {
      const event = d.events[r.eventId];
      const q = event?.questions.find((x) => x.id === r.questionId);
      const label = q?.options[r.choice]?.label;
      if (label) w.wrongLabels.set(label, (w.wrongLabels.get(label) ?? 0) + 1);
    }
    byWord.set(r.wordKey, w);
  }
  const words: WordStats[] = [...byWord]
    .map(([key, w]) => ({
      key,
      word: d.words[key]?.spelling ?? key,
      meaning: d.words[key]?.meaning ?? '',
      attempts: w.attempts,
      accuracy: w.attempts ? w.correct / w.attempts : 0,
      topWrong: [...w.wrongLabels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
  return { students, words };
}

/** CSV with a BOM so Korean Excel opens it as UTF-8. */
export function statsCsv(classId?: string): string {
  const { students } = computeStats(classId);
  // Session columns differ per class; each student's own sessions go under one header row per class.
  const sessionIds: string[] = [];
  const sessionLabel = new Map<string, string>();
  for (const s of students) {
    for (const x of s.sessions) {
      if (sessionLabel.has(x.sessionId)) continue;
      sessionIds.push(x.sessionId);
      sessionLabel.set(x.sessionId, `${s.className} ${new Date(x.date).toLocaleDateString('ko-KR')} ${x.eventName}`);
    }
  }
  const header = ['반', '번호', '이름', '출석', '평균 정답률', ...sessionIds.map((id) => sessionLabel.get(id)!), '자주 틀리는 단어', '이제 맞히는 단어', '받은 보상'];
  const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
  const rows = students.map((s) => [
    s.className,
    s.number,
    s.name,
    s.attendance,
    pct(s.average),
    ...sessionIds.map((id) => {
      const x = s.sessions.find((y) => y.sessionId === id);
      return x ? pct(x.accuracy) : '';
    }),
    s.missed.map((m) => `${m.word}(${m.count})`).join(' '),
    s.fixed.join(' '),
    s.rewards,
  ]);
  const esc = (v: unknown) => {
    const t = String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

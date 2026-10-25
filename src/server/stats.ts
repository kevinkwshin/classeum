// Per-student and per-word statistics for the teacher, computed from stored responses.
import { db } from './store';

export interface StudentStats {
  id: string;
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

export function computeStats(): { students: StudentStats[]; words: WordStats[] } {
  const d = db();
  const sessions = [...d.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const students: StudentStats[] = Object.values(d.students)
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const perSession = sessions.map((ses) => {
        const p = ses.perStudent.find((x) => x.studentId === s.id);
        return {
          sessionId: ses.id,
          eventName: d.events[ses.eventId]?.name ?? '삭제된 이벤트',
          date: ses.startedAt,
          accuracy: p && p.connected > 0 ? p.correct / p.connected : null,
        };
      });
      const accs = perSession.map((x) => x.accuracy).filter((x): x is number => x !== null);
      const mine = d.responses.filter((r) => r.studentId === s.id && r.wordKey && r.round !== 'practice');
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
        number: s.number,
        name: s.name,
        attendance: d.attendance[s.id]?.length ?? 0,
        sessions: perSession,
        average: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
        missed: [...missCount].filter(([k]) => !fixed.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ word: label(k), count: n })),
        fixed: fixed.map(label).slice(0, 8),
        rewards: d.rewards.filter((r) => r.studentId === s.id).length,
      };
    });

  const byWord = new Map<string, { attempts: number; correct: number; wrongLabels: Map<string, number> }>();
  for (const r of d.responses) {
    if (!r.wordKey || r.round !== 'main') continue;
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
export function statsCsv(): string {
  const { students } = computeStats();
  const sessionNames = students[0]?.sessions.map((s) => `${new Date(s.date).toLocaleDateString('ko-KR')} ${s.eventName}`) ?? [];
  const header = ['번호', '이름', '출석', '평균 정답률', ...sessionNames, '자주 틀리는 단어', '이제 맞히는 단어', '받은 보상'];
  const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
  const rows = students.map((s) => [
    s.number,
    s.name,
    s.attendance,
    pct(s.average),
    ...s.sessions.map((x) => pct(x.accuracy)),
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

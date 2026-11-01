'use client';
// [인쇄·PDF] in a student's 퀴즈별 틀린 문제 (아레나 → 통계): their wrong questions in every quiz, the latest first, on
// A4 for the browser to print or keep as a PDF (its print window's 'PDF로 저장'). It opens in a window of its own and
// asks to print once it has drawn them; the window's title is the file name a PDF gets.
import { useEffect, useState } from 'react';
import { formatDay } from '@/client/live';
import { TeacherGate } from '@/components/TeacherGate';

interface Mistakes {
  student: { className: string; number: number; name: string } | null;
  quizzes: {
    sessionId: string;
    eventName: string;
    date: number;
    total: number;
    correct: number;
    wrong: { questionId: string; kind: string; text: string; mine: string; answer: string; fixedInRetry: boolean }[];
    gone: boolean;
  }[];
}

export default function PrintPage() {
  return (
    <TeacherGate>
      <MistakesSheet />
    </TeacherGate>
  );
}

function MistakesSheet() {
  const [data, setData] = useState<Mistakes | 'missing' | null>(null);
  useEffect(() => {
    let stop = false;
    const studentId = new URLSearchParams(window.location.search).get('student') ?? '';
    fetch(`/api/stats?student=${encodeURIComponent(studentId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Mistakes>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => !stop && setData(d.student ? d : 'missing'))
      .catch(() => !stop && setData('missing'));
    return () => {
      stop = true;
    };
  }, []);
  useEffect(() => {
    if (!data || data === 'missing' || !data.student) return;
    const s = data.student;
    document.title = `오답 노트 ${s.className} ${s.number} ${s.name}`;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data]);
  if (!data) return <main className="p-10 text-ink-3">불러오는 중…</main>;
  if (data === 'missing' || !data.student) return <main className="p-10 text-ink-3">그 학생이 없어요. 통계에서 다시 열어 주세요.</main>;
  const { student, quizzes } = data;
  return (
    <main className="mx-auto max-w-[190mm] bg-white px-8 py-8 text-ink print:max-w-none print:p-0">
      <style>{'@page { size: A4; margin: 14mm 12mm; }'}</style>
      <div className="mb-8 flex items-center justify-between gap-4 rounded-xl bg-bg px-4 py-3 print:hidden">
        <span className="text-sm text-ink-2">인쇄 창에서 프린터 대신 &lsquo;PDF로 저장&rsquo;을 고르면 PDF 파일이 돼요.</span>
        <button type="button" onClick={() => window.print()} className="h-10 shrink-0 rounded-xl bg-ink px-4 text-sm font-bold text-white">
          인쇄·PDF
        </button>
      </div>
      <h1 className="text-2xl font-bold">오답 노트</h1>
      <div className="mt-1 text-[15px] text-ink-2">
        {student.className} {student.number}번 {student.name}
      </div>
      {quizzes.length === 0 && <p className="mt-8 text-ink-3">아직 푼 퀴즈가 없어요.</p>}
      {quizzes.map((quiz) => (
        <section key={quiz.sessionId} className="mt-7">
          <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink pb-1.5 break-after-avoid">
            <h2 className="text-lg font-bold">{quiz.eventName}</h2>
            <span className="tabular shrink-0 text-sm text-ink-3">
              {formatDay(quiz.date)}
              {!quiz.gone && ` · ${quiz.total}문제 중 ${quiz.correct}개 맞힘`}
            </span>
          </div>
          {quiz.gone ? (
            <p className="py-2 text-sm text-ink-3">이벤트를 지워서 문제를 볼 수 없어요.</p>
          ) : quiz.wrong.length === 0 ? (
            <p className="py-2 text-sm text-ink-3">틀린 문제가 없어요.</p>
          ) : (
            <table className="w-full table-fixed text-left text-[14px]">
              <colgroup>
                <col className="w-24" />
                <col />
                <col className="w-[30%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead className="text-xs font-bold text-ink-3">
                <tr>
                  <th className="py-1.5">유형</th>
                  <th>문제</th>
                  <th>내 답</th>
                  <th>정답</th>
                </tr>
              </thead>
              <tbody>
                {quiz.wrong.map((w) => (
                  <tr key={w.questionId} className="break-inside-avoid border-t border-[#E3E5EA] align-top">
                    <td className="py-1.5 pr-2 text-xs text-ink-3">{w.kind}</td>
                    <td className="break-keep py-1.5 pr-3 [overflow-wrap:anywhere]">{w.text}</td>
                    <td className="py-1.5 pr-3 text-bad [overflow-wrap:anywhere]">{w.mine}</td>
                    <td className="py-1.5 font-bold [overflow-wrap:anywhere]">
                      {w.answer}
                      {w.fixedInRetry && <span className="ml-1 text-xs font-semibold text-good">(다시 도전에서 맞힘)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </main>
  );
}

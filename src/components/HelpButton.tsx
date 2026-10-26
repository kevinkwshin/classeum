'use client';
import { useEffect, useState } from 'react';
import type { TeacherView } from '@/client/views';
import { PHONE_HELP, StepCheck, setupSteps } from './SetupGuide';

// The shortcuts in src/client/live.ts (shortcutAction), plus F on the projector screen.
const KEYS: [string, string][] = [
  ['Space', '멈춤'],
  ['Enter', '공개'],
  ['↑', '+5초'],
  ['→', '다음'],
  ['S', '건너뛰기'],
  ['B', '가리기'],
  ['F', '전체 화면'],
];

const LABEL = 'w-[4.5rem] shrink-0 pt-1 text-sm font-bold text-ink-3';

/** The round ? in the teacher menu: the setup steps with their live checks, the quiz keys, and how to stop the server. */
export function HelpButton({ view }: { view: TeacherView }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const steps = setupSteps(view);
  return (
    <>
      <button
        type="button"
        aria-label="도움말"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#3D4354] text-base font-bold text-white"
      >
        ?
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()} className="cls-pop flex max-h-full w-full max-w-[600px] flex-col gap-4 overflow-y-auto rounded-[24px] bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 id="help-title" className="text-xl font-bold">도움말</h2>
              <button type="button" aria-label="닫기" autoFocus onClick={() => setOpen(false)} className="h-9 w-9 rounded-xl text-lg text-ink-3 hover:bg-bg">
                ✕
              </button>
            </div>
            <section className="flex gap-4">
              <h3 className={LABEL}>수업 준비</h3>
              <ol className="min-w-0 flex-1">
                {steps.map((s, i) => (
                  <li key={s.key} className="flex items-start gap-3 border-t border-[#EEF0F3] py-2 first:border-t-0">
                    <StepCheck done={s.done} n={i + 1} />
                    <div className="min-w-0 pt-0.5">
                      <span className="font-bold">{s.label}</span>
                      <span className="ml-2 text-sm text-ink-3">{s.hint}</span>
                      {s.key === 'phones' && <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">안 들어오면 · {PHONE_HELP.join(' · ')}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="flex gap-4 border-t border-[#EEF0F3] pt-4">
              <h3 className={LABEL}>수업 중 키</h3>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {KEYS.map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1.5 rounded-xl bg-bg py-1 pl-1 pr-2.5 text-sm font-semibold">
                    <kbd className="min-w-7 rounded-lg bg-white px-1.5 py-0.5 text-center font-sans text-xs font-extrabold shadow-[inset_0_-2px_0_#E3E5EA]">{key}</kbd>
                    {label}
                  </span>
                ))}
              </div>
            </section>
            <section className="flex gap-4 border-t border-[#EEF0F3] pt-4">
              <h3 className={LABEL}>끝낼 때</h3>
              <p className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold">맥: 터미널에서 Ctrl+C · 윈도우: 검은 창 닫기</p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

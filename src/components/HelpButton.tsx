'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TeacherView } from '@/client/views';
import { ProjectorLink } from './ProjectorLink';
import { PHONE_HELP, StepCheck, setupSteps, type StepKey } from './SetupGuide';

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

/** Where each step is done, in the screen's own button names, for someone who has never seen these screens. */
const HOW: Record<StepKey, string[]> = {
  class: ['왼쪽 메뉴 [반 관리] → 반 이름 쓰고 [반 추가]'],
  words: ['[아레나] 위 [직접 작성하기], 또는 [템플릿 받기] → 채워서 [엑셀 올리기]'],
  projector: [
    '① 프로젝터를 연결하고 화면을 확장으로 (윈도우 ⊞+P · 맥 시스템 설정 → 디스플레이)',
    '② 노트북에는 선생님 화면(이 창), 프로젝터에는 [프로젝터 화면 열기] 창을 끌어다 놓기',
    '③ 프로젝터 화면 클릭 → F (전체 화면 · 소리 켜짐)',
  ],
  phones: ['학생: 프로젝터 QR 찍고 반·번호·이름 → 선생님: 오른쪽 요청에서 기호 확인 후 [승인]'],
  quiz: ['[아레나] 이벤트 → 오늘 반 → [대기실 열기] → [퀴즈 시작]'],
};

const LABEL = 'w-[4.5rem] shrink-0 pt-1 text-sm font-bold text-ink-3';
const GO = 'flex h-8 shrink-0 items-center whitespace-nowrap rounded-xl border border-[#D5D8DF] bg-white px-2.5 text-[13px] font-bold';

/** The round ? in the teacher menu: the setup steps and where each is done, the quiz keys, and how to stop the server. */
export function HelpButton({ view, onTab }: { view: TeacherView; onTab: (tab: 'students' | 'arena') => void }) {
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
  const go = (tab: 'students' | 'arena', label: string) => (
    <button
      type="button"
      onClick={() => {
        onTab(tab);
        setOpen(false);
      }}
      className={GO}
    >
      {label}
    </button>
  );
  const action = (key: StepKey) => {
    if (key === 'class') return go('students', '반 관리로');
    if (key === 'words' || key === 'quiz') return go('arena', '아레나로');
    if (key === 'projector') return <ProjectorLink className={GO}>프로젝터 화면 열기</ProjectorLink>;
    return null;
  };
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
      {/* Rendered on the body: inside the sticky menu it would share the menu's layer, under the page's characters. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()} className="cls-pop flex max-h-full w-full max-w-[660px] flex-col gap-4 overflow-y-auto rounded-[24px] bg-white p-7">
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
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="pt-1 font-bold">{s.label}</span>
                        {action(s.key)}
                      </div>
                      {HOW[s.key].map((line) => (
                        <div key={line} className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{line}</div>
                      ))}
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
              <p className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold">터미널 닫기</p>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

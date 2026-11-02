'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TeacherView } from '@/client/views';
import { ProjectorLink } from './ProjectorLink';
import { StepCheck, setupSteps, type StepKey } from './SetupGuide';

// Short on purpose: one line per step, the order in buttons' names, and the keys. The screens show the rest (the big
// button says what comes next, and a dialog explains whenever something can't be undone).

/** Each setup step in one line, in the screen's own button names, and a quieter tip where one helps. */
const HOW: Record<StepKey, [string, string?]> = {
  class: ['[반 관리]에서 반 이름을 쓰고 [반 추가]'],
  words: ['[아레나]의 [직접 작성하기]나 [엑셀 올리기]'],
  projector: ['확장 모드로 연결하고, [프로젝터 화면 열기] 창을 프로젝터로 옮겨 F', '소리가 안 나면 소리 출력 장치를 확인해요'],
  phones: ['학생이 QR을 찍고 등록하면 오른쪽 요청에서 [승인]', '안 들어오면 같은 와이파이인지 확인해요'],
  quiz: ['이벤트를 고르고 [대기실 열기] → [퀴즈 시작]'],
};

// The shortcuts in src/client/live.ts (shortcutAction), plus F on the projector screen.
const ARENA_KEYS: [string, string][] = [
  ['Space', '멈춤'],
  ['Enter', '정답 공개'],
  ['→', '다음'],
  ['↑', '+5초'],
  ['S', '건너뛰기'],
  ['B', '잠시 멈춤'],
  ['F', '전체 화면 (프로젝터)'],
];
const AGORA_KEYS: [string, string][] = [
  ['Enter', '큰 버튼'],
  ['← →', '쪽 넘기기'],
  ['↑ ↓', '1분 더·덜'],
  ['S', '건너뛰기'],
];

const LABEL = 'w-16 shrink-0 pt-0.5 text-sm font-bold text-ink-3';
const GO = 'flex h-8 shrink-0 items-center whitespace-nowrap rounded-xl border border-[#D5D8DF] bg-white px-2.5 text-[13px] font-bold';
const LINE = 'text-[14px] leading-snug text-ink-2';

type Tab = 'students' | 'arena' | 'agora';
type Part = 'setup' | 'arena' | 'agora' | 'end';

function Keys({ keys }: { keys: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {keys.map(([key, label]) => (
        <span key={key} className="flex items-center gap-1.5 rounded-xl bg-bg py-1 pl-1 pr-2.5 text-sm font-semibold">
          <kbd className="min-w-7 rounded-lg bg-white px-1.5 py-0.5 text-center font-sans text-xs font-extrabold shadow-[inset_0_-2px_0_#E3E5EA]">{key}</kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * The round ? in the teacher menu, and on the two class bars while the menu is hidden: the setup steps, how an arena
 * and an 아고라 go with their keys, and how to end the day. On a class bar (`first`) the activity under way comes first,
 * and there are no buttons to other tabs.
 */
export function HelpButton({ view, onTab, first }: { view: TeacherView; onTab?: (tab: Tab) => void; first?: 'arena' | 'agora' }) {
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
  const go = (tab: Tab, label: string) =>
    onTab ? (
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
    ) : null;
  const action = (key: StepKey) => {
    if (key === 'class') return go('students', '반 관리로');
    if (key === 'words' || key === 'quiz') return go('arena', '아레나로');
    if (key === 'projector') return <ProjectorLink className={GO}>프로젝터 화면 열기</ProjectorLink>;
    return null;
  };
  const parts: Record<Part, React.ReactNode> = {
    setup: (
      <ol className="min-w-0 flex-1">
        {steps.map((s, i) => {
          const [line, tip] = HOW[s.key];
          return (
            <li key={s.key} className="flex items-start gap-3 border-t border-[#EEF0F3] py-1.5 first:border-t-0 first:pt-0">
              <StepCheck done={s.done} n={i + 1} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <span className="pt-0.5 font-bold">{s.label}</span>
                  {action(s.key)}
                </div>
                <div className={`mt-0.5 ${LINE}`}>{line}</div>
                {tip && <div className="text-[13px] leading-snug text-ink-3">{tip}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    ),
    arena: (
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="pt-0.5 font-bold">[대기실 열기] → [퀴즈 시작] → 결과 → [아레나 닫기]</span>
          {go('arena', '아레나로')}
        </div>
        <div className={LINE}>지난 기록은 아레나 위 [통계]에서 봐요.</div>
        <Keys keys={ARENA_KEYS} />
      </div>
    ),
    agora: (
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="pt-0.5 font-bold">[새 아고라] → [대기실 열기] → [쓰기 시작]</span>
          {go('agora', '아고라로')}
        </div>
        <div className={LINE}>그다음은 오른쪽 아래 큰 버튼만 차례로 누르면 돼요.</div>
        <div className={LINE}>받아쓰기는 [▶ 읽어 주기]로 읽어 줘요.</div>
        <div className={LINE}>좋은 답에는 [⭐ 칭찬], 고쳐 볼 답에는 [🤔 다시]를 눌러요.</div>
        <div className={LINE}>지난 기록은 아고라 위 [통계]에서 봐요.</div>
        <Keys keys={AGORA_KEYS} />
      </div>
    ),
    end: <p className={`min-w-0 flex-1 ${LINE}`}>[아레나 닫기]나 [아고라 닫기] 뒤에 서버 창을 닫아요. 기록은 저절로 저장돼요.</p>,
  };
  const titles: Record<Part, string> = { setup: '수업 준비', arena: '아레나', agora: '아고라', end: '끝낼 때' };
  const order: Part[] = first === 'arena' ? ['arena', 'agora', 'setup', 'end'] : first === 'agora' ? ['agora', 'arena', 'setup', 'end'] : ['setup', 'arena', 'agora', 'end'];
  return (
    <>
      <button
        type="button"
        aria-label="도움말"
        aria-haspopup="dialog"
        title="도움말"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#3D4354] text-base font-bold text-white"
      >
        ?
      </button>
      {/* Rendered on the body: inside the sticky menu it would share the menu's layer, under the page's characters. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()} className="cls-pop flex max-h-full w-full max-w-[620px] flex-col gap-3 overflow-y-auto rounded-[24px] bg-white p-7 text-ink">
            <div className="flex items-center justify-between">
              <h2 id="help-title" className="text-xl font-bold">도움말</h2>
              <button type="button" aria-label="닫기" autoFocus onClick={() => setOpen(false)} className="h-9 w-9 rounded-xl text-lg text-ink-3 hover:bg-bg">
                ✕
              </button>
            </div>
            {order.map((part, i) => (
              <section key={part} className={`flex gap-4 ${i > 0 ? 'border-t border-[#EEF0F3] pt-3' : ''}`}>
                <h3 className={LABEL}>{titles[part]}</h3>
                {parts[part]}
              </section>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

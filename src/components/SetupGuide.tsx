'use client';
import { useEffect, useState } from 'react';
import type { TeacherView } from '@/client/views';
import { DEFAULT_LOOK } from '@/lib/avatar';
import type { AvatarLook } from '@/lib/types';
import { PixelAvatar } from './PixelAvatar';
import { ProjectorLink } from './ProjectorLink';
import { Reaction } from './Reaction';

export type StepKey = 'class' | 'words' | 'projector' | 'phones' | 'quiz';
export interface SetupStep {
  key: StepKey;
  label: string;
  hint: string;
  done: boolean;
}

/** The five things a new laptop needs before the first class, each ticked off from the real state. */
export function setupSteps(view: TeacherView): SetupStep[] {
  const played = view.events.some((e) => e.played > 0);
  const phones = view.students.some((s) => s.hasDevice);
  return [
    { key: 'class', label: '반 만들기', hint: '예: 2-3반', done: view.classes.length > 0 },
    { key: 'words', label: '단어 넣기', hint: '직접 쓰거나 엑셀로', done: view.events.length > 0 },
    // After a first quiz the projector counts as set up even on a day its window isn't open yet.
    { key: 'projector', label: '프로젝터', hint: '확장 모드 → 창 옮기고 F', done: view.displayOn || played },
    { key: 'phones', label: '폰 접속', hint: !phones && view.requests.length > 0 ? '요청 왔어요 → 승인' : !phones && view.phones > 0 ? '폰 연결됨 · 요청을 기다려요' : 'QR 찍고 등록 → 승인', done: phones },
    { key: 'quiz', label: '첫 퀴즈', hint: '반 고르고 대기실 열기', done: played },
  ];
}

/** What to check when phones can't reach the laptop. */
export const PHONE_HELP = ['같은 와이파이인지 확인', '윈도우: 와이파이 속성 → 개인 네트워크로', '그래도 안 되면 휴대용 공유기'];

export const GUIDE_LOOK: AvatarLook = { ...DEFAULT_LOOK, helmet: 'grad', face: 'glasses' };

export function StepCheck({ done, n }: { done: boolean; n: number }) {
  return done ? (
    <span key="done" role="img" aria-label="완료" className="cls-pop flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-good text-sm font-extrabold text-white">✓</span>
  ) : (
    <span key="todo" className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[#D5D8DF] text-xs font-bold text-ink-3">{n}</span>
  );
}

// What each guide remembers on this laptop: 'hidden': the teacher pressed 숨기기 · 'shown': seen with steps left (so
// finishing later cheers once) · 'done': cheered.
function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface GuideStep {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  /** The hint is good news, so it shows in green. */
  good?: boolean;
}

const ACTION = 'flex h-9 shrink-0 items-center rounded-xl border border-[#D5D8DF] bg-white px-3 text-sm font-bold';

/**
 * A guide card, with the guide character: steps ticked off from the real state. A laptop that already has every step
 * never shows it; when the last step is done it cheers "준비 끝!" and folds away. 숨기기 puts it away for good.
 */
function GuideCard({ title, storageKey, bubble, steps, action, detail }: { title: string; storageKey: string; bubble: string; steps: GuideStep[]; action: (step: GuideStep) => React.ReactNode; detail?: (step: GuideStep) => React.ReactNode }) {
  const doneCount = steps.filter((s) => s.done).length;
  const all = doneCount === steps.length;
  const [flag, setFlag] = useState<string | null>(() => readFlag(storageKey));
  const [stage, setStage] = useState<'card' | 'cheer' | 'fold' | 'gone'>('card');
  const open = flag !== 'hidden' && flag !== 'done';
  if (open && !all && flag !== 'shown') setFlag('shown');
  if (open && all && flag === 'shown' && stage === 'card') setStage('cheer');
  useEffect(() => {
    try {
      if (flag) localStorage.setItem(storageKey, flag);
    } catch {
      // Private window: the card just comes back next time.
    }
  }, [flag, storageKey]);
  useEffect(() => {
    if (stage === 'cheer') {
      const t = setTimeout(() => setStage('fold'), 2500);
      return () => clearTimeout(t);
    }
    if (stage === 'fold') {
      const t = setTimeout(() => {
        setStage('gone');
        setFlag('done');
      }, 500);
      return () => clearTimeout(t);
    }
  }, [stage]);
  if (!open || stage === 'gone' || (all && stage === 'card')) return null;

  return (
    // Folds by shrinking its row to nothing, so the page below slides up instead of jumping.
    <div className={`grid transition-[grid-template-rows,opacity] duration-500 ${stage === 'fold' ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]'}`}>
      <div className="min-h-0 overflow-hidden">
        <section aria-label={title} className="cls-slide-up flex items-center gap-7 rounded-[20px] bg-white p-6">
          <div className="flex h-44 w-36 shrink-0 items-end justify-center rounded-t-full rounded-b-2xl bg-bg pb-3">
            {stage === 'card' ? (
              <div className="relative">
                <span className="cls-bubble absolute bottom-full left-1/2 mb-3 whitespace-nowrap rounded-xl bg-white px-3 py-1 text-sm font-bold text-ink shadow-[0_2px_8px_rgba(16,18,24,0.15)]">
                  {bubble}
                </span>
                <div className="cls-float">
                  <PixelAvatar look={GUIDE_LOOK} size={96} blink={1} />
                </div>
              </div>
            ) : (
              <Reaction kind="happy" look={GUIDE_LOOK} size={96} bubble="준비 끝!" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold">{title}</h2>
              <span className="tabular rounded-full bg-bg px-2.5 py-0.5 text-sm font-extrabold">
                {doneCount}/{steps.length}
              </span>
              {stage === 'card' && (
                <button
                  type="button"
                  onClick={() => setFlag('hidden')}
                  className="ml-auto rounded-lg px-2 py-1 text-sm font-semibold text-ink-3 hover:bg-bg"
                >
                  숨기기
                </button>
              )}
            </div>
            <ol className="mt-2">
              {steps.map((s, i) => (
                <li key={s.key} className="border-t border-[#EEF0F3] first:border-t-0">
                  <div className="flex min-h-12 items-center gap-3 py-1.5">
                    <StepCheck done={s.done} n={i + 1} />
                    <span className={`w-24 shrink-0 font-bold ${s.done ? 'text-ink-3' : ''}`}>{s.label}</span>
                    <span className={`min-w-0 flex-1 truncate text-sm ${s.good && !s.done ? 'font-semibold text-good' : 'text-ink-3'}`}>{s.hint}</span>
                    {!s.done && action(s)}
                  </div>
                  {!s.done && detail?.(s)}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * 수업 준비: a card on the empty laptop of a teacher using Classeum for the first time. A laptop that already has
 * everything never shows it. When the last step is done the guide cheers "준비 끝!" and the card folds away.
 */
/** `onStudents` is left out on 반 관리 itself, where step 1 needs no button. */
export function SetupGuide({ view, onStudents, onWrite }: { view: TeacherView; onStudents?: () => void; onWrite: () => void }) {
  const [phoneHelp, setPhoneHelp] = useState(false);
  const steps = setupSteps(view).map((s) => ({ ...s, good: s.key === 'phones' && (view.phones > 0 || view.requests.length > 0) }));
  const action = (s: GuideStep) => {
    if (s.key === 'class') return onStudents ? <button type="button" onClick={onStudents} className={ACTION}>반 관리</button> : null;
    if (s.key === 'words') return <button type="button" onClick={onWrite} className={ACTION}>직접 작성하기</button>;
    if (s.key === 'projector') return <ProjectorLink className={ACTION}>열기</ProjectorLink>;
    if (s.key === 'phones') {
      return (
        <button type="button" aria-expanded={phoneHelp} onClick={() => setPhoneHelp((o) => !o)} className={`${ACTION} ${phoneHelp ? '!bg-bg' : ''}`}>
          안 들어와요?
        </button>
      );
    }
    return null;
  };
  const detail = (s: GuideStep) =>
    s.key === 'phones' && phoneHelp ? (
      <ul className="mb-2 ml-10 flex flex-col gap-1 rounded-xl bg-bg px-4 py-2.5 text-sm text-ink-2">
        {PHONE_HELP.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    ) : null;
  return <GuideCard title="수업 준비" storageKey="classeum.guide" bubble="같이 준비해요" steps={steps} action={action} detail={detail} />;
}

/**
 * 아고라 준비: the same card on the 아고라 tab until the teacher's first 아고라, its three steps ticked off from the real
 * state (an 아고라, then a class that has done one). A teacher who has already run one never sees it.
 */
export function AgoraGuide({ view, onNew }: { view: TeacherView; onNew: () => void }) {
  const ran = view.agora.agoras.some((a) => a.runs.length > 0);
  const steps: GuideStep[] = [
    { key: 'topic', label: '아고라 만들기', hint: '제목을 쓰고 주제를 한 줄씩', done: view.agora.agoras.length > 0 },
    { key: 'lobby', label: '대기실 열기', hint: '아고라 고르고 오늘 반 → 대기실 열기 · 놀이 방법으로 시범', done: ran },
    { key: 'run', label: '쓰고 함께 보기', hint: '쓰기 시작 → 지금 마감 → 전체 공개 → 다음 주제', done: ran && !view.agora.live },
  ];
  const action = (s: GuideStep) => (s.key === 'topic' ? <button type="button" onClick={onNew} className={ACTION}>새 아고라</button> : null);
  return <GuideCard title="아고라 준비" storageKey="classeum.agoraGuide" bubble="아고라도 같이 해요" steps={steps} action={action} />;
}

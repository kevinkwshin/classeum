'use client';
import { useEffect, useRef, useState } from 'react';
import type { AvatarLook } from '@/lib/types';
import { PixelAvatar } from './PixelAvatar';
import { Reaction } from './Reaction';

const OPTIONS = ['사과', '바나나', '포도', '수박'];
const KEY = 'classeum.practiced';

function practiced(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 연습: one pretend question on a first-timer's waiting screen, with boxes like the real game pad. Nothing goes to
 * the server. The pick counts after 1.5 s without another tap, the same feel as the real field closing.
 */
export function PracticeCard({ look }: { look: AvatarLook }) {
  const [hidden, setHidden] = useState(practiced);
  const [pick, setPick] = useState<number | null>(null);
  const [judged, setJudged] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (hidden) return null;

  const tap = (z: number) => {
    if (z !== pick) {
      try {
        navigator.vibrate?.(25);
      } catch {}
    }
    setPick(z);
    setJudged(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setJudged(true), 1500);
  };
  const correct = pick === 0;
  const line = pick === null ? '칸을 톡!' : !judged ? '바꿔도 돼요' : correct ? '정답! 진짜도 이렇게' : '펑! 정답은 사과';

  return (
    <div className="cls-slide-up flex flex-col gap-3 rounded-3xl bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-extrabold text-white">연습</span>
        <span key={line} className={`cls-pop text-sm font-extrabold ${judged ? (correct ? 'text-good' : 'text-[#E5484D]') : 'text-ink-2'}`}>{line}</span>
      </div>
      <div className="text-center text-[28px] font-extrabold leading-tight tracking-tight">apple</div>
      {/* The same boxes, colours and numbers as the real game pad. */}
      <div className="relative h-52 select-none overflow-hidden rounded-3xl bg-bg">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-2 p-2">
          {OPTIONS.map((label, z) => {
            const mine = pick === z;
            const answer = judged && z === 0;
            return (
              <button
                key={z}
                type="button"
                onClick={() => tap(z)}
                className={`zone-${z} relative flex flex-col items-center justify-center overflow-hidden rounded-2xl px-3 pb-3 pt-7 text-center transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]`}
                style={{
                  background: mine ? 'var(--zone-soft)' : '#FFFFFF',
                  boxShadow: answer ? 'inset 0 0 0 4px #F5B82E' : mine ? 'inset 0 0 0 4px var(--zone)' : 'inset 0 -3px 0 rgba(16,18,24,0.06)',
                }}
              >
                <span className={`absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold text-white ${answer ? 'bg-good' : ''}`} style={answer ? undefined : { background: 'var(--zone)' }}>
                  {answer ? '✓' : z + 1}
                </span>
                <span className="text-xl font-extrabold leading-tight" style={{ color: 'var(--zone-ink)' }}>
                  {label}
                </span>
                {mine && (
                  <span key={`${z}-${judged}`} className={`absolute bottom-1.5 right-1.5 ${judged ? '' : 'cls-pop'}`}>
                    {judged ? <Reaction kind={correct ? 'happy' : 'pop'} look={look} size={36} /> : <PixelAvatar look={look} size={36} blink={3} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Until a box is picked the character waits on the start line in the middle. */}
        {pick === null && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[#C9CDD6] bg-bg/90 p-2">
            <PixelAvatar look={look} size={36} blink={3} />
          </div>
        )}
      </div>
      {judged && (
        <div className="cls-slide-up flex items-center justify-between gap-3">
          <span className="text-sm text-ink-3">가운데 남으면 쿨쿨</span>
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(KEY, '1');
              } catch {
                // Private window: it shows again next time.
              }
            }}
            className="h-11 shrink-0 rounded-2xl bg-ink px-5 text-[15px] font-extrabold text-white"
          >
            알겠어요
          </button>
        </div>
      )}
    </div>
  );
}

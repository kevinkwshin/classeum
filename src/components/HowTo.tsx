'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTicker } from '@/client/live';
import { playCheer } from '@/client/sound';
import { DEFAULT_LOOK } from '@/lib/avatar';
import type { AvatarLook, RevealInfo } from '@/lib/types';
import { Field } from './Field';
import { PixelAvatar } from './PixelAvatar';
import { Reaction } from './Reaction';

const OPTIONS = ['사과', '바나나', '포도', '수박'];
const REVEAL: RevealInfo = { correctIndex: 0, correctLabel: '사과', zoneCounts: [3, 2, 0, 0], unanswered: 1, accuracy: 0.5, avatars: [], long: false };
const START = { x: 0.5, y: 0.5 };

// Six sample characters: three pick 사과 (right), two 바나나, and the last one never leaves the start line.
// Spots are the avatar's centre as a share of the field, below the zone labels.
const CAST: { look: AvatarLook; zone: number; at: { x: number; y: number } }[] = [
  { look: { ...DEFAULT_LOOK, hair: 'black', hairStyle: 'ponytail', tunic: 'sky' }, zone: 0, at: { x: 0.13, y: 0.37 } },
  { look: { ...DEFAULT_LOOK, skin: 'tan', hairStyle: 'spiky', tunic: 'hoodie', helmet: 'cap' }, zone: 1, at: { x: 0.68, y: 0.37 } },
  { look: { ...DEFAULT_LOOK, hair: 'pink', hairStyle: 'twinbun', eyes: 'big', tunic: 'stripe' }, zone: 0, at: { x: 0.24, y: 0.37 } },
  { look: { ...DEFAULT_LOOK, skin: 'medium', hair: 'black', hairStyle: 'buzz', tunic: 'tracksuit' }, zone: 1, at: { x: 0.8, y: 0.37 } },
  { look: { ...DEFAULT_LOOK, hair: 'blond', hairStyle: 'bob', eyes: 'smile', tunic: 'olive', helmet: 'ribbon' }, zone: 0, at: { x: 0.35, y: 0.37 } },
  { look: { ...DEFAULT_LOOK, skin: 'deep', hair: 'black', hairStyle: 'curly', tunic: 'vest' }, zone: -1, at: START },
];

// One caption at a time: 0-2 s, 2-6 s, 6-10 s and 10-12 s.
const CAPTIONS = ['① 폰에서 칸을 톡', '② 안개 속에서 자리 잡기', '③ 맞히면 Yeah! 틀리면 펑!', '가운데 남으면 쿨쿨'];

/**
 * 놀이 방법: a 12-second demo of one question on the projector's lobby, built from the real field and reactions.
 * `startedAt` is on the server clock, so a reloaded projector picks up where the demo is.
 */
export function HowTo({ startedAt, serverNow, sound }: { startedAt: number; serverNow: () => number; sound: boolean }) {
  useTicker(true, 100);
  const t = serverNow() - startedAt;
  const stage = t >= 10000 ? 3 : t >= 6000 ? 2 : t >= 2000 ? 1 : 0;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // One "Yeah!" as the fog lifts (nothing while the projector's audio is still locked).
  const cheered = useRef(false);
  useEffect(() => {
    if (stage < 2 || cheered.current) return;
    cheered.current = true;
    if (sound && stage === 2) playCheer(1);
  }, [stage, sound]);
  const size = Math.round(Math.min(96, Math.max(32, width * 0.085)));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.4vh]">
      <div className="flex items-center gap-4">
        <span className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-xl font-bold text-white">놀이 방법</span>
        <div key={stage} className="cls-slide-up truncate text-[2.6vw] font-extrabold leading-tight tracking-tight">
          {CAPTIONS[stage]}
        </div>
      </div>
      {/* isolate: the characters sit between the field's start line and its fog (z-index 1 and 2 inside Field). */}
      <div ref={box} className="relative isolate min-h-0 flex-1">
        <Field
          options={OPTIONS}
          fog={stage === 1}
          reveal={stage >= 2 ? REVEAL : null}
          center={
            stage === 1 ? (
              <div className="flex items-center gap-3 rounded-full bg-ink px-6 py-3 text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3DDC97] text-xl font-extrabold text-ink">✓</div>
                <div className="tabular text-4xl font-extrabold">5<span className="text-ink-3"> / 6</span></div>
              </div>
            ) : null
          }
        />
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }}>
          {CAST.map((c, i) => {
            // They leave the start line one after another in the first two seconds.
            const moved = c.zone >= 0 && t >= 250 + i * 220;
            // Before that they stand side by side on the start line, the sleeper in the middle.
            const p = moved ? c.at : c.zone < 0 ? START : { x: 0.46 + i * 0.02, y: 0.5 };
            const kind = stage < 2 ? null : c.zone === 0 ? 'happy' : c.zone > 0 ? 'pop' : stage === 3 ? 'sleep' : null;
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'left 0.55s cubic-bezier(0.3, 0.7, 0.4, 1), top 0.55s cubic-bezier(0.3, 0.7, 0.4, 1), opacity 0.5s ease',
                  // At the end only the sleeper stays bright.
                  opacity: stage === 3 && c.zone >= 0 ? 0.3 : 1,
                }}
              >
                {kind ? (
                  <Reaction key={kind} kind={kind} look={c.look} size={size} delay={kind === 'happy' ? 300 + i * 90 : kind === 'pop' ? 450 + i * 160 : 0} bubble={kind === 'sleep' ? '쿨쿨…' : undefined} />
                ) : (
                  <div key={moved ? 'hop' : 'wait'} className={`origin-bottom ${moved ? 'cls-poke' : ''}`}>
                    <PixelAvatar look={c.look} size={size} blink={i} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute left-1/2 top-[3%] -translate-x-1/2 rounded-full bg-white px-6 py-1.5 text-[2.4vw] font-extrabold leading-tight tracking-tight shadow-[0_2px_10px_rgba(16,18,24,0.12)]" style={{ zIndex: 4 }}>
          apple
        </div>
      </div>
    </div>
  );
}

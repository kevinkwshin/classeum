'use client';
// 오늘의 보상 뽑기 as the projector and the phones show it: before a draw a question mark, while the projector draws a
// capsule machine rattling with item names flicking past, then the item popping out. Every screen goes by the server's
// clock (revealAt), so a phone or projector that comes in late shows the same moment, and one after it shows the item.
import type { PrizeDraw } from '@/client/views';
import { QUIZ_REWARD_ITEMS, itemById } from '@/lib/items';
import type { ItemDef } from '@/lib/types';

export type PrizeStage = 'wait' | 'draw' | 'shown';

export function prizeStage(prize: PrizeDraw, now: number): PrizeStage {
  if (now < prize.revealAt) return 'draw';
  return prize.itemId ? 'shown' : 'wait';
}

/** The name line: a name flicking past while it draws, 뭘까요? before, the item's name after. */
export function prizeName(prize: PrizeDraw, name: string, now: number): string {
  const stage = prizeStage(prize, now);
  if (stage === 'draw') return QUIZ_REWARD_ITEMS[Math.floor(now / 110) % QUIZ_REWARD_ITEMS.length].name;
  return stage === 'wait' ? '뭘까요?' : name;
}

// Capsules in the machine: where each sits (percent of the dome) and its colour.
const CAPSULES: [number, number, string][] = [
  [18, 56, '#FF5B24'],
  [44, 66, '#F5B82E'],
  [70, 54, '#3DDC97'],
  [30, 80, '#5B8DEF'],
  [58, 82, '#B57CF2'],
  [40, 32, '#FF8A5C'],
  [66, 28, '#7FD8A6'],
];

/** A capsule machine as round as `size`, its capsules rattling (or standing `still`, as the reward picker shows it). */
export function CapsuleMachine({ size, still = false }: { size: number; still?: boolean }) {
  return (
    <div className={`relative shrink-0 rounded-full bg-white/35 ${size < 60 ? 'border-2' : 'border-4'} border-white`} style={{ width: size, height: size }} aria-hidden>
      {CAPSULES.map(([x, y, color], i) => (
        <span key={i} className={`${still ? '' : 'cls-rattle'} absolute rounded-full ${size < 60 ? 'border' : 'border-2'} border-white/80`} style={{ left: `${x - 11}%`, top: `${y - 11}%`, width: '22%', height: '22%', background: color, animationDelay: `${i * 35}ms` }} />
      ))}
    </div>
  );
}

/** The picture: a question mark, the rattling machine, or the item (as `show` draws it) popping out. */
export function PrizeFace({ prize, now, size, show }: { prize: PrizeDraw; now: number; size: number; show: (item: ItemDef) => React.ReactNode }) {
  const stage = prizeStage(prize, now);
  const item = prize.itemId ? itemById(prize.itemId) : undefined;
  if (stage === 'draw') return <CapsuleMachine size={size * 0.86} />;
  if (stage === 'wait' || !item) {
    return (
      <div className="flex items-center justify-center font-extrabold text-ink/45" style={{ width: size, height: size, fontSize: size * 0.55 }}>
        ?
      </div>
    );
  }
  // Keyed by the draw, so each new item pops out again.
  return (
    <div key={prize.seq} className="cls-pop">
      {show(item)}
    </div>
  );
}

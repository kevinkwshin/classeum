import type { AvatarLook } from '@/lib/types';
import { PixelAvatar } from './PixelAvatar';

/** A small stable number from a string, so the same character keeps its own rhythm across renders and reloads. */
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A character standing in a list or a preview: it blinks, and now and then hops, sways or glances aside, each on
 * its own clock picked from `seed` (an item or student id), so a whole grid never moves in step.
 */
export function IdleAvatar({ look, size, seed }: { look: AvatarLook; size: number; seed: string }) {
  const h = seedOf(seed);
  return (
    <span className={`cls-idle-${h % 3} inline-block`} style={{ animationDuration: `${6 + ((h >>> 2) % 6)}s`, animationDelay: `-${((h >>> 5) % 1000) / 100}s` }}>
      <PixelAvatar look={look} size={size} blink={h % 97} />
    </span>
  );
}

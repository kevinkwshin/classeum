import { memo } from 'react';
import type { AvatarLook } from '@/lib/types';
import { avatarRuns, skinTones } from '@/lib/avatar';

const SPARKS: [number, number, number][] = [[1, 3, 0], [13, 2, 0.4], [14, 8, 0.8], [0, 10, 1.2], [12, 13, 0.6], [2, 6, 1.0]];
const PUFFS: [number, number, number][] = [[3, 15, 0], [12, 15, 0.4], [2, 14, 0.8], [13, 14, 0.2]];
// Eye pixels sit at (6,6) and (9,6), the mouth at (7..8, 8) on every layer combination.
const EYES = [6, 9];
const INK = '#1E1A16';

export type Mood = 'normal' | 'happy' | 'dizzy' | 'sleep';

function Face({ look, mood }: { look: AvatarLook; mood: Exclude<Mood, 'normal'> }) {
  const [skin] = skinTones(look);
  return (
    <g>
      {EYES.map((x) => (
        <rect key={x} x={x} y={6} width={1} height={1} fill={skin} />
      ))}
      {mood === 'happy' && (
        <>
          {/* ^ ^ eyes, pink cheeks, open grin */}
          {EYES.map((x) => (
            <g key={x}>
              <rect x={x - 0.1} y={6.15} width={0.6} height={0.28} fill={INK} transform={`rotate(-40 ${x + 0.2} ${6.3})`} />
              <rect x={x + 0.5} y={6.15} width={0.6} height={0.28} fill={INK} transform={`rotate(40 ${x + 0.8} ${6.3})`} />
            </g>
          ))}
          <rect x={5} y={7} width={1} height={1} fill="#F28B9A" opacity={0.75} />
          <rect x={10} y={7} width={1} height={1} fill="#F28B9A" opacity={0.75} />
          <rect x={6.5} y={8} width={3} height={1} fill="#7A2A2A" />
          <rect x={7.25} y={8.5} width={1.5} height={0.5} fill="#E06A6A" />
        </>
      )}
      {mood === 'dizzy' && (
        <>
          {/* x x eyes and a wobbly mouth */}
          {EYES.map((x) => (
            <g key={x}>
              <rect x={x - 0.15} y={6.36} width={1.3} height={0.28} fill={INK} transform={`rotate(45 ${x + 0.5} 6.5)`} />
              <rect x={x - 0.15} y={6.36} width={1.3} height={0.28} fill={INK} transform={`rotate(-45 ${x + 0.5} 6.5)`} />
            </g>
          ))}
          <rect x={7} y={8.2} width={0.7} height={0.5} fill={INK} />
          <rect x={7.7} y={8.5} width={0.7} height={0.5} fill={INK} />
        </>
      )}
      {mood === 'sleep' &&
        EYES.map((x) => <rect key={x} x={x - 0.1} y={6.5} width={1.2} height={0.28} fill={INK} />)}
    </g>
  );
}

function PixelAvatarImpl({
  look,
  size = 64,
  title,
  mood = 'normal',
  blink,
}: {
  look: AvatarLook;
  size?: number;
  title?: string;
  mood?: Mood;
  /** Any number turns on blinking; different numbers blink at different moments. */
  blink?: number;
}) {
  const runs = avatarRuns(look);
  const outline = look.effect === 'gold' ? 'drop-shadow(1px 0 0 #F5B82E) drop-shadow(-1px 0 0 #F5B82E) drop-shadow(0 1px 0 #F5B82E) drop-shadow(0 -1px 0 #F5B82E)' : undefined;
  const [skin] = skinTones(look);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', filter: outline, display: 'block' }}
    >
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
      {mood !== 'normal' && <Face look={look} mood={mood} />}
      {mood === 'normal' && blink !== undefined && (
        <g className="cls-blink" style={{ animationDelay: `-${((blink * 1.37) % 5).toFixed(2)}s` }}>
          {EYES.map((x) => (
            <g key={x}>
              <rect x={x} y={6} width={1} height={1} fill={skin} />
              <rect x={x - 0.1} y={6.5} width={1.2} height={0.28} fill={INK} />
            </g>
          ))}
        </g>
      )}
      {look.effect === 'sparkle' &&
        SPARKS.map(([x, y, d], i) => <rect key={`s${i}`} className="cls-spark" x={x} y={y} width={1} height={1} fill="#FFD84D" style={{ animationDelay: `${d}s` }} />)}
      {look.effect === 'dust' &&
        PUFFS.map(([x, y, d], i) => <rect key={`p${i}`} className="cls-puff" x={x} y={y} width={1} height={1} fill="#C9C1B3" style={{ animationDelay: `${d}s` }} />)}
    </svg>
  );
}

export const PixelAvatar = memo(PixelAvatarImpl);

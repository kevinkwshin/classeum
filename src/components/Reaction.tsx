import type { AvatarLook } from '@/lib/types';
import { hashString } from '@/lib/text';
import { PixelAvatar } from './PixelAvatar';

export type ReactionKind = 'happy' | 'pop' | 'sleep';

const LINES: Record<ReactionKind, string[]> = {
  happy: ['야호!', '천재 등장', '쉽네~', '오예!', '나 좀 멋짐', '알고 있었지', '룰루♪', '굿굿'],
  pop: ['으악', '앗 뜨거', '다음엔 꼭!', '헉', '뭐였더라…', '내 머리…', '흑흑', '타버렸다'],
  sleep: ['쿨쿨…', 'zzz', '5분만…', '음냐'],
};

/** A funny one-liner that stays the same for one student on one question. */
export function reactionLine(kind: ReactionKind, key: string) {
  const list = LINES[kind];
  return list[hashString(key) % list.length];
}

const HEARTS = [
  { dx: -18, d: 0 },
  { dx: 14, d: 120 },
  { dx: -6, d: 260 },
  { dx: 22, d: 380 },
];
const DEBRIS = [
  { dx: -30, dy: -26, c: '#F5B82E' },
  { dx: 28, dy: -30, c: '#E8590C' },
  { dx: -34, dy: 6, c: '#9AA0AC' },
  { dx: 34, dy: 4, c: '#F5B82E' },
  { dx: -12, dy: -38, c: '#E8590C' },
  { dx: 14, dy: -40, c: '#9AA0AC' },
];

/**
 * Wraps an avatar in a reveal reaction: a happy hop with hearts when right, a cartoon
 * "펑" (puff up, burst, come back sooty and dizzy) when wrong, and dozing when the
 * student never left the start line. `delay` is in ms; particles scale with `size`.
 */
export function Reaction({
  kind,
  look,
  size,
  delay = 0,
  bubble,
  bang = true,
}: {
  kind: ReactionKind;
  look: AvatarLook;
  size: number;
  delay?: number;
  bubble?: string;
  bang?: boolean;
}) {
  const k = size / 56;
  const at = (ms: number) => ({ animationDelay: `${delay + ms}ms` });
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {kind === 'happy' && (
        <>
          <div className="cls-cheer origin-bottom" style={at(0)}>
            <div className="cls-dance origin-bottom" style={at(900)}>
              <PixelAvatar look={look} size={size} mood="happy" />
            </div>
          </div>
          {HEARTS.map((h, i) => (
            <span
              key={i}
              className="cls-heart pointer-events-none absolute left-1/2 top-0 font-bold leading-none text-[#F25C8A]"
              style={{ ...at(300 + h.d), fontSize: 16 * k, ['--dx' as string]: `${h.dx * k}px`, ['--rise' as string]: `${-60 * k}px` }}
            >
              ♥
            </span>
          ))}
        </>
      )}

      {kind === 'pop' && (
        <>
          <div className="cls-burst-out origin-bottom" style={at(0)}>
            <PixelAvatar look={look} size={size} />
          </div>
          <div className="cls-burst-in absolute inset-0 origin-bottom" style={at(950)}>
            <div className="cls-wobble origin-bottom" style={at(1500)}>
              <div style={{ filter: 'brightness(0.55) saturate(0.35)' }}>
                <PixelAvatar look={look} size={size} mood="dizzy" />
              </div>
            </div>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="cls-dizzy pointer-events-none absolute left-1/2 font-bold leading-none text-[#F5B82E]"
                style={{ ...at(1100 + i * 330), top: -4 * k, fontSize: 11 * k, ['--r' as string]: `${size * 0.26}px` }}
              >
                ★
              </span>
            ))}
            {[0, 1].map((i) => (
              <span
                key={`smoke${i}`}
                className="cls-smoke pointer-events-none absolute rounded-full bg-[#9AA0AC]"
                style={{ ...at(1200 + i * 500), left: `${38 + i * 18}%`, top: '8%', width: 5 * k, height: 5 * k }}
              />
            ))}
          </div>
          <div className="cls-puff-cloud pointer-events-none absolute inset-0" style={at(560)}>
            {[
              [-0.15, 0.1, 0.62],
              [0.45, -0.05, 0.7],
              [0.2, 0.35, 0.75],
              [-0.05, 0.5, 0.55],
              [0.6, 0.45, 0.55],
            ].map(([x, y, s], i) => (
              <span
                key={i}
                className="absolute rounded-full bg-white"
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: size * s, height: size * s, border: `${Math.max(1.5, 2.5 * k)}px solid #B8BDC8`, boxShadow: 'inset -3px -3px 0 rgba(16,18,24,0.07)' }}
              />
            ))}
          </div>
          {DEBRIS.map((d, i) => (
            <span
              key={i}
              className="cls-debris pointer-events-none absolute left-1/2 top-1/2"
              style={{ ...at(560), width: 5 * k, height: 5 * k, background: d.c, ['--dx' as string]: `${d.dx * k}px`, ['--dy' as string]: `${d.dy * k}px` }}
            />
          ))}
          {bang && (
            <span
              className="cls-bang pointer-events-none absolute left-1/2 top-0 whitespace-nowrap font-display font-bold leading-none text-[#E8590C]"
              style={{ ...at(560), fontSize: 20 * k, WebkitTextStroke: `${Math.max(1, 2 * k)}px #FFFFFF`, paintOrder: 'stroke' }}
            >
              펑!
            </span>
          )}
        </>
      )}

      {kind === 'sleep' && (
        <>
          <div className="origin-bottom" style={{ transform: 'rotate(-10deg)' }}>
            <div className="cls-breathe origin-bottom" style={at(0)}>
              <PixelAvatar look={look} size={size} mood="sleep" />
            </div>
          </div>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="cls-zzz pointer-events-none absolute font-display font-bold leading-none text-ink-3"
              style={{ ...at(i * 700), right: -2 * k, top: 0, fontSize: (10 + i * 3) * k }}
            >
              z
            </span>
          ))}
        </>
      )}

      {bubble && (
        <div
          className="cls-bubble pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 whitespace-nowrap rounded-xl bg-white px-2 py-0.5 font-bold text-ink shadow-[0_2px_8px_rgba(16,18,24,0.15)]"
          style={{ ...at(kind === 'pop' ? 1700 : 500), fontSize: Math.max(11, 13 * k) }}
        >
          {bubble}
        </div>
      )}
    </div>
  );
}

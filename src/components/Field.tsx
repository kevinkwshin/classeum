import type { AvatarOnField, RevealInfo } from '@/lib/types';
import { CountUp } from './CountUp';
import { PixelAvatar } from './PixelAvatar';
import { Reaction, reactionLine } from './Reaction';
import { hashString } from '@/lib/text';

// Must match START_HALF_W / START_HALF_H in src/server/hub.ts.
const START_W = 0.18;
const START_H = 0.26;

// [left%, top%, width%, height%, alpha]; on reveal each cloud slides out the side it is nearest.
const CLOUDS = [
  [-6, 8, 34, 40, 0.55], [20, -10, 40, 42, 0.45], [53, 4, 42, 46, 0.5], [72, 34, 34, 42, 0.4],
  [-3, 48, 38, 46, 0.5], [27, 38, 45, 50, 0.6], [57, 58, 42, 46, 0.45], [10, 72, 36, 40, 0.4], [78, -6, 30, 36, 0.35],
];

const LEAVES = Array.from({ length: 16 }, (_, i) => ({
  left: 6 + ((i * 37) % 88),
  dx: ((i * 53) % 90) - 45,
  delay: (i * 170) % 1500,
  size: 12 + ((i * 7) % 10),
  color: i % 3 === 0 ? '#2b8a3e' : '#F5B82E',
}));

function zoneOf(x: number, y: number, n: number): number {
  if (Math.abs(x - 0.5) < START_W / 2 && Math.abs(y - 0.5) < START_H / 2) return -1;
  if (n === 2) return x < 0.5 ? 0 : 1;
  const z = (y < 0.5 ? 0 : 2) + (x < 0.5 ? 0 : 1);
  return z < n ? z : -1;
}

/**
 * Lines each zone's avatars up in a tidy block instead of where they stopped, so the
 * reveal doesn't single out exact spots. Wrong zones with one or two people show only
 * the number, and students left on the start line aren't drawn at all.
 */
function formation(avatars: AvatarOnField[], n: number, correct: number | undefined) {
  const groups = new Map<number, AvatarOnField[]>();
  for (const a of avatars) {
    const z = zoneOf(a.point.x, a.point.y, n);
    if (z < 0) continue;
    groups.set(z, [...(groups.get(z) ?? []), a]);
  }
  const placed: { a: AvatarOnField; x: number; y: number; zone: number; rank: number }[] = [];
  const aspect = 2.1;
  for (const [z, list] of groups) {
    if (correct !== undefined && z !== correct && list.length <= 2) continue;
    const left = n === 2 ? z === 0 : z % 2 === 0;
    const top = n === 2 ? null : z < 2;
    const x0 = left ? 0.05 : 0.6;
    const w = 0.35;
    const y0 = top === null ? 0.15 : top ? 0.15 : 0.55;
    const h = top === null ? 0.73 : 0.3;
    const sorted = [...list].sort((p, q) => p.studentId.localeCompare(q.studentId));
    const cols = Math.max(1, Math.min(sorted.length, Math.ceil(Math.sqrt((sorted.length * w * aspect) / h))));
    const rows = Math.ceil(sorted.length / cols);
    sorted.forEach((a, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      placed.push({ a, x: x0 + ((c + 0.5) * w) / cols, y: y0 + ((r + 0.5) * h) / rows + 0.04, zone: z, rank: i });
    });
  }
  return placed;
}

export function zoneCells(count: number) {
  if (count === 2) return { cols: 2, rows: 1, cells: [0, 1] };
  return { cols: 2, rows: 2, cells: [0, 1, 2, 3] };
}

export function Field({
  options,
  fog,
  reveal,
  avatars,
  nameLabels,
  center,
  compact = false,
  seed = '',
}: {
  options: string[];
  fog: boolean;
  reveal?: RevealInfo | null;
  avatars?: AvatarOnField[];
  nameLabels?: boolean;
  center?: React.ReactNode;
  compact?: boolean;
  /** Changes per question, so the funny one-liners land on different students each time. */
  seed?: string;
}) {
  const { cols, rows, cells } = zoneCells(options.length);
  const avatarSize = compact ? 18 : (avatars?.length ?? 0) > 28 ? 44 : 56;
  const labelSize = compact ? 'text-sm' : 'text-[34px]';
  const badgeSize = compact ? 'h-6 w-6 text-xs' : 'h-14 w-14 text-[26px]';

  return (
    <div className={`relative h-full w-full overflow-hidden bg-white ${compact ? 'rounded-xl' : 'rounded-[36px]'}`}>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {cells.map((z) => {
          const label = options[z];
          const blocked = label === undefined;
          const isCorrect = !!reveal && reveal.correctIndex === z;
          const faded = !!reveal && !isCorrect;
          const top = rows === 1 || z < 2;
          const left = z % 2 === 0;
          return (
            <div
              key={z}
              className={`zone-${z} relative overflow-hidden transition-[background-color,opacity] duration-500 ${isCorrect && !compact ? 'cls-glow' : ''}`}
              style={{
                background: blocked ? 'repeating-linear-gradient(135deg, #F4F5F7 0 12px, #ECEEF1 12px 24px)' : faded ? '#F4F5F7' : 'var(--zone-soft)',
                boxShadow: isCorrect ? `inset 0 0 0 ${compact ? 3 : 6}px #F5B82E` : undefined,
                borderRight: left && cols === 2 ? '2px solid #E3E5EA' : undefined,
                borderBottom: rows === 2 && z < 2 ? '2px solid #E3E5EA' : undefined,
              }}
            >
              {!blocked && (
                <div
                  className={`absolute flex items-center gap-3 transition-opacity duration-500 ${compact ? 'gap-1.5' : ''}`}
                  style={{ [top ? 'top' : 'bottom']: compact ? 6 : 28, [left ? 'left' : 'right']: compact ? 6 : 32, zIndex: 3, opacity: faded ? 0.55 : 1 }}
                >
                  <div
                    key={isCorrect ? 'ok' : 'n'}
                    className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-white ${badgeSize} ${isCorrect ? 'cls-pop bg-good' : ''}`}
                    style={isCorrect ? undefined : { background: faded ? '#A3A8B4' : 'var(--zone)' }}
                  >
                    {isCorrect ? '✓' : z + 1}
                  </div>
                  <div className={`font-bold ${labelSize} ${fog ? 'rounded-full bg-white px-3 py-1' : ''}`} style={{ color: faded ? undefined : 'var(--zone-ink)' }}>
                    {label}
                  </div>
                  {reveal && (
                    <div className={`tabular font-extrabold ${compact ? 'text-sm' : 'text-[32px]'} ${isCorrect ? 'text-ink' : 'text-ink-3'}`}>
                      <CountUp value={reveal.zoneCounts[z] ?? 0} delay={compact ? 0 : 450} />
                    </div>
                  )}
                </div>
              )}
              {isCorrect &&
                !compact &&
                LEAVES.map((leaf, i) => (
                  <div
                    key={i}
                    className="cls-leaf pointer-events-none absolute top-0 opacity-0"
                    style={{
                      left: `${leaf.left}%`,
                      width: leaf.size,
                      height: leaf.size * 0.55,
                      background: leaf.color,
                      borderRadius: '0 80% 0 80%',
                      animationDelay: `${600 + leaf.delay}ms`,
                      ['--dx' as string]: `${leaf.dx}px`,
                      zIndex: 1,
                    }}
                  />
                ))}
            </div>
          );
        })}
      </div>

      <div
        className="absolute rounded-full border-[3px] border-dashed border-[#C9CDD6] bg-white"
        style={{ left: `${50 - (START_W * 100) / 2}%`, top: `${50 - (START_H * 100) / 2}%`, width: `${START_W * 100}%`, height: `${START_H * 100}%`, zIndex: 1 }}
      />

      {avatars &&
        formation(avatars, options.length, reveal?.correctIndex).map(({ a, x, y, zone, rank }, i) => {
          const happy = !!reveal && zone === reveal.correctIndex;
          // Two students per zone get a speech bubble; the rest just react.
          const talk = !compact && (hashString(a.studentId + seed) % 7 === 0 || rank === hashString(seed + zone) % 6);
          return (
            <div
              key={a.studentId}
              className="cls-land absolute"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -70%)', zIndex: talk ? 3 : 2, animationDelay: `${250 + (i % 14) * 35}ms` }}
            >
              <div className="flex flex-col items-center">
                {compact || !reveal ? (
                  <PixelAvatar look={a.look} size={avatarSize} />
                ) : (
                  <Reaction
                    kind={happy ? 'happy' : 'pop'}
                    look={a.look}
                    size={avatarSize}
                    delay={happy ? 750 + (rank % 8) * 70 : 750 + Math.min(rank, 10) * 140}
                    bang={rank % 2 === 0}
                    bubble={talk ? reactionLine(happy ? 'happy' : 'pop', a.studentId + seed) : undefined}
                  />
                )}
                {nameLabels && !compact && (
                  <div className="mt-0.5 whitespace-nowrap rounded-md bg-white/90 px-1.5 text-[13px] font-bold">{a.number}</div>
                )}
              </div>
            </div>
          );
        })}

      <div className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }} aria-hidden>
        <div className="cls-fog-base absolute inset-0 bg-[#E7E9EE]" style={{ opacity: fog ? 0.88 : 0 }} />
        {CLOUDS.map(([x, y, w, h, a], i) => {
          const out = x + w / 2 < 50 ? -140 : 140;
          return (
            <div
              key={i}
              className="cls-fog-cloud absolute"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: `${w}%`,
                height: `${h}%`,
                opacity: fog ? 1 : 0,
                transform: fog ? 'translateX(0)' : `translateX(${out}%)`,
                transitionDelay: fog ? '0ms' : `${(i % 4) * 60}ms`,
              }}
            >
              <div
                className={`h-full w-full rounded-full ${compact ? '' : 'cls-drift'}`}
                style={{ background: `rgba(255,255,255,${a})`, animationDuration: `${7 + (i % 4) * 2}s`, animationDelay: `-${i * 1.3}s` }}
              />
            </div>
          );
        })}
      </div>

      {center && <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ zIndex: 4 }}>{center}</div>}
    </div>
  );
}

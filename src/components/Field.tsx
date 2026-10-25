'use client';
import { useLayoutEffect, useRef, useState } from 'react';
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

type Tag = { h: number; w: number; small: boolean };
// Name tag under an avatar: its height (with the 2px gap) and the width a three-syllable name needs.
const TAG: Tag = { h: 20, w: 52, small: false };
const TAG_SM: Tag = { h: 16, w: 42, small: true };
// Zone labels sit 28px in from the edge and are 56px tall.
const LABEL_EDGE = 84;
const LABEL_STRIP = 92;
// Room the 많이 고른 오답 card takes at the bottom centre.
const FOOTER_STRIP = 120;

/** The field's size in px and where the footer card sits in it. */
type Box = { w: number; h: number; foot: { left: number; right: number; top: number } | null };

type Slot = { a: AvatarOnField; x: number; y: number; zone: number; rank: number; row: number; size: number; tag: Tag | null; tagW?: number; tight: boolean };

/** Biggest avatars (up to `base`) for `count` slots in a w×h px box: tries every column count, then smaller tags, then none. */
function pack(count: number, w: number, h: number, base: number, names: boolean, onlyCols?: number) {
  const fit = (tag: Tag | null) => {
    let best = { cols: onlyCols ?? 1, size: -Infinity, tag };
    for (let cols = onlyCols ?? 1; cols <= (onlyCols ?? count); cols++) {
      if (tag && w / cols < tag.w) break;
      const size = Math.min(base, w / cols - 4, h / Math.ceil(count / cols) - (tag?.h ?? 0));
      if (size > best.size) best = { cols, size, tag };
    }
    return best;
  };
  let best = fit(names ? TAG : null);
  if (names) {
    const small = fit(TAG_SM);
    if (small.size >= best.size + 2) best = small;
    // Too tight even for small tags: drop the names rather than shrink everyone to dots.
    if (best.size < 18) best = fit(null);
  }
  return { ...best, size: Math.max(16, Math.floor(best.size)) };
}

/**
 * Lines each zone's avatars up in a tidy block (exact spots would pile up where everyone
 * tapped the zone's centre). With `showAll` (name tags on) everyone is drawn, including
 * students left on the start line (zone -1, drawn in the start box). Without it, wrong
 * zones with one or two people show only the number and the start line stays empty, so
 * nobody stands out alone. Given the field's px `box`, a block that would bury name tags
 * under the next row or run into the zone label is re-packed to fit (`tight`).
 */
function formation(
  avatars: AvatarOnField[],
  n: number,
  correct: number | undefined,
  showAll: boolean,
  reserveFooter: boolean,
  box: Box | null = null,
  base = 56,
) {
  const groups = new Map<number, AvatarOnField[]>();
  for (const a of avatars) {
    const z = zoneOf(a.point.x, a.point.y, n);
    if (z < 0 && !showAll) continue;
    groups.set(z, [...(groups.get(z) ?? []), a]);
  }
  const placed: Slot[] = [];
  const aspect = 2.1;
  for (const [z, list] of groups) {
    if (!showAll && correct !== undefined && z !== correct && list.length <= 2) continue;
    let x0: number, y0: number, w: number, h: number;
    const sorted = [...list].sort((p, q) => p.studentId.localeCompare(q.studentId));
    let cols: number;
    if (z < 0) {
      // A band across the middle (wider than the start box) in at most two rows, so names stay readable.
      [x0, y0, w, h] = [0.36, 0.38, 0.28, 0.2];
      cols = Math.max(1, Math.ceil(sorted.length / 2));
    } else {
      const left = n === 2 ? z === 0 : z % 2 === 0;
      const top = n === 2 ? null : z < 2;
      x0 = left ? 0.05 : 0.6;
      w = 0.35;
      y0 = top === null ? 0.15 : top ? 0.15 : 0.55;
      // Leave the bottom centre free for the 많이 고른 오답 card.
      h = top === null ? (reserveFooter ? 0.62 : 0.73) : top ? 0.3 : reserveFooter ? 0.24 : 0.3;
      cols = Math.max(1, Math.min(sorted.length, Math.ceil(Math.sqrt((sorted.length * w * aspect) / h))));
    }
    const rows = Math.ceil(sorted.length / cols);
    const tag = showAll ? TAG : null;
    const labelTop = z >= 0 && (n === 2 || z < 2);
    let tight = false;
    if (box) {
      // Avatars are anchored 70% down their slot (avatar plus tag).
      const S = base + (tag?.h ?? 0);
      const firstY = (y0 + h / rows / 2 + 0.04) * box.h;
      const lastY = (y0 + h - h / rows / 2 + 0.04) * box.h;
      // Without tags a little overlap between rows is fine.
      tight =
        (h * box.h) / rows < S - (tag ? 0 : 6) ||
        (!!tag && (w * box.w) / cols < tag.w) ||
        (z >= 0 && (labelTop ? firstY - 0.7 * S < LABEL_EDGE : lastY + 0.3 * S > box.h - LABEL_EDGE));
    }
    if (!box || !tight) {
      sorted.forEach((a, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        placed.push({ a, x: x0 + ((c + 0.5) * w) / cols, y: y0 + ((r + 0.5) * h) / rows + 0.04, zone: z, rank: i, row: r, size: base, tag, tight: false });
      });
      continue;
    }
    // Re-pack into the part of the zone clear of its label strip, a little further out from
    // the start box so sleepers' names don't touch the block's inner column.
    const { w: W, h: H } = box;
    let top = y0 * H;
    let bottom = (y0 + h) * H;
    let left = x0 * W;
    let width = w * W;
    if (z >= 0) {
      top = labelTop ? LABEL_STRIP : H / 2 + 6;
      bottom = labelTop && n !== 2 ? H / 2 - 6 : H - (labelTop ? 16 : LABEL_STRIP);
      left = (x0 < 0.5 ? x0 - 0.02 : x0 + 0.02) * W;
    }
    let fit = pack(sorted.length, width, bottom - top, base, !!tag, z < 0 ? cols : undefined);
    // Keep clear of the 많이 고른 오답 card: stop above it or beside it, whichever packs better.
    if (z >= 0 && reserveFooter && bottom > H / 2) {
      const f = box.foot ?? { left: 0.29 * W, right: 0.71 * W, top: H - FOOTER_STRIP };
      if (left < f.right + 8 && left + width > f.left - 8 && bottom > f.top - 8) {
        const above = pack(sorted.length, width, f.top - 8 - top, base, !!tag);
        const sideW = x0 < 0.5 ? f.left - 8 - left : left + width - (f.right + 8);
        const beside = sideW > 0 ? pack(sorted.length, sideW, bottom - top, base, !!tag) : null;
        // Keeping the names counts for more than a few px of avatar.
        if (beside && (!!beside.tag !== !!above.tag ? !!beside.tag : beside.size > above.size)) {
          fit = beside;
          if (x0 >= 0.5) left = f.right + 8;
          width = sideW;
        } else {
          fit = above;
          bottom = f.top - 8;
        }
      }
    }
    const colPx = width / fit.cols;
    const rowPx = (bottom - top) / Math.ceil(sorted.length / fit.cols);
    const S = fit.size + (fit.tag?.h ?? 0);
    sorted.forEach((a, i) => {
      const c = i % fit.cols;
      const r = Math.floor(i / fit.cols);
      const x = (left + (c + 0.5) * colPx) / W;
      const y = (top + (r + 0.5) * rowPx + 0.2 * S) / H;
      placed.push({ a, x, y, zone: z, rank: i, row: r, size: fit.size, tag: fit.tag, tagW: colPx - 2, tight: true });
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
  footer,
  compact = false,
  seed = '',
}: {
  options: string[];
  fog: boolean;
  reveal?: RevealInfo | null;
  avatars?: AvatarOnField[];
  nameLabels?: boolean;
  center?: React.ReactNode;
  /** Shown at the bottom centre, clear of the start box where sleepers stand at the reveal. */
  footer?: React.ReactNode;
  compact?: boolean;
  /** Changes per question, so the funny one-liners land on different students each time. */
  seed?: string;
}) {
  const { cols, rows, cells } = zoneCells(options.length);
  const avatarSize = compact ? 18 : (avatars?.length ?? 0) > 28 ? 44 : 56;
  const labelSize = compact ? 'text-sm' : 'text-[34px]';
  const badgeSize = compact ? 'h-6 w-6 text-xs' : 'h-14 w-14 text-[26px]';

  // The projector's real size decides how tightly a crowded zone can be packed.
  const ref = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const hasFooter = !!footer;
  useLayoutEffect(() => {
    const el = ref.current;
    if (compact || !el) return;
    const measure = () => {
      const f = footRef.current;
      // Offsets skip the card's centring and slide-in transforms.
      const foot = f ? { left: f.offsetLeft - f.offsetWidth / 2, right: f.offsetLeft + f.offsetWidth / 2, top: f.offsetTop } : null;
      const next = { w: el.clientWidth, h: el.clientHeight, foot };
      setBox((b) => (b && JSON.stringify(b) === JSON.stringify(next) ? b : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (footRef.current) ro.observe(footRef.current);
    return () => ro.disconnect();
  }, [compact, hasFooter]);

  return (
    <div ref={ref} className={`relative h-full w-full overflow-hidden bg-white ${compact ? 'rounded-xl' : 'rounded-[36px]'}`}>
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
        formation(avatars, options.length, reveal?.correctIndex, !!nameLabels && !compact, !!footer, compact ? null : box, avatarSize).map(({ a, x, y, zone, rank, row, size, tag, tagW, tight }, i) => {
          const happy = !!reveal && zone === reveal.correctIndex;
          const kind = happy ? 'happy' : zone < 0 ? 'sleep' : 'pop';
          // A few students per zone get a speech bubble; with name tags only the top row, so no bubble hides a name.
          // A tightly packed zone has no room above its top row either.
          const talk = !compact && !tight && (!nameLabels || row === 0) && (hashString(a.studentId + seed) % 7 === 0 || rank === hashString(seed + zone) % 6);
          return (
            <div
              key={a.studentId}
              className="cls-land absolute"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -70%)', zIndex: talk ? 3 : 2, animationDelay: `${250 + (i % 14) * 35}ms` }}
            >
              <div className="flex flex-col items-center">
                {compact || !reveal ? (
                  <PixelAvatar look={a.look} size={size} />
                ) : (
                  <Reaction
                    kind={kind}
                    look={a.look}
                    size={size}
                    delay={happy ? 750 + (rank % 8) * 70 : 750 + Math.min(rank, 10) * 140}
                    bang={rank % 2 === 0}
                    bubble={talk && kind !== 'sleep' ? reactionLine(kind, a.studentId + seed) : undefined}
                  />
                )}
                {tag && (
                  <div
                    className={`mt-0.5 truncate whitespace-nowrap rounded-md bg-white/90 font-bold ${tag.small ? 'px-1 text-[11px] leading-tight' : 'max-w-[5.5em] px-1.5 text-[13px] leading-snug'}`}
                    style={tagW ? { maxWidth: `min(5.5em, ${tagW}px)` } : undefined}
                  >
                    {a.name}
                  </div>
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
      {footer && <div ref={footRef} className="absolute bottom-4 left-1/2 -translate-x-1/2" style={{ zIndex: 4 }}>{footer}</div>}
    </div>
  );
}

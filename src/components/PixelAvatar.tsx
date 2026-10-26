import { memo, useMemo } from 'react';
import type { AvatarLook } from '@/lib/types';
import { avatarRuns, eyesCovered, GRID, skinTones } from '@/lib/avatar';

const SPARKS: [number, number, number][] = [[1, 3, 0], [13, 2, 0.4], [14, 8, 0.8], [0, 10, 1.2], [12, 13, 0.6], [2, 6, 1.0]];
const PUFFS: [number, number, number][] = [[3, 15, 0], [12, 15, 0.4], [2, 14, 0.8], [13, 14, 0.2]];
// Small pixel shapes for the newer effects, as [x, y] offsets from an anchor.
const HEART = [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
const NOTE = [[1, 0], [1, 1], [1, 2], [0, 3], [1, 3], [2, 0]];
const BOLT = [[1, 0], [0, 1], [1, 1], [0, 2], [1, 3], [0, 4]];
const FLAME = [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
const HEARTS: [number, number, number][] = [[0, 2, 0], [13, 4, 0.5], [1, 9, 1.0]];
const NOTES: [number, number, number][] = [[0, 1, 0], [13, 3, 0.6], [14, 9, 1.2]];
const BOLTS: [number, number, number, string][] = [[0, 3, 0, '#FFE14D'], [14, 5, 0.15, '#7FDBFF'], [1, 10, 0.3, '#7FDBFF'], [13, 11, 0.45, '#FFE14D']];
const FLAMES: [number, number, number, string][] = [[1, 12, 0, '#FF8A3D'], [12, 12, 0.2, '#FFC93D'], [0, 6, 0.4, '#FFC93D'], [13, 6, 0.1, '#FF8A3D']];
const NEONS: [number, number, number, string][] = [[0, 4, 0, '#3DF5FF'], [15, 7, 0.5, '#FF5FD2'], [1, 12, 1.0, '#C266FF'], [14, 2, 0.3, '#3DF5FF'], [15, 13, 0.8, '#C266FF']];
const DROP = [[1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
const BUBBLE = [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]];
const PETAL = [[0, 0], [1, 0], [1, 1]];
const FLAKE = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
// Sweat beads by the head after a hard game; bubbles drift up; petals and snow drift down past the character.
const DROPS: [number, number, number][] = [[2, 3, 0], [13, 2, 0.7], [14, 6, 1.4]];
const BUBBLES: [number, number, number][] = [[0, 11, 0], [12, 9, 0.6], [0, 5, 1.2], [12, 3, 0.3], [10, 12, 0.9]];
const PETALS: [number, number, number, string][] = [[0, 1, 0, '#F7A8C4'], [13, 0, 0.9, '#FFC2D6'], [2, 7, 1.8, '#FFC2D6'], [13, 6, 2.4, '#F7A8C4'], [1, 12, 1.2, '#F7A8C4']];
const FLAKES: [number, number, number][] = [[0, 1, 0], [12, 2, 1.1], [1, 8, 2.2], [13, 9, 0.6], [11, 13, 1.6]];
// Light rising off the character, the way 'aura' is drawn in memes.
const AURAS: [number, number, number, string][] = [[2, 14, 0, '#FFE58A'], [13, 13, 0.4, '#FFFFFF'], [4, 15, 0.8, '#FFE58A'], [11, 15, 1.2, '#FFE58A'], [1, 10, 1.0, '#FFFFFF'], [14, 10, 0.2, '#FFE58A'], [7, 15, 0.6, '#FFFFFF']];

function Shape({ cells, x, y, color, delay, className }: { cells: number[][]; x: number; y: number; color: string; delay: number; className: string }) {
  return (
    <g className={className} style={{ animationDelay: `${delay}s` }}>
      {cells.map(([dx, dy], i) => (
        <rect key={i} x={x + dx} y={y + dy} width={1} height={1} fill={color} />
      ))}
    </g>
  );
}
// Each eye has a 3x2 box (cols 7-9 and 14-16, rows 10-11); the mouth is on row 13, the chin on row 14.
const EYE_BOX = [7, 14];
const EYE_Y = 10;
const INK = '#1E1A16';
// The effects were drawn on the old 16-pixel grid; they keep their size relative to the character.
const FX_SCALE = GRID / 16;

export type Mood = 'normal' | 'happy' | 'dizzy' | 'sleep';

/**
 * One <path> per colour instead of one <rect> per run: 13-32 nodes instead of 100-325, with 40 avatars on
 * the projector. Runs never overlap, so the picture is the same.
 */
function colourPaths(look: AvatarLook): [string, string][] {
  const byColour = new Map<string, string>();
  for (const r of avatarRuns(look)) byColour.set(r.color, `${byColour.get(r.color) ?? ''}M${r.x} ${r.y}h${r.w}v1h-${r.w}z`);
  return [...byColour];
}

function Face({ look, mood }: { look: AvatarLook; mood: Exclude<Mood, 'normal'> }) {
  const [skin] = skinTones(look);
  // Behind sunglasses only the mouth changes.
  const eyes = !eyesCovered(look);
  return (
    <g>
      {eyes && EYE_BOX.map((x) => <rect key={x} x={x} y={EYE_Y} width={3} height={2} fill={skin} />)}
      {mood === 'happy' && (
        <>
          {/* ^ ^ eyes and an open grin */}
          {eyes &&
            EYE_BOX.map((x) => (
              <g key={x} fill={INK}>
                <rect x={x + 1} y={EYE_Y} width={1} height={1} />
                <rect x={x} y={EYE_Y + 1} width={1} height={1} />
                <rect x={x + 2} y={EYE_Y + 1} width={1} height={1} />
              </g>
            ))}
          <rect x={10} y={13} width={4} height={1} fill="#7A2A2A" />
          <rect x={11} y={14} width={2} height={1} fill="#E06A6A" />
        </>
      )}
      {mood === 'dizzy' && (
        <>
          {/* x x eyes and a wobbly mouth */}
          {eyes &&
            EYE_BOX.map((x) => (
              <g key={x}>
                <rect x={x - 0.1} y={EYE_Y + 0.75} width={3.2} height={0.5} fill={INK} transform={`rotate(35 ${x + 1.5} ${EYE_Y + 1})`} />
                <rect x={x - 0.1} y={EYE_Y + 0.75} width={3.2} height={0.5} fill={INK} transform={`rotate(-35 ${x + 1.5} ${EYE_Y + 1})`} />
              </g>
            ))}
          <rect x={10} y={13} width={2} height={1} fill="#7A2A2A" />
          <rect x={12} y={13.5} width={2} height={1} fill="#7A2A2A" />
        </>
      )}
      {mood === 'sleep' && eyes && EYE_BOX.map((x) => <rect key={x} x={x} y={EYE_Y + 1} width={3} height={0.6} fill={INK} />)}
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
  // Rebuilt when the look changes, not when only the mood or blink does.
  const lookJson = JSON.stringify(look);
  const paths = useMemo(() => colourPaths(JSON.parse(lookJson) as AvatarLook), [lookJson]);
  const outline =
    look.effect === 'gold'
      ? 'drop-shadow(1px 0 0 #F5B82E) drop-shadow(-1px 0 0 #F5B82E) drop-shadow(0 1px 0 #F5B82E) drop-shadow(0 -1px 0 #F5B82E)'
      : look.effect === 'electric'
        ? 'drop-shadow(0 0 2px #7FDBFF)'
        : look.effect === 'neon'
          ? 'drop-shadow(0 0 1px #3DF5FF) drop-shadow(0 0 3px #C266FF)'
          : look.effect === 'aura'
            ? 'drop-shadow(0 0 2px #FFE58A) drop-shadow(0 0 4px rgba(255, 229, 138, 0.6))'
            : undefined;
  const [skin] = skinTones(look);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      // Below one CSS pixel per grid pixel, crisp edges would drop whole rows (an eye, the mouth); let them blend instead.
      shapeRendering={size >= GRID ? 'crispEdges' : 'auto'}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', filter: outline, display: 'block' }}
    >
      {paths.map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
      {mood !== 'normal' && <Face look={look} mood={mood} />}
      {mood === 'normal' && blink !== undefined && !eyesCovered(look) && (
        <g className="cls-blink" style={{ animationDelay: `-${((blink * 1.37) % 5).toFixed(2)}s` }}>
          {EYE_BOX.map((x) => (
            <g key={x}>
              <rect x={x} y={EYE_Y} width={3} height={2} fill={skin} />
              <rect x={x} y={EYE_Y + 1} width={3} height={0.6} fill={INK} />
            </g>
          ))}
        </g>
      )}
      <g transform={`scale(${FX_SCALE})`}>
        {look.effect === 'sparkle' &&
          SPARKS.map(([x, y, d], i) => <rect key={`s${i}`} className="cls-spark" x={x} y={y} width={1} height={1} fill="#FFD84D" style={{ animationDelay: `${d}s` }} />)}
        {look.effect === 'dust' &&
          PUFFS.map(([x, y, d], i) => <rect key={`p${i}`} className="cls-puff" x={x} y={y} width={1} height={1} fill="#C9C1B3" style={{ animationDelay: `${d}s` }} />)}
        {look.effect === 'hearts' && HEARTS.map(([x, y, d], i) => <Shape key={`h${i}`} cells={HEART} x={x} y={y} color="#F25C8A" delay={d} className="cls-spark" />)}
        {look.effect === 'notes' && NOTES.map(([x, y, d], i) => <Shape key={`n${i}`} cells={NOTE} x={x} y={y} color="#5B6CFF" delay={d} className="cls-spark" />)}
        {look.effect === 'electric' && BOLTS.map(([x, y, d, c], i) => <Shape key={`z${i}`} cells={BOLT} x={x} y={y} color={c} delay={d} className="cls-zap" />)}
        {look.effect === 'fire' && FLAMES.map(([x, y, d, c], i) => <Shape key={`f${i}`} cells={FLAME} x={x} y={y} color={c} delay={d} className="cls-zap" />)}
        {look.effect === 'neon' && NEONS.map(([x, y, d, c], i) => <rect key={`o${i}`} className="cls-spark" x={x} y={y} width={1} height={1} fill={c} style={{ animationDelay: `${d}s` }} />)}
        {look.effect === 'aura' && AURAS.map(([x, y, d, c], i) => <rect key={`a${i}`} className="cls-rise" x={x} y={y} width={1} height={1} fill={c} style={{ animationDelay: `${d}s` }} />)}
        {look.effect === 'sweat' && DROPS.map(([x, y, d], i) => <Shape key={`w${i}`} cells={DROP} x={x} y={y} color="#4FA8E8" delay={d} className="cls-drip" />)}
        {look.effect === 'bubbles' && BUBBLES.map(([x, y, d], i) => <Shape key={`b${i}`} cells={BUBBLE} x={x} y={y} color="#5DBDEA" delay={d} className="cls-rise" />)}
        {look.effect === 'petals' && PETALS.map(([x, y, d, c], i) => <Shape key={`l${i}`} cells={PETAL} x={x} y={y} color={c} delay={d} className="cls-fall" />)}
        {look.effect === 'snow' && FLAKES.map(([x, y, d], i) => <Shape key={`k${i}`} cells={FLAKE} x={x} y={y} color="#A9CBEA" delay={d} className="cls-fall" />)}
      </g>
    </svg>
  );
}

type Props = Parameters<typeof PixelAvatarImpl>[0];

function sameLook(a: AvatarLook, b: AvatarLook): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof AvatarLook)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

// Views arrive as fresh JSON on every push, so the look is compared by value; the other props as usual.
function sameProps(a: Props, b: Props): boolean {
  const keys = Object.keys(a) as (keyof Props)[];
  return keys.length === Object.keys(b).length && keys.every((k) => (k === 'look' ? sameLook(a.look, b.look) : a[k] === b[k]));
}

export const PixelAvatar = memo(PixelAvatarImpl, sameProps);

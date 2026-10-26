// Field geometry in 0-1 coordinates, shared by the server's judging, the phone and the projector so they
// always agree. No server imports here: the phone and projector pages import it too.
import type { FieldPoint } from './types';

/** Half the start box's width and height; a character still inside it hasn't answered. */
export const START_HALF_W = 0.09;
export const START_HALF_H = 0.13;

/** The answer box (0-3) a point is in, or -1 on the start line or outside the boxes in use. */
export function zoneOf(p: FieldPoint, optionCount: number): number {
  if (Math.abs(p.x - 0.5) < START_HALF_W && Math.abs(p.y - 0.5) < START_HALF_H) return -1;
  if (optionCount === 2) return p.x < 0.5 ? 0 : 1;
  const z = (p.y < 0.5 ? 0 : 2) + (p.x < 0.5 ? 0 : 1);
  return z < optionCount ? z : -1;
}

/** The middle of answer box `z`, where a tap on the phone puts the character. */
export function zoneCenter(z: number, optionCount: number): FieldPoint {
  if (optionCount === 2) return { x: z === 0 ? 0.25 : 0.75, y: 0.5 };
  return { x: z % 2 === 0 ? 0.25 : 0.75, y: z < 2 ? 0.27 : 0.73 };
}

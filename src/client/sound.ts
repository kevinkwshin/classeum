// Sound effects for the projector, made in code (src/client/cheer.ts) so there are no sound files to ship or
// license. Browsers keep audio off until the page is clicked or a key is pressed; the projector calls
// unlockAudio() on its first touch (the teacher clicks it or presses F for full screen anyway).
import { cheerLevel, renderCheer } from './cheer';

let ctx: AudioContext | null = null;
// Two takes of each cheer size, alternated so twenty reveals in a row don't sound like one recording.
const takes = new Map<number, AudioBuffer[]>();
let played = 0;

function context(): AudioContext | null {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
  return ctx;
}

function render(c: AudioContext, level: 0 | 1 | 2, seed: number): AudioBuffer {
  const data = renderCheer(c.sampleRate, level, seed);
  const buffer = c.createBuffer(2, data[0].length, c.sampleRate);
  data.forEach((ch, i) => buffer.getChannelData(i).set(ch));
  return buffer;
}

/** Makes the takes in the background, one at a time (each is a few tens of ms), well before a reveal needs them. */
function prepare(c: AudioContext) {
  if (takes.size > 0) return;
  ([0, 1, 2] as const).forEach((level) => takes.set(level, []));
  const jobs = ([0, 1, 2] as const).flatMap((level) => [1, 2].map((seed) => [level, seed] as const));
  const next = () => {
    const job = jobs.shift();
    if (!job) return;
    takes.get(job[0])!.push(render(c, job[0], job[1]));
    setTimeout(next, 50);
  };
  setTimeout(next, 0);
}

/** Turns audio on after a click or key press; resolves to whether it is now playing. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  if (c.state === 'running') prepare(c);
  return c.state === 'running';
}

export function audioReady(): boolean {
  return context()?.state === 'running';
}

/**
 * Students shouting "Yeah!" for a reveal where some of the class got it right. `share` (0-1) is how many:
 * a few voices for a few, a bigger crowd for about half, and nearly everyone adds applause.
 */
export function playCheer(share: number) {
  const c = context();
  if (!c || c.state !== 'running' || share <= 0) return;
  const level = cheerLevel(share);
  const list = takes.get(level) ?? [];
  const buffer = list.length > 0 ? list[played++ % list.length] : render(c, level, 1);
  const source = c.createBufferSource();
  source.buffer = buffer;
  // A slightly different pitch each time keeps it lively.
  source.playbackRate.value = 0.96 + Math.random() * 0.08;
  const gain = c.createGain();
  gain.gain.value = [0.5, 0.6, 0.7][level];
  source.connect(gain).connect(c.destination);
  source.start(c.currentTime + 0.02);
}

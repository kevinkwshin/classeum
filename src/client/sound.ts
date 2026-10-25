// Short sound effects made with the Web Audio API, so there are no sound files to ship or license.
// Browsers keep audio off until the page is clicked or a key is pressed; the projector calls
// unlockAudio() on its first touch (the teacher clicks it or presses F for full screen anyway).

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
  return ctx;
}

/** Turns audio on after a click or key press; resolves to whether it is now playing. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

export function audioReady(): boolean {
  return context()?.state === 'running';
}

/**
 * A bright rising chime for a reveal where some of the class got it right. `share` (0-1) is how many:
 * a few get two notes, about half get four, nearly everyone gets five and a sparkle on top.
 */
export function playCheer(share: number) {
  const c = context();
  if (!c || c.state !== 'running' || share <= 0) return;
  const notes = share >= 0.8 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : share >= 0.4 ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
  const out = c.createGain();
  out.gain.value = 0.16;
  out.connect(c.destination);
  const start = c.currentTime + 0.02;
  const tone = (freq: number, at: number, length: number, type: OscillatorType, peak = 1) => {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  };
  notes.forEach((f, i) => tone(f, start + i * 0.085, 0.45, 'triangle'));
  if (share >= 0.8) [2093, 2637, 3136].forEach((f, i) => tone(f, start + notes.length * 0.085 + i * 0.05, 0.25, 'sine', 0.35));
}

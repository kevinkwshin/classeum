// The projector's "Yeah!" at a reveal: a short recording of children cheering (public/sounds/yeah.mp3, CC0:
// "funny kids 7 yeah" by phantastonia on freesound.org).
// Browsers keep audio off until the page is clicked or a key is pressed; the projector calls unlockAudio() on
// its first touch (the teacher clicks it or presses F for full screen anyway), which also loads the sound.

const SOUND_URL = '/sounds/yeah.mp3';

let ctx: AudioContext | null = null;
let yeah: Promise<AudioBuffer | null> | null = null;

function context(): AudioContext | null {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
  return ctx;
}

function load(c: AudioContext): Promise<AudioBuffer | null> {
  yeah ??= fetch(SOUND_URL)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((data) => c.decodeAudioData(data))
    .catch(() => {
      yeah = null; // try again on the next click
      return null;
    });
  return yeah;
}

/** Turns audio on after a click or key press; resolves to whether it is now playing. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  if (c.state === 'running') void load(c);
  return c.state === 'running';
}

export function audioReady(): boolean {
  return context()?.state === 'running';
}

/** Plays the cheer for a reveal where some of the class got it right; louder the more of them (`share`, 0-1). */
export function playCheer(share: number) {
  const c = context();
  if (!c || c.state !== 'running' || share <= 0) return;
  void load(c).then((buffer) => {
    if (!buffer) return;
    const source = c.createBufferSource();
    source.buffer = buffer;
    // A hair higher or lower each time, so twenty reveals don't sound like one recording on repeat.
    source.playbackRate.value = 0.97 + Math.random() * 0.06;
    const gain = c.createGain();
    // The recording itself is loud (peaks at full scale), so even the biggest cheer leaves some headroom.
    gain.gain.value = share >= 0.8 ? 0.8 : share >= 0.4 ? 0.65 : 0.5;
    source.connect(gain).connect(c.destination);
    source.start();
  });
}

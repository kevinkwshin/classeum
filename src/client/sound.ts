// The projector's sounds at a reveal, short recordings in public/sounds (credits in CREDITS.txt there): "Yeah!"
// when some of the class got it right, crickets when nobody did.
// Browsers keep audio off until the page is clicked or a key is pressed; the projector calls unlockAudio() on
// its first touch (the teacher clicks it or presses F for full screen anyway), which also loads the sounds.

const SOUNDS = { yeah: '/sounds/yeah.mp3', crickets: '/sounds/crickets.m4a' };
type Sound = keyof typeof SOUNDS;

let ctx: AudioContext | null = null;
const loaded = new Map<Sound, Promise<AudioBuffer | null>>();

function context(): AudioContext | null {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
  return ctx;
}

function load(c: AudioContext, sound: Sound): Promise<AudioBuffer | null> {
  let p = loaded.get(sound);
  if (!p) {
    p = fetch(SOUNDS[sound])
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => c.decodeAudioData(data))
      .catch(() => {
        loaded.delete(sound); // try again on the next click
        return null;
      });
    loaded.set(sound, p);
  }
  return p;
}

/** Turns audio on after a click or key press; resolves to whether it is now playing. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  if (c.state === 'running') (Object.keys(SOUNDS) as Sound[]).forEach((s) => void load(c, s));
  return c.state === 'running';
}

function play(sound: Sound, volume: number, rate = 1) {
  const c = context();
  if (!c || c.state !== 'running') return;
  void load(c, sound).then((buffer) => {
    if (!buffer) return;
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = c.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(c.destination);
    source.start();
  });
}

/** "Yeah!" for a reveal where some of the class got it right; louder the more of them (`share`, 0-1). */
export function playCheer(share: number) {
  if (share <= 0) return;
  // The recording itself is loud (peaks at full scale), so even the biggest cheer leaves some headroom.
  // A hair higher or lower each time, so twenty reveals don't sound like one recording on repeat.
  play('yeah', share >= 0.8 ? 0.8 : share >= 0.4 ? 0.65 : 0.5, 0.97 + Math.random() * 0.06);
}

/** Two seconds of crickets for a reveal where nobody got it right: an awkward little silence. */
export function playCrickets() {
  play('crickets', 0.7);
}

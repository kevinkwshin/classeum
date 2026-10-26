// The projector's sounds, in public/sounds (credits in CREDITS.txt there): "Yeah!" at a reveal where some of the
// class got it right, crickets when nobody did, a wood-block tick-tock over a question's last three seconds, and the
// background song through the whole session, softer under the questions.
// Browsers keep audio off until the page is clicked or a key is pressed; the projector calls unlockAudio() on
// its first touch (the teacher clicks it or presses F for full screen anyway), which also loads the sounds.
// Only MP3 and WAV: every browser decodes them itself, while AAC (.m4a) leans on Windows' own decoders, which some
// editions (N/KN without the media pack) lack.

const SOUNDS = { yeah: '/sounds/yeah.mp3', crickets: '/sounds/crickets.wav', tick: '/sounds/ticktock.wav' };
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
  // The song's <audio> element first, synchronously inside the click: Safari lets it play only within the gesture
  // itself (the first resume() below finishes outside it), and once it has played there it may play later too. Its
  // gain stays at 0 until playMusic raises it, so this makes no sound.
  const m = musicNode(c);
  if (!m.primed || (musicLevel > 0 && m.el.paused)) {
    m.primed = true;
    void m.el.play().then(
      () => musicLevel <= 0 && m.el.pause(),
      () => {
        m.primed = false; // refused: try again at the next click
      },
    );
  }
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  if (c.state === 'running') {
    (Object.keys(SOUNDS) as Sound[]).forEach((s) => void load(c, s));
    if (musicLevel > 0) playMusic();
  }
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

/** The tick-tock file's six hits sit on a half-second grid, each starting 10 ms into its slot. */
export const TICK_STEP_MS = 500;
export const TICK_PRE_MS = 10;
export const TICK_LEAD_MS = 3000 + TICK_PRE_MS;

/**
 * The tick-tock from `offset` seconds into the file (0 when it starts on time at 3 s left); returns a stop that
 * fades it out in a few milliseconds, for a question that closes early, pauses, or gets more time.
 */
export function playTickTock(offset: number): () => void {
  const c = context();
  if (!c || c.state !== 'running') return () => undefined;
  let playing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  let stopped = false;
  void load(c, 'tick').then((buffer) => {
    if (!buffer || stopped || offset >= buffer.duration) return;
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    gain.gain.value = 0.7;
    source.connect(gain).connect(c.destination);
    source.start(0, offset);
    duckMusic(1);
    source.onended = () => duckMusic(-1);
    playing = { source, gain };
  });
  return () => {
    stopped = true;
    if (!playing) return;
    const t = c.currentTime;
    playing.gain.gain.setTargetAtTime(0, t, 0.01);
    playing.source.stop(t + 0.08);
  };
}

// The song plays from an <audio> element, through a gain node for the fades: decoded whole, two minutes of music
// would take some 50 MB in each window. Paused, the element keeps its place, so the song carries on from there.
const MUSIC_SRC = '/sounds/music.mp3';
/** The song's name, shown on the teacher screen beside its switch. */
export const MUSIC_TITLE = '오늘은 내가 정해';
/** Music volumes: fuller in the lobby and on the results, softly under the questions. */
export const MUSIC_FULL = 0.25;
export const MUSIC_SOFT = 0.12;
// Under the tick-tock the music dips further, so the last three seconds are heard.
const MUSIC_DUCK = 0.35;
let musicLevel = 0;
let ticking = 0;
let musicPause: ReturnType<typeof setTimeout> | undefined;
// The gain's current ramp, so a new ramp starts from where the last one has got to (gain.value can still read 1
// before the audio thread has run a new node).
let music: { el: HTMLAudioElement; gain: GainNode; from: number; to: number; t0: number; t1: number; primed: boolean } | null = null;

function musicNode(c: AudioContext) {
  if (music) return music;
  const el = new Audio(MUSIC_SRC);
  el.loop = true;
  el.preload = 'auto';
  const gain = c.createGain();
  gain.gain.value = 0;
  c.createMediaElementSource(el).connect(gain).connect(c.destination);
  music = { el, gain, from: 0, to: 0, t0: 0, t1: 0, primed: false };
  return music;
}

const musicTarget = () => musicLevel * (ticking > 0 ? MUSIC_DUCK : 1);

function rampMusic(to: number, seconds: number) {
  if (!music || !ctx) return;
  const t = ctx.currentTime;
  const { from, to: was, t0, t1 } = music;
  const now = t >= t1 ? was : from + (was - from) * Math.max(0, (t - t0) / (t1 - t0));
  music.gain.gain.cancelScheduledValues(t);
  music.gain.gain.setValueAtTime(now, t);
  music.gain.gain.linearRampToValueAtTime(to, t + seconds);
  Object.assign(music, { from: now, to, t0: t, t1: t + seconds });
}

function playMusic() {
  const c = context();
  if (!c || c.state !== 'running') return;
  const m = musicNode(c);
  clearTimeout(musicPause);
  if (m.el.paused) void m.el.play().catch(() => undefined);
  rampMusic(musicTarget(), m.to > 0 ? 0.8 : 1);
}

/**
 * Sets the background music's volume (MUSIC_FULL, MUSIC_SOFT, or 0 to fade it out and pause), easing between levels;
 * started again, it carries on where it paused. Asked before audio is on, it starts at the first click.
 */
export function setMusic(level: number) {
  musicLevel = level;
  if (level > 0) {
    playMusic();
    return;
  }
  if (!music) return;
  rampMusic(0, 0.6);
  const { el } = music;
  clearTimeout(musicPause);
  musicPause = setTimeout(() => musicLevel <= 0 && el.pause(), 700);
}

function duckMusic(by: 1 | -1) {
  ticking += by;
  rampMusic(musicTarget(), by > 0 ? 0.15 : 0.5);
}

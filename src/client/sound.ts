// The projector's sounds, recordings in public/sounds (credits in CREDITS.txt there): "Yeah!" at a reveal where
// some of the class got it right, crickets when nobody did, a wood-block tick-tock over a question's last three
// seconds, and background music through the whole session, softer under the questions.
// Browsers keep audio off until the page is clicked or a key is pressed; the projector calls unlockAudio() on
// its first touch (the teacher clicks it or presses F for full screen anyway), which also loads the sounds.

const SOUNDS = { yeah: '/sounds/yeah.mp3', crickets: '/sounds/crickets.m4a', tick: '/sounds/ticktock.m4a', music: '/sounds/music.m4a' };
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
  if (c.state === 'running') {
    (Object.keys(SOUNDS) as Sound[]).forEach((s) => void load(c, s));
    if (musicLevel > 0) void startMusic();
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

// The music file is a 16.7-second loop followed by its first second again, so looping from 0.5 s to 0.5 s plus the
// loop's length is seamless however much silence a browser's decoder adds or drops at the very start.
const MUSIC_LOOP = 736279 / 44100;
/** Music volumes: fuller in the lobby and on the results, softly under the questions. */
export const MUSIC_FULL = 0.25;
export const MUSIC_SOFT = 0.12;
// Under the tick-tock the music dips further, so the last three seconds are heard.
const MUSIC_DUCK = 0.35;
let musicLevel = 0;
let ticking = 0;
// Where the song was when it last stopped, so after a pause or a cover it carries on from there.
let musicPos = 0;
// The gain's current ramp, so a new ramp starts from where the last one has got to (gain.value can still read 1
// before the audio thread has run a new node), and where in the song the source started.
let music: {
  source: AudioBufferSourceNode;
  gain: GainNode;
  from: number;
  to: number;
  t0: number;
  t1: number;
  startedAt: number;
  offset: number;
} | null = null;

/** The song's position at context time `t`, following the loop. */
function musicPosAt(t: number): number {
  if (!music) return 0;
  const raw = music.offset + (t - music.startedAt);
  return raw < 0.5 + MUSIC_LOOP ? raw : 0.5 + ((raw - 0.5) % MUSIC_LOOP);
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

async function startMusic() {
  const c = context();
  if (!c || c.state !== 'running' || music) return;
  const buffer = await load(c, 'music');
  if (!buffer || musicLevel <= 0 || music) return;
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0.5;
  source.loopEnd = 0.5 + MUSIC_LOOP;
  const gain = c.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(c.destination);
  const t = c.currentTime;
  source.start(0, musicPos);
  music = { source, gain, from: 0, to: 0, t0: t, t1: t, startedAt: t, offset: musicPos };
  rampMusic(musicTarget(), 1);
}

/**
 * Sets the background music's volume (MUSIC_FULL, MUSIC_SOFT, or 0 to fade it out and stop), easing between levels;
 * started again, it carries on where it stopped. Asked before audio is on, it starts at the first click.
 */
export function setMusic(level: number) {
  musicLevel = level;
  if (level > 0) {
    if (music) rampMusic(musicTarget(), 0.8);
    else void startMusic();
    return;
  }
  if (!music || !ctx) return;
  rampMusic(0, 0.6);
  music.source.stop(ctx.currentTime + 0.7);
  musicPos = musicPosAt(ctx.currentTime + 0.6);
  music = null;
}

function duckMusic(by: 1 | -1) {
  ticking += by;
  rampMusic(musicTarget(), by > 0 ? 0.15 : 0.5);
}

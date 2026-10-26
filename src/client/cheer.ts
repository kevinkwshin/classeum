// A small crowd shouting "Yeah!", made sample by sample. Each voice is a buzz with a rising-then-falling
// pitch, shaped by three moving formant filters from "y" through "e" to "ah", with some breath. A big win
// adds light applause, and a short room echo glues it together. Plain math with no browser APIs, so a test
// script can render the very same sound to a file; there is no sound file to ship or license.

type Rand = () => number;

function random(seed: number): Rand {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Formants (Hz) of a teenager's "y" → "e" → "æ" → "a", at fractions of one shout. */
const VOWEL: [number, number[]][] = [
  [0, [300, 2500, 3300]],
  [0.16, [560, 2150, 3050]],
  [0.42, [820, 1750, 2900]],
  [1, [880, 1450, 2800]],
];
const BANDWIDTH = [90, 150, 230];
const FORMANT_GAIN = [1, 0.55, 0.3];

function formantsAt(u: number): number[] {
  let k = 0;
  while (k < VOWEL.length - 2 && u > VOWEL[k + 1][0]) k++;
  const [u0, a] = VOWEL[k];
  const [u1, b] = VOWEL[k + 1];
  const w = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
  const s = w * w * (3 - 2 * w);
  return a.map((f, i) => f + (b[i] - f) * s);
}

/** Band-pass biquad coefficients with 0 dB at the centre: [b0, a1, a2] (b1 = 0, b2 = -b0). */
function bandPass(freq: number, bandwidth: number, rate: number): [number, number, number] {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * (freq / bandwidth));
  const a0 = 1 + alpha;
  return [alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
}

/** Softens the corner of a naive sawtooth so high voices don't alias into a whistle. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function addVoice(out: Float32Array[], rate: number, start: number, length: number, f0: number, gain: number, pan: number, rand: Rand) {
  const n = Math.floor(length * rate);
  const at = Math.floor(start * rate);
  const left = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const right = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  const vibRate = 5 + rand() * 1.5;
  const vibPhase = rand() * 2 * Math.PI;
  const attack = 0.03 + rand() * 0.02;
  let phase = rand();
  let soft = 0;
  const z1 = [0, 0, 0];
  const z2 = [0, 0, 0];
  let coef: [number, number, number][] = [];
  for (let i = 0; i < n && at + i < out[0].length; i++) {
    const t = i / rate;
    const u = i / n;
    if (i % 32 === 0) coef = formantsAt(u).map((f, k) => bandPass(f, BANDWIDTH[k], rate));
    // Up into the shout, then falling away: "yeAH-h".
    const contour = u < 0.15 ? 0.9 + 0.28 * Math.sin((u / 0.15) * (Math.PI / 2)) : 1.18 - 0.4 * ((u - 0.15) / 0.85) ** 1.3;
    const dt = (f0 * contour * (1 + 0.018 * Math.sin(2 * Math.PI * vibRate * t + vibPhase))) / rate;
    phase += dt;
    if (phase >= 1) phase -= 1;
    soft += 0.25 * (2 * phase - 1 - blep(phase, dt) - soft);
    const x = soft + (rand() * 2 - 1) * (0.03 + 0.12 * u * u);
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const [b0, a1, a2] = coef[k];
      const v = b0 * x + z1[k];
      z1[k] = -a1 * v + z2[k];
      z2[k] = -b0 * x - a2 * v;
      y += v * FORMANT_GAIN[k];
    }
    const rise = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const fall = u < 0.5 ? 1 : Math.exp(-10 * (u - 0.5));
    const tail = u > 0.97 ? (1 - u) / 0.03 : 1;
    const env = rise * fall * tail;
    out[0][at + i] += y * env * left;
    out[1][at + i] += y * env * right;
  }
}

function addClap(out: Float32Array[], rate: number, start: number, level: number, rand: Rand) {
  const n = Math.floor(0.05 * rate);
  const at = Math.floor(start * rate);
  const [b0, a1, a2] = bandPass(1000 + rand() * 1200, 900, rate);
  const gain = level * (0.6 + rand() * 0.4);
  const pan = rand() * 1.4 - 0.7;
  const left = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const right = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < n && at + i < out[0].length; i++) {
    const x = (rand() * 2 - 1) * Math.exp(-i / (0.012 * rate));
    const v = b0 * x + z1;
    z1 = -a1 * v + z2;
    z2 = -b0 * x - a2 * v;
    out[0][at + i] += v * left;
    out[1][at + i] += v * right;
  }
}

/** A short, damped room echo (four combs into two all-passes per side), mixed in quietly. */
function addRoom(out: Float32Array[], rate: number) {
  const n = out[0].length;
  const wet = new Float32Array(n);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const line = new Float32Array(Math.round((ms / 1000) * rate));
    let p = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const y = line[p];
      lp += 0.3 * (y - lp);
      line[p] = (out[0][i] + out[1][i]) * 0.5 + lp * 0.72;
      p = (p + 1) % line.length;
      wet[i] += y * 0.25;
    }
  }
  [[5.0, 1.7], [5.3, 1.9]].forEach((delays, c) => {
    let x = wet;
    for (const ms of delays) {
      const line = new Float32Array(Math.round((ms / 1000) * rate));
      const y = new Float32Array(n);
      let p = 0;
      for (let i = 0; i < n; i++) {
        const d = line[p];
        y[i] = d - 0.7 * x[i];
        line[p] = x[i] + 0.7 * y[i];
        p = (p + 1) % line.length;
      }
      x = y;
    }
    for (let i = 0; i < n; i++) out[c][i] += x[i] * 0.22;
  });
}

/** 0: a few got it right · 1: about half · 2: nearly everyone. */
export function cheerLevel(share: number): 0 | 1 | 2 {
  return share >= 0.8 ? 2 : share >= 0.4 ? 1 : 0;
}

/** Renders the cheer as two channels (left, right) of samples in -1..1, peaking at 0.89. */
export function renderCheer(rate: number, level: 0 | 1 | 2, seed: number): Float32Array[] {
  const rand = random(seed);
  const n = Math.ceil(1.7 * rate);
  const out = [new Float32Array(n), new Float32Array(n)];
  const voices = [3, 8, 14][level];
  for (let v = 0; v < voices; v++) {
    // Mixed middle-school voices, pitched up by shouting; a couple of them come in late.
    const f0 = (rand() < 0.4 ? 170 + rand() * 60 : 250 + rand() * 130) * 1.15;
    const start = v > 1 && rand() < 0.2 ? 0.14 + rand() * 0.1 : rand() * 0.12;
    addVoice(out, rate, start, 0.55 + rand() * 0.3, f0, 0.6 + rand() * 0.4, rand() * 1.4 - 0.7, rand);
  }
  // Applause under the shout, thinning out as it ends.
  if (level === 2) {
    for (let k = 0; k < 60; k++) {
      const w = rand();
      addClap(out, rate, 0.2 + w * 1.0, 0.12 * (1 - 0.7 * w), rand);
    }
  }
  addRoom(out, rate);
  let peak = 0;
  for (const ch of out) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const scale = peak > 0 ? 0.89 / peak : 0;
  for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= scale;
  return out;
}

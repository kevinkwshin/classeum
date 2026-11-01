// 받아쓰기: a sentence made into a sound file with the laptop's own English voice, for the teacher screen's
// [▶ 읽어 주기]. The browser's speech reads too fast for dictation even at its slowest clear rate, and its volume
// stops at the voice's own; a file can be slowed by the voice itself and made louder. macOS's `say` reads it, on this
// laptop, so the sentence never leaves it; anywhere else there is no file and the browser's speech reads it.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { englishVoice } from '@/lib/voices';

const run = promisify(execFile);

/** `say`'s words a minute: a dictation pace. Samantha's usual is about 180, and about 50 is as slow as she goes. */
const WPM = 60;
/** Speech this much louder before the limiter holds its peaks at -1 dBFS: about 5 dB louder words in all. */
const DRIVE_DB = 4;
/** The longest sentence read: a 받아쓰기 sentence is at most 200 characters. */
export const SPEECH_MAX = 300;

const g = globalThis as unknown as { __classeumSayVoice?: Promise<string | null>; __classeumSpeech?: Map<string, Promise<Buffer | null>> };

/** `say`'s clearest English voice on this Mac (`say -v ?` lists "Name   en_US   # Hello! …"). */
function sayVoice(): Promise<string | null> {
  g.__classeumSayVoice ??= run('say', ['-v', '?'])
    .then(({ stdout }) => {
      const voices = stdout.split('\n').flatMap((line) => {
        const m = line.match(/^(.+?)\s{2,}([a-z]{2,3}[_-]\w+)\s+#/);
        return m ? [{ name: m[1].trim(), lang: m[2] }] : [];
      });
      return englishVoice(voices)?.name ?? null;
    })
    .catch(() => null);
  return g.__classeumSayVoice;
}

/** Whether this laptop makes the sound files: a Mac with an English voice of its own. */
export async function speechAvailable(): Promise<boolean> {
  return process.platform === 'darwin' && !!(await sayVoice());
}

/** The sentence as a WAV file (mono, 16-bit), or null where it can't be made. Kept for the lesson's next readings. */
export function speechFile(text: string): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  // `say` takes [[…]] in its text as commands (silence, volume …), never wanted from a sentence.
  const sentence = text.replace(/\[\[|\]\]/g, ' ').replace(/\s+/g, ' ').trim();
  const files = (g.__classeumSpeech ??= new Map<string, Promise<Buffer | null>>());
  let file = files.get(sentence);
  if (!file) {
    file = makeFile(sentence);
    files.set(sentence, file);
    void file.then((wav) => wav || files.delete(sentence));
    if (files.size > 50) files.delete(files.keys().next().value as string);
  }
  return file;
}

async function makeFile(sentence: string): Promise<Buffer | null> {
  const voice = await sayVoice();
  if (!voice || !sentence) return null;
  const dir = await mkdtemp(join(tmpdir(), 'classeum-say-'));
  try {
    // From a file, so a sentence starting with "-" is never taken for an option.
    await writeFile(join(dir, 'sentence.txt'), sentence);
    const out = join(dir, 'speech.wav');
    await run('say', ['-v', voice, '-r', String(WPM), '--file-format=WAVE', '--data-format=LEI16@22050', '-o', out, '-f', join(dir, 'sentence.txt')], { timeout: 20_000 });
    return louder(await readFile(out));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Speech as loud as it can be without clipping or sounding pumped: a gentle compressor first brings the words to one
 * level, then the whole is raised by DRIVE_DB while a limiter with a short lookahead eases each peak down to -1 dBFS
 * (no clicks) and lets go over 50 ms. Only mono 16-bit PCM, as `say` is asked for; anything else comes back as it was.
 */
function louder(wav: Buffer): Buffer {
  let at = 12;
  let rate = 0;
  let data: Buffer | null = null;
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ' && (wav.readUInt16LE(at + 8) !== 1 || wav.readUInt16LE(at + 10) !== 1 || wav.readUInt16LE(at + 22) !== 16)) return wav;
    if (id === 'fmt ') rate = wav.readUInt32LE(at + 12);
    if (id === 'data') data = wav.subarray(at + 8, Math.min(wav.length, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  if (!data || !rate) return wav;
  const n = data.length >> 1;
  const x = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    x[i] = data.readInt16LE(i * 2) / 32768;
    peak = Math.max(peak, Math.abs(x[i]));
  }
  if (peak === 0) return wav;

  // The compressor: 3:1 above 20 dB under the loudest peak, on an envelope that sees 4 ms ahead.
  const ahead = Math.round(rate * 0.004);
  const attack = Math.exp(-1 / (rate * 0.002));
  const release = Math.exp(-1 / (rate * 0.12));
  let env = 0;
  let top = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[Math.min(n - 1, i + ahead)]) / peak;
    env = a > env ? attack * env + (1 - attack) * a : release * env + (1 - release) * a;
    const over = 20 * Math.log10(env + 1e-9) + 20;
    x[i] = (x[i] / peak) * (over > 0 ? 10 ** ((-over * (2 / 3)) / 20) : 1);
    top = Math.max(top, Math.abs(x[i]));
  }

  // The limiter: what each sample needs to stay under the ceiling, the least of it over the next 2.5 ms, eased in.
  const ceiling = 10 ** (-1 / 20);
  const drive = (10 ** (DRIVE_DB / 20) * ceiling) / top;
  const span = Math.round(rate * 0.0025);
  const letGo = Math.exp(-1 / (rate * 0.05));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = Math.min(1, ceiling / (Math.abs(x[i] * drive) + 1e-12));
  const out = Buffer.alloc(44 + n * 2);
  let gain = 1;
  for (let i = 0; i < n; i++) {
    let least = 1;
    for (let j = i; j < Math.min(n, i + span); j++) least = Math.min(least, need[j]);
    gain = least < gain ? gain + (least - gain) / Math.max(1, span / 2) : letGo * gain + (1 - letGo) * least;
    gain = Math.min(gain, need[i]);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * drive * gain * 32767))), 44 + i * 2);
  }
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * 2, 40);
  return out;
}

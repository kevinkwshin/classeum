'use client';
// 받아쓰기: the teacher screen reads a sentence aloud with the laptop's own English voice. On a Mac the server makes it
// into a sound file with that voice (/api/speech), slower and louder than the browser's speech can read (its volume
// stops at the voice's own), and this window plays it; anywhere else, or if that fails, the browser's speech reads
// it. Only a voice on the laptop itself is used either way, so the sentence never leaves it, as nothing else of a class
// does; a laptop without one leaves the reading to the teacher. It reads from the window whose button was pressed,
// which the browser lets play because the press is the teacher's own.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { englishVoice } from '@/lib/voices';

/** The browser's speech, when it reads: slow, since the class is listening for every word. */
const RATE = 0.6;

/** The laptop's own English voice for the browser's speech. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return englishVoice(window.speechSynthesis.getVoices().filter((v) => v.localService));
}

/** Whether the laptop has an English voice of its own; null while the browser is still listing its voices. */
function voiceSnapshot(): boolean | null {
  if (!('speechSynthesis' in window)) return false;
  if (pickVoice()) return true;
  return window.speechSynthesis.getVoices().length === 0 ? null : false;
}

/** Chrome lists its voices a moment after the page loads, and says so. */
function subscribeVoices(onChange: () => void): () => void {
  if (!('speechSynthesis' in window)) return () => undefined;
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
}

let ctx: AudioContext | null = null;
/** This window's audio for the sound files, made (or woken) inside the teacher's press. */
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  ctx ??= new AudioContext();
  void ctx.resume();
  return ctx;
}

/** False once the server has said it can't make sound files (not a Mac): the browser reads from then on. */
let filesMade = true;
/** The sound files fetched so far, by sentence: a lesson's few, so a second reading starts at once. */
const files = new Map<string, Promise<ArrayBuffer | null>>();
function soundFile(text: string): Promise<ArrayBuffer | null> {
  if (!filesMade) return Promise.resolve(null);
  let file = files.get(text);
  if (!file) {
    file = fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((res) => {
        if (res.status === 501) filesMade = false;
        return res.ok ? res.arrayBuffer() : null;
      })
      .catch(() => null);
    files.set(text, file);
    // A failed one is asked for again next time.
    void file.then((data) => data || files.delete(text));
    if (files.size > 20) files.delete(files.keys().next().value as string);
  }
  return file;
}

/** Makes a sentence's sound file before its first reading (the console, when a 받아쓰기 topic comes up). */
export function prepareSpeech(text: string) {
  if (text.trim()) void soundFile(text);
}

/** One reading: stops whichever way it is being read. */
type Reading = { stop: () => void };

/**
 * Reads a sentence once (pressed again, it starts over), says whether it is reading, and stops on `stop` or when the
 * screen goes. `canSpeak` is null while the browser is still listing its voices, then whether the laptop has an
 * English voice of its own. `onSpeaking` hears each start and end, for the projector and the phones.
 */
export function useSpeech(onSpeaking?: (speaking: boolean) => void) {
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = useSyncExternalStore(subscribeVoices, voiceSnapshot, () => null);
  const notify = useRef(onSpeaking);
  useEffect(() => {
    notify.current = onSpeaking;
  }, [onSpeaking]);
  // The reading going on now: one cut short by a new one ends later, and must not end the new one.
  const current = useRef<Reading | null>(null);
  useEffect(
    () => () => {
      current.current?.stop();
      current.current = null;
    },
    [],
  );
  const finish = useCallback((r: Reading | null) => {
    if (!r || current.current !== r) return;
    current.current = null;
    setSpeaking(false);
    notify.current?.(false);
  }, []);
  const speak = useCallback(
    (text: string) => {
      current.current?.stop();
      const sound = audio();
      const r: Reading = { stop: () => undefined };
      current.current = r;
      setSpeaking(true);
      notify.current?.(true);
      void soundFile(text)
        .then((data) => (data && sound ? sound.decodeAudioData(data.slice(0)) : null))
        .catch(() => null)
        .then((buffer) => {
          if (current.current !== r) return; // stopped, or another reading began, while the file came
          if (buffer && sound) {
            const source = sound.createBufferSource();
            source.buffer = buffer;
            source.connect(sound.destination);
            source.onended = () => finish(r);
            r.stop = () => source.stop();
            source.start();
            return;
          }
          const voice = pickVoice();
          if (!voice) return finish(r);
          const synth = window.speechSynthesis;
          const u = new SpeechSynthesisUtterance(text);
          u.voice = voice;
          u.lang = voice.lang;
          u.rate = RATE;
          u.onend = () => finish(r);
          u.onerror = () => finish(r);
          r.stop = () => synth.cancel();
          synth.cancel();
          synth.speak(u);
        });
    },
    [finish],
  );
  const stop = useCallback(() => {
    const r = current.current;
    r?.stop();
    finish(r);
  }, [finish]);
  return { speak, stop, speaking, canSpeak };
}

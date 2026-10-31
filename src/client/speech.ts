'use client';
// 받아쓰기: the teacher screen reads a sentence aloud with the laptop's own English voice. Only a voice on the laptop
// itself (localService) is used, so the sentence never leaves it, as nothing else of a class does; a laptop without
// one leaves the reading to the teacher. It reads from the window whose button was pressed, which the browser lets
// speak because the press is the teacher's own.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** A little slower than speech: the class is listening for every word. */
const RATE = 0.85;

/** macOS's joke and singing voices (Bubbles, Bad News, Cellos …): never for dictation. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Princess)\b/i;
/** macOS's older, robotic voices: only when there is nothing clearer. */
const ROBOTIC = /^(Fred|Junior|Ralph|Kathy|Bruce|Agnes|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
/** Clear voices that come with a laptop, best first: macOS's, then Windows'. */
const CLEAR = ['Samantha', 'Alex', 'Ava', 'Allison', 'Susan', 'Tom', 'Aaron', 'Nicky', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Microsoft David', 'Microsoft Mark'];

/** The laptop's own English voice: a clear one by name, else American, else any English, a robotic one last. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const rank = (v: SpeechSynthesisVoice) => {
    const clear = CLEAR.findIndex((name) => v.name.startsWith(name));
    if (clear >= 0) return clear;
    return CLEAR.length + (ROBOTIC.test(v.name) ? 2 : /^en[-_]US/i.test(v.lang) ? 0 : 1);
  };
  const voices = window.speechSynthesis.getVoices().filter((v) => v.localService && /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  return voices.sort((a, b) => rank(a) - rank(b))[0] ?? null;
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
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  // The reading going on now: one cut short by a new one ends later, and must not end the new one.
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const finish = useCallback((u: SpeechSynthesisUtterance | null) => {
    if (!u || current.current !== u) return;
    current.current = null;
    setSpeaking(false);
    notify.current?.(false);
  }, []);
  const speak = useCallback(
    (text: string) => {
      const voice = pickVoice();
      if (!voice) return;
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = RATE;
      u.onend = () => finish(u);
      u.onerror = () => finish(u);
      current.current = u;
      synth.cancel();
      setSpeaking(true);
      notify.current?.(true);
      synth.speak(u);
    },
    [finish],
  );
  const stop = useCallback(() => {
    const u = current.current;
    window.speechSynthesis?.cancel();
    finish(u);
  }, [finish]);
  return { speak, stop, speaking, canSpeak };
}

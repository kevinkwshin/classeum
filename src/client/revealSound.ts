'use client';
// When the sounds play, and from which window. The projector plays them once it has been clicked; until then, or
// with no projector window open, the teacher screen on the same laptop plays them, so a class never goes silent
// because nobody clicked the projector. The two windows talk over a BroadcastChannel (same laptop only).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase, RevealInfo } from '@/lib/types';
import { TICK_LEAD_MS, TICK_PRE_MS, TICK_STEP_MS, playCheer, playCrickets, playTickTock, setMusic, unlockAudio } from './sound';

const CHANNEL = 'classeum-sound';
// One function for every render: a fresh `() => true` default would re-run the sound effects on each re-render
// (the projector re-renders five times a second during a question), restarting timers and dropping sounds.
const always = () => true;

/** Turns audio on at the first click or key press in this window (browsers allow nothing earlier). */
export function useAudioUnlock(onChange?: (on: boolean) => void) {
  useEffect(() => {
    const unlock = () => void unlockAudio().then((on) => onChange?.(on));
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [onChange]);
}

/** The projector, once its audio is on, tells the teacher screen every 2 s (and at once when asked) that it plays the sounds. */
export function useProjectorAudioBeacon(active: boolean) {
  useEffect(() => {
    if (!active || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    const send = () => channel.postMessage({ projectorAudio: true });
    channel.onmessage = (e: MessageEvent<{ ask?: boolean }>) => e.data?.ask && send();
    send();
    const timer = setInterval(send, 2000);
    return () => {
      clearInterval(timer);
      channel.close();
    };
  }, [active]);
}

/**
 * For the teacher page, kept for its whole life: whether this tab should play the sounds. Not while a projector
 * window on this laptop says it plays them (in the last 5 s; a new tab asks it at once), and not when another teacher
 * tab was clicked more recently, so a tab left open from an earlier period stays quiet. `now()` asks at the moment a
 * sound is due; `on` follows it for the music, from half a second after the page opens so the projector can answer.
 */
export function useTeacherPlaysSound(): { now: () => boolean; on: boolean } {
  const lastBeacon = useRef(0);
  const owner = useRef(true);
  const [on, setOn] = useState(false);
  const now = useCallback(() => owner.current && Date.now() - lastBeacon.current >= 5000, []);
  useEffect(() => {
    const id = Math.random().toString(36).slice(2);
    const opened = Date.now();
    const update = () => setOn(now() && Date.now() - opened >= 500);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    if (channel) {
      channel.onmessage = (e: MessageEvent<{ projectorAudio?: boolean; teacherAudio?: string }>) => {
        if (e.data?.projectorAudio) lastBeacon.current = Date.now();
        else if (e.data?.teacherAudio && e.data.teacherAudio !== id) owner.current = false;
        update();
      };
      channel.postMessage({ ask: true });
    }
    const claim = () => {
      owner.current = true;
      channel?.postMessage({ teacherAudio: id });
      update();
    };
    window.addEventListener('pointerdown', claim);
    window.addEventListener('keydown', claim);
    const timer = setInterval(update, 500);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', claim);
      window.removeEventListener('keydown', claim);
      channel?.close();
    };
  }, [now]);
  return { now, on };
}

/** The music plays in the lobby and on the results, not over the questions, and stops while the projector is covered. */
export const musicTime = (phase: Phase | undefined, blank: boolean | undefined) => (phase === 'lobby' || phase === 'summary') && !blank;

/** Background music, looping softly while `on` and fading out when it turns off. */
export function useBackgroundMusic(on: boolean) {
  useEffect(() => {
    if (!on) return;
    setMusic(true);
    return () => setMusic(false);
  }, [on]);
}

/**
 * Once per question, when the fog lifts: "Yeah!" if someone got it right, and crickets after a beat if students took
 * part and nobody did (not when the room is empty, e.g. the teacher trying it alone). `canPlay` is asked at that
 * moment, so a window can step aside for another one.
 */
export function useRevealSound(seq: number, reveal: RevealInfo | null, on: boolean, canPlay: () => boolean = always) {
  const played = useRef(-1);
  const share = reveal?.accuracy ?? 0;
  const nobody = !!reveal && share === 0 && reveal.avatars.length > 0;
  useEffect(() => {
    if (!on || (share <= 0 && !nobody) || played.current === seq || !canPlay()) return;
    played.current = seq;
    const t = share > 0 ? setTimeout(() => playCheer(share), 250) : setTimeout(playCrickets, 700);
    return () => clearTimeout(t);
  }, [seq, share, nobody, on, canPlay]);
}

/**
 * The tick-tock over the last three seconds of a question, timed from the server's deadline (`endsAt`, null when the
 * question isn't running), so it lands on the projector's clock. It stops when the question closes early or pauses,
 * starts over when +5초 moves the deadline, and picks up midway after a resume with less than 3 s left.
 */
export function useCountdownTick(endsAt: number | null, serverNow: () => number, on: boolean, canPlay: () => boolean = always) {
  useEffect(() => {
    if (!on || endsAt === null) return;
    const begin = endsAt - TICK_LEAD_MS;
    let stop: (() => void) | undefined;
    const t = setTimeout(() => {
      if (!canPlay()) return;
      // Start where the clock is, but never inside a hit: up to 0.1 s past one (a resume gives exactly 3 s, and the
      // view takes a few ms to arrive), play that hit from its start instead.
      const late = Math.max(0, serverNow() - begin);
      const into = (late - TICK_PRE_MS) % TICK_STEP_MS;
      stop = playTickTock((into >= 0 && into < 100 ? late - into - TICK_PRE_MS : late) / 1000);
    }, Math.max(0, begin - serverNow()));
    // The teacher screen steps aside mid-countdown if the projector is clicked then.
    const poll = setInterval(() => {
      if (stop && !canPlay()) {
        stop();
        stop = undefined;
      }
    }, 250);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      stop?.();
    };
  }, [endsAt, serverNow, on, canPlay]);
}

/** Ticking [효과음] back on plays one cheer, so the teacher hears how loud it is. */
export function useSoundPreview(on: boolean, canPlay: () => boolean = always) {
  const was = useRef(on);
  useEffect(() => {
    // A moment later, so a click on the checkbox itself has turned audio on first.
    const t = on && !was.current && canPlay() ? setTimeout(() => playCheer(1), 150) : undefined;
    was.current = on;
    return () => clearTimeout(t);
  }, [on, canPlay]);
}

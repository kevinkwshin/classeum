'use client';
// When the reveal sounds play, and from which window. The projector plays them once it has been clicked; until
// then, or with no projector window open, the teacher screen on the same laptop plays them, so a class never goes
// silent because nobody clicked the projector. The two windows talk over a BroadcastChannel (same laptop only).
import { useCallback, useEffect, useRef } from 'react';
import type { RevealInfo } from '@/lib/types';
import { playCheer, playCrickets, unlockAudio } from './sound';

const CHANNEL = 'classeum-sound';

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

/** The projector, while its sound is on, tells the teacher screen every 2 s that it is playing the sounds. */
export function useProjectorAudioBeacon(active: boolean) {
  useEffect(() => {
    if (!active || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    const send = () => channel.postMessage({ projectorAudio: true });
    send();
    const timer = setInterval(send, 2000);
    return () => {
      clearInterval(timer);
      channel.close();
    };
  }, [active]);
}

/** Whether a projector window on this laptop has said in the last 5 s that it plays the sounds. */
export function useProjectorPlaysSound(): () => boolean {
  const last = useRef(0);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<{ projectorAudio?: boolean }>) => {
      if (e.data?.projectorAudio) last.current = Date.now();
    };
    return () => channel.close();
  }, []);
  return useCallback(() => Date.now() - last.current < 5000, []);
}

/**
 * Once per question, when the fog lifts: "Yeah!" if someone got it right, and crickets after a beat if students took
 * part and nobody did (not when the room is empty, e.g. the teacher trying it alone). `canPlay` is asked at that
 * moment, so a window can step aside for another one.
 */
export function useRevealSound(seq: number, reveal: RevealInfo | null, on: boolean, canPlay: () => boolean = () => true) {
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

/** Ticking [효과음] back on plays one cheer, so the teacher hears how loud it is. */
export function useSoundPreview(on: boolean, canPlay: () => boolean = () => true) {
  const was = useRef(on);
  useEffect(() => {
    // A moment later, so a click on the checkbox itself has turned audio on first.
    const t = on && !was.current && canPlay() ? setTimeout(() => playCheer(1), 150) : undefined;
    was.current = on;
    return () => clearTimeout(t);
  }, [on, canPlay]);
}

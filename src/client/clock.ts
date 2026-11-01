'use client';
// The time of day on the projector and the teacher screen: the laptop's own clock as '오후 2:35', changing on the
// minute. One timer serves every clock on the page, and it stops when none is shown.
import { useSyncExternalStore } from 'react';

const format = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const listeners = new Set<() => void>();
let shown = '';
let timer: ReturnType<typeof setTimeout> | null = null;

function tick() {
  shown = format.format(new Date());
  for (const listener of listeners) listener();
  // Just past the next minute, so it turns with the laptop's clock.
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) tick();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** '오후 2:35', or '' on the server and before the first tick. */
export function useClock(): string {
  return useSyncExternalStore(subscribe, () => shown, () => '');
}

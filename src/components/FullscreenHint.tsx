'use client';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    window.removeEventListener('resize', onChange);
  };
}

// The browser's own full screen (the green button, F11) fills the screen without document.fullscreenElement.
const isFull = () => !!document.fullscreenElement || (window.innerWidth >= screen.width && window.innerHeight >= screen.height);

/** A small reminder on the projector's waiting screens until the window is full screen. */
export function FullscreenHint() {
  const full = useSyncExternalStore(subscribe, isFull, () => true);
  if (full) return null;
  return <div className="absolute bottom-3 left-4 z-50 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-ink-3">클릭하고 F · 전체 화면</div>;
}

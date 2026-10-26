'use client';

const NAME = 'classeum-display';

/**
 * Opens the projector screen in its own window (not a tab), so it can be dragged to the projector and made full
 * screen. Call it straight from a click, before any await: Safari blocks a window opened later. An open projector
 * window is only brought forward, not reloaded, so it stays full screen. False when the browser blocked it.
 */
export function openProjector(): boolean {
  const w = window.open('', NAME, 'popup,width=1280,height=720');
  if (!w) return false;
  try {
    if (!w.location.pathname.startsWith('/display')) w.location.href = '/display';
  } catch {
    w.location.href = '/display';
  }
  w.focus();
  return true;
}

/** A link to the projector screen that opens it as a window; if the browser blocks that, the link opens it as a tab. */
export function ProjectorLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <a
      href="/display"
      target={NAME}
      onClick={(e) => {
        if (openProjector()) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </a>
  );
}

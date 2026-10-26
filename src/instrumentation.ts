// Prints the teacher link once at startup; `npm run class` also opens it in the laptop's browser.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // The build loaded, so a stop from here on (a refused store, Ctrl+C, a relaunch) isn't one that --forget
  // should treat as a broken build (scripts/build-if-changed.mjs).
  const { rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  try {
    rmSync(join(process.cwd(), '.next', 'classeum-started'), { force: true });
  } catch {
    // Not written by next dev; nothing to clear.
  }
  const { openStore } = await import('./server/store');
  await openStore();
  const { teacherKey } = await import('./server/auth');
  const port = process.env.PORT || '3000';
  const url = `http://localhost:${port}/api/teacher/login?key=${teacherKey()}`;
  console.log(`\n  Classeum 선생님 링크 (이 노트북에서만, 남에게 보여 주지 마세요): ${url}\n`);
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build' || process.env.CLASSEUM_NO_OPEN) return;
  const { openInBrowser } = await import('./server/launch');
  openInBrowser(url);
}

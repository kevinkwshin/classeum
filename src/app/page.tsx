'use client';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

const noop = () => () => undefined;
function isLocal() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export default function Home() {
  const local = useSyncExternalStore(noop, isLocal, () => null);

  useEffect(() => {
    // Phones that open the bare address go straight to the student screen.
    if (local === false) window.location.replace('/play');
  }, [local]);

  if (!local) return null;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <h1 className="font-display text-6xl font-bold tracking-tight">Classeum</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/teacher" className="rounded-2xl bg-ink p-6 text-white hover:opacity-90">
          <div className="text-sm font-semibold text-white/60">노트북</div>
          <div className="mt-2 text-2xl font-bold">선생님</div>
        </Link>
        <a href="/display" target="classeum-display" className="rounded-2xl bg-surface p-6 hover:bg-white/70">
          <div className="text-sm font-semibold text-ink-3">프로젝터</div>
          <div className="mt-2 text-2xl font-bold">큰 화면</div>
        </a>
        <a href="/play?slot=1" target="_blank" className="rounded-2xl bg-surface p-6 hover:bg-white/70">
          <div className="text-sm font-semibold text-ink-3">시험용</div>
          <div className="mt-2 text-2xl font-bold">학생 폰</div>
        </a>
      </div>
    </main>
  );
}

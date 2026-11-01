'use client';
import { useEffect, useState } from 'react';

type Me = { ok: boolean; local: boolean; denied?: boolean; port: string };

/**
 * Shows the teacher and projector screens only to the browser holding the teacher cookie. A check that doesn't come
 * back (the server is still starting, or restarting) isn't a refusal: it says it is connecting and asks again.
 */
export function TeacherGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let stop = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    // /api/teacher/login sends a wrong key here with ?denied=1.
    const denied = new URLSearchParams(window.location.search).has('denied');
    fetch('/api/teacher/me')
      .then((r) => (r.ok ? (r.json() as Promise<Omit<Me, 'port'>>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        if (!stop) setMe({ ...m, denied, port: window.location.port });
      })
      .catch(() => {
        if (!stop) again = setTimeout(() => setTries((n) => n + 1), 2000);
      });
    return () => {
      stop = true;
      clearTimeout(again);
    };
  }, [tries]);
  if (!me) return <main className="flex min-h-screen items-center justify-center bg-bg text-ink-3">{tries > 0 ? '서버에 연결하는 중… 서버 창이 켜져 있는지 확인해 주세요' : '연결 중…'}</main>;
  if (me.ok) return <>{children}</>;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
      <div className="text-2xl font-bold">선생님 화면이에요</div>
      <div className="max-w-md text-ink-3">
        {me.local && me.denied
          ? '이 노트북의 선생님 링크가 아니에요 · 이 노트북에서 켠 터미널의 링크를 쓰세요'
          : me.local
            ? '서버를 켠 터미널에 나온 “선생님 링크”를 이 브라우저에서 열어 주세요. (npm run class는 처음에 저절로 열어 줘요)'
            : `노트북에서 http://localhost:${me.port || '3000'}/teacher 로 열어 주세요.`}
      </div>
    </main>
  );
}

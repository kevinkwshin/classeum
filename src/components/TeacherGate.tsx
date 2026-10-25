'use client';
import { useEffect, useState } from 'react';

type Me = { ok: boolean; local: boolean };

/** Shows the teacher and projector screens only to the browser holding the teacher cookie. */
export function TeacherGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let stop = false;
    fetch('/api/teacher/me')
      .then((r) => r.json() as Promise<Me>)
      .then((m) => {
        if (!stop) setMe(m);
      })
      .catch(() => !stop && setMe({ ok: false, local: false }));
    return () => {
      stop = true;
    };
  }, []);
  if (!me) return <main className="flex min-h-screen items-center justify-center bg-bg text-ink-3">연결 중…</main>;
  if (me.ok) return <>{children}</>;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
      <div className="text-2xl font-bold">선생님 화면이에요</div>
      <div className="max-w-md text-ink-3">
        {me.local
          ? '서버를 켠 터미널에 나온 “선생님 링크”를 이 브라우저에서 열어 주세요. (npm run class는 처음에 저절로 열어 줘요)'
          : '노트북에서 http://localhost:3000/teacher 로 열어 주세요.'}
      </div>
    </main>
  );
}

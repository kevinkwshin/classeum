'use client';
// Client side of the realtime transport. The prototype uses SSE + fetch; a Supabase
// version would keep this hook's signature and swap the internals.
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnState = 'connecting' | 'open' | 'lost';

export function useLive<T extends { serverNow: number }>(role: 'teacher' | 'display' | 'student', token?: string | null) {
  const [view, setView] = useState<T | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const offset = useRef(0);
  // A late message makes serverNow - Date.now() look smaller, so the largest recent sample is the truest.
  const best = useRef({ v: -Infinity, at: 0 });

  useEffect(() => {
    if (role === 'student' && !token) return;
    const qs = new URLSearchParams({ role });
    if (token) qs.set('token', token);
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const open = () => {
      best.current = { v: -Infinity, at: 0 };
      es = new EventSource(`/api/stream?${qs}`);
      es.onopen = () => setConn('open');
      es.onerror = () => {
        setConn('lost');
        // EventSource gives up for good after a non-200 response or a dropped server; start over.
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          retry = setTimeout(open, 2000);
        }
      };
      // Another tab on this phone took over. Stay closed while hidden, so tabs don't keep bumping each other.
      es.addEventListener('replaced', () => {
        es?.close();
        setConn('lost');
        if (!stopped && document.visibilityState === 'visible') retry = setTimeout(open, 2000);
      });
      es.onmessage = (e) => {
        const data = JSON.parse(e.data) as T;
        const now = Date.now();
        const sample = data.serverNow - now;
        if (sample > best.current.v || now - best.current.at > 10000) best.current = { v: sample, at: now };
        offset.current = best.current.v;
        setConn('open');
        setView(data);
      };
    };
    open();
    // Phones that come back from a locked screen or another tab reconnect straight away.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && es?.readyState !== EventSource.OPEN) {
        if (retry) clearTimeout(retry);
        es?.close();
        open();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      es?.close();
    };
  }, [role, token]);

  const send = useCallback(
    async (action: Record<string, unknown>) => {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { ...action, token } : action),
      });
      const json = (await res.json().catch(() => ({ ok: false, error: '연결이 불안정해요.' }))) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '문제가 생겼어요.');
      return json;
    },
    [token],
  );

  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { view, conn, send, serverNow };
}

/**
 * Projector and teacher shortcuts by physical key (e.code), so S and B work with the
 * Korean input source on too.
 */
export function shortcutAction(code: string, paused: boolean): string | undefined {
  const map: Record<string, string> = {
    Space: paused ? 'resume' : 'pause',
    Enter: 'close-now',
    NumpadEnter: 'close-now',
    ArrowUp: 'add-time',
    KeyS: 'skip',
    ArrowRight: 'next',
    KeyB: 'blank',
  };
  return map[code];
}

/** Re-renders every `ms` while active, for countdowns. */
export function useTicker(active: boolean, ms = 200) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function remainingMs(endsAt: number | null | undefined, paused: boolean, pausedRemaining: number | null | undefined, now: number) {
  if (paused) return pausedRemaining ?? 0;
  if (!endsAt) return 0;
  return Math.max(0, endsAt - now);
}

export function formatClock(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

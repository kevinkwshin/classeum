'use client';
// Client side of the realtime transport: one SSE stream per screen carries its view, and actions go up as
// fetch POSTs. School Wi-Fi drops connections without telling anyone, so the stream is watched (the server
// pings every 10 s), phones beat so the server can tell when one has gone, and phone requests time out.
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnState = 'connecting' | 'open' | 'lost';

/** While a page is looked at, this long without a view or a ping means the stream died without an error. */
const STALE_MS = 25_000;
/** Coming back to the page, a ping missed while away is enough: reconnect at once rather than show old news. */
const STALE_ON_RETURN_MS = 12_000;
/** Phones beat this often while looked at; the server ends a beating phone's stream after 40 s of silence. */
const BEAT_MS = 15_000;
/** A request stuck on a dead connection would never fail, so a caller's retry would never run. */
export const SEND_TIMEOUT_MS = 5_000;

export function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  // Safari before 16 and Chrome before 103.
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function postAction(body: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutMs ? timeoutSignal(timeoutMs) : undefined,
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    // Offline, timed out, or a reply that isn't ours (cut short, or an error page).
    return { ok: false, error: '연결이 불안정해요.' };
  }
}

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
    // Names the current stream in heartbeats, so they keep only this one alive on the server.
    let streamId = '';
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    // When the stream last said anything (a view or a ping), or was opened.
    let heardAt = 0;
    const visible = () => document.visibilityState === 'visible';
    const heard = (serverNow: number) => {
      const now = Date.now();
      heardAt = now;
      const sample = serverNow - now;
      if (Number.isFinite(sample) && (sample > best.current.v || now - best.current.at > 10000)) best.current = { v: sample, at: now };
      if (best.current.v > -Infinity) offset.current = best.current.v;
      setConn('open');
    };
    // Tells the server this phone is still looked at; streams that have beaten and then go quiet are ended there.
    const beat = () => {
      if (role === 'student' && token && es?.readyState === EventSource.OPEN) void postAction({ type: 'hb', token, s: streamId }, SEND_TIMEOUT_MS);
    };
    const open = () => {
      if (retry) clearTimeout(retry);
      retry = null;
      es?.close();
      best.current = { v: -Infinity, at: 0 };
      heardAt = Date.now();
      streamId = Math.random().toString(36).slice(2, 10);
      if (role === 'student') qs.set('s', streamId);
      const s = new EventSource(`/api/stream?${qs}`);
      es = s;
      // A closed stream shouldn't fire again, but if one does it must not undo its replacement.
      const current = () => s === es && !stopped;
      s.onopen = () => {
        if (!current()) return;
        heardAt = Date.now();
        setConn('open');
        // The server only times out streams that have beaten, so start right away.
        if (visible()) beat();
      };
      s.onerror = () => {
        if (!current()) return;
        setConn('lost');
        // EventSource gives up for good after a non-200 response or a dropped server; start over.
        if (s.readyState === EventSource.CLOSED) {
          s.close();
          retry = setTimeout(open, 2000);
        }
      };
      // Another tab on this phone took over, or the server stopped hearing this one. Stay closed while hidden,
      // so tabs don't keep bumping each other and a phone in a pocket stays quiet.
      s.addEventListener('replaced', () => {
        if (!current()) return;
        s.close();
        setConn('lost');
        if (visible()) retry = setTimeout(open, 2000);
      });
      s.addEventListener('ping', (e) => current() && heard(Number((e as MessageEvent<string>).data)));
      s.onmessage = (e) => {
        if (!current()) return;
        const data = JSON.parse(e.data) as T;
        heard(data.serverNow);
        setView(data);
      };
    };
    open();
    // A roamed or blinked Wi-Fi can leave the socket dead while EventSource still says OPEN (or CONNECTING).
    const watchdog = setInterval(() => {
      if (!stopped && visible() && es && es.readyState !== EventSource.CLOSED && Date.now() - heardAt > STALE_MS) {
        setConn('lost');
        open();
      }
    }, 5000);
    const beats = role === 'student' ? setInterval(() => visible() && beat(), BEAT_MS) : null;
    // Phones that come back from a locked screen or another tab reconnect straight away, unless the stream is plainly alive.
    const onVisible = () => {
      if (stopped || !visible()) return;
      if (es?.readyState !== EventSource.OPEN || Date.now() - heardAt > STALE_ON_RETURN_MS) open();
      else beat();
    };
    const onOnline = () => {
      if (!stopped && visible()) open();
    };
    const onOffline = () => setConn('lost');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      clearInterval(watchdog);
      if (beats) clearInterval(beats);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      es?.close();
    };
  }, [role, token]);

  const send = useCallback(
    async (action: Record<string, unknown>) => {
      // Only phones time out: the laptop's own screens talk to itself, and a slow teacher action that looked
      // failed could be clicked twice.
      const json = await postAction(token ? { ...action, token } : action, role === 'student' ? SEND_TIMEOUT_MS : 0);
      if (!json.ok) throw new Error(json.error ?? '문제가 생겼어요.');
      return json;
    },
    [role, token],
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

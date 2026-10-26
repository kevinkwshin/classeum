import type { NextRequest } from 'next/server';
import { hashToken, hub, type Client, type Role } from '@/server/hub';
import { isTeacher } from '@/server/auth';

// Server-Sent Events: one long-lived response per screen, carrying that screen's view.
export async function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get('role') as Role | null;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (role !== 'teacher' && role !== 'display' && role !== 'student') return new Response('bad role', { status: 400 });
  if (role !== 'student' && !isTeacher(request)) {
    return new Response('선생님 화면과 큰 화면은 노트북에서 선생님 링크로 열어 주세요.', { status: 403 });
  }
  if (role === 'student' && token.length < 32) return new Response('missing token', { status: 400 });

  const h = hub();
  if (role === 'student') {
    const refused = h.admitStudent(hashToken(token));
    if (refused) {
      // EventSource can't read a non-200 body, so send the reason as one event; the browser waits 30 s before trying again.
      const body = `retry: 30000\n\ndata: ${JSON.stringify({ role: 'student', serverNow: Date.now(), me: null, refused })}\n\n`;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
    }
  }
  await h.ensureJoinUrl(request.nextUrl.port || process.env.PORT || '3000');
  const encoder = new TextEncoder();
  let client: Client | null = null;
  let keepAlive: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (client) h.removeClient(client);
    client = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const end = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // A classmate's join or look re-sends every phone its view, which then differs only in serverNow; skip
      // those repeats. A reconnect is a new client, so its first view always goes out.
      let lastKey = '';
      client = {
        role,
        tokenHash: role === 'student' ? hashToken(token) : undefined,
        send: (payload) => {
          const body = JSON.stringify(payload);
          const key = body.replace(/"serverNow":\d+/, '');
          if (key === lastKey) return;
          lastKey = key;
          write(`data: ${body}\n\n`);
        },
        // Replaced by a newer stream from the same phone: that tab stops until the student looks at it again.
        close: () => {
          write('event: replaced\ndata: 1\n\n');
          end();
        },
        end,
      };
      write('retry: 1500\n\n');
      h.addClient(client);
      keepAlive = setInterval(() => write(': ping\n\n'), 15000);
      request.signal.addEventListener('abort', end);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

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
      client = {
        id: crypto.randomUUID(),
        role,
        tokenHash: role === 'student' ? hashToken(token) : undefined,
        send: (payload) => write(`data: ${JSON.stringify(payload)}\n\n`),
      };
      write('retry: 1500\n\n');
      h.addClient(client);
      keepAlive = setInterval(() => write(': ping\n\n'), 15000);
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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

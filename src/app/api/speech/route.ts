import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { SPEECH_MAX, speechFile } from '@/server/speech';

/**
 * 받아쓰기: a sentence as the laptop's own voice reads it, slow and loud, for the teacher screen's [▶ 읽어 주기] (in
 * class and in the [새 아고라] window). Teacher only, like the sentence itself. 501 where the laptop can't make one
 * (not a Mac): the screen's browser reads it then.
 */
export async function POST(request: NextRequest) {
  if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 할 수 있어요.' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > SPEECH_MAX) return Response.json({ ok: false, error: '읽을 문장이 없거나 너무 길어요.' }, { status: 400 });
  const wav = await speechFile(text);
  if (!wav) return Response.json({ ok: false, error: '이 노트북에서는 소리 파일을 만들 수 없어요.' }, { status: 501 });
  return new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
}

import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { eventWorkbook, typedWorkbook } from '@/server/xlsx';

/** RFC 5987, so Korean names arrive intact; the plain name is for clients that only read that one. */
function disposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const plain = /^[\x20-\x7e]+$/.test(fileName) ? fileName : 'words.xlsx';
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

/** [엑셀로 받기]: the rows typed in [직접 작성하기] ({ name, words }) or an event's words ({ eventId }) in the template. */
export async function POST(request: NextRequest) {
  if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 받을 수 있어요.' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 415 });
  if (Number(request.headers.get('content-length') ?? 0) > 500_000) return Response.json({ ok: false, error: '단어가 너무 많아요.' }, { status: 413 });
  const text = await request.text();
  if (text.length > 500_000) return Response.json({ ok: false, error: '단어가 너무 많아요.' }, { status: 413 });
  let body: { eventId?: unknown; name?: unknown; words?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 400 });
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  let file: { fileName: string; data: Buffer } | null;
  try {
    if (typeof body.eventId === 'string') {
      file = eventWorkbook(body.eventId);
      if (!file) return Response.json({ ok: false, error: '이벤트를 찾을 수 없어요.' }, { status: 404 });
    } else {
      // The same limits as [미리보기] (src/app/api/words/route.ts), but more rows: the file is for keeping.
      const rows = (Array.isArray(body.words) ? body.words : [])
        .slice(0, 1000)
        .map((w) => {
          const r = (w ?? {}) as Record<string, unknown>;
          return { spelling: str(r.spelling, 60), meaning: str(r.meaning, 100), example: str(r.example, 200) };
        })
        .filter((w) => w.spelling || w.meaning || w.example);
      if (rows.length === 0) return Response.json({ ok: false, error: '단어를 한 줄 이상 써 주세요.' }, { status: 400 });
      file = typedWorkbook(str(body.name, 40), rows);
    }
  } catch (e) {
    console.error('Classeum: 엑셀 파일을 만들지 못했어요.', e);
    return Response.json({ ok: false, error: '엑셀 파일을 만들지 못했어요.' }, { status: 500 });
  }
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition(file.fileName),
      'Cache-Control': 'no-store',
    },
  });
}

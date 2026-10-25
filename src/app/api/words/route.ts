import type { NextRequest } from 'next/server';
import { importTypedWords } from '@/server/excel';
import { hub } from '@/server/hub';
import { isTeacher } from '@/server/auth';

/** [직접 작성하기]: a title and typed words become a draft, previewed and created like an uploaded file. */
export async function POST(request: NextRequest) {
  if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 만들 수 있어요.' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 415 });
  const text = await request.text();
  if (text.length > 200_000) return Response.json({ ok: false, error: '단어가 너무 많아요 (200개까지).' }, { status: 413 });
  let body: { name?: unknown; words?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 400 });
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const rows = (Array.isArray(body.words) ? body.words : [])
    .slice(0, 200)
    .map((w) => {
      const r = (w ?? {}) as Record<string, unknown>;
      return { spelling: str(r.spelling, 60), meaning: str(r.meaning, 100), example: str(r.example, 200) };
    })
    .filter((w) => w.spelling || w.meaning || w.example);
  const result = importTypedWords(rows);
  const h = hub();
  const draft = h.makeDraft(result, undefined, str(body.name, 40));
  return Response.json({
    ok: true,
    draftId: draft.id,
    issues: result.issues,
    hasErrors: result.issues.some((i) => i.level === 'error'),
    rosterCount: 0,
    groups: h.previewDraft(draft),
  });
}

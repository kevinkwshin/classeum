import type { NextRequest } from 'next/server';
import { importWorkbook } from '@/server/excel';
import { hub } from '@/server/hub';
import { isTeacher } from '@/server/auth';

export async function POST(request: NextRequest) {
  if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 올릴 수 있어요.' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 6 * 1024 * 1024) return Response.json({ ok: false, error: '파일이 너무 커요 (5MB 이하).' }, { status: 413 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ ok: false, error: '파일이 없어요.' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return Response.json({ ok: false, error: '파일이 너무 커요 (5MB 이하).' }, { status: 400 });
  const result = await importWorkbook(Buffer.from(await file.arrayBuffer()));
  const h = hub();
  const draft = h.makeDraft(result, file.name);
  // Rows that would rename someone already on the roster are skipped; say so before 만들기.
  const kept = h.rosterConflicts(result.roster).map((message) => ({ level: 'warning' as const, sheet: '명단', message }));
  return Response.json({
    ok: true,
    draftId: draft.id,
    issues: [...result.issues, ...kept],
    hasErrors: result.issues.some((i) => i.level === 'error'),
    rosterCount: result.roster.length,
    groups: h.previewDraft(draft),
  });
}

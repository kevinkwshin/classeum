import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { teacherAnswers } from '@/server/agora';

/**
 * One class's answers to an 아고라's topics, for the teacher screen's 답 card: its stream carries only how many there
 * are, so a semester of answers doesn't travel with every change. Teacher only, like every answer that isn't shown.
 */
export async function GET(request: NextRequest) {
  if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 볼 수 있어요.' }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const answers = teacherAnswers(params.get('agoraId') ?? '', params.get('classId') ?? '');
  if (!answers) return Response.json({ ok: false, error: '그 아고라가 없어요.' }, { status: 404 });
  return Response.json({ ok: true, answers });
}

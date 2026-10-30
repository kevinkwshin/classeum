import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { computeStats, statsCsv, studentMistakes } from '@/server/stats';

export async function GET(request: NextRequest) {
  if (!isTeacher(request)) return new Response('forbidden', { status: 403 });
  // One student's quizzes with what they got wrong, asked for when the teacher opens that student.
  const studentId = request.nextUrl.searchParams.get('student');
  if (studentId) return Response.json({ quizzes: studentMistakes(studentId) });
  const classId = request.nextUrl.searchParams.get('class') || undefined;
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(statsCsv(classId), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('classeum-통계.csv')}`,
      },
    });
  }
  return Response.json(computeStats(classId));
}

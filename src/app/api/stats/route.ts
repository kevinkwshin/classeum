import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { csvFile } from '@/server/csv';
import { computeStats, questionsCsv, studentLabel, studentMistakes, studentMistakesCsv } from '@/server/stats';

export async function GET(request: NextRequest) {
  if (!isTeacher(request)) return new Response('forbidden', { status: 403 });
  const params = request.nextUrl.searchParams;
  // One student's quizzes with what they got wrong, asked for when the teacher opens that student: as a file for
  // Excel with format=csv, else for the screen and the printable 오답 노트 (with who they are).
  const studentId = params.get('student');
  if (studentId) {
    if (params.get('format') === 'csv') {
      const file = studentMistakesCsv(studentId);
      return file ? csvFile(file.csv, file.name) : new Response('not found', { status: 404 });
    }
    return Response.json({ student: studentLabel(studentId), quizzes: studentMistakes(studentId) });
  }
  // A class (every class when empty): its students and questions, or with format=csv its questions as a file.
  const classId = params.get('class') || undefined;
  if (params.get('format') === 'csv') {
    const file = questionsCsv(classId);
    return csvFile(file.csv, file.name);
  }
  return Response.json(computeStats(classId));
}

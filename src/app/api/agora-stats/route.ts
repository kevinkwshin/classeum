import type { NextRequest } from 'next/server';
import { agoraStats, agoraStatsCsv } from '@/server/agoraStats';
import { isTeacher } from '@/server/auth';
import { csvFile } from '@/server/csv';

/** 아고라 통계 for one class (teacher only, like every answer): for the screen, or with format=csv its 받아쓰기 as a file. */
export async function GET(request: NextRequest) {
  if (!isTeacher(request)) return new Response('forbidden', { status: 403 });
  const params = request.nextUrl.searchParams;
  const classId = params.get('class') ?? '';
  if (params.get('format') === 'csv') {
    const file = agoraStatsCsv(classId);
    return file ? csvFile(file.csv, file.name) : new Response('not found', { status: 404 });
  }
  const stats = agoraStats(classId);
  return stats ? Response.json(stats) : new Response('not found', { status: 404 });
}

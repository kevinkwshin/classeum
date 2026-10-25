import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { computeStats, statsCsv } from '@/server/stats';

export async function GET(request: NextRequest) {
  if (!isTeacher(request)) return new Response('forbidden', { status: 403 });
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(statsCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('classeum-통계.csv')}`,
      },
    });
  }
  return Response.json(computeStats());
}

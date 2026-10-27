import { readFile } from 'node:fs/promises';
import { TEMPLATE } from '@/server/xlsx';

/**
 * [템플릿 받기]: the template in the repo's templates/ folder, read on each request, so a new copy there is what the
 * next download gets (no copy in public/ to keep in step).
 */
export async function GET() {
  let data: Buffer;
  try {
    data = await readFile(TEMPLATE);
  } catch {
    return new Response('템플릿 파일(templates/M2_L7.xlsx)이 없어요.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="M2_L7.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

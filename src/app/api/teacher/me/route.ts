import type { NextRequest } from 'next/server';
import { isTeacher } from '@/server/auth';
import { isLocalHost } from '@/server/lan';

export async function GET(request: NextRequest) {
  return Response.json({ ok: isTeacher(request), local: isLocalHost(request.headers.get('host')) });
}

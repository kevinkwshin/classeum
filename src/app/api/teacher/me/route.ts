import type { NextRequest } from 'next/server';
import { canClaim, isTeacher } from '@/server/auth';
import { isLocalHost } from '@/server/lan';

export async function GET(request: NextRequest) {
  const local = isLocalHost(request.headers.get('host'));
  return Response.json({ ok: isTeacher(request), local, canClaim: local && canClaim() });
}

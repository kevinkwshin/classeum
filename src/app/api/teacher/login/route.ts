import type { NextRequest } from 'next/server';
import { canClaim, keyMatches, markClaimed, teacherCookieHeader } from '@/server/auth';
import { isLocalHost } from '@/server/lan';

// GET /api/teacher/login?key=… (the link printed in the terminal), or without a key on the
// very first visit from the laptop. Sets the teacher cookie and goes to the teacher page.
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const local = isLocalHost(request.headers.get('host'));
  const ok = local && (keyMatches(key) || (!key && canClaim()));
  const target = new URL(ok ? '/teacher' : '/teacher?denied=1', request.nextUrl.origin);
  const res = new Response(null, { status: 303, headers: { Location: target.pathname + target.search } });
  if (ok) {
    markClaimed();
    res.headers.append('Set-Cookie', teacherCookieHeader());
  }
  return res;
}

import type { NextRequest } from 'next/server';
import { keyMatches, teacherCookieHeader } from '@/server/auth';
import { isLocalHost } from '@/server/lan';

// GET /api/teacher/login?key=…[&next=/display]: the link printed in the terminal. Sets the
// teacher cookie and goes to the teacher (or projector) screen.
export async function GET(request: NextRequest) {
  const ok = isLocalHost(request.headers.get('host')) && keyMatches(request.nextUrl.searchParams.get('key'));
  const dest = request.nextUrl.searchParams.get('next') === '/display' ? '/display' : '/teacher';
  const res = new Response(null, { status: 303, headers: { Location: ok ? dest : '/teacher?denied=1' } });
  if (ok) res.headers.append('Set-Cookie', teacherCookieHeader());
  return res;
}

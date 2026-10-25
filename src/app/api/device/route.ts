import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Issues the device token as a server-set cookie. Safari's 7-day limit applies to
// storage written by page scripts, not to cookies set in an HTTP response, so the
// token survives a week between classes on iPhones too.
export async function POST(request: NextRequest) {
  const slot = request.nextUrl.searchParams.get('slot');
  const name = slot && /^\d{1,2}$/.test(slot) ? `cls_device_${slot}` : 'cls_device';
  let token = request.cookies.get(name)?.value ?? '';
  if (!/^[a-f0-9]{48}$/.test(token)) token = randomBytes(24).toString('hex');
  const res = Response.json({ ok: true, token });
  res.headers.append('Set-Cookie', `${name}=${token}; Path=/; Max-Age=${60 * 60 * 24 * 400}; SameSite=Lax; HttpOnly`);
  return res;
}

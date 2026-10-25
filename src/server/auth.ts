// Teacher access. The Host header alone can be forged by any phone on the Wi-Fi, so the
// teacher and projector screens also need a secret cookie, which only the link printed in
// the terminal hands out (npm run class opens it in the laptop's browser by itself).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { isLocalHost } from './lan';

const DIR = join(process.cwd(), '.data');
const KEY_FILE = join(DIR, 'teacher-key');
export const TEACHER_COOKIE = 'cls_teacher';

const g = globalThis as unknown as { __classeumTeacherKey?: string };

export function teacherKey(): string {
  if (g.__classeumTeacherKey) return g.__classeumTeacherKey;
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(24).toString('hex'), { mode: 0o600 });
  g.__classeumTeacherKey = readFileSync(KEY_FILE, 'utf8').trim();
  return g.__classeumTeacherKey;
}

export function keyMatches(value: string | undefined | null): boolean {
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(teacherKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function teacherCookieHeader(): string {
  return `${TEACHER_COOKIE}=${teacherKey()}; Path=/; Max-Age=${60 * 60 * 24 * 400}; SameSite=Strict; HttpOnly`;
}

/** Requests from another site never carry teacher powers (blocks CSRF from a page open in the teacher's browser). */
export function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get('host')) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function isTeacher(request: NextRequest): boolean {
  return isLocalHost(request.headers.get('host')) && sameOrigin(request) && keyMatches(request.cookies.get(TEACHER_COOKIE)?.value);
}

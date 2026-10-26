// Local JSON store for the prototype. Swap this module for Supabase in production;
// the rest of the server only talks to the functions exported here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AvatarLook, Question, RewardSetting, StudentSummary, Word } from '@/lib/types';

/** A class (반) the teacher runs; numbers are unique only within one class. */
export interface ClassRec {
  id: string;
  name: string;
  createdAt: number;
}

export interface StudentRec {
  id: string;
  classId: string;
  number: number;
  name: string;
  look: AvatarLook | null;
  inventory: string[];
  createdAt: number;
}

export interface DeviceRec {
  studentId: string;
  createdAt: number;
  lastSeen: number;
}

/**
 * A first-visit registration: what the student typed, and how it compares with the roster.
 * match: on the roster, no phone yet · replace: on the roster, another phone is bound ·
 * new: nobody has that number in the class yet · conflict: that number belongs to someone else.
 */
export interface RequestRec {
  id: string;
  tokenHash: string;
  classId: string;
  number: number;
  name: string;
  kind: 'match' | 'replace' | 'new' | 'conflict';
  /** The roster student it matches (or collides with); '' for a new student. */
  studentId: string;
  symbol: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** Why an expired request ended, so the phone can say what to fix. */
  reason?: 'timeout' | 'taken' | 'class' | 'cancelled' | 'gone';
}

export interface EventRec {
  id: string;
  name: string;
  createdAt: number;
  questions: Question[];
  retry: Record<string, Question>;
  warnings: string[];
  reward: RewardSetting;
  /** Written by older versions; nothing reads it. */
  wordKeys?: string[];
  /** After the main round, ask again the words much of the class got wrong. Off unless the teacher turns it on. */
  retryRound?: boolean;
  /** The Excel file it was made from (events made before this was kept have none). */
  fileName?: string;
  /** Typed in the teacher screen instead of uploaded. */
  typed?: boolean;
}

export interface ResponseRec {
  sessionId: string;
  eventId: string;
  questionId: string;
  wordKey?: string;
  round: 'main' | 'retry' | 'practice';
  studentId: string;
  choice: number;
  text?: string;
  correct: boolean;
  at: number;
}

export interface SessionSummaryRec {
  id: string;
  eventId: string;
  classId: string;
  startedAt: number;
  endedAt: number;
  mainCount: number;
  perStudent: { studentId: string; connected: number; correct: number; judged: boolean }[];
}

export interface RewardRec {
  sessionId: string;
  eventId: string;
  studentId: string;
  itemId: string;
  reason: 'challenge' | 'growth' | 'attendance';
  at: number;
}

export interface LastSummaryRec extends StudentSummary {
  sessionId: string;
  eventId: string;
  eventName: string;
  at: number;
}

export interface DB {
  version: 1;
  classes: Record<string, ClassRec>;
  students: Record<string, StudentRec>;
  devices: Record<string, DeviceRec>;
  requests: Record<string, RequestRec>;
  words: Record<string, Word>;
  events: Record<string, EventRec>;
  sessions: SessionSummaryRec[];
  responses: ResponseRec[];
  rewards: RewardRec[];
  attendance: Record<string, string[]>;
  /** Each student's latest session summary, so wrong-answer notes outlive the live arena. */
  lastSummary: Record<string, LastSummaryRec>;
}

const DIR = join(process.cwd(), '.data');
const FILE = join(DIR, 'classeum.json');

function empty(): DB {
  return { version: 1, classes: {}, students: {}, devices: {}, requests: {}, words: {}, events: {}, sessions: [], responses: [], rewards: [], attendance: {}, lastSummary: {} };
}

/** Data saved before classes existed: everyone goes into one class the teacher can rename. */
function migrate(d: DB): DB {
  const loose = Object.values(d.students).filter((s) => !s.classId);
  const sessionsWithout = d.sessions.filter((s) => !s.classId);
  if (loose.length || sessionsWithout.length) {
    const id = 'cls_default';
    d.classes[id] ??= { id, name: '1반', createdAt: Date.now() };
    for (const s of loose) s.classId = id;
    for (const s of sessionsWithout) s.classId = id;
  }
  // Requests from before self-registration have no typed details; they can't be approved anymore.
  for (const [id, r] of Object.entries(d.requests)) if (!r.kind) delete d.requests[id];
  // Armour was its own slot over the top; it is worn as the top (몸) now.
  for (const s of Object.values(d.students)) {
    const look = s.look as (AvatarLook & { armor?: string }) | null;
    if (!look || look.armor === undefined) continue;
    if (look.armor === 'lorica' || look.armor === 'gold') look.tunic = look.armor;
    delete look.armor;
  }
  return d;
}

function load(): DB {
  if (!existsSync(FILE)) return empty();
  try {
    return migrate({ ...empty(), ...JSON.parse(readFileSync(FILE, 'utf8')) });
  } catch {
    // Keep the broken file for inspection and start fresh rather than crash the class.
    renameSync(FILE, `${FILE}.broken-${Date.now()}`);
    return empty();
  }
}

const g = globalThis as unknown as { __classeumDb?: DB; __classeumSaveTimer?: NodeJS.Timeout };

export function db(): DB {
  if (!g.__classeumDb) g.__classeumDb = load();
  return g.__classeumDb;
}

export function save(): void {
  if (g.__classeumSaveTimer) return;
  g.__classeumSaveTimer = setTimeout(() => {
    g.__classeumSaveTimer = undefined;
    flush();
  }, 400);
}

export function flush(): void {
  try {
    mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(db()));
    renameSync(tmp, FILE);
  } catch (e) {
    // On Windows an antivirus scan or a sync app can hold the file for a moment; try again instead of stopping the class.
    console.error('Classeum: 저장하지 못해서 1초 뒤 다시 저장해요.', e);
    if (!g.__classeumSaveTimer) g.__classeumSaveTimer = setTimeout(() => {
      g.__classeumSaveTimer = undefined;
      flush();
    }, 1000);
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

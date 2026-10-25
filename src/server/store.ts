// Local JSON store for the prototype. Swap this module for Supabase in production;
// the rest of the server only talks to the functions exported here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AvatarLook, Question, RewardSetting, StudentSummary, Word } from '@/lib/types';

export interface StudentRec {
  id: string;
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

export interface RequestRec {
  id: string;
  studentId: string;
  tokenHash: string;
  symbol: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  replace: boolean;
}

export interface EventRec {
  id: string;
  name: string;
  createdAt: number;
  questions: Question[];
  retry: Record<string, Question>;
  warnings: string[];
  reward: RewardSetting;
  wordKeys: string[];
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
  return { version: 1, students: {}, devices: {}, requests: {}, words: {}, events: {}, sessions: [], responses: [], rewards: [], attendance: {}, lastSummary: {} };
}

function load(): DB {
  if (!existsSync(FILE)) return empty();
  try {
    return { ...empty(), ...JSON.parse(readFileSync(FILE, 'utf8')) };
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
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db()));
  renameSync(tmp, FILE);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

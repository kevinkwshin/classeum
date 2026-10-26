// Local JSON store for the prototype. Swap this module for Supabase in production;
// the rest of the server only talks to the functions exported here.
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
  wordKeys: string[];
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
const BACKUP_DIR = join(DIR, 'backup');
const KEEP_BACKUPS = 10;

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

const RECORDS = ['classes', 'students', 'devices', 'requests', 'words', 'events', 'attendance', 'lastSummary'] as const;
const LISTS = ['sessions', 'responses', 'rewards'] as const;
const isRecord = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Throws unless the text is a whole database, so a damaged file is never taken for an empty class. */
function parse(text: string): DB {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('not an object');
  const d = { ...empty(), ...(raw as Partial<DB>) };
  for (const k of RECORDS) if (!isRecord(d[k])) throw new Error(`${k} is not an object`);
  for (const k of LISTS) if (!Array.isArray(d[k])) throw new Error(`${k} is not a list`);
  return migrate(d);
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The laptop's calendar day, which names that day's backup. */
function today(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Backup file names, newest first. */
function backups(): string[] {
  return list(BACKUP_DIR).filter((n) => /^classeum-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();
}

/** Copies the saved file (just read, or written by us, so known good) once a day and keeps the newest ten. */
function backup(): void {
  const day = today();
  if (g.__classeumBackupDay === day || !existsSync(FILE)) return;
  // Tried once a day even when it fails, so a full disk doesn't print an error after every question.
  g.__classeumBackupDay = day;
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    try {
      copyFileSync(FILE, join(BACKUP_DIR, `classeum-${day}.json`), constants.COPYFILE_EXCL);
    } catch (e) {
      // Today's copy is already there: the day's first state is the one worth keeping.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    for (const old of backups().slice(KEEP_BACKUPS)) unlinkSync(join(BACKUP_DIR, old));
  } catch (e) {
    console.error('Classeum: 백업을 만들지 못했어요. 수업은 그대로 할 수 있어요.', e);
  }
}

/** The whole file reaches the disk before it replaces the old one, so a power cut leaves one or the other. */
function write(d: DB): void {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, JSON.stringify(d));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, FILE);
}

const box = (lines: string[]) => ['', '='.repeat(64), ...lines.map((l) => `  ${l}`), '='.repeat(64), ''].join('\n');

/**
 * The saved file's text. An antivirus scan or a sync app can hold it for a moment on Windows, so it tries for about a
 * second; a file that can't be opened isn't a damaged one, so nothing is moved aside or restored over it.
 */
function readSaved(): string {
  for (let i = 0; ; i++) {
    try {
      return readFileSync(FILE, 'utf8');
    } catch (e) {
      if (i === 4) {
        throw new Error(box([
          'Classeum: 기록 파일을 열 수 없어서 서버를 켜지 않았어요.',
          '아무것도 덮어쓰지 않았어요. 백신이나 OneDrive 같은 프로그램이 잡고 있을 수 있어요. 잠시 뒤 다시 켜세요.',
          `파일: ${FILE} (${(e as Error).message})`,
        ]));
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

/**
 * The saved file, or else the newest backup that reads. With neither it throws rather than start empty, since an
 * empty start would be saved over the real records at the first answer.
 */
function load(): DB {
  let broken = '';
  if (existsSync(FILE)) {
    const text = readSaved();
    try {
      const d = parse(text);
      backup();
      return d;
    } catch (e) {
      console.error(`Classeum: classeum.json을 읽지 못했어요. (${(e as Error).message})`);
      broken = `${FILE}.broken-${Date.now()}`;
      try {
        renameSync(FILE, broken);
      } catch {
        // Left in place, it would be overwritten by the restored copy; refuse below instead.
        broken = FILE;
      }
    }
  }
  const names = backups();
  // A damaged file from an earlier run means the last start was refused, not that this is the first one.
  const damaged = list(DIR).filter((n) => n.startsWith('classeum.json.broken-')).sort();
  if (!broken && !names.length && !damaged.length) return empty();
  for (const name of broken === FILE ? [] : names) {
    let d: DB;
    try {
      d = parse(readFileSync(join(BACKUP_DIR, name), 'utf8'));
    } catch {
      continue;
    }
    const [y, m, day] = name.slice(9, 19).split('-').map(Number);
    const why = broken ? '기록 파일이 망가져서' : '기록 파일이 없어서';
    g.__classeumNotice = `${why} ${m}월 ${day}일 백업으로 되돌렸어요.`;
    // A backup of today would only repeat the one just restored.
    g.__classeumBackupDay = today();
    console.error(box([
      `Classeum: ${why} ${y}년 ${m}월 ${day}일 백업으로 되돌렸어요.`,
      '그 뒤에 한 퀴즈 기록은 빠져 있을 수 있어요.',
      `사용한 백업: ${join(BACKUP_DIR, name)}`,
      ...(broken ? [`망가진 파일 (지우지 않았어요): ${broken}`] : []),
    ]));
    try {
      write(d);
    } catch {
      // The next save puts it in place.
    }
    return d;
  }
  throw new Error(box([
    'Classeum: 저장된 기록을 읽지 못해서 서버를 켜지 않았어요.',
    '아무것도 덮어쓰지 않았어요.',
    `읽지 못한 파일: ${broken || (damaged.length ? join(DIR, damaged[damaged.length - 1]) : `${FILE} (없어요)`)}`,
    `백업 폴더: ${BACKUP_DIR} (${names.length ? `${names.length}개 모두 읽지 못했어요` : '백업이 없어요'})`,
    '기록을 살리려면 .data 폴더를 통째로 복사해 두세요.',
    '새로 시작하려면 .data 폴더를 다른 곳으로 옮긴 뒤 다시 켜세요.',
  ]));
}

const g = globalThis as unknown as {
  __classeumDb?: DB;
  __classeumSaveTimer?: NodeJS.Timeout;
  __classeumLoadError?: Error;
  __classeumBackupDay?: string;
  __classeumNotice?: string;
};

export function db(): DB {
  if (!g.__classeumDb) {
    // A failed load stays failed: loading again would find the file moved aside and could start empty.
    if (g.__classeumLoadError) throw g.__classeumLoadError;
    try {
      g.__classeumDb = load();
    } catch (e) {
      g.__classeumLoadError = e as Error;
      throw e;
    }
  }
  return g.__classeumDb;
}

/**
 * Reads the records at startup, so a restore from backup is announced before any screen opens. Unreadable records
 * stop the server with one message; left running, every request would fail and print it again.
 */
export async function openStore(): Promise<void> {
  try {
    db();
  } catch (e) {
    // Never resolves: the server exits once the message is out (a Windows console is written asynchronously).
    await new Promise(() => process.stderr.write(`${(e as Error).message}\n`, () => process.exit(1)));
  }
}

/** Set when the records were put back from a backup at startup, for a notice on the teacher screen. */
export function storeNotice(): string | null {
  return g.__classeumNotice ?? null;
}

export function save(): void {
  if (g.__classeumSaveTimer) return;
  g.__classeumSaveTimer = setTimeout(() => {
    g.__classeumSaveTimer = undefined;
    flush();
  }, 400);
}

export function flush(): void {
  // Only loaded records are saved: before a load, or after a failed one, a save would replace the real file.
  const d = g.__classeumDb;
  if (!d) return;
  try {
    backup();
    write(d);
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

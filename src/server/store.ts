// The class records: one JSON file in .data, kept in memory while the server runs and rewritten whole a moment
// after each change. The rest of the server only talks to the functions exported here.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** Packed on disk (PackedResponses): a new field needs adding there too, or answers that have it are saved unpacked. */
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
  /** Scored questions the session set out to ask (left out in the lobby or skipped ones don't count); older records lack it. */
  planned?: number;
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

const RECORDS = ['classes', 'students', 'devices', 'requests', 'words', 'events', 'attendance', 'lastSummary'] as const;
const LISTS = ['sessions', 'responses', 'rewards'] as const;
const isRecord = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Answers on disk. They are most of the file and grow every class, so the names repeated on every answer are listed
 * once and each answer is four numbers: question, student, flags, ms since the previous answer, where
 * flags = (choice + 1) * 12 + round * 4 + typed * 2 + correct and round is 0 main, 1 retry, 2 practice. In memory they
 * stay plain ResponseRec objects.
 */
interface PackedResponses {
  packed: 1;
  count: number;
  /** [questionId] or [questionId, wordKey]. */
  questions: string[][];
  students: string[];
  /** Consecutive answers from one session and event: [sessionId, eventId, four numbers per answer]. */
  runs: [string, string, number[]][];
  /** [position in the list, what the student typed] for each answer flagged typed (단답형). */
  texts: [number, string][];
  /** [position in the list, answer] for anything that doesn't fit the numbers, kept as it is. */
  other: [number, unknown][];
}

const ROUNDS: readonly unknown[] = ['main', 'retry', 'practice'] satisfies ResponseRec['round'][];
const FIELDS = new Set(['sessionId', 'eventId', 'questionId', 'wordKey', 'round', 'studentId', 'choice', 'text', 'correct', 'at']);

/** Whether an answer packs without losing anything; undefined counts as absent, as it does in JSON. */
function packable(v: unknown): v is ResponseRec {
  if (!isRecord(v)) return false;
  for (const k of Object.keys(v as object)) if (!FIELDS.has(k)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.sessionId === 'string' && typeof r.eventId === 'string' && typeof r.questionId === 'string' && typeof r.studentId === 'string'
    && (r.wordKey === undefined || typeof r.wordKey === 'string') && (r.text === undefined || typeof r.text === 'string')
    && ROUNDS.includes(r.round) && typeof r.correct === 'boolean'
    && Number.isSafeInteger(r.choice) && (r.choice as number) >= -1 && Number.isSafeInteger(r.at);
}

function packResponses(list: ResponseRec[]): PackedResponses {
  const p: PackedResponses = { packed: 1, count: list.length, questions: [], students: [], runs: [], texts: [], other: [] };
  const questions = new Map<string, Map<string | undefined, number>>();
  const students = new Map<string, number>();
  let run: [string, string, number[]] | undefined;
  let at = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!packable(r) || !Number.isSafeInteger(r.at - at)) {
      p.other.push([i, r]);
      continue;
    }
    let byWord = questions.get(r.questionId);
    if (!byWord) questions.set(r.questionId, (byWord = new Map()));
    let q = byWord.get(r.wordKey);
    if (q === undefined) {
      byWord.set(r.wordKey, (q = p.questions.length));
      p.questions.push(r.wordKey === undefined ? [r.questionId] : [r.questionId, r.wordKey]);
    }
    let u = students.get(r.studentId);
    if (u === undefined) {
      students.set(r.studentId, (u = p.students.length));
      p.students.push(r.studentId);
    }
    if (!run || run[0] !== r.sessionId || run[1] !== r.eventId) p.runs.push((run = [r.sessionId, r.eventId, []]));
    run[2].push(q, u, (r.choice + 1) * 12 + ROUNDS.indexOf(r.round) * 4 + (r.text !== undefined ? 2 : 0) + (r.correct ? 1 : 0), r.at - at);
    at = r.at;
    if (r.text !== undefined) p.texts.push([i, r.text]);
  }
  return p;
}

/** The answers back as saved, or throws: damaged answers must stop the start like any damaged file, never go missing. */
function unpackResponses(v: unknown): ResponseRec[] {
  if (!isRecord(v) || (v as { packed?: unknown }).packed !== 1) throw new Error('responses is not a list');
  const p = v as Record<keyof PackedResponses, unknown>;
  const bad = (what: string) => new Error(`responses: ${what}`);
  const index = (n: unknown, size: number): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < size;
  const { count, questions, students, runs } = p;
  if (!index(count, Infinity)) throw bad('count');
  if (!Array.isArray(questions) || !questions.every((e) => Array.isArray(e) && (e.length === 1 || e.length === 2) && e.every((s) => typeof s === 'string'))) throw bad('questions');
  if (!Array.isArray(students) || !students.every((s) => typeof s === 'string')) throw bad('students');
  if (!Array.isArray(runs)) throw bad('runs');
  /** [position, value] pairs in strictly rising positions, so each lands exactly once. */
  const positioned = <T>(name: 'texts' | 'other', ok: (value: unknown) => boolean): [number, T][] => {
    const list = p[name];
    if (!Array.isArray(list)) throw bad(name);
    let last = -1;
    for (const e of list) {
      if (!Array.isArray(e) || e.length !== 2 || !index(e[0], count) || e[0] <= last || !ok(e[1])) throw bad(name);
      last = e[0];
    }
    return list;
  };
  const texts = positioned<string>('texts', (t) => typeof t === 'string');
  const other = positioned<ResponseRec>('other', () => true);

  const out: ResponseRec[] = [];
  let o = 0;
  let t = 0;
  let at = 0;
  const takeOther = () => {
    while (o < other.length && other[o][0] === out.length) out.push(other[o++][1]);
  };
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 3 || typeof run[0] !== 'string' || typeof run[1] !== 'string' || !Array.isArray(run[2]) || run[2].length % 4) throw bad('runs');
    const [sessionId, eventId, rows] = run as PackedResponses['runs'][number];
    for (let j = 0; j < rows.length; j += 4) {
      takeOther();
      const q = rows[j], u = rows[j + 1], x = rows[j + 2], gap = rows[j + 3];
      if (!index(q, questions.length) || !index(u, students.length) || !index(x, Infinity) || !Number.isSafeInteger(gap) || !Number.isSafeInteger(at + gap)) {
        throw bad(`answer ${out.length}`);
      }
      at += gap;
      const [questionId, wordKey] = questions[q];
      const r = { sessionId, eventId, questionId } as ResponseRec;
      if (wordKey !== undefined) r.wordKey = wordKey;
      r.round = ROUNDS[Math.floor(x / 4) % 3] as ResponseRec['round'];
      r.studentId = students[u];
      r.choice = Math.floor(x / 12) - 1;
      if (Math.floor(x / 2) % 2) {
        if (texts[t]?.[0] !== out.length) throw bad(`answer ${out.length} text`);
        r.text = texts[t++][1];
      }
      r.correct = x % 2 === 1;
      r.at = at;
      out.push(r);
    }
  }
  takeOther();
  if (out.length !== count || o < other.length || t < texts.length) throw bad(`${out.length} of ${count} answers`);
  return out;
}

/** Throws unless the text is a whole database, so a damaged file is never taken for an empty class. */
function parse(text: string): DB {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('not an object');
  const d = { ...empty(), ...(raw as Partial<DB>) } as DB & { answers?: unknown };
  // Packed answers are kept under 'answers' and 'responses' is saved as a plain list, so an older copy of the app
  // (a rollback, or .data copied to a laptop with an older ZIP) reads an empty list instead of crashing, and keeps
  // 'answers' as it is. Answers it adds to the list are merged back here. Files saved before packing hold only the
  // plain list; a few saved during development hold the packed form under 'responses'.
  const plain = Array.isArray(d.responses) ? d.responses : unpackResponses(d.responses);
  d.responses = d.answers === undefined ? plain : [...unpackResponses(d.answers), ...plain];
  delete d.answers;
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

/** The whole file reaches the disk before it replaces the old one, so a power cut leaves one or the other. */
function write(d: DB): void {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, JSON.stringify({ ...d, responses: [], answers: packResponses(d.responses) }));
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
 * The saved file. A damaged one is moved aside and the server refuses to start, rather than start empty: an empty
 * start would be saved over the real records at the first answer.
 */
function load(): DB {
  // A damaged file from an earlier run means the last start was refused, not that this is the first one.
  const damaged = list(DIR).filter((n) => n.startsWith('classeum.json.broken-')).sort();
  let broken = damaged.length ? join(DIR, damaged[damaged.length - 1]) : '';
  if (existsSync(FILE)) {
    const text = readSaved();
    try {
      return parse(text);
    } catch (e) {
      console.error(`Classeum: classeum.json을 읽지 못했어요. (${(e as Error).message})`);
      broken = `${FILE}.broken-${Date.now()}`;
      try {
        renameSync(FILE, broken);
      } catch {
        broken = FILE;
      }
    }
  }
  if (!broken) return empty();
  throw new Error(box([
    'Classeum: 저장된 기록을 읽지 못해서 서버를 켜지 않았어요.',
    '아무것도 덮어쓰지 않았어요.',
    `읽지 못한 파일: ${broken}`,
    '새로 시작하려면 .data 폴더를 다른 곳으로 옮긴 뒤 다시 켜세요.',
  ]));
}

const g = globalThis as unknown as {
  __classeumDb?: DB;
  __classeumSaveTimer?: NodeJS.Timeout;
  __classeumLoadError?: Error;
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
 * Reads the records at startup, so unreadable records stop the server with one message before any screen opens;
 * left running, every request would fail and print it again.
 */
export async function openStore(): Promise<void> {
  // The build loaded, so a stop from here on (a refused store, Ctrl+C, a relaunch) isn't one that
  // scripts/build-if-changed.mjs --forget should treat as a broken build.
  try {
    rmSync(join(process.cwd(), '.next', 'classeum-started'), { force: true });
  } catch {
    // Only npm run class writes it.
  }
  try {
    db();
  } catch (e) {
    // Never resolves: the server exits once the message is out (a Windows console is written asynchronously).
    await new Promise(() => process.stderr.write(`${(e as Error).message}\n`, () => process.exit(1)));
  }
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

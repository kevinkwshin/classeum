// Reads the Classeum Excel template (단어장 / 문법 고르기·쓰기·고치기·배열 / 문항 / 명단 sheets) and validates it.
import readExcelFile from 'read-excel-file/node';
import type { Confusable, CustomQuestion, GrammarItem, GrammarTab, Pos, Word, WordStatus } from '@/lib/types';
import { MAX_TEXT_ANSWER, normalizeAnswer, wordKey } from '@/lib/text';
import { clozeOf } from './generate';
import { GRAMMAR_TABS, grammarItem } from './grammar';

export interface ImportIssue {
  level: 'error' | 'warning';
  sheet: string;
  row?: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  words: Word[];
  questions: CustomQuestion[];
  grammar: GrammarItem[];
  roster: { className: string; number: number; name: string }[];
  issues: ImportIssue[];
}

type Cell = string | number | boolean | Date | null;

const POS_VALUES: Pos[] = ['명', '동', '형', '부', '대', '전', '접', '감', '구'];
const POS_ALIASES: Record<string, Pos> = {
  명사: '명', 동사: '동', 형용사: '형', 부사: '부', 대명사: '대', 전치사: '전', 접속사: '접', 감탄사: '감', 구동사: '구',
};
const STATUS_VALUES: WordStatus[] = ['사용', '검토', '보관'];

// Header aliases → canonical header, so small differences don't lose data.
export const WORD_HEADERS: Record<string, string> = {
  단어: '단어', 영어: '단어', 영단어: '단어', word: '단어',
  뜻: '뜻', 의미: '뜻', 한국어: '뜻', meaning: '뜻',
  품사: '품사',
  헷갈리는단어: '헷갈리는 단어', 헷갈리는: '헷갈리는 단어',
  예문: '예문', 예문뜻: '예문 뜻',
  '시간(초)': '시간(초)', 시간: '시간(초)', 초: '시간(초)',
  세트: '세트', 단원: '단원', 상태: '상태', 단어id: '단어ID',
};
export const QUESTION_HEADERS: Record<string, string> = {
  문항id: '문항ID', id: '문항ID', 유형: '유형', 문제: '문제',
  보기1: '보기1', 보기2: '보기2', 보기3: '보기3', 보기4: '보기4',
  정답: '정답', 해설: '해설',
  피드백1: '피드백1', 피드백2: '피드백2', 피드백3: '피드백3', 피드백4: '피드백4',
  '시간(초)': '시간(초)', 시간: '시간(초)', 세트: '세트', 상태: '상태',
};
/** One set of headers for the four 문법 tabs; each tab reads the columns it needs. */
export const GRAMMAR_HEADERS: Record<string, string> = {
  번호: '번호', 순번: '번호', no: '번호',
  지시문: '지시문', 지시: '지시문', 발문: '지시문',
  우리말: '우리말', 해석: '우리말', 한국어: '우리말', 정보: '우리말',
  문장: '문장', 문제: '문장', 질문: '문장',
  보기1: '보기1', 보기2: '보기2', 보기3: '보기3', 보기4: '보기4',
  정답: '정답', 답: '정답', '정답(조각을/로)': '정답',
  해설: '해설', '시간(초)': '시간(초)', 시간: '시간(초)', 초: '시간(초)', 세트: '세트', 상태: '상태',
};
/** The cell that marks a template's example rows; they are never asked. */
export const EXAMPLE_MARK = '예시';

function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  // Excel turns labels like "10-29" or "1-1" into dates, and "7:30" into a time on 1899-12-30;
  // give back what the teacher most likely typed.
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1900) return `${v.getUTCHours()}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
    return `${v.getUTCMonth() + 1}-${v.getUTCDate()}`;
  }
  return String(v).trim();
}

export function headerKey(h: string): string {
  return h.replace(/\s+/g, '').toLowerCase();
}

/**
 * Reads cells as text by header name. Excel quietly turns labels like "3-1" into dates;
 * those are read back as "3-1", and `done()` adds one warning per affected column.
 */
function cellReader(h: Map<string, number>, sheet: string, issues: ImportIssue[]) {
  const dated = new Map<string, { first: number; count: number; sample: string }>();
  const get = (row: Cell[], col: string, r: number) => {
    if (!h.has(col)) return '';
    const v = row[h.get(col)!];
    const out = text(v);
    if (v instanceof Date) {
      const seen = dated.get(col);
      if (seen) seen.count++;
      else dated.set(col, { first: r, count: 1, sample: out });
    }
    return out;
  };
  const done = () => {
    for (const [col, { first, count, sample }] of dated) {
      issues.push({
        level: 'warning',
        sheet,
        row: first,
        column: col,
        message: `'${col}' 열의 ${count}칸이 날짜·시간으로 바뀌어 있어서 '${sample}'처럼 읽었어요. 열 서식을 '텍스트'로 바꾼 뒤 값을 다시 입력해 주세요.`,
      });
    }
  };
  return { get, done };
}

function mapHeaders(row: Cell[], aliases: Record<string, string>, sheet: string, issues: ImportIssue[]) {
  const map = new Map<string, number>();
  row.forEach((cell, i) => {
    const raw = text(cell);
    if (!raw) return;
    const canonical = aliases[headerKey(raw)] ?? aliases[raw];
    if (canonical) {
      if (!map.has(canonical)) map.set(canonical, i);
    } else {
      issues.push({ level: 'warning', sheet, row: 1, column: raw, message: `알 수 없는 머리글 '${raw}'은 건너뛰었어요.` });
    }
  });
  return map;
}

function seconds(raw: string, sheet: string, row: number, issues: ImportIssue[]): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 5 || n > 60) {
    issues.push({ level: 'warning', sheet, row, column: '시간(초)', message: `시간 '${raw}'은 5~60 사이가 아니라서 기본 시간으로 둡니다.` });
    return undefined;
  }
  return Math.round(n);
}

function status(raw: string, sheet: string, row: number, issues: ImportIssue[]): WordStatus {
  if (!raw) return '사용';
  if ((STATUS_VALUES as string[]).includes(raw)) return raw as WordStatus;
  issues.push({ level: 'warning', sheet, row, column: '상태', message: `상태 '${raw}'을 몰라서 '사용'으로 둡니다.` });
  return '사용';
}

const SPELLING_RE = /^[A-Za-z][A-Za-z '\-.’]*$/;

/** Splits "lend; quite(꽤), there(거기에)" on ; or , outside parentheses and drops entries that aren't English words. */
function parseConfusables(raw: string, sheet: string, row: number, issues: ImportIssue[]): Confusable[] {
  const normalized = raw.replace(/（/g, '(').replace(/）/g, ')');
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of normalized) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[;；,，]/.test(ch)) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const out: Confusable[] = [];
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*\((.+)\)\s*$/);
    const word = (m ? m[1] : part).trim();
    if (!SPELLING_RE.test(word) || word.length > 40) {
      issues.push({ level: 'warning', sheet, row, column: '헷갈리는 단어', message: `'${part}'는 영어 단어가 아니라서 뺐어요.` });
      continue;
    }
    out.push(m ? { word, meaning: m[2].trim() } : { word });
  }
  return out;
}

/** Accepts 1, ①, 1), (1); anything with more than one answer mark is invalid. */
function parseAnswerIndex(raw: string): number {
  if (/^[①-④]$/.test(raw)) return '①②③④'.indexOf(raw);
  const digits = raw.replace(/[()\s.)]/g, '');
  if (!/^\d+$/.test(digits)) return -1;
  return Number(digits) - 1;
}

/** `firstRow` is the number of the row after the header, as the teacher sees it. */
function parseWords(data: Cell[][], issues: ImportIssue[], sheet = '단어장', firstRow = 2): Word[] {
  if (data.length === 0) return [];
  const h = mapHeaders(data[0], WORD_HEADERS, sheet, issues);
  if (!h.has('단어') || !h.has('뜻')) {
    issues.push({ level: 'error', sheet, row: 1, message: "'단어'와 '뜻' 머리글이 있어야 해요." });
    return [];
  }
  const { get: read, done } = cellReader(h, sheet, issues);
  const words: Word[] = [];
  const seen = new Map<string, number>();
  data.slice(1).forEach((row, i) => {
    const r = i + firstRow;
    const get = (cells: Cell[], col: string) => read(cells, col, r);
    const spellingRaw = get(row, '단어');
    const meaning = get(row, '뜻');
    if (!spellingRaw && !meaning) return;
    if (!spellingRaw) {
      issues.push({ level: 'error', sheet, row: r, column: '단어', message: '단어가 비어 있어요.' });
      return;
    }
    if (!meaning) {
      issues.push({ level: 'error', sheet, row: r, column: '뜻', message: `'${spellingRaw}'의 뜻이 비어 있어요.` });
      return;
    }
    const spellings = spellingRaw.split('|').map((s) => s.trim()).filter(Boolean);
    if (spellings.length === 0) {
      issues.push({ level: 'error', sheet, row: r, column: '단어', message: '단어가 비어 있어요.' });
      return;
    }
    if (spellings.some((s) => !SPELLING_RE.test(s) || s.length > 40)) {
      issues.push({ level: 'error', sheet, row: r, column: '단어', message: `'${spellingRaw}'에는 영어, 띄어쓰기, ' - . 만 쓸 수 있어요.` });
      return;
    }
    const id = get(row, '단어ID');
    const key = id ? `id:${id}` : wordKey(spellings[0]);
    if (seen.has(key)) {
      issues.push({ level: 'warning', sheet, row: r, column: '단어', message: `'${spellingRaw}'는 ${seen.get(key)}행과 같은 단어라서 건너뛰었어요.` });
      return;
    }
    seen.set(key, r);
    const posRaw = get(row, '품사');
    let pos: Pos | undefined;
    if (posRaw) {
      pos = (POS_VALUES as string[]).includes(posRaw) ? (posRaw as Pos) : POS_ALIASES[posRaw];
      if (!pos) issues.push({ level: 'warning', sheet, row: r, column: '품사', message: `품사 '${posRaw}'를 몰라서 비워 둡니다.` });
    }
    const example = get(row, '예문');
    const word: Word = {
      key,
      spelling: spellings[0],
      altSpellings: spellings.slice(1),
      meaning,
      pos,
      confusables: parseConfusables(get(row, '헷갈리는 단어'), sheet, r, issues),
      example: example || undefined,
      exampleMeaning: get(row, '예문 뜻') || undefined,
      seconds: seconds(get(row, '시간(초)'), sheet, r, issues),
      set: get(row, '세트') || undefined,
      unit: get(row, '단원') || undefined,
      status: status(get(row, '상태'), sheet, r, issues),
    };
    if (example && !clozeOf(word)) {
      const brackets = (example.match(/\[/g) ?? []).length;
      const why =
        brackets > 1
          ? '[ ]는 한 번만 써 주세요.'
          : brackets === 1
            ? `[ ] 안의 글자가 '${spellings[0]}'과 똑같아야 해요 (cooks처럼 바뀐 형태는 쓰지 않아요).`
            : `'${spellings[0]}' 자리를 [ ]로 감싸 주세요.`;
      issues.push({ level: 'warning', sheet, row: r, column: '예문', message: `예문 빈칸 문제를 만들지 못했어요. ${why}` });
    }
    words.push(word);
  });
  done();
  return words;
}

function parseQuestions(data: Cell[][], issues: ImportIssue[]): CustomQuestion[] {
  const sheet = '문항';
  if (data.length === 0) return [];
  const h = mapHeaders(data[0], QUESTION_HEADERS, sheet, issues);
  const { get: read, done } = cellReader(h, sheet, issues);
  const out: CustomQuestion[] = [];
  const ids = new Set<string>();
  data.slice(1).forEach((row, i) => {
    const r = i + 2;
    const get = (cells: Cell[], col: string) => read(cells, col, r);
    const id = get(row, '문항ID');
    const prompt = get(row, '문제');
    if (!id && !prompt) return;
    if (!id) {
      issues.push({ level: 'error', sheet, row: r, column: '문항ID', message: '문항ID가 비어 있어요.' });
      return;
    }
    if (ids.has(id)) {
      issues.push({ level: 'error', sheet, row: r, column: '문항ID', message: `문항ID '${id}'가 두 번 나와요.` });
      return;
    }
    ids.add(id);
    const kind = get(row, '유형');
    if (kind !== '객관식' && kind !== 'OX' && kind !== '단답형') {
      issues.push({ level: 'error', sheet, row: r, column: '유형', message: `유형 '${kind}'는 객관식, OX, 단답형 중 하나여야 해요.` });
      return;
    }
    if (!prompt) {
      issues.push({ level: 'error', sheet, row: r, column: '문제', message: '문제가 비어 있어요.' });
      return;
    }
    const answerRaw = get(row, '정답');
    if (!answerRaw) {
      issues.push({ level: 'error', sheet, row: r, column: '정답', message: '정답이 비어 있어요.' });
      return;
    }
    let options: string[] = [];
    let answerIndex = 0;
    let answers: string[] = [];
    let feedback = ['피드백1', '피드백2', '피드백3', '피드백4'].map((c) => get(row, c));
    if (kind === '객관식') {
      // Keep each option tied to its own column so a blank 보기2 doesn't shift the answer or feedback.
      const cols = [1, 2, 3, 4].map((n) => ({ label: get(row, `보기${n}`), feedback: get(row, `피드백${n}`), col: n - 1 }));
      const kept = cols.filter((c) => c.label);
      if (kept.length < 2) {
        issues.push({ level: 'error', sheet, row: r, column: '보기1', message: '객관식은 보기가 2개 이상 있어야 해요.' });
        return;
      }
      const colIdx = parseAnswerIndex(answerRaw);
      if (colIdx < 0 || colIdx > 3 || !cols[colIdx].label) {
        issues.push({ level: 'error', sheet, row: r, column: '정답', message: colIdx >= 0 && colIdx <= 3 ? `정답이 가리키는 보기${colIdx + 1}이 비어 있어요.` : `정답 '${answerRaw}'는 1~4 중 하나여야 해요.` });
        return;
      }
      options = kept.map((c) => c.label);
      feedback = kept.map((c) => c.feedback);
      answerIndex = kept.findIndex((c) => c.col === colIdx);
    } else if (kind === 'OX') {
      const a = answerRaw.toUpperCase().replace('○', 'O').replace('×', 'X');
      if (a !== 'O' && a !== 'X') {
        issues.push({ level: 'error', sheet, row: r, column: '정답', message: 'OX 정답은 O 또는 X여야 해요.' });
        return;
      }
      options = ['O', 'X'];
      answerIndex = a === 'O' ? 0 : 1;
    } else {
      // Kept as typed ('Seoul', 'I am a student.') for display; grading normalizes both sides.
      answers = answerRaw.split('|').map((a) => a.trim().replace(/\s+/g, ' ')).filter((a) => normalizeAnswer(a));
      if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) {
        issues.push({ level: 'error', sheet, row: r, column: '정답', message: `쓰기 정답은 ${MAX_TEXT_ANSWER}자까지예요. 폰에서 그보다 길게는 쓸 수 없어요.` });
        return;
      }
    }
    out.push({
      id,
      kind,
      prompt,
      options,
      answerIndex,
      answers,
      explanation: get(row, '해설') || undefined,
      feedback,
      seconds: seconds(get(row, '시간(초)'), sheet, r, issues),
      set: get(row, '세트') || undefined,
      status: status(get(row, '상태'), sheet, r, issues),
    });
  });
  done();
  return out;
}

/** One 문법 tab. Rows marked 예시 are the template's examples, and a row the same as an earlier one is skipped. */
function parseGrammar(tab: GrammarTab, data: Cell[][], issues: ImportIssue[], seen: Map<string, string>): GrammarItem[] {
  const sheet = `문법 ${tab}`;
  if (data.length === 0) return [];
  const h = mapHeaders(data[0], GRAMMAR_HEADERS, sheet, issues);
  const { get: read, done } = cellReader(h, sheet, issues);
  const out: GrammarItem[] = [];
  // Rows with nothing but a 지시문 or 해설 (filled down ahead of the questions) are skipped, with one warning.
  const leadOnly: number[] = [];
  data.slice(1).forEach((row, i) => {
    const r = i + 2;
    const get = (col: string) => read(row, col, r);
    const label = get('번호');
    if (label === EXAMPLE_MARK) return;
    const cells: Record<string, string> = {};
    for (const col of h.keys()) {
      const v = get(col);
      if (v) cells[col] = v;
    }
    if (!['문장', '우리말', '보기1', '보기2', '보기3', '보기4', '정답'].some((c) => cells[c])) {
      if (cells['지시문'] || cells['해설']) leadOnly.push(r);
      return;
    }
    const { item, problems } = grammarItem(tab, {
      label,
      lead: get('지시문'),
      ko: get('우리말'),
      sentence: get('문장'),
      options: [1, 2, 3, 4].map((n) => get(`보기${n}`)),
      answer: get('정답'),
      explanation: get('해설'),
      seconds: seconds(get('시간(초)'), sheet, r, issues),
      set: get('세트') || undefined,
      status: status(get('상태'), sheet, r, issues),
      cells,
    });
    for (const p of problems) issues.push({ level: p.level, sheet, row: r, column: p.column, message: p.message });
    if (!item) return;
    const where = `${sheet} ${r}행`;
    if (seen.has(item.id)) {
      issues.push({ level: 'warning', sheet, row: r, message: `${seen.get(item.id)}과 같은 문제라서 건너뛰었어요.` });
      return;
    }
    seen.set(item.id, where);
    out.push(item);
  });
  if (leadOnly.length) {
    const rows = leadOnly.length === 1 ? `${leadOnly[0]}행` : `${leadOnly[0]}~${leadOnly[leadOnly.length - 1]}행`;
    issues.push({ level: 'warning', sheet, row: leadOnly[0], message: `문제 없이 지시문·해설만 있는 줄 ${leadOnly.length}개는 건너뛰었어요 (${rows}).` });
  }
  done();
  return out;
}

/** Optional 명단 sheet: 반, 번호, 이름. Numbers only need to be unique within one 반. */
function parseRoster(data: Cell[][], issues: ImportIssue[]) {
  const sheet = '명단';
  if (data.length === 0) return [];
  const header = data[0].map((c) => headerKey(text(c)));
  const classCol = header.indexOf('반');
  const numCol = header.indexOf('번호');
  const nameCol = header.indexOf('이름');
  if (classCol < 0 || numCol < 0 || nameCol < 0) {
    issues.push({ level: 'warning', sheet, row: 1, message: "명단 시트에 '반', '번호', '이름' 머리글이 모두 있어야 해요. 명단은 건너뛰었어요." });
    return [];
  }
  const out: { className: string; number: number; name: string }[] = [];
  const seen = new Map<string, number>();
  data.slice(1).forEach((row, i) => {
    const className = text(row[classCol]);
    const num = Number(text(row[numCol]));
    const name = text(row[nameCol]);
    if (!className && !name && !text(row[numCol])) return;
    if (className && text(row[numCol]) !== '' && Number.isInteger(num) && name && (num < 1 || num > 99)) {
      issues.push({ level: 'warning', sheet, row: i + 2, message: `번호는 1~99만 쓸 수 있어 건너뛰었어요 (${num}).` });
      return;
    }
    if (!className || !Number.isInteger(num) || num <= 0 || !name) {
      issues.push({ level: 'warning', sheet, row: i + 2, message: '반, 번호, 이름 중 비어 있는 칸이 있어 건너뛰었어요.' });
      return;
    }
    const key = `${className}:${num}`;
    if (seen.has(key)) {
      issues.push({ level: 'warning', sheet, row: i + 2, message: `${className} ${num}번이 ${seen.get(key)}행에도 있어서 건너뛰었어요.` });
      return;
    }
    seen.set(key, i + 2);
    out.push({ className: className.slice(0, 20), number: num, name });
  });
  return out;
}

/** Words typed in the teacher screen ([직접 작성하기]), checked by the same rules as a 단어장 sheet. */
export function importTypedWords(rows: { spelling: string; meaning: string; example?: string }[]): ImportResult {
  const issues: ImportIssue[] = [];
  // Rows count from 1 as on screen, where there is no header row.
  const words = parseWords([['단어', '뜻', '예문'], ...rows.map((r) => [r.spelling, r.meaning, r.example ?? ''])], issues, '직접 작성', 1);
  if (words.length === 0 && !issues.some((i) => i.level === 'error')) issues.push({ level: 'error', sheet: '직접 작성', message: '단어와 뜻을 한 줄 이상 써 주세요.' });
  return { words, questions: [], grammar: [], roster: [], issues };
}

export async function importWorkbook(buffer: Buffer): Promise<ImportResult> {
  const issues: ImportIssue[] = [];
  let sheets: { sheet: string; data: Cell[][] }[];
  try {
    sheets = (await readExcelFile(buffer)) as { sheet: string; data: Cell[][] }[];
  } catch {
    return { words: [], questions: [], grammar: [], roster: [], issues: [{ level: 'error', sheet: '파일', message: '엑셀(.xlsx) 파일을 읽지 못했어요.' }] };
  }
  const find = (name: string) => sheets.find((s) => s.sheet.replace(/[\s_-]+/g, '') === name)?.data ?? [];
  const words = parseWords(find('단어장'), issues);
  // The 문법 tabs in the order they sit in the file, which is the order they are asked in.
  const seen = new Map<string, string>();
  const grammar = sheets
    .map((s) => ({ s, tab: GRAMMAR_TABS.find((t) => s.sheet.replace(/[\s_-]+/g, '') === `문법${t}`) }))
    .filter((x): x is { s: (typeof sheets)[number]; tab: GrammarTab } => !!x.tab)
    .flatMap(({ s, tab }) => parseGrammar(tab, s.data, issues, seen));
  const questions = parseQuestions(find('문항'), issues);
  const roster = parseRoster(find('명단'), issues);
  if (words.length === 0 && grammar.length === 0 && questions.length === 0 && !issues.some((i) => i.level === 'error')) {
    issues.push({ level: 'error', sheet: '파일', message: "'단어장'이나 문법 시트, '문항' 시트에 내용이 없어요." });
  }
  return { words, questions, grammar, roster, issues };
}

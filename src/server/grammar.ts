// The 문법 tabs (고르기 · 쓰기 · 고치기 · 배열): each row, written the way grammar worksheets are, becomes a grammar
// question (two for 고치기: find the wrong part, then fix it), without any AI. The marks:
//   고르기  (try / to try) in the sentence, or 보기1~4 for whole sentences, or 정답 O/X (T/F)
//   쓰기    [answer] where each blank goes ([as|so] for other answers), or 정답 for a whole answer
//   고치기  [fastly → fast] around the wrong part ([to →] to take it out); [word] marks a decoy, 4 parts in all
//   배열    정답 written in chunks, the clerk / let / me / try on / the scarf
// What students see first (facts to check, the 우리말 뜻) goes on lines above the sentence in the same 문장 cell; the
// 우리말 column of older files still works, and stays on 배열.
import type { GrammarItem, GrammarPart, GrammarShow, GrammarTab, Question, WordStatus } from '@/lib/types';
import { MAX_TEXT_ANSWER, hashString, mulberry32, normalizeAnswer, shuffle } from '@/lib/text';

export const GRAMMAR_TABS: GrammarTab[] = ['고르기', '쓰기', '고치기', '배열'];

/** One row of a 문법 tab, read by header (see GRAMMAR_HEADERS in excel.ts). */
export interface GrammarRow {
  label: string;
  lead: string;
  ko: string;
  sentence: string;
  /** 보기1~4 in their columns; an empty one stays '' so 정답 2 still means 보기2. */
  options: string[];
  answer: string;
  explanation: string;
  seconds?: number;
  set?: string;
  status: WordStatus;
  /** The cells as typed, by canonical header, for [엑셀로 받기]. */
  cells: Record<string, string>;
}

export interface GrammarProblem {
  level: 'error' | 'warning';
  column: string;
  message: string;
}

const ARROW = /\s*(?:→|->|=>|⇒|➔|➡)\s*/;
/** (a / b) or [a / b]: a group with a slash is a choice. */
const CHOICE = /[([]([^()[\]]*\/[^()[\]]*)[)\]]/g;
const BRACKET = /\[([^[\]]*)\]/g;
const HAS_BRACKET = /\[[^[\]]*\]/;
const ARTICLES = new Set(['a', 'an', 'the']);
const MAX_BLANKS = 4;
const MAX_CHIPS = 12;
/** The field has four zones, so a 고치기 sentence underlines four parts at most, the wrong one included. */
const MAX_PARTS = 4;
/**
 * Words that start a sentence with a capital only because they start it. A first 배열 chunk that begins with one is
 * shown in lowercase, or its capital would give the first place away; names (Tom, Seoul) and I keep theirs.
 */
const SENTENCE_STARTERS = new Set(
  'a an the this that these those my your his her its our their we you he she it they there here some every each no one what who where when why how which do does did can could will would shall should may might must is are was were have has had let please'.split(' '),
);

/**
 * Lenient for typed grammar answers: case, a final . ? !, commas, curly quotes, didn't / did not and → / -> are all
 * the same; spelling still has to be right.
 */
export function canon(s: string): string {
  return normalizeAnswer(s.replace(/[“”„‟″«»]/g, '"'))
    .replace(ARROW, ' → ')
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bcannot\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/'m\b/g, ' am')
    .replace(/'re\b/g, ' are')
    .replace(/'ve\b/g, ' have')
    .replace(/'ll\b/g, ' will')
    .replace(/,/g, ' ')
    .replace(/[.?!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grades a typed grammar answer. Blank boxes come joined by ' / ' and are read as one run of words, so a word typed
 * in the next box still counts; each blank may be filled with any of its own answers.
 */
export function gradeGrammar(q: Question, text: string): boolean {
  if (q.gaps) {
    const words = canon(text.replace(/\s*\/\s*/g, ' ')).split(' ').filter(Boolean);
    const gaps = q.gaps.map((alts) => alts.map((a) => canon(a).split(' ').filter(Boolean)));
    const from = (g: number, at: number): boolean =>
      g === gaps.length ? at === words.length : gaps[g].some((alt) => alt.length > 0 && alt.every((w, k) => words[at + k] === w) && from(g + 1, at + alt.length));
    return words.length > 0 && from(0, 0);
  }
  const typed = canon(text);
  return !!typed && (q.answers ?? []).some((a) => canon(a) === typed);
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const alternatives = (s: string, split = /\|/) => s.split(split).map(tidy).filter((a) => normalizeAnswer(a));
const hangul = (answers: string[]) => answers.some((a) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(a));

/** 1, ①, 1), (1), 2번 → 0-based index, or -1. NFKC would turn ① into 1, so circled numbers are read first. */
function numberAnswer(raw: string): number {
  const t = raw.trim();
  if (/^[①-④]$/.test(t)) return '①②③④'.indexOf(t);
  const m = /^\(?([1-4])[).]?\s*번?$/.exec(t);
  return m ? Number(m[1]) - 1 : -1;
}

/** O, X, T, F (and ○ ×): which side, and whether the teacher wrote T/F. */
function oxAnswer(raw: string): { index: number; tf: boolean } | null {
  const t = raw.trim().toUpperCase();
  if (t === 'O' || t === '○' || t === '0') return { index: 0, tf: false };
  if (t === 'X' || t === '×' || t === '✕') return { index: 1, tf: false };
  if (t === 'T' || t === 'TRUE' || t === '참') return { index: 0, tf: true };
  if (t === 'F' || t === 'FALSE' || t === '거짓') return { index: 1, tf: true };
  if (t === '맞음' || t === '맞다') return { index: 0, tf: false };
  if (t === '틀림' || t === '틀리다') return { index: 1, tf: false };
  return null;
}

/** The words that differ between whole-sentence options, for the zones ('to clean' / 'clean'); null if too long. */
export function differing(sentences: string[]): string[] | null {
  const words = sentences.map((s) => tidy(s).split(' '));
  const min = Math.min(...words.map((w) => w.length));
  let pre = 0;
  while (pre < min && words.every((w) => w[pre] === words[0][pre])) pre++;
  let suf = 0;
  while (suf < min - pre && words.every((w) => w[w.length - 1 - suf] === words[0][words[0].length - 1 - suf])) suf++;
  // A side with nothing left gets the next word after it (or before it), so no zone is empty.
  const middles = () => words.map((w) => w.slice(pre, w.length - suf));
  while (middles().some((m) => m.length === 0) && (pre > 0 || suf > 0)) {
    if (suf > 0) suf--;
    else pre--;
  }
  const out = middles().map((m) => m.join(' ').replace(/[.?!]$/, ''));
  if (out.some((x) => !x || x.length > 28) || new Set(out).size !== out.length) return null;
  return out;
}

/** The finished 배열 sentence: the chips joined, a capital first letter, and the teacher's end mark (or a full stop). */
function finished(chips: string[], end: string): string {
  const s = chips.join(' ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${end || '.'}`;
}

function itemId(tab: GrammarTab, r: GrammarRow): string {
  return hashString([tab, r.ko, r.sentence, ...r.options, r.answer].map(tidy).join('\u0001')).toString(36);
}

interface Built {
  questions: Question[];
  problems: GrammarProblem[];
  /** The row's cells rewritten into the template's layout, when the teacher's file put a value elsewhere. */
  cells?: Record<string, string>;
  /** The row as its id is hashed, when it isn't the row itself (배열 hashes its chunks in answer order). */
  idRow?: GrammarRow;
}

const error = (column: string, message: string): Built => ({ questions: [], problems: [{ level: 'error', column, message }] });

function base(id: string, r: GrammarRow, show: GrammarShow, modeLabel: string, seconds: number): Pick<Question, 'id' | 'modeLabel' | 'seconds' | 'explanation' | 'grammar'> {
  return { id, modeLabel, seconds: r.seconds ?? seconds, explanation: r.explanation || undefined, grammar: show };
}

function choose(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  const sentence = tidy(r.sentence);
  const groups = [...sentence.matchAll(CHOICE)];
  const given = r.options.map(tidy);
  if (groups.length > 1) return error('문장', '보기 괄호 (A / B)는 한 문장에 하나만 쓸 수 있어요.');
  if (groups.length === 1) {
    if (given.some(Boolean)) problems.push({ level: 'warning', column: '보기1', message: '문장에 (A / B)가 있어서 보기 칸은 쓰지 않았어요.' });
    const parts = groups[0][1].split('/').map(tidy).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return error('문장', '괄호 안 보기는 2~4개여야 해요. (예: try / to try)');
    if (new Set(parts.map(normalizeAnswer)).size !== parts.length) return error('문장', '괄호 안에 같은 보기가 두 번 있어요.');
    if (!r.answer.trim()) return error('정답', '정답이 비어 있어요.');
    let index = parts.findIndex((p) => normalizeAnswer(p) === normalizeAnswer(r.answer));
    if (index < 0) index = numberAnswer(r.answer);
    if (index < 0 || index >= parts.length) return error('정답', `정답 '${r.answer}'이 괄호 안 보기(${parts.join(' / ')}) 중에 없어요.`);
    const at = groups[0].index!;
    const show: GrammarShow = {
      tab: '고르기',
      lead: r.lead || '알맞은 말을 고르세요.',
      ko: r.ko || undefined,
      parts: [{ text: sentence.slice(0, at) }, { gap: 0 }, { text: sentence.slice(at + groups[0][0].length) }],
    };
    return {
      questions: [{ ...base(id, r, show, '알맞은 말', 15), mode: 'CUSTOM_MC', prompt: sentence, options: parts.map((label) => ({ label })), answerIndex: index, fill: [parts[index]] }],
      problems,
    };
  }
  if (given.some(Boolean)) {
    const kept = given.map((label, col) => ({ label, col })).filter((o) => o.label);
    if (kept.length < 2) return error('보기1', '보기를 2개 이상 써 주세요.');
    if (!r.answer.trim()) return error('정답', '정답이 비어 있어요.');
    const col = numberAnswer(r.answer);
    if (col < 0) return error('정답', `정답 '${r.answer}'은 보기 번호(1~4)로 써 주세요.`);
    if (!given[col]) return error('정답', `정답이 가리키는 보기${col + 1}이 비어 있어요.`);
    const sentences = kept.map((o) => o.label);
    const lead = r.lead || '바른 문장을 고르세요.';
    const show: GrammarShow = { tab: '고르기', lead, ko: r.ko || undefined, parts: sentence ? [{ text: sentence }] : [], sentences, short: differing(sentences) ?? undefined };
    return {
      questions: [
        {
          // Reading whole sentences takes time: 26 s for two, 42 s for four.
          ...base(id, r, show, '문장 고르기', Math.min(60, 10 + 8 * sentences.length)),
          mode: 'CUSTOM_MC',
          prompt: sentence ? `${lead} ${sentence}` : lead,
          options: sentences.map((label) => ({ label })),
          answerIndex: kept.findIndex((o) => o.col === col),
          fixedOrder: true,
        },
      ],
      problems,
    };
  }
  const ox = oxAnswer(r.answer);
  if (ox) {
    if (!sentence) return error('문장', 'O/X로 판단할 문장을 써 주세요.');
    const [yes, no] = ox.tf ? ['T', 'F'] : ['O', 'X'];
    const show: GrammarShow = { tab: '고르기', lead: r.lead || `맞으면 ${yes}, 틀리면 ${no}를 고르세요.`, ko: r.ko || undefined, parts: [{ text: sentence }] };
    return {
      questions: [{ ...base(id, r, show, `${yes}/${no}`, 15), mode: 'CUSTOM_OX', prompt: sentence, options: [{ label: yes }, { label: no }], answerIndex: ox.index, fixedOrder: true }],
      problems,
    };
  }
  if (!r.answer.trim()) return error('정답', '정답이 비어 있어요.');
  return error('문장', '문장에 (try / to try)처럼 보기를 넣거나, 보기1~4를 채우거나, 정답을 O·X(T·F)로 써 주세요.');
}

function write(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  const sentence = tidy(r.sentence);
  const marks = [...sentence.matchAll(BRACKET)];
  if (marks.length > 0) {
    if (marks.length > MAX_BLANKS) return error('문장', `빈칸은 ${MAX_BLANKS}개까지예요.`);
    // [as|so] and [as/so] both list other answers, as / does in 고르기's (try / to try).
    const alts = marks.map((m) => alternatives(m[1], /[|/]/));
    if (alts.some((a) => a.length === 0)) return error('정답', '빈칸에 들어갈 답을 정답 칸에 써 주세요.');
    if (alts.some((a) => a.some((x) => !canon(x)))) return error('정답', '빈칸의 답이 문장부호뿐이면 채점할 수 없어요. 낱말을 넣어 주세요.');
    if (r.answer.trim()) problems.push({ level: 'warning', column: '정답', message: '문장의 [ ]로 채점해서 정답 칸은 쓰지 않았어요.' });
    const parts: GrammarPart[] = [];
    let at = 0;
    marks.forEach((m, i) => {
      parts.push({ text: sentence.slice(at, m.index) }, { gap: i });
      at = m.index! + m[0].length;
    });
    parts.push({ text: sentence.slice(at) });
    const n = marks.length;
    const show: GrammarShow = { tab: '쓰기', lead: r.lead || '빈칸에 알맞은 말을 쓰세요.', ko: r.ko || undefined, parts, blanks: n, hangulOk: hangul(alts.flat()) || undefined };
    let k = 0;
    const prompt = sentence.replace(BRACKET, () => (n > 1 ? `${'①②③④'[k++]}＿＿` : '＿＿'));
    const fill = alts.map((a) => a[0]);
    if (fill.join(', ').length > MAX_TEXT_ANSWER) return error('정답', `답은 ${MAX_TEXT_ANSWER}자까지예요.`);
    return {
      questions: [
        // Graded blank by blank (gaps); `answers` is the first filling, for the teacher's screen, as they write it.
        { ...base(id, r, show, '빈칸 쓰기', Math.min(40, 20 + 5 * (n - 1))), mode: 'CUSTOM_TEXT', prompt, options: [], answerIndex: -1, answers: [fill.join(', ')], gaps: alts, fill },
      ],
      problems,
    };
  }
  const answers = alternatives(r.answer);
  if (answers.length === 0) return error('정답', '정답 칸에 답을 써 주세요. 빈칸 문제면 문장의 빈칸 자리를 ___로 써요.');
  if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) return error('정답', `답은 ${MAX_TEXT_ANSWER}자까지예요. 폰에서 그보다 길게는 쓸 수 없어요.`);
  if (!sentence && !r.ko && !r.lead) return error('문장', '문장 칸에 문제로 보여 줄 문장이나 우리말을 써 주세요.');
  if (r.answer.includes('/')) problems.push({ level: 'warning', column: '정답', message: "정답의 / 는 답의 일부로 읽어요. 다른 답을 인정하려면 | 로 나눠요." });
  const show: GrammarShow = { tab: '쓰기', lead: r.lead || '알맞은 답을 쓰세요.', ko: r.ko || undefined, parts: sentence ? [{ text: sentence }] : [], hangulOk: hangul(answers) || undefined };
  return {
    questions: [{ ...base(id, r, show, '문장 쓰기', 40), mode: 'CUSTOM_TEXT', prompt: sentence || r.ko || r.lead, options: [], answerIndex: -1, answers, fill: [answers[0]] }],
    problems,
  };
}

/** Words of `text` with where they start, for picking decoy parts in a 고치기 sentence. */
function wordsOf(text: string, from: number): { text: string; at: number }[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z'’-]*/g)].map((m) => ({ text: m[0], at: from + m.index! }));
}

function fix(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  const raw = tidy(r.sentence);
  const marks = [...raw.matchAll(BRACKET)];
  const wrongs = marks.filter((m) => ARROW.test(m[1]));
  if (wrongs.length === 0) return error('정답', "정답 칸에 '틀린 말 → 고친 말'을 써 주세요. (예: fastly → fast)");
  if (wrongs.length > 1) return error('문장', '고칠 곳은 한 문장에 하나만 써 주세요.');
  if (marks.length > MAX_PARTS) return error('문장', `[ ]로 표시한 곳은 틀린 곳까지 ${MAX_PARTS}곳까지예요. 헷갈리게 할 곳은 3곳까지 표시해 주세요.`);
  // The sentence as students see it, with where each marked part sits in it.
  let plain = '';
  let at = 0;
  const spans: { text: string; start: number; wrong: boolean; fixes: string[] }[] = [];
  for (const m of marks) {
    plain += raw.slice(at, m.index);
    const [before, ...rest] = m[1].split(ARROW);
    const text = tidy(before);
    if (!text) return error('정답', '화살표 앞에 틀린 말을 써 주세요. (예: fastly → fast)');
    if (text.includes('|')) return error('정답', '틀린 말 쪽에는 | 를 쓸 수 없어요. 다른 답은 고친 말 쪽에 써요. (예: to cross → cross|crossing)');
    spans.push({ text, start: plain.length, wrong: ARROW.test(m[1]), fixes: alternatives(rest.join(' ')) });
    plain += text;
    at = m.index! + m[0].length;
  }
  plain += raw.slice(at);
  const wrong = spans.find((s) => s.wrong)!;
  const after = tidy(wrongs[0][1].split(ARROW).slice(1).join(' '));
  if (after && wrong.fixes.length === 0) return error('정답', "고친 말이 비어 있어요. 빼야 하는 말이면 'to → 삭제'처럼 써요.");
  if (wrong.fixes.some((f) => !canon(f))) return error('정답', '문장부호만 고치는 문제는 채점할 수 없어요. 낱말을 고치는 문제로 써 주세요.');
  if (wrong.fixes.some((f) => canon(f) === canon(wrong.text))) return error('정답', `고친 말이 틀린 말 '${wrong.text}'과 같아요.`);
  const chosen = spans.map(({ text, start }) => ({ text, start }));
  if (chosen.length < 4) {
    // Decoys from the rest of the sentence: no articles, nothing inside a marked part, and no word that appears twice
    // (which 'as' would be meant?) or matches the wrong part.
    const taken = (w: { text: string; at: number }) => spans.some((s) => w.at < s.start + s.text.length && w.at + w.text.length > s.start);
    const seen = new Map<string, number>();
    const all = wordsOf(plain, 0);
    for (const w of all) seen.set(w.text.toLowerCase(), (seen.get(w.text.toLowerCase()) ?? 0) + 1);
    const usedText = new Set(chosen.map((c) => c.text.toLowerCase()));
    // A speaker's label (A:, B:) is not part of the sentence.
    const label = (w: { text: string; at: number }) => plain.charAt(w.at + w.text.length) === ':';
    const pool = all.filter((w) => !taken(w) && !label(w) && !ARTICLES.has(w.text.toLowerCase()) && seen.get(w.text.toLowerCase()) === 1 && !usedText.has(w.text.toLowerCase()));
    const rnd = mulberry32(hashString(id));
    for (const w of shuffle(pool, rnd).slice(0, 4 - chosen.length)) chosen.push({ text: w.text, start: w.at });
  }
  if (chosen.length < 2) return error('문장', '틀린 곳 말고 고를 만한 낱말이 없어요. 다른 낱말도 [ ]로 표시해 주세요.');
  chosen.sort((a, b) => a.start - b.start);
  if (new Set(chosen.map((c) => c.text.toLowerCase())).size !== chosen.length) return error('문장', '[ ]로 표시한 곳 중에 같은 말이 있어요. 다른 말을 골라 주세요.');
  const answerIndex = chosen.findIndex((c) => c.start === wrong.start);
  const partsWith = (marked: { text: string; start: number }[]): GrammarPart[] => {
    const parts: GrammarPart[] = [];
    let i = 0;
    marked.forEach((c, k) => {
      parts.push({ text: plain.slice(i, c.start) }, { mark: k, text: c.text });
      i = c.start + c.text.length;
    });
    parts.push({ text: plain.slice(i) });
    return parts;
  };
  const corrected = (f: string) => tidy(plain.slice(0, wrong.start) + f + plain.slice(wrong.start + wrong.text.length));
  const deletion = wrong.fixes.length === 0;
  const find: Question = {
    ...base(`${id}:find`, r, { tab: '고치기', step: 'find', lead: r.lead || '어법상 틀린 곳을 고르세요.', ko: r.ko || undefined, parts: partsWith(chosen) }, '틀린 곳 찾기', 15),
    // When the fix is the next question, this reveal only shows where it was wrong. A word that just has to go is the
    // whole question: there is nothing to type, so its reveal gives the rule.
    explanation: deletion ? r.explanation || undefined : undefined,
    mode: 'CUSTOM_MC',
    prompt: plain,
    options: chosen.map((c) => ({ label: c.text })),
    answerIndex,
    fixedOrder: true,
    noteLabel: `${wrong.text} → ${deletion ? '빼기' : wrong.fixes[0]}`,
  };
  if (deletion) return { questions: [find], problems };
  const answers = wrong.fixes.flatMap((f) => [f, `${wrong.text} → ${f}`, corrected(f)]);
  if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) return error('문장', `문장은 ${MAX_TEXT_ANSWER}자까지예요.`);
  const fixQ: Question = {
    ...base(`${id}:fix`, r, { tab: '고치기', step: 'fix', lead: '밑줄 친 곳을 바르게 고쳐 쓰세요.', ko: r.ko || undefined, parts: partsWith([wrong]), hangulOk: hangul(wrong.fixes) || undefined }, '고쳐 쓰기', 20),
    mode: 'CUSTOM_TEXT',
    prompt: plain,
    options: [],
    answerIndex: -1,
    answers,
    fill: [wrong.fixes[0]],
  };
  return { questions: [find, fixQ], problems };
}

/**
 * One 배열 order as chips and the end mark: the end mark (or a chunk that is only punctuation) comes off the last chip,
 * which it would give away, and a first chunk like 'The clerk' loses the capital that would give the first place away.
 */
function chipsOf(order: string[]): { chips: string[]; end: string } {
  const joined: string[] = [];
  for (const c of order) {
    if (/^[.?!,]+$/.test(c) && joined.length) joined[joined.length - 1] += c;
    else joined.push(c);
  }
  const last = joined.length - 1;
  const end = /[.?!]+$/.exec(joined[last])?.[0] ?? '';
  const chips = joined.map((c, i) => (i === last ? c.slice(0, c.length - end.length).trim() : c)).filter(Boolean);
  const first = chips[0]?.split(' ')[0] ?? '';
  if (/^[A-Z][a-z]*$/.test(first) && SENTENCE_STARTERS.has(first.toLowerCase())) chips[0] = chips[0].charAt(0).toLowerCase() + chips[0].slice(1);
  return { chips, end };
}

/** A line of 배열 chunks: '(let / me / the clerk)', with or without brackets; commas only inside brackets. */
function chunkLine(line: string): string[] | null {
  if (HANGUL.test(line)) return null;
  const inner = /^[([<{]\s*(.*?)\s*[)\]>}]$/.exec(line)?.[1];
  const body = inner ?? line;
  const sep = (body.match(/\//g) ?? []).length >= 2 ? '/' : inner !== undefined && (body.match(/,/g) ?? []).length >= 2 ? ',' : null;
  return sep ? body.split(sep).map(tidy).filter(Boolean) : null;
}

/**
 * The order the chunks take in a finished sentence, compared as words (case, commas, the end mark and didn't = did
 * not don't matter). Chunks it doesn't need are left over; null when some of the sentence isn't in the chunks.
 */
function orderOf(chunks: string[], sentence: string): { order: number[]; unused: number[] } | null {
  const words = (s: string) => canon(s).split(' ').filter(Boolean);
  const target = words(sentence);
  const cw = chunks.map(words);
  const used = new Set<number>();
  const order: number[] = [];
  const go = (at: number): boolean => {
    if (at === target.length) return true;
    const tried = new Set<string>();
    for (let i = 0; i < cw.length; i++) {
      const key = cw[i].join(' ');
      if (used.has(i) || !cw[i].length || tried.has(key)) continue;
      tried.add(key);
      if (cw[i].every((w, k) => target[at + k] === w)) {
        used.add(i);
        order.push(i);
        if (go(at + cw[i].length)) return true;
        used.delete(i);
        order.pop();
      }
    }
    return false;
  };
  if (!go(0)) return null;
  return { order, unused: cw.map((_, i) => i).filter((i) => !used.has(i)) };
}

/** The words of a sentence its chunks can't make, for the error: what is missing or in another form. */
function missingWords(chunks: string[], sentence: string): string[] {
  const have = new Map<string, number>();
  for (const w of chunks.flatMap((c) => canon(c).split(' ')).filter(Boolean)) have.set(w, (have.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of canon(sentence).split(' ').filter(Boolean)) {
    if (have.get(w)) have.set(w, have.get(w)! - 1);
    else out.push(w);
  }
  return out;
}

function arrange(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  // A worksheet may put the chunks right after the Korean cue on the same line: split them off.
  const lines = r.sentence
    .split(/\r?\n/)
    .map(tidy)
    .filter(Boolean)
    .flatMap((l) => {
      const m = /^(.*[가-힣].*?)\s*([([<{][^()[\]<>{}]*\/[^()[\]<>{}]*\/[^()[\]<>{}]*[)\]>}])$/.exec(l);
      return m ? [tidy(m[1]), m[2]] : [l];
    });
  let chunkAt = -1;
  lines.forEach((l, i) => {
    if (chunkLine(l)) chunkAt = i;
  });
  const listed = chunkAt >= 0 ? chunkLine(lines[chunkAt])! : null;
  const answer = tidy(r.answer);
  // The Korean cue (and any other line) is shown above the chips, like 우리말; older files have the 우리말 column.
  const others = lines.filter((_, i) => i !== chunkAt);
  const ko = [r.ko, ...others.filter((l) => HANGUL.test(l))].filter(Boolean).join('\n');
  const sentence = others.filter((l) => !HANGUL.test(l)).join(' ');
  let raw: string;
  let shown: string[] | undefined;
  let extras: string[] = [];
  if (answer.includes('/')) {
    // The older form: 정답 in chunks, in answer order.
    raw = answer;
    if (listed) {
      const key = (cs: string[]) => cs.map((c) => canon(c)).sort().join('\u0001');
      if (key(listed) !== key(answer.split('|')[0].split('/').map(tidy).filter(Boolean))) return error('정답', '문장의 조각과 정답의 조각이 달라요. 정답 칸에는 완성 문장을 써 주세요.');
    }
  } else if (!answer) {
    // A bare chunk line with 정답 empty is an older file's chunks in answer order; anything else misses its answer.
    if (listed && lines.length === 1 && !/^[([<{]/.test(lines[0]) && r.ko) {
      raw = lines[0];
      problems.push({ level: 'warning', column: '정답', message: `문장의 조각 순서를 정답으로 읽었어요: ${finished(chipsOf(listed).chips, chipsOf(listed).end)} 맞지 않으면 정답 칸에 완성 문장을 써 주세요.` });
    } else return error('정답', '정답 칸에 완성 문장을 써 주세요. (예: The clerk let me try on the scarf.)');
  } else {
    const chunks = (listed ?? answer.replace(/[.?!]+$/, '').split(' ')).filter((c) => canon(c));
    if (!listed) problems.push({ level: 'warning', column: '문장', message: '조각이 없어서 정답을 낱말마다 나눴어요. 조각을 정하려면 문장 칸에 (조각 / 조각 / …)을 써 주세요.' });
    const alts = alternatives(answer);
    const found = alts.map((a) => orderOf(chunks, a));
    const bad = found.findIndex((f) => !f);
    if (bad >= 0) {
      const miss = missingWords(chunks, alts[bad]);
      return error('정답', miss.length ? `'${miss.join(' ')}'은 조각에 없어요 (조각: ${chunks.join(' / ')}). 형태를 바꾸는 문제는 문법 쓰기 탭에 써 주세요.` : `조각 (${chunks.join(' / ')})으로 '${alts[bad]}'를 만들 수 없어요. 조각과 정답을 확인해 주세요.`);
    }
    const unused = found[0]!.unused;
    if (found.some((f) => f!.unused.join() !== unused.join())) return error('정답', '| 뒤의 다른 정답도 같은 조각으로 만들어야 해요.');
    extras = unused.map((i) => chunks[i].replace(/[.?!]+$/, ''));
    if (extras.length) problems.push({ level: 'warning', column: '문장', message: `'${extras.join("', '")}'은 정답에 쓰이지 않아서 헷갈리게 하는 조각으로 나와요.` });
    // The chunks in each answer's order, the answer's own end mark on the last ('.' is the default).
    raw = found
      .map((f, k) => {
        const end = /[?!]+$/.exec(alts[k])?.[0] ?? '';
        return f!.order.map((i) => chunks[i]).join(' / ') + end;
      })
      .join('|');
    shown = alts;
  }
  const orders = raw.split('|').map((o) => chipsOf(o.split('/').map(tidy).filter(Boolean))).filter((o) => o.chips.length > 0);
  if (orders.length === 0) return error('정답', '정답 칸에 완성 문장을 써 주세요. (예: The clerk let me try on the scarf.)');
  const chips = orders[0].chips;
  if (chips.length < 3) return error('정답', '조각은 3개 이상이어야 해요. (예: (I / drink / milk))');
  if (chips.length + extras.length > MAX_CHIPS) return error('정답', `조각은 ${MAX_CHIPS}개까지예요. 몇 개를 묶어 주세요.`);
  const key = (o: string[]) => o.map(normalizeAnswer).sort().join('\u0001');
  if (orders.slice(1).some((o) => key(o.chips) !== key(chips))) return error('정답', '| 뒤의 다른 정답도 같은 조각으로 만들어야 해요.');
  const all = [...chips, ...extras.map((c) => (/^[A-Z][a-z]*$/.test(c.split(' ')[0]) && SENTENCE_STARTERS.has(c.split(' ')[0].toLowerCase()) ? c.charAt(0).toLowerCase() + c.slice(1) : c))];
  const rnd = mulberry32(hashString(id));
  let mixed = shuffle(all, rnd);
  for (let k = 0; k < 5 && mixed.join('\u0001') === all.join('\u0001'); k++) mixed = shuffle(all, rnd);
  if (mixed.join('\u0001') === all.join('\u0001')) mixed = [...all.slice(1), all[0]];
  const answers = shown ?? orders.map((o) => finished(o.chips, o.end));
  if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) return error('정답', `문장은 ${MAX_TEXT_ANSWER}자까지예요.`);
  const show: GrammarShow = {
    tab: '배열',
    lead: r.lead || (ko ? '우리말과 같도록 조각을 순서대로 누르세요.' : '조각을 순서대로 눌러 문장을 만드세요.'),
    ko: ko || undefined,
    parts: sentence ? [{ text: sentence }] : [],
    chips: mixed,
  };
  return {
    questions: [
      { ...base(id, r, show, '배열', Math.max(20, Math.min(45, 15 + 2 * all.length))), mode: 'CUSTOM_TEXT', prompt: ko || sentence || show.lead, options: [], answerIndex: -1, answers, fill: [answers[0]] },
    ],
    problems,
    // Hashed as an older file would have written it: 우리말, and the chunks in answer order in 정답.
    idRow: { ...r, ko, sentence, answer: extras.length ? `${raw} ~ ${extras.join(' / ')}` : raw },
  };
}

/**
 * The example rows of the template (M2_L7.xlsx), by tab: recognized by their content, so the tabs need no column to
 * mark them. A row the teacher has edited is a question of their own. The 배열 example of the first template is kept,
 * so a file made from it still reads the same.
 */
const TEMPLATE_EXAMPLES: Record<GrammarTab, Record<string, string>[]> = {
  고르기: [
    { 문장: 'I want (to go / going) home.', 정답: 'to go' },
    { 문장: '바른 문장을 고르세요.', 보기1: 'He make me laugh.', 보기2: 'He makes me laugh.', 정답: '2' },
    { 문장: '가방 A 3kg, 가방 B 3kg\nBag A is as heavy as Bag B.', 정답: 'O' },
    // The templates before the 문장 cell took 우리말 and the question.
    { 지시문: '바른 문장을 고르세요.', 보기1: 'He make me laugh.', 보기2: 'He makes me laugh.', 정답: '2' },
    { 우리말: '가방 A 3kg, 가방 B 3kg', 문장: 'Bag A is as heavy as Bag B.', 정답: 'O' },
  ],
  쓰기: [
    { 문장: "그는 우유를 좋아하지 않는다.\nHe ___ like milk.", 정답: "doesn't" },
    { 지시문: 'and로 한 문장을 만드세요.', 문장: 'I like cats. I like dogs.', 정답: 'I like cats and dogs.|I like dogs and cats.' },
    // Earlier templates: the answer in [ ], and the 우리말 in its own column.
    { 문장: "그는 우유를 좋아하지 않는다.\nHe [doesn't] like milk." },
    { 우리말: '그는 우유를 좋아하지 않는다.', 문장: "He [doesn't] like milk." },
  ],
  고치기: [{ 문장: 'She go to school every day.', 정답: 'go → goes' }, { 문장: 'She [go → goes] to school every day.' }],
  배열: [
    { 문장: '엄마는 내가 매일 우유를 마시게 하신다.\n(drink / my mom / milk / every day / makes / me)', 정답: 'My mom makes me drink milk every day.' },
    { 우리말: '엄마는 내가 매일 우유를 마시게 하신다.', 정답: 'my mom / makes / me / drink / milk / every day' },
    { 우리말: '나는 매일 아침 우유를 마신다.', 정답: 'I / drink / milk / every morning' },
  ],
};
const EXAMPLE_FIELDS = ['문장', '정답', '보기1', '보기2', '보기3', '보기4', '우리말', '지시문'];
// Normalized the way rows are read, so an example written back by a tool (\n, <br>, curly quotes) is still one.
const exampleKey = (cells: Record<string, string>) => EXAMPLE_FIELDS.map((f) => tidy(fold(clean(cells[f] ?? '')))).join('\u0001');
const EXAMPLE_KEYS = Object.fromEntries(GRAMMAR_TABS.map((t) => [t, new Set(TEMPLATE_EXAMPLES[t].map(exampleKey))])) as Record<GrammarTab, Set<string>>;

/** How many example rows the template has right under each tab's header. */
export const TEMPLATE_EXAMPLE_ROWS: Record<GrammarTab, number> = { 고르기: 3, 쓰기: 2, 고치기: 1, 배열: 1 };

/** A row of a 문법 tab, by canonical header, that is one of the template's own examples. */
export function isTemplateExample(tab: GrammarTab, cells: Record<string, string>): boolean {
  return EXAMPLE_KEYS[tab].has(exampleKey(cells));
}

// ---------- Reading a row: 문장 (what students see) + 정답 (the answer) ----------
//
// Every tab is one pair, the way a worksheet has a question and an answer key. What the teacher pastes is read into
// the inline form the builders above take ([let] for a blank, [fastly → fast] for the part to fix, chunks / in answer
// order for 배열), which is also how older files wrote it, so the same question has the same id either way.

const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;
/** A blank to fill: ___ (two or more), or an empty ( ) or [ ]. */
const BLANK = /_{2,}|\(\s*\)|\[\s*\]/g;
/** A 고치기 or arrow-marked part ([fastly → fast]). */
const FIX_MARK = /\[[^[\]]*(?:→|->|=>|⇒|➔|➡|⇨|⟶|➜|➝|-->)[^[\]]*\]/;
const ARROWS = /\s*(?:-->|→|->|=>|⇒|➔|➡|⇨|⟶|➜|➝)\s*/;
/** What a fix may say instead of a word when the word just has to go (or any Korean, for an English word). */
const DELETE_WORDS = new Set(['', '삭제', '빼기', '생략', '없음', '지우기', '지움', '불필요', '(삭제)', '(없음)', '(생략)', 'x', '×', '-', '—', '∅', 'ø', 'delete', '(delete)', 'omit']);
const isDeletion = (right: string) => DELETE_WORDS.has(right.toLowerCase()) || (HANGUL.test(right) && !LATIN.test(right));
/** Grammar terms a key writes in brackets after an answer: a note, not another answer. */
const TERMS = /^(?:adverb|adjective|adj|adv|noun|verb|past|present|participle|p\.?p\.?|base form|plural|singular|comparative|superlative|gerund|infinitive|to-infinitive)\.?$/i;

/**
 * One answer in an answer key, as accepted answers: 'as(so)' or 'as[so]' lists another one, '(과거형)' or '(adverb)'
 * is a note and dropped, 'go → went' (the form to change, then the answer) is the answer. No [ ] stays in it.
 */
function answerPiece(raw: string, split: RegExp): string[] {
  let t = tidy(raw);
  const arrow = t.split(ARROWS);
  if (arrow.length === 2 && tidy(arrow[1])) t = tidy(arrow[1]);
  t = t.replace(/\s*[([［]([^()[\]［］]*)[)\]］]/g, (_m, y: string) => (HANGUL.test(y) || TERMS.test(tidy(y)) || !tidy(y) ? '' : `|${tidy(y)}`));
  return alternatives(t.replace(/[[\]［］]/g, ''), split);
}

const blankRe = () => new RegExp(BLANK.source, 'g');
/** A blank counts on a line with English in it: '( ) 안의 말을 이용하여…' is an instruction, not a blank. */
const hasBlank = (l: string) => LATIN.test(l.replace(blankRe(), '')) && blankRe().test(l);
function fold(s: string): string {
  return s.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ok = <T>(row: T): { row: T; problems: GrammarProblem[] } => ({ row, problems: [] });

/** Full-width marks typed with the Korean input on, invisible characters from a PDF, and \n or <br> from a tool. */
function clean(s: string): string {
  return s
    .replace(/\\n|<br\s*\/?>/gi, '\n')
    .replace(/＿+/g, '__')
    .replace(/／/g, '/')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/｜/g, '|')
    .replace(/，/g, ',')
    .replace(/[　 ]/g, ' ')
    .replace(/[​-‍﻿]/g, '');
}

/** A worksheet's instruction line ('…빈칸에 알맞은 말을 쓰세요.'), by the task it asks for at its end and what it names. */
const TASK_WORDS = /빈칸|괄호|어법|문장|우리말|다음|알맞은|바르게|바른|틀린|보기|배열|영작|정보|맞으면|형태|순서|대화|주어진|고친|밑줄|해석|낱말|단어|표현/;
const INSTRUCTION = /(?:고르|쓰|고치|고쳐 ?쓰|배열하|바꾸|바꿔 ?쓰|만드|만들|완성하|영작하|옮기|옮겨 ?쓰|채우|찾으|연결하|답하)(?:세요|시오|십시오|라)[.?!]*$|것은\??$|것을 고르(?:세요|시오)\.?$/;

/** Pasting a worksheet's question cell brings its instruction on the first line: that line is the 지시문. */
function instruction(r: GrammarRow): GrammarRow {
  const lines = r.sentence.split(/\r?\n/);
  const at = lines.findIndex((l) => tidy(l));
  if (at < 0) return r;
  const first = tidy(lines[at]).replace(/^\d+[.)]\s*/, '');
  if (!HANGUL.test(first) || !INSTRUCTION.test(first) || !TASK_WORDS.test(first)) return r;
  // The instruction line holds no question of its own, and something follows it ('하나를 고르세요.' alone may be 우리말).
  if (new RegExp(CHOICE.source).test(first) || HAS_BRACKET.test(first) || hasBlank(first)) return r;
  const rest = lines.slice(at + 1).join('\n');
  if (!tidy(rest)) return r;
  if (!r.lead) return { ...r, lead: first, sentence: rest };
  return tidy(r.lead) === first ? { ...r, sentence: rest } : r;
}

/**
 * Lines of a 문장 cell, with a sentence that was broken across lines (pasted from a PDF or HWP) joined again: a line
 * that starts in lowercase, with a mark or a blank carries on an English line above that doesn't end a sentence.
 */
function linesOf(cell: string): string[] {
  const out: string[] = [];
  for (const l of cell.split(/\r?\n/).map(tidy).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (prev !== undefined && !HANGUL.test(prev) && !/[.?!:]["'’”)\]]*$/.test(prev) && /^[a-z([_]/.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}

/** 고치기's 정답: the wrong words and their fixes ('fastly → fast', 'to →', 'to 삭제'), or null for a corrected sentence. */
function fixAnswer(raw: string): { wrong: string; fixes: string[]; note: string } | { error: string } | null {
  let t = tidy(raw)
    .replace(/^(?:[①-④]|\(?[1-4][).]|[1-4]\.)\s*,?\s*/, '')
    .replace(/^["'“‘]|["'”’]$/g, '');
  let note = '';
  // A Korean note at the end goes to 해설; '(삭제)' after the arrow says the word goes.
  const m = /\s*\(([^()]*[가-힣][^()]*)\)\s*$/.exec(t);
  if (m && !DELETE_WORDS.has(tidy(m[1])) && !ARROWS.test(t.slice(Math.max(0, m.index - 3), m.index + 1) + ' ') ) {
    note = tidy(m[1]);
    t = t.slice(0, m.index);
  }
  const sides = t.split(ARROWS);
  if (sides.length > 2) return { error: '한 줄에는 고칠 곳 하나만 써 주세요. 틀린 곳이 둘이면 두 줄로 나누고, 줄마다 다른 틀린 곳은 고친 채로 문장에 써요.' };
  if (sides.length === 2) {
    const wrong = tidy(sides[0]).replace(/^["'“‘]|["'”’]$/g, '');
    const right = tidy(sides[1]).replace(/^["'“‘]|["'”’]$/g, '');
    if (!wrong) return { error: "정답의 화살표 앞에 틀린 말을 써 주세요. (예: fastly → fast)" };
    return { wrong, fixes: isDeletion(right) ? [] : answerPiece(right, /[|,/]/), note };
  }
  const del = /^(.+?)\s*(?:삭제|빼기|생략|지우기|지움|없애기)$/.exec(t);
  if (del && LATIN.test(del[1])) return { wrong: tidy(del[1]), fixes: [], note };
  return null;
}

/** Words of a sentence with where they are, for finding the wrong part: quotes folded, letters, digits, ' and -. */
function tokens(s: string): { w: string; at: number; end: number }[] {
  return [...fold(s).matchAll(/[A-Za-z0-9][A-Za-z0-9'-]*/g)].map((m) => ({ w: m[0], at: m.index!, end: m.index! + m[0].length }));
}

/** Where `wrong` appears in `text` as whole words, outside [ ]: case as written first, then ignoring case. */
function findWords(text: string, wrong: string): { at: number; end: number }[] {
  const ws = tokens(wrong).map((t) => t.w);
  if (ws.length === 0) return [];
  const inBracket = (i: number) => {
    const open = text.lastIndexOf('[', i);
    return open >= 0 && text.indexOf(']', open) >= i && text.lastIndexOf(']', i - 1) < open;
  };
  const toks = tokens(text);
  const hits = (same: (a: string, b: string) => boolean) => {
    const out: { at: number; end: number }[] = [];
    for (let i = 0; i + ws.length <= toks.length; i++) {
      if (ws.every((w, k) => same(toks[i + k].w, w)) && !inBracket(toks[i].at)) out.push({ at: toks[i].at, end: toks[i + ws.length - 1].end });
    }
    return out;
  };
  const exact = hits((a, b) => a === b);
  return exact.length ? exact : hits((a, b) => a.toLowerCase() === b.toLowerCase());
}

/** Words of tokens with contractions spelled out (didn't = did not), each pointing back at its token. */
function spelled(toks: { w: string }[]): { w: string; t: number }[] {
  return toks.flatMap((tok, t) => canon(tok.w).split(' ').filter(Boolean).map((w) => ({ w, t })));
}

/**
 * A corrected sentence written as 고치기's 정답, compared with the sentence word by word: the one stretch that differs
 * is the wrong part and its fix. A word only added ('tall → as tall') takes the word before it along. More than one
 * changed place is 'multi' (the teacher writes 틀린 말 → 고친 말 then).
 */
function diffFix(sentence: string, corrected: string): { at: number; end: number; fix: string } | 'multi' | null {
  const A = tokens(sentence);
  const B = tokens(corrected);
  if (!A.length || !B.length) return null;
  const a = spelled(A);
  const b = spelled(B);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].w === b[pre].w) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].w === b[b.length - 1 - suf].w) suf++;
  if (pre === a.length && pre === b.length) return null;
  let i = pre;
  let j = a.length - suf;
  let k = pre;
  let l = b.length - suf;
  const midB = new Set(b.slice(k, l).map((x) => x.w));
  if (a.slice(i, j).some((x) => midB.has(x.w))) return 'multi';
  if (i === j) {
    // Nothing removed: widen by a word so there is something to point at.
    if (i > 0) {
      i--;
      k--;
    } else if (j < a.length) {
      j++;
      l++;
    } else return null;
  }
  const at = A[a[i].t].at;
  const end = A[a[j - 1].t].end;
  const fix = l > k ? tidy(fold(corrected).slice(B[b[k].t].at, B[b[l - 1].t].end)) : '';
  return { at, end, fix };
}

/** Which line of a several-line 문장 the question starts on; the lines above it are shown first. */
function questionStart(tab: GrammarTab, r: GrammarRow, lines: string[]): number {
  const last = lines.length - 1;
  const firstOf = (p: (l: string) => boolean) => lines.findIndex(p);
  const blanks = firstOf(hasBlank);
  if (tab === '쓰기') {
    if (blanks >= 0) return blanks;
    // With a 정답 to write, a [ ] is a blank only if what it holds is in the 정답: a [보기] or [조건] box is not.
    const answers = alternatives(r.answer).map(normalizeAnswer).filter(Boolean);
    const inline = (l: string) => [...l.matchAll(BRACKET)].some((m) => !answers.length || alternatives(m[1], /[|/]/).some((a) => answers.some((x) => x.includes(normalizeAnswer(a)))));
    const at = firstOf(inline);
    return at >= 0 ? at : last;
  }
  if (tab === '고르기') {
    if (blanks >= 0) return blanks;
    if (r.options.some((o) => tidy(o)) || oxAnswer(r.answer)) return last;
    // The (A / B) that holds the 정답, so a fact in brackets above it stays a fact.
    const holds = (l: string) =>
      [...l.matchAll(CHOICE)].some((m) => {
        const parts = m[1].split('/').map(tidy);
        return parts.some((p) => normalizeAnswer(p) === normalizeAnswer(r.answer)) || (numberAnswer(r.answer) >= 0 && numberAnswer(r.answer) < parts.length);
      });
    const at = firstOf(holds);
    return at >= 0 ? at : Math.max(0, firstOf((l) => new RegExp(CHOICE.source).test(l)));
  }
  // 고치기: the line with the part to fix (marked, or found from the 정답), or an earlier line with decoys marked.
  const bracket = firstOf((l) => HAS_BRACKET.test(l));
  const upTo = (at: number) => (bracket >= 0 && bracket < at ? bracket : at);
  const marked = firstOf((l) => FIX_MARK.test(l));
  if (marked >= 0) return upTo(marked);
  const fa = fixAnswer(r.answer);
  if (fa && !('error' in fa)) {
    const at = firstOf((l) => findWords(l, fa.wrong).length > 0);
    if (at >= 0) return upTo(at);
  } else if (!fa && r.answer.trim()) {
    // A corrected sentence: the English line that differs from it the least.
    let best = last;
    let score = -1;
    lines.forEach((l, i) => {
      if (!LATIN.test(l)) return;
      const d = diffFix(l, r.answer);
      const s = d && d !== 'multi' ? tokens(l).length - tokens(fold(l).slice(d.at, d.end)).length : -1;
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return upTo(best);
  }
  return bracket >= 0 ? bracket : last;
}

/**
 * A 문장 cell written on several lines (Alt+Enter) carries what students see first above the question: facts to check
 * it against, or its 우리말 뜻. Those lines join the 우리말 column's text (older files keep that column), in order. The
 * question runs from its start line (questionStart) to the end, so a dialogue keeps all its blanks and no answer is
 * shown above the question; O/X and 보기1~4 rows ask the bottom line. A Korean line where no English sentence is
 * needed (문장 고르기's question, the 우리말 of an 영작 쓰기) is the lead or the 우리말, as an older file wrote it.
 */
function given(tab: GrammarTab, r: GrammarRow): GrammarRow {
  let out = r;
  const lines = linesOf(r.sentence);
  if (lines.length > 1) {
    const at = questionStart(tab, r, lines);
    out = { ...r, ko: [r.ko, ...lines.slice(0, at)].filter(Boolean).join('\n'), sentence: lines.slice(at).join(' ') };
  }
  const sentence = tidy(out.sentence);
  if (tab === '고르기' && out.options.some((o) => tidy(o)) && !new RegExp(CHOICE.source).test(sentence) && !hasBlank(sentence) && HANGUL.test(sentence)) {
    out = out.lead ? { ...out, ko: [out.ko, sentence].filter(Boolean).join('\n'), sentence: '' } : { ...out, lead: sentence, sentence: '' };
  }
  if (tab === '쓰기' && !HAS_BRACKET.test(sentence) && !hasBlank(sentence) && HANGUL.test(sentence) && !LATIN.test(sentence)) {
    out = { ...out, ko: [out.ko, sentence].filter(Boolean).join('\n'), sentence: '' };
  }
  return out;
}

/** 문장 고르기 pasted with its options on lines of their own (① …, ② …) when the 보기 columns are empty. */
function optionLines(r: GrammarRow): GrammarRow {
  if (r.options.some((o) => tidy(o)) || oxAnswer(r.answer) || new RegExp(CHOICE.source).test(r.sentence)) return r;
  // Numbered fact lines above an O/X or (A / B) question are facts: options only for a 정답 that is a number.
  if (numberAnswer(r.answer) < 0 && !/^(?:[①-④]|\(?[1-4][).]|[1-4]번)\s*\S/.test(r.answer.trim())) return r;
  const marker = /^(?:([①-④])|\(([1-4])\)|([1-4])\))\s*(.+)$/;
  const lines = r.sentence.split(/\r?\n/).map(tidy).filter(Boolean);
  const opts = lines.map((l) => marker.exec(l));
  if (opts.filter(Boolean).length < 2) return r;
  const options = ['', '', '', ''];
  for (const m of opts) if (m) options[m[1] ? '①②③④'.indexOf(m[1]) : Number(m[2] ?? m[3]) - 1] = m[4];
  return { ...r, options, sentence: lines.filter((_, i) => !opts[i]).join('\n') };
}

/** 고르기: ___ with 보기 words, or with a (A / B) group after it, or (A, B) with commas, read as (A / B) inline. */
function chooseForm(r: GrammarRow): { row: GrammarRow; problems: GrammarProblem[] } | { error: [string, string] } {
  const s = r.sentence;
  const blanks = [...s.matchAll(blankRe())].filter(() => hasBlank(s));
  const groups = [...s.matchAll(CHOICE)];
  const opts = r.options.map(tidy);
  if (blanks.length === 1 && groups.length === 1) {
    // 'The clerk let me ___ on the sneakers. (try / to try)': the choices go where the blank is.
    const g = groups[0];
    const rest = tidy(`${s.slice(0, g.index)} ${s.slice(g.index! + g[0].length)}`);
    return ok({ ...r, sentence: rest.replace(blankRe(), `(${g[1].split('/').map(tidy).join(' / ')})`) });
  }
  if (blanks.length === 1 && groups.length === 0 && opts.some(Boolean)) {
    const kept = opts.filter(Boolean);
    if (kept.some((o) => o.length > 28 || /[/()[\]]/.test(o)) || new Set(kept.map(normalizeAnswer)).size !== kept.length) return ok(r);
    const col = numberAnswer(r.answer);
    const answer = col >= 0 && opts[col] ? opts[col] : r.answer;
    return ok({ ...r, sentence: s.replace(blankRe(), `(${kept.join(' / ')})`), options: ['', '', '', ''], answer });
  }
  if (blanks.length > 0 && groups.length === 0 && !opts.some(Boolean) && !oxAnswer(r.answer)) {
    return { error: ['보기1', '빈칸 ___에 들어갈 보기를 보기1~4에 쓰거나, 문장에 (try / to try)처럼 써 주세요.'] };
  }
  if (groups.length === 0 && !opts.some(Boolean) && !oxAnswer(r.answer) && r.answer.trim()) {
    // (try, to try): commas inside one group whose part is the 정답.
    const comma = [...s.matchAll(/\(([^()]*,[^()]*)\)/g)].find((m) => m[1].split(',').some((p) => normalizeAnswer(p) === normalizeAnswer(r.answer)));
    if (comma) return ok({ ...r, sentence: s.replace(comma[0], `(${comma[1].split(',').map(tidy).join(' / ')})`) });
  }
  // '② My mom made me clean my room.' in 정답: the number.
  const lead = /^([①-④]|\(?[1-4][).]|[1-4]번)\s*\S/.exec(r.answer.trim());
  if (lead && opts.some(Boolean)) return ok({ ...r, answer: lead[1] });
  return ok(r);
}

/** A sentence as it lines up with its answer key: hints in ( ) or [ ] and speaker labels (A:, B:) left out. */
function bare(x: string): string {
  return fold(tidy(x))
    .replace(/\s*(?:\([^()]*[^\s()][^()]*\)|\[[^[\]]*[^\s[\]][^[\]]*\]|［[^［］]*］)/g, ' ')
    .replace(/(^|[\s.?!])[A-Z]\s*:\s+/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[.?!]+$/, '');
}

/**
 * Splits 쓰기's 정답 into one answer per blank: the finished sentence lined up with the blanks, ① let ② exchange, or
 * pieces separated by , / or ; (the first that gives one per blank), or one word per blank. Within a piece, | (or / when
 * it doesn't separate the blanks) lists other answers. A finished sentence that doesn't line up is an error, not one
 * long answer.
 */
function blankAnswers(sentence: string, answer: string, n: number): string[][] | { error: string } | null {
  const frame = bare(sentence);
  // The finished sentence: what fills each blank, read off by lining it up with the sentence around the blanks.
  const lineUp = (f: (x: string) => string) => {
    const segments = frame.split(blankRe()).map((x) => tidy(f(x)));
    const pattern = segments.map((x, i) => (i === 0 ? '' : segments[i - 1] === '' && i > 1 ? '\\s+' : '\\s*') + (i === 0 ? '' : '(\\S(?:.*?\\S)?)') + (x ? `\\s*${x.split(' ').map(escapeRe).join('\\s+')}` : '')).join('');
    return alternatives(answer)
      .map((a) => new RegExp(`^\\s*${pattern}\\s*[.?!]*$`, 'i').exec(f(bare(a))))
      .filter((m): m is RegExpExecArray => !!m && m.length === n + 1);
  };
  let fits = lineUp((x) => x);
  // didn't = did not, commas: lined up again in the grader's terms.
  if (!fits.length) fits = lineUp(canon);
  if (fits.length) return Array.from({ length: n }, (_, i) => [...new Set(fits.map((m) => tidy(m[i + 1])))]);
  if (n === 1) {
    const words = (x: string) => canon(x).split(' ').filter(Boolean);
    const [before, after] = frame.split(blankRe()).map(words);
    const whole = alternatives(answer, /[|/]/).some((a) => {
      const w = words(bare(a));
      return (before.length > 0 || after.length > 0) && w.length > before.length + after.length && (!before.length || w[0] === before[0]) && (!after.length || w[w.length - 1] === after[after.length - 1]);
    });
    if (whole) return { error: '정답이 완성 문장이면 빈칸 앞뒤가 문장과 똑같아야 해요. 빈칸에 들어갈 말만 써도 돼요.' };
    return [answerPiece(answer, /[|/]/)];
  }
  const labeled = answer.split(/\s*(?:[①-④]|\([A-Da-d1-4]\)|[ⓐ-ⓓ]|\b[A-D]\)|\b[1-4]\))\s*/).map(tidy).filter(Boolean);
  if (labeled.length === n && /[①-④ⓐ-ⓓ]|\([A-Da-d1-4]\)|\b[A-D1-4]\)/.test(answer)) return labeled.map((p) => answerPiece(p, /[|/]/));
  for (const sep of [',', '/', ';']) {
    const pieces = answer.split(sep).map(tidy);
    if (pieces.length === n && pieces.every(Boolean)) return pieces.map((p) => answerPiece(p, sep === '/' ? /\|/ : /[|/]/));
  }
  const words = tidy(answer).split(' ');
  if (!answer.includes('|') && words.length === n) return words.map((w) => [w]);
  return null;
}

/** 쓰기: blanks written as ___ with their answers in 정답, read as [answer] in the sentence. */
function writeForm(r: GrammarRow): { row: GrammarRow; problems: GrammarProblem[] } | { error: [string, string] } {
  const s = r.sentence;
  const n = hasBlank(s) ? (s.match(blankRe()) ?? []).length : 0;
  const problems: GrammarProblem[] = [];
  if (n === 0) {
    const raw = r.cells.문장 ?? '';
    const pieces = r.answer.split(',').map(tidy).filter(Boolean);
    const gap = /\S {3,}\S/.test(raw) && !HAS_BRACKET.test(s);
    // A list of single words with no blank in the sentence: most likely blanks lost in a paste (an error when the
    // sentence shows the gaps, otherwise a warning; 'Yes, I do' and 'went, gone' are answers too).
    const list = pieces.length >= 2 && pieces.every((p) => p.split(' ').length === 1) && !HAS_BRACKET.test(s) && LATIN.test(s);
    if (list && gap) return { error: ['문장', `빈칸 ___을 못 찾았어요. 정답 '${tidy(r.answer)}'이 들어갈 자리를 문장에 ___로 써 주세요.`] };
    if (list) problems.push({ level: 'warning', column: '정답', message: `정답이 쉼표로 나뉜 낱말이에요. 빈칸 문제면 문장에 ___를 써 주세요. 지금은 '${tidy(r.answer)}' 전체를 한 답으로 읽었어요.` });
    else if (gap) problems.push({ level: 'warning', column: '문장', message: '문장에 빈칸처럼 띄운 곳이 있어요. 빈칸이면 ___로 써 주세요.' });
    if (oxAnswer(r.answer) && !HAS_BRACKET.test(s)) problems.push({ level: 'warning', column: '정답', message: 'O/X(T/F) 문제는 문법 고르기 탭에 쓰면 운동장에서 골라요.' });
    const visible = alternatives(r.answer).find((a) => a.split(' ').length <= 4 && fold(s).toLowerCase().includes(fold(a).toLowerCase()) && canon(a) !== canon(s));
    if (visible && LATIN.test(s)) problems.push({ level: 'warning', column: '문장', message: `정답 '${visible}'이 문장에 그대로 보여요. 빈칸이면 그 자리를 ___로 써 주세요.` });
    return { row: r, problems };
  }
  if (!r.answer.trim()) return { error: ['정답', `빈칸 ___에 들어갈 답을 정답 칸에 써 주세요.${n > 1 ? ' 빈칸이 여럿이면 순서대로 쉼표로 나눠요. (예: let, exchange)' : ''}`] };
  if (n > MAX_BLANKS) return { error: ['문장', `빈칸은 ${MAX_BLANKS}개까지예요.`] };
  const per = blankAnswers(s, r.answer, n);
  if (per && 'error' in per) return { error: ['정답', per.error] };
  if (!per || per.some((a) => a.length === 0)) {
    return { error: ['정답', `빈칸이 ${n}개인데 정답 '${tidy(r.answer)}'을 ${n}개로 나눌 수 없어요. 빈칸 순서대로 쉼표로 나눠 써 주세요. (예: ${Array.from({ length: n }, (_, i) => ['not', 'as', 'as', 'that'][i]).join(', ')})`] };
  }
  if (n === 1 && r.answer.split(',').length >= 2 && r.answer.split(',').every((p) => tidy(p).split(' ').length === 1)) {
    problems.push({ level: 'warning', column: '정답', message: `빈칸은 1개인데 정답에 쉼표가 있어요. '${tidy(r.answer)}' 전체를 한 답으로 읽었어요. 다른 답도 인정하려면 | 로 나눠요.` });
  }
  // Brackets already in the sentence are hints ([go]), not blanks: shown as they are.
  let k = 0;
  const sentence = s.replace(/\[([^[\]]+)\]/g, '［$1］').replace(blankRe(), () => `[${per[k++].join('|')}]`);
  return { row: { ...r, sentence, answer: '' }, problems };
}

/** 고치기: the sentence as students see it with 'fastly → fast' (or the corrected sentence) in 정답, read as [fastly → fast]. */
function fixForm(r: GrammarRow): { row: GrammarRow; problems: GrammarProblem[] } | { error: [string, string] } {
  const s = r.sentence;
  const inline = FIX_MARK.exec(s);
  if (inline) {
    // The older form; a 정답 that says the same is fine.
    if (r.answer.trim()) {
      const fa = fixAnswer(r.answer);
      const [before, ...rest] = inline[0].slice(1, -1).split(ARROWS);
      if (fa && !('error' in fa) && (canon(fa.wrong) !== canon(before) || canon(fa.fixes.join('|')) !== canon(alternatives(rest.join(' ')).join('|')))) {
        return { error: ['정답', `문장의 ${inline[0]}와 정답 '${tidy(r.answer)}'이 달라요. 한쪽만 써 주세요.`] };
      }
    }
    return ok({ ...r, answer: '' });
  }
  if (!r.answer.trim()) return { error: ['정답', "정답 칸에 '틀린 말 → 고친 말'을 써 주세요. (예: fastly → fast)"] };
  const fa = fixAnswer(r.answer);
  if (fa && 'error' in fa) return { error: ['정답', fa.error] };
  const explanation = r.explanation || (fa?.note ?? '');
  let span: { at: number; end: number };
  let fixes: string[];
  if (fa) {
    fixes = fa.fixes;
    // A bracket holding the wrong words says which of them it is; other brackets are decoys.
    const marked = [...s.matchAll(BRACKET)].find((m) => canon(m[1]) === canon(fa.wrong));
    if (marked) {
      const text = tidy(marked[1]);
      return ok({ ...r, explanation, sentence: `${s.slice(0, marked.index)}[${text} → ${fixes.join('|')}]${s.slice(marked.index! + marked[0].length)}`.replace('→ ]', '→]'), answer: '' });
    }
    const found = findWords(s, fa.wrong);
    if (found.length === 0) return { error: ['정답', `정답의 '${fa.wrong}'이 문장에 없어요. 문장에 쓰인 그대로 써 주세요.`] };
    if (found.length > 1) {
      const near = found.map((f) => {
        const next = tokens(s).find((t) => t.at >= f.end)?.w;
        return `'${next ? `${fa.wrong} ${next}` : fa.wrong}'`;
      });
      return { error: ['정답', `'${fa.wrong}'이 문장에 ${found.length}번 나와요(${near.join(', ')}). 정답에 틀린 쪽을 옆 낱말과 함께 쓰거나, 문장에서 틀린 곳을 [${fa.wrong}]처럼 [ ]로 감싸 주세요.`] };
    }
    span = found[0];
  } else {
    const d = diffFix(s.replace(/[[\]]/g, ''), r.answer);
    if (d === 'multi') return { error: ['정답', "고친 문장에서 바뀐 곳이 둘 이상이에요. 정답을 '틀린 말 → 고친 말'로 써 주세요."] };
    if (!d) return { error: ['정답', LATIN.test(s) ? "정답이 문장과 같아요. 고친 문장을 쓰거나 '틀린 말 → 고친 말'로 써 주세요." : '문장 칸에 틀린 곳이 있는 영어 문장을 써 주세요.'] };
    const plain = s.replace(/[[\]]/g, '');
    if (plain !== s) return { error: ['정답', "문장에 [ ]가 있으면 정답은 '틀린 말 → 고친 말'로 써 주세요."] };
    span = d;
    fixes = d.fix ? [d.fix] : [];
  }
  const text = s.slice(span.at, span.end);
  const mark = fixes.length ? `[${text} → ${fixes.join('|')}]` : `[${text} →]`;
  return ok({ ...r, explanation, sentence: `${s.slice(0, span.at)}${mark}${s.slice(span.end)}`, answer: '' });
}

/** Checks one row of a 문법 tab and builds its questions; with any error, there are none. */
export function grammarItem(tab: GrammarTab, row: GrammarRow): { item: GrammarItem | null; problems: GrammarProblem[] } {
  const cleaned: GrammarRow = { ...row, sentence: clean(row.sentence), answer: clean(row.answer), ko: clean(row.ko), lead: clean(row.lead), options: row.options.map(clean) };
  let r = instruction(cleaned);
  if (tab === '고르기') r = optionLines(r);
  // Read the same whether the 우리말 sits in its own column or on a line above the sentence (배열 reads its own lines).
  if (tab !== '배열') r = given(tab, r);
  const form = tab === '고르기' ? chooseForm(r) : tab === '쓰기' ? writeForm(r) : tab === '고치기' ? fixForm(r) : ok(r);
  if ('error' in form) return { item: null, problems: [{ level: 'error', column: form.error[0], message: form.error[1] }] };
  r = form.row;
  // The id comes from the inline form the row was read into (배열 hashes its chunks in answer order), so it doesn't
  // depend on how the row was typed.
  const id = `g:${itemId(tab, tab === '배열' ? (arrange('', r).idRow ?? r) : r)}`;
  const rebuilt = tab === '고르기' ? choose(id, r) : tab === '쓰기' ? write(id, r) : tab === '고치기' ? fix(id, r) : arrange(id, r);
  const problems = [...form.problems, ...rebuilt.problems];
  if (rebuilt.questions.length === 0) return { item: null, problems };
  rebuilt.questions[0].source = { tab, cells: rebuilt.cells ?? row.cells };
  return { item: { id, tab, label: row.label || undefined, questions: rebuilt.questions, set: row.set, status: row.status }, problems };
}

// ---------- Writing a row back ([엑셀로 받기]) ----------

/** A row's cells as the importer reads them. */
function rowOf(cells: Record<string, string>): GrammarRow {
  const get = (k: string) => String(cells[k] ?? '');
  return { label: '', lead: get('지시문'), ko: get('우리말'), sentence: get('문장'), options: [1, 2, 3, 4].map((n) => get(`보기${n}`)), answer: get('정답'), explanation: get('해설'), status: '사용', cells };
}

/** Two rows that read as the same question: the same id and the same questions. */
function sameQuestion(tab: GrammarTab, a: Record<string, string>, b: Record<string, string>): boolean {
  const x = grammarItem(tab, rowOf(a)).item;
  const y = grammarItem(tab, rowOf(b)).item;
  const plain = (qs: Question[]) => JSON.stringify(qs.map((q) => ({ ...q, source: undefined })));
  return !!x && !!y && x.id === y.id && plain(x.questions) === plain(y.questions);
}

/** An older file's 우리말 on a line above 문장 (the template has no 우리말 column). */
function foldKo(tab: GrammarTab, cells: Record<string, string>): Record<string, string> {
  const c = { ...cells };
  if (!c.우리말) return c;
  const lead = c.지시문 ?? '';
  if (tab === '고르기' && !c.문장 && [1, 2, 3, 4].some((n) => c[`보기${n}`]) && (!lead || HANGUL.test(lead))) {
    // 문장 고르기 with no 문장: the question goes on the bottom line (it would otherwise take the 우리말 for it).
    c.문장 = `${c.우리말}\n${lead || '바른 문장을 고르세요.'}`;
    delete c.지시문;
  } else {
    c.문장 = [c.우리말, c.문장].filter(Boolean).join('\n');
  }
  delete c.우리말;
  return c;
}

/** An older inline form as the template's 문장 + 정답 pair: ___ and its answers, 'fastly → fast', 배열 chunks + sentence. */
function toPair(tab: GrammarTab, c: Record<string, string>): Record<string, string> | null {
  const s = c.문장 ?? '';
  if (tab === '쓰기') {
    const marks = [...s.matchAll(BRACKET)];
    if (!marks.length || hasBlank(s)) return null;
    const alts = marks.map((m) => alternatives(m[1], /[|/]/));
    if (alts.some((a) => !a.length || a.some((x) => x.includes(',')))) return null;
    return { ...c, 문장: s.replace(BRACKET, '___'), 정답: alts.map((a) => a.join('|')).join(', ') };
  }
  if (tab === '고치기') {
    const m = FIX_MARK.exec(s);
    if (!m) return null;
    const [before, ...rest] = m[0].slice(1, -1).split(ARROWS);
    const wrong = tidy(before);
    const fixes = alternatives(rest.join(' '));
    const plain = s.slice(0, m.index) + wrong + s.slice(m.index + m[0].length);
    const once = findWords(plain, wrong).length === 1;
    return { ...c, 문장: once ? plain : s.slice(0, m.index) + `[${wrong}]` + s.slice(m.index + m[0].length), 정답: `${wrong} → ${fixes.length ? fixes.join('|') : '삭제'}` };
  }
  if (tab === '배열') {
    const answer = c.정답 ?? '';
    // Chunks in 정답 (in answer order), or an older file's chunks under 문장 with 정답 empty.
    const bareChunks = !answer.trim() && (c.문장 ?? '').includes('/') && !(c.문장 ?? '').includes('\n');
    if (!answer.includes('/') && !bareChunks) return null;
    const item = grammarItem(tab, rowOf(c)).item;
    const q = item?.questions[0];
    if (!item || !q?.answers) return null;
    const chunks = (bareChunks ? c.문장 : answer.split('|')[0]).split('/').map(tidy).filter(Boolean);
    const cue = bareChunks ? c.우리말 : c.문장;
    // Listed in a mixed order, as a worksheet does (the app mixes them again anyway).
    let listed = shuffle(chunks, mulberry32(hashString(item.id)));
    if (listed.join('\u0001') === chunks.join('\u0001')) listed = [...chunks.slice(1), chunks[0]];
    const out: Record<string, string> = { ...c, 문장: [cue, `(${listed.join(' / ')})`].filter(Boolean).join('\n'), 정답: q.answers.join('|') };
    delete out.우리말;
    return out;
  }
  return null;
}

/**
 * A grammar row as the template writes it: the 우리말 on a line above 문장, and an older inline form as a 문장 + 정답
 * pair. Each rewrite is kept only when it reads back as the same question; otherwise the row goes back as typed.
 */
export function pairCells(tab: GrammarTab, cells: Record<string, string>): Record<string, string> {
  try {
    const folded = foldKo(tab, cells);
    const paired = tab === '배열' && cells.우리말 && !(cells.정답 ?? '').trim() ? toPair(tab, cells) : toPair(tab, folded);
    // With 지시문 written out, a 우리말 line that reads like an instruction ('케이크를 만드세요.') stays the 우리말.
    const lead = grammarItem(tab, rowOf(cells)).item?.questions[0]?.grammar?.lead;
    const withLead = (c: Record<string, string> | null) => (c && !c.지시문 && lead ? { ...c, 지시문: lead } : null);
    for (const c of [paired, withLead(paired), folded, withLead(folded)]) if (c && sameQuestion(tab, c, cells)) return c;
    return folded;
  } catch {
    return cells;
  }
}

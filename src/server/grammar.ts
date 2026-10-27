// The 문법 tabs (고르기 · 쓰기 · 고치기 · 배열): each row, written the way grammar worksheets are, becomes a grammar
// question (two for 고치기: find the wrong part, then fix it), without any AI. The marks:
//   고르기  (try / to try) in the sentence, or 보기1~4 for whole sentences, or 정답 O/X (T/F)
//   쓰기    [answer] where each blank goes ([as|so] for other answers), or 정답 for a whole answer
//   고치기  [fastly → fast] around the wrong part ([to →] to take it out); [word] marks a decoy, 4 parts in all
//   배열    정답 written in chunks, the clerk / let / me / try on / the scarf
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
  if (t === 'T' || t === 'TRUE') return { index: 0, tf: true };
  if (t === 'F' || t === 'FALSE') return { index: 1, tf: true };
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
  return error('문장', '문장에 (try / to try)처럼 보기를 넣거나, 보기1~4를 채우거나, 정답을 O나 X로 써 주세요.');
}

function write(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  const sentence = tidy(r.sentence);
  const marks = [...sentence.matchAll(BRACKET)];
  if (marks.length > 0) {
    if (marks.length > MAX_BLANKS) return error('문장', `빈칸 [ ]은 ${MAX_BLANKS}개까지예요.`);
    // [as|so] and [as/so] both list other answers, as / does in 고르기's (try / to try).
    const alts = marks.map((m) => alternatives(m[1], /[|/]/));
    if (alts.some((a) => a.length === 0)) return error('문장', '[ ] 안에 들어갈 답을 써 주세요. (예: The clerk [let] me go.)');
    if (alts.some((a) => a.some((x) => !canon(x)))) return error('문장', '[ ] 안이 문장부호뿐이면 채점할 수 없어요. 낱말을 넣어 주세요.');
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
    if (fill.join(' / ').length > MAX_TEXT_ANSWER) return error('문장', `답은 ${MAX_TEXT_ANSWER}자까지예요.`);
    return {
      questions: [
        // Graded blank by blank (gaps); `answers` is the first filling, for the teacher's screen.
        { ...base(id, r, show, '빈칸 쓰기', Math.min(40, 20 + 5 * (n - 1))), mode: 'CUSTOM_TEXT', prompt, options: [], answerIndex: -1, answers: [fill.join(' / ')], gaps: alts, fill },
      ],
      problems,
    };
  }
  const answers = alternatives(r.answer);
  if (answers.length === 0) return error('정답', '정답을 쓰거나, 문장에서 답이 들어갈 자리를 [ ]로 감싸 주세요.');
  if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) return error('정답', `답은 ${MAX_TEXT_ANSWER}자까지예요. 폰에서 그보다 길게는 쓸 수 없어요.`);
  if (!sentence && !r.ko && !r.lead) return error('문장', '문제로 보여 줄 문장이나 우리말을 써 주세요.');
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
  if (wrongs.length === 0) return error('문장', '틀린 곳을 [fastly → fast]처럼 [틀린 말 → 고친 말]로 써 주세요.');
  if (wrongs.length > 1) return error('문장', '[틀린 말 → 고친 말]은 한 문장에 하나만 써 주세요.');
  if (marks.length > MAX_PARTS) return error('문장', `[ ]로 표시한 곳은 틀린 곳까지 ${MAX_PARTS}곳까지예요. 헷갈리게 할 곳은 3곳까지 표시해 주세요.`);
  // The sentence as students see it, with where each marked part sits in it.
  let plain = '';
  let at = 0;
  const spans: { text: string; start: number; wrong: boolean; fixes: string[] }[] = [];
  for (const m of marks) {
    plain += raw.slice(at, m.index);
    const [before, ...rest] = m[1].split(ARROW);
    const text = tidy(before);
    if (!text) return error('문장', '[ ] 안에 틀린 말을 써 주세요. (예: [fastly → fast])');
    if (text.includes('|')) return error('문장', '틀린 말 쪽에는 | 를 쓸 수 없어요. 다른 답은 고친 말 쪽에 써요. (예: [to cross → cross|crossing])');
    spans.push({ text, start: plain.length, wrong: ARROW.test(m[1]), fixes: alternatives(rest.join(' ')) });
    plain += text;
    at = m.index! + m[0].length;
  }
  plain += raw.slice(at);
  const wrong = spans.find((s) => s.wrong)!;
  const after = tidy(wrongs[0][1].split(ARROW).slice(1).join(' '));
  if (after && wrong.fixes.length === 0) return error('문장', '고친 말이 비어 있어요. 빼야 하는 말이면 [to →]처럼 화살표 뒤를 비워요.');
  if (wrong.fixes.some((f) => !canon(f))) return error('문장', '문장부호만 고치는 문제는 채점할 수 없어요. 낱말을 고치는 문제로 써 주세요.');
  if (wrong.fixes.some((f) => canon(f) === canon(wrong.text))) return error('문장', `고친 말이 틀린 말 '${wrong.text}'과 같아요.`);
  const chosen = spans.map(({ text, start }) => ({ text, start }));
  if (chosen.length < 4) {
    // Decoys from the rest of the sentence: no articles, nothing inside a marked part, and no word that appears twice
    // (which 'as' would be meant?) or matches the wrong part.
    const taken = (w: { text: string; at: number }) => spans.some((s) => w.at < s.start + s.text.length && w.at + w.text.length > s.start);
    const seen = new Map<string, number>();
    const all = wordsOf(plain, 0);
    for (const w of all) seen.set(w.text.toLowerCase(), (seen.get(w.text.toLowerCase()) ?? 0) + 1);
    const usedText = new Set(chosen.map((c) => c.text.toLowerCase()));
    const pool = all.filter((w) => !taken(w) && !ARTICLES.has(w.text.toLowerCase()) && seen.get(w.text.toLowerCase()) === 1 && !usedText.has(w.text.toLowerCase()));
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

function arrange(id: string, r: GrammarRow): Built {
  const problems: GrammarProblem[] = [];
  // A file that wrote the chunks under 문장 (with 정답 empty) is read the same, and exported in the template's layout.
  const fromSentence = !r.answer.trim() && r.sentence.includes('/');
  const raw = fromSentence ? r.sentence : r.answer.trim();
  const orders = raw.split('|').map((o) => chipsOf(o.split('/').map(tidy).filter(Boolean))).filter((o) => o.chips.length > 0);
  if (orders.length === 0) return error('정답', '정답 문장을 조각마다 / 로 나눠 써 주세요. (예: I / drink / milk)');
  const chips = orders[0].chips;
  if (chips.length < 3) return error('정답', '조각을 / 로 나눠 3개 이상 써 주세요. (예: I / drink / milk)');
  if (chips.length > MAX_CHIPS) return error('정답', `조각은 ${MAX_CHIPS}개까지예요. 몇 개를 묶어 주세요.`);
  const key = (o: string[]) => o.map(normalizeAnswer).sort().join('\u0001');
  if (orders.slice(1).some((o) => key(o.chips) !== key(chips))) return error('정답', '| 뒤의 다른 정답도 같은 조각으로 만들어야 해요.');
  const rnd = mulberry32(hashString(id));
  let mixed = shuffle(chips, rnd);
  for (let k = 0; k < 5 && mixed.join('\u0001') === chips.join('\u0001'); k++) mixed = shuffle(chips, rnd);
  if (mixed.join('\u0001') === chips.join('\u0001')) mixed = [...chips.slice(1), chips[0]];
  const answers = orders.map((o) => finished(o.chips, o.end));
  if (answers.some((a) => a.length > MAX_TEXT_ANSWER)) return error('정답', `문장은 ${MAX_TEXT_ANSWER}자까지예요.`);
  const sentence = tidy(fromSentence ? '' : r.sentence);
  const show: GrammarShow = {
    tab: '배열',
    lead: r.lead || (r.ko ? '우리말과 같도록 조각을 순서대로 누르세요.' : '조각을 순서대로 눌러 문장을 만드세요.'),
    ko: r.ko || undefined,
    parts: sentence ? [{ text: sentence }] : [],
    chips: mixed,
  };
  const cells = fromSentence ? Object.fromEntries(Object.entries({ ...r.cells, 정답: r.cells.문장 }).filter(([k]) => k !== '문장')) : undefined;
  return {
    questions: [
      { ...base(id, r, show, '배열', Math.max(20, Math.min(45, 15 + 2 * chips.length))), mode: 'CUSTOM_TEXT', prompt: r.ko || sentence || show.lead, options: [], answerIndex: -1, answers, fill: [answers[0]] },
    ],
    problems,
    cells,
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
    { 지시문: '바른 문장을 고르세요.', 보기1: 'He make me laugh.', 보기2: 'He makes me laugh.', 정답: '2' },
    { 우리말: '가방 A 3kg, 가방 B 3kg', 문장: 'Bag A is as heavy as Bag B.', 정답: 'O' },
  ],
  쓰기: [
    { 우리말: '그는 우유를 좋아하지 않는다.', 문장: "He [doesn't] like milk." },
    { 지시문: 'and로 한 문장을 만드세요.', 문장: 'I like cats. I like dogs.', 정답: 'I like cats and dogs.|I like dogs and cats.' },
  ],
  고치기: [{ 문장: 'She [go → goes] to school every day.' }],
  배열: [
    { 우리말: '엄마는 내가 매일 우유를 마시게 하신다.', 정답: 'my mom / makes / me / drink / milk / every day' },
    { 우리말: '나는 매일 아침 우유를 마신다.', 정답: 'I / drink / milk / every morning' },
  ],
};
const EXAMPLE_FIELDS = ['문장', '정답', '보기1', '보기2', '보기3', '보기4', '우리말', '지시문'];
const exampleKey = (cells: Record<string, string>) => EXAMPLE_FIELDS.map((f) => tidy(cells[f] ?? '')).join('\u0001');
const EXAMPLE_KEYS = Object.fromEntries(GRAMMAR_TABS.map((t) => [t, new Set(TEMPLATE_EXAMPLES[t].map(exampleKey))])) as Record<GrammarTab, Set<string>>;

/** How many example rows the template has right under each tab's header. */
export const TEMPLATE_EXAMPLE_ROWS: Record<GrammarTab, number> = { 고르기: 3, 쓰기: 2, 고치기: 1, 배열: 1 };

/** A row of a 문법 tab, by canonical header, that is one of the template's own examples. */
export function isTemplateExample(tab: GrammarTab, cells: Record<string, string>): boolean {
  return EXAMPLE_KEYS[tab].has(exampleKey(cells));
}

/** Checks one row of a 문법 tab and builds its questions; with any error, there are none. */
export function grammarItem(tab: GrammarTab, r: GrammarRow): { item: GrammarItem | null; problems: GrammarProblem[] } {
  const id = `g:${itemId(tab, r)}`;
  const built = tab === '고르기' ? choose(id, r) : tab === '쓰기' ? write(id, r) : tab === '고치기' ? fix(id, r) : arrange(id, r);
  if (built.questions.length === 0) return { item: null, problems: built.problems };
  built.questions[0].source = { tab, cells: built.cells ?? r.cells };
  return { item: { id, tab, label: r.label || undefined, questions: built.questions, set: r.set, status: r.status }, problems: built.problems };
}

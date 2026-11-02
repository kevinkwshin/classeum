// 받아쓰기: how a student's sentence is checked against the one the laptop read aloud. The server (the 답 card's
// statistics and the CSV) and the screens (each phone's comparison) use this one function, so they always agree.
// It checks listening, so what can't be heard doesn't count: capitals, punctuation, the shape of quotes, and a number
// written in digits or in words. Contractions are what was said (don't is not do not); the teacher can accept one.

/** A word as written, with whether it matched. */
export interface DictationWord {
  word: string;
  ok: boolean;
}

export interface DictationResult {
  /** Every word right and nothing extra. */
  perfect: boolean;
  /** 1 − (words written differently + missed + extra) / the sentence's words, never below 0. */
  accuracy: number;
  /** The sentence's words, each heard right or not (missed, or written differently). */
  target: DictationWord[];
  /** The student's words, each right or not (written differently, or extra). */
  answer: DictationWord[];
  /** Of the sentence's words: written differently, and missed; and words the student added. */
  changed: number;
  missed: number;
  extra: number;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0–99 as said: 15 → fifteen, 21 → twenty-one. */
function numberWord(n: number): string {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** How a word is compared: no capitals, one kind of quote and dash, no punctuation around it, numbers as words. */
export function dictationKey(raw: string): string {
  const w = raw
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return /^\d{1,2}$/.test(w) ? numberWord(Number(w)) : w;
}

// Twenty to ninety, then one to nine: 'twenty one' is heard as twenty-one (21), however it is written.
const TENS_WORDS = new Set(TENS.filter(Boolean));
const ONES_WORDS = new Set(ONES.slice(1, 10));

/**
 * The words of a sentence, as written and as compared; marks standing alone (a dash, an ellipsis) aren't words, and a
 * number written as two words ('twenty one', not 'twenty, one') is one, as 21 and twenty-one are.
 */
function words(text: string): { word: string; key: string }[] {
  const out: { word: string; key: string }[] = [];
  for (const word of text.split(/\s+/)) {
    const key = dictationKey(word);
    if (key === '') continue;
    const prev = out[out.length - 1];
    if (prev && TENS_WORDS.has(prev.key) && /\p{L}$/u.test(prev.word) && ONES_WORDS.has(key)) out[out.length - 1] = { word: `${prev.word} ${word}`, key: `${prev.key}-${key}` };
    else out.push({ word, key });
  }
  return out;
}

/**
 * The student's sentence lined up with the target word by word (an edit distance over words), so one missed word
 * doesn't make every word after it wrong.
 */
export function gradeDictation(target: string, answer: string): DictationResult {
  const t = words(target);
  const a = words(answer);
  const n = t.length;
  const m = a.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j - 1] + (t[i - 1].key === a[j - 1].key ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  }
  const tOk = t.map(() => false);
  const aOk = a.map(() => false);
  let changed = 0;
  let missed = 0;
  let extra = 0;
  let i = n;
  let j = m;
  // Back through the table, a match first, then a word written differently, then one missed, then one added.
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && t[i - 1].key === a[j - 1].key && d[i][j] === d[i - 1][j - 1]) {
      tOk[i - 1] = true;
      aOk[j - 1] = true;
      i--;
      j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      changed++;
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      missed++;
      i--;
    } else {
      extra++;
      j--;
    }
  }
  const errors = changed + missed + extra;
  return {
    perfect: n > 0 && errors === 0,
    accuracy: n ? Math.max(0, 1 - errors / n) : 0,
    target: t.map((w, k) => ({ word: w.word, ok: tOk[k] })),
    answer: a.map((w, k) => ({ word: w.word, ok: aOk[k] })),
    changed,
    missed,
    extra,
  };
}

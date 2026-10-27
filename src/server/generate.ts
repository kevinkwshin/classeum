// Turns a word list into quiz questions with wrong options, without any AI.
import type { CustomQuestion, GrammarItem, Option, Question, QuestionMode, Word } from '@/lib/types';
import { displayMeaning, editDistance, meaningKeys, meaningStem, mulberry32, normalizeAnswer, shuffle, wordKey } from '@/lib/text';

export interface GeneratedEvent {
  questions: Question[];
  retry: Record<string, Question>;
  warnings: string[];
}

interface Candidate {
  key: string;
  spelling: string;
  altSpellings: string[];
  meaning?: string;
  pos?: string;
  unit?: string;
  confusable: boolean;
  fromBank: boolean;
}

const MODE_LABEL: Record<QuestionMode, string> = {
  MEAN: '뜻 고르기',
  WORD: '단어 고르기',
  CLOZE: '예문 빈칸',
  CUSTOM_MC: '객관식',
  CUSTOM_OX: 'OX',
  CUSTOM_TEXT: '쓰기',
};

function overlaps(a: string | undefined, b: string | undefined, posA?: string, posB?: string): boolean {
  if (!a || !b) return false;
  const ka = meaningKeys(a);
  const kb = meaningKeys(b);
  // Equal fragments, or one containing the other (아침 ⊂ 아침식사), count as the same meaning.
  const contains = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
  if (ka.some((x) => kb.some((y) => contains(x, y)))) return true;
  if (posA && posB && posA !== posB) return false;
  const sa = ka.map(meaningStem);
  return kb.map(meaningStem).some((s) => sa.includes(s));
}

/**
 * Finds the blank in an example sentence. The blanked text must be exactly the word
 * (or one of its other spellings); inflected forms like "cooks" are skipped so the
 * base-form options never read wrong in the sentence.
 */
export function clozeOf(word: Word): { prompt: string } | null {
  if (!word.example) return null;
  const spellings = [word.spelling, ...word.altSpellings].map((s) => s.toLowerCase());
  const brackets = [...word.example.matchAll(/\[([^\]]+)\]/g)];
  if (brackets.length > 1) return null;
  if (brackets.length === 1) {
    if (!spellings.includes(brackets[0][1].trim().toLowerCase())) return null;
    return { prompt: word.example.replace(/\[[^\]]+\]/, '_____') };
  }
  const base = word.spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...word.example.matchAll(new RegExp(`\\b${base}\\b`, 'gi'))];
  if (matches.length !== 1) return null;
  const m = matches[0];
  return { prompt: word.example.slice(0, m.index) + '_____' + word.example.slice((m.index ?? 0) + m[0].length) };
}

function candidatesFor(target: Word, setWords: Word[], bank: Word[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>([target.key]);
  const confusableKeys = new Set(target.confusables.map((c) => wordKey(c.word)));
  // A confusable named on the other word's row applies both ways.
  for (const w of [...setWords, ...bank]) {
    if (w.confusables.some((c) => wordKey(c.word) === target.key)) confusableKeys.add(w.key);
  }
  const push = (w: Word, fromBank: boolean) => {
    if (seen.has(w.key) || w.status === '보관') return;
    seen.add(w.key);
    out.push({ key: w.key, spelling: w.spelling, altSpellings: w.altSpellings, meaning: w.meaning, pos: w.pos, unit: w.unit, confusable: confusableKeys.has(w.key), fromBank });
  };
  setWords.forEach((w) => push(w, false));
  bank.forEach((w) => push(w, true));
  for (const c of target.confusables) {
    const k = wordKey(c.word);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, spelling: c.word, altSpellings: [], meaning: c.meaning, confusable: true, fromBank: false });
  }
  return out;
}

function pickDistractors(target: Word, mode: QuestionMode, setWords: Word[], bank: Word[], rnd: () => number): Candidate[] {
  const correctLabel = mode === 'MEAN' ? displayMeaning(target.meaning) : target.spelling;
  const targetSpellings = new Set([target.spelling, ...target.altSpellings].map(normalizeAnswer));
  const all = candidatesFor(target, setWords, bank).filter((c) => {
    // Same spelling under another row (bat/bat, color|colour) would be a second right answer.
    if ([c.spelling, ...c.altSpellings].some((sp) => targetSpellings.has(normalizeAnswer(sp)))) return false;
    if (mode === 'MEAN' && !c.meaning) return false;
    // In a sentence, a teacher-marked pair (early/late, borrow/lend) can fit just as well.
    if (mode === 'CLOZE' && c.confusable) return false;
    if (overlaps(target.meaning, c.meaning, target.pos, c.pos)) return false;
    const label = mode === 'MEAN' ? displayMeaning(c.meaning!) : c.spelling;
    if (label.toLowerCase() === correctLabel.toLowerCase()) return false;
    return true;
  });
  const score = (c: Candidate) => {
    let s = 0;
    if (c.confusable) s += 100;
    if (target.pos && c.pos === target.pos) s += mode === 'CLOZE' ? 80 : 40;
    const a = target.spelling.toLowerCase();
    const b = c.spelling.toLowerCase();
    s += (1 - editDistance(a, b) / Math.max(a.length, b.length)) * (mode === 'MEAN' ? 10 : 20);
    if (a.slice(0, 2) === b.slice(0, 2) || a.slice(-3) === b.slice(-3)) s += 5;
    const label = mode === 'MEAN' ? displayMeaning(c.meaning ?? '') : c.spelling;
    if (Math.abs(label.length - correctLabel.length) <= correctLabel.length * 0.3) s += 10;
    if (target.unit && c.unit === target.unit) s += 5;
    if (c.fromBank) s -= 20;
    return s + rnd() * 10;
  };
  const scored = all.map((c) => ({ c, s: score(c) })).sort((x, y) => y.s - x.s);
  const chosen: Candidate[] = [];
  const labels = new Set<string>([correctLabel.toLowerCase()]);
  const take = (c: Candidate) => {
    const label = (mode === 'MEAN' ? displayMeaning(c.meaning!) : c.spelling).toLowerCase();
    if (labels.has(label)) return;
    // Two distractors that mean the same thing would make each other obviously wrong.
    if (chosen.some((x) => overlaps(x.meaning, c.meaning, x.pos, c.pos))) return;
    const spellings = new Set([c.spelling, ...c.altSpellings].map(normalizeAnswer));
    if (chosen.some((x) => [x.spelling, ...x.altSpellings].some((sp) => spellings.has(normalizeAnswer(sp))))) return;
    labels.add(label);
    chosen.push(c);
  };
  scored.filter((x) => x.c.confusable).slice(0, 2).forEach((x) => take(x.c));
  const pool = scored.filter((x) => !chosen.includes(x.c)).slice(0, 8);
  while (chosen.length < 3 && pool.length > 0) {
    const total = pool.reduce((sum, x) => sum + Math.max(1, x.s), 0);
    let r = rnd() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= Math.max(1, pool[idx].s);
      if (r <= 0) break;
    }
    take(pool[idx].c);
    pool.splice(idx, 1);
  }
  if (chosen.length < 3) {
    for (const x of scored) {
      if (chosen.length >= 3) break;
      if (!chosen.includes(x.c)) take(x.c);
    }
  }
  return chosen;
}

function buildWordQuestion(
  target: Word,
  mode: 'MEAN' | 'WORD' | 'CLOZE',
  setWords: Word[],
  bank: Word[],
  rnd: () => number,
  defaultSeconds: number,
): Question | null {
  let prompt = mode === 'MEAN' ? target.spelling : displayMeaning(target.meaning);
  let explanation = `${target.spelling} = ${target.meaning}`;
  if (mode === 'CLOZE') {
    const cz = clozeOf(target);
    if (!cz) return null;
    prompt = cz.prompt;
    explanation = `${target.example?.replace(/[[\]]/g, '')} · ${target.spelling} = ${target.meaning}`;
  }
  const distractors = pickDistractors(target, mode, setWords, bank, rnd);
  if (distractors.length < 2) return null;
  const correct: Option = { label: mode === 'MEAN' ? displayMeaning(target.meaning) : target.spelling, sourceKey: target.key };
  const wrong: Option[] = distractors.map((d) => {
    const label = mode === 'MEAN' ? displayMeaning(d.meaning!) : d.spelling;
    const feedback = mode === 'MEAN' ? `${d.spelling} = ${label}` : d.meaning ? `${d.spelling} = ${d.meaning}` : `${d.spelling}은 다른 단어예요`;
    return { label, sourceKey: d.key, feedback };
  });
  return {
    id: `${target.key}:${mode}`,
    wordKey: target.key,
    mode,
    modeLabel: MODE_LABEL[mode],
    prompt,
    options: [correct, ...wrong],
    answerIndex: 0,
    seconds: target.seconds ?? defaultSeconds,
    explanation,
  };
}

function customToQuestion(q: CustomQuestion, defaultSeconds: number): Question {
  if (q.kind === '단답형') {
    return {
      id: `custom:${q.id}`,
      mode: 'CUSTOM_TEXT',
      modeLabel: MODE_LABEL.CUSTOM_TEXT,
      prompt: q.prompt,
      options: [],
      answerIndex: -1,
      answers: q.answers,
      seconds: q.seconds ?? Math.max(defaultSeconds, 20),
      explanation: q.explanation,
    };
  }
  const options: Option[] = q.options.map((label, i) => ({ label, feedback: q.feedback[i] || undefined }));
  return {
    id: `custom:${q.id}`,
    mode: q.kind === 'OX' ? 'CUSTOM_OX' : 'CUSTOM_MC',
    modeLabel: MODE_LABEL[q.kind === 'OX' ? 'CUSTOM_OX' : 'CUSTOM_MC'],
    prompt: q.prompt,
    options,
    answerIndex: q.answerIndex,
    seconds: q.seconds ?? defaultSeconds,
    explanation: q.explanation,
  };
}

/** Moves the correct option to `target` and shuffles the rest around it. */
function placeAnswer(q: Question, target: number, rnd: () => number): Question {
  const correct = q.options[q.answerIndex];
  const others = shuffle(q.options.filter((_, i) => i !== q.answerIndex), rnd);
  const slot = Math.min(target, q.options.length - 1);
  const options = [...others.slice(0, slot), correct, ...others.slice(slot)];
  return { ...q, options, answerIndex: slot };
}

/**
 * Picks each question's answer slot at random, leaning towards slots used less so far, and
 * never the same slot three times running. No slot is ever ruled out by the others (a fixed
 * bag of 1-2-3-4 would let students work out every fourth answer by elimination).
 */
function answerSlots(counts: number[], rnd: () => number): number[] {
  const slots: number[] = [];
  // Counted per number of options, or a run of two-option grammar questions would push the next four-option
  // answers towards ③ and ④.
  const usedBy = new Map<number, number[]>();
  for (const count of counts) {
    const n = slots.length;
    const banned = n >= 2 && slots[n - 1] === slots[n - 2] ? slots[n - 1] : -1;
    const allowed = Array.from({ length: count }, (_, k) => k).filter((k) => k !== banned);
    if (!usedBy.has(count)) usedBy.set(count, [0, 0, 0, 0]);
    const used = usedBy.get(count)!;
    const low = Math.min(...allowed.map((k) => used[k]));
    const weights = allowed.map((k) => 1 / (1 + 2 * (used[k] - low)));
    let r = rnd() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < allowed.length - 1 && (r -= weights[i]) > 0) i++;
    slots.push(allowed[i]);
    used[allowed[i]]++;
  }
  return slots;
}

/**
 * Places each question's right answer so the slots are spread evenly in the given order
 * and never repeat three times running. OX, written questions and options in a set order keep their layout.
 * Returns copies; the input questions are not changed.
 */
export function spreadAnswers(sequence: Question[], rnd: () => number): Question[] {
  const placeable = sequence.filter((q) => q.mode !== 'CUSTOM_OX' && q.mode !== 'CUSTOM_TEXT' && !q.fixedOrder);
  const slots = answerSlots(placeable.map((q) => q.options.length), rnd);
  const slotOf = new Map(placeable.map((q, i) => [q, slots[i]]));
  return sequence.map((q) => (slotOf.has(q) ? placeAnswer(q, slotOf.get(q)!, rnd) : q));
}

function isConfusablePair(a: Question, b: Question, words: Map<string, Word>): boolean {
  if (!a.wordKey || !b.wordKey) return false;
  const wa = words.get(a.wordKey);
  const wb = words.get(b.wordKey);
  return !!wa?.confusables.some((c) => wordKey(c.word) === b.wordKey) || !!wb?.confusables.some((c) => wordKey(c.word) === a.wordKey);
}

/** Greedy ordering that keeps confusable pairs apart and avoids giving away the next answer. */
function orderQuestions(list: Question[], words: Map<string, Word>, rnd: () => number): Question[] {
  const remaining = shuffle(list, rnd);
  const out: Question[] = [];
  while (remaining.length > 0) {
    const ok = (q: Question) => {
      const recent = out.slice(-3);
      if (recent.some((p) => isConfusablePair(p, q, words))) return false;
      const prev = out[out.length - 1];
      if (prev) {
        // Seeing a word as the last answer and again now (in either form) gives it away.
        if (prev.wordKey && q.options.some((o) => o.sourceKey === prev.wordKey)) return false;
        if (q.wordKey && prev.options.some((o) => o.sourceKey === q.wordKey)) return false;
        const prevAnswer = prev.options[prev.answerIndex]?.label.toLowerCase();
        if (prevAnswer && q.options.some((o) => o.label.toLowerCase() === prevAnswer)) return false;
      }
      return true;
    };
    const idx = remaining.findIndex(ok);
    out.push(remaining.splice(idx >= 0 ? idx : 0, 1)[0]);
  }
  return out;
}

export function generateEvent(opts: {
  words: Word[];
  grammar: GrammarItem[];
  custom: CustomQuestion[];
  bank: Word[];
  askedBefore: Set<string>;
  seed: number;
  defaultSeconds: number;
}): GeneratedEvent {
  const rnd = mulberry32(opts.seed);
  const warnings: string[] = [];
  const active = opts.words.filter((w) => w.status === '사용');
  // Words in this upload replace their old copies, including ones now set to 검토 or 보관.
  const uploaded = new Set(opts.words.map((w) => w.key));
  const bank = opts.bank.filter((b) => !uploaded.has(b.key));
  const byKey = new Map(active.map((w) => [w.key, w]));
  const main: Question[] = [];
  const retry: Record<string, Question> = {};

  for (const w of active) {
    const hasCloze = !!clozeOf(w);
    let order: ('MEAN' | 'WORD' | 'CLOZE')[];
    if (opts.askedBefore.has(w.key)) {
      order = hasCloze && rnd() < 0.5 ? ['CLOZE', 'WORD', 'MEAN'] : ['WORD', 'MEAN', 'CLOZE'];
    } else {
      // First sight: meaning 60 / word 40; the example blank waits until the word comes back.
      order = rnd() < 0.6 ? ['MEAN', 'WORD', 'CLOZE'] : ['WORD', 'MEAN', 'CLOZE'];
    }
    let q: Question | null = null;
    for (const mode of order) {
      q = buildWordQuestion(w, mode, active, bank, rnd, opts.defaultSeconds);
      if (q) break;
    }
    if (!q) {
      warnings.push(`'${w.spelling}'은 오답 보기를 만들 단어가 부족해서 뺐어요. 단어를 더 넣거나 헷갈리는 단어를 채워 주세요.`);
      continue;
    }
    main.push(q);
    const reverse: 'MEAN' | 'WORD' = q.mode === 'MEAN' ? 'WORD' : 'MEAN';
    const r = buildWordQuestion(w, reverse, active, bank, rnd, opts.defaultSeconds);
    if (r) retry[w.key] = placeAnswer(r, Math.floor(rnd() * r.options.length), rnd);
    if (q.options.length < 4) warnings.push(`'${w.spelling}'은 보기가 ${q.options.length}개예요.`);
  }

  // Order first, then place answers, so the no-three-in-a-row rule holds in the order played.
  // Words, then grammar in the order of its tabs and rows, then the hand-written bonus questions.
  const grammar = opts.grammar.filter((g) => g.status === '사용').flatMap((g) => g.questions);
  const customs = opts.custom.filter((c) => c.status === '사용').map((c) => customToQuestion(c, opts.defaultSeconds));
  const questions = spreadAnswers([...orderQuestions(main, byKey, rnd), ...grammar, ...customs], rnd);

  return { questions, retry, warnings };
}

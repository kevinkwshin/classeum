// String helpers shared by the Excel importer, the generator and answer checking.

/** Lowercase, trim, single spaces, straight apostrophes, no trailing period. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function wordKey(spelling: string): string {
  return normalizeAnswer(spelling.split('|')[0] ?? spelling);
}

/** Meaning fragments without parentheses, tildes or spaces, used to detect overlapping meanings. */
export function meaningKeys(meaning: string): string[] {
  return meaning
    .split(/[,;/，]/)
    .map((part) => part.replace(/\([^)]*\)/g, '').replace(/[~\s]/g, '').trim())
    .filter(Boolean);
}

const STEM_ENDINGS = ['스러운', '하게', '적인', '하다', '한', '히', '의', '다'];

export function meaningStem(key: string): string {
  for (const end of STEM_ENDINGS) {
    if (key.length > end.length && key.endsWith(end)) return key.slice(0, -end.length);
  }
  return key;
}

/** First meaning when the full meaning is long, so options stay readable. */
export function displayMeaning(meaning: string): string {
  const full = meaning.trim();
  if (full.length <= 15) return full;
  return full.split(/[,;/]/)[0].trim();
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Deterministic PRNG so a generated event can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shortDate(date = new Date()): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

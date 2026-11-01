/**
 * A word with the Korean particle that fits it: the first form after a final consonant (을, 이, 은, 과, 으로), the second
 * after a vowel (를, 가, 는, 와, 로), and 로 after ㄹ. Closing quotes and brackets are looked past. Numbers are read as
 * Korean (1 일, 2 이, …) and a lone letter by its name (X 엑스, M 엠). Any other ending, such as an English word, gets
 * both forms: apple을(를).
 */
export type JosaPair = '을/를' | '이/가' | '은/는' | '과/와' | '으로/로';

// 영 일 이 삼 사 오 육 칠 팔 구: which end in a consonant, and which in ㄹ.
const DIGIT_FINAL = [true, true, false, true, false, false, true, true, true, false];
const DIGIT_RIEUL = [false, true, false, false, false, false, false, true, true, false];
// Letters whose names end in a consonant: 엘 엠 엔 알 (L and R in ㄹ).
const LETTER_FINAL = new Set(['L', 'M', 'N', 'R']);
const LETTER_RIEUL = new Set(['L', 'R']);

export function josa(word: string, pair: JosaPair): string {
  const [withFinal, withoutFinal] = pair.split('/');
  const bare = word.replace(/[\s'"‘’“”)\]}」』]+$/u, '');
  const last = bare.slice(-1);
  const code = last.charCodeAt(0);
  let final: boolean | null = null;
  let rieul = false;
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    final = jong !== 0;
    rieul = jong === 8;
  } else if (last >= '0' && last <= '9') {
    final = DIGIT_FINAL[Number(last)];
    rieul = DIGIT_RIEUL[Number(last)];
  } else if (/^[A-Za-z]$/.test(last) && !/[A-Za-z]/.test(bare.slice(-2, -1))) {
    final = LETTER_FINAL.has(last.toUpperCase());
    rieul = LETTER_RIEUL.has(last.toUpperCase());
  }
  if (final === null) return `${word}${withFinal}(${withoutFinal})`;
  if (pair === '으로/로') return `${word}${final && !rieul ? withFinal : withoutFinal}`;
  return `${word}${final ? withFinal : withoutFinal}`;
}

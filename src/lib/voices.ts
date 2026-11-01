// 받아쓰기's voice, the same on both ways of reading: the browser's speech and macOS's `say` list the laptop's voices
// by the same names.

/** macOS's joke and singing voices (Bubbles, Bad News, Cellos …): never for dictation. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Princess)\b/i;
/** macOS's older, robotic voices: only when there is nothing clearer. */
const ROBOTIC = /^(Fred|Junior|Ralph|Kathy|Bruce|Agnes|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
/** Clear voices that come with a laptop, best first: macOS's, then Windows'. */
const CLEAR = ['Samantha', 'Alex', 'Ava', 'Allison', 'Susan', 'Tom', 'Aaron', 'Nicky', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Microsoft David', 'Microsoft Mark'];

/** The laptop's English voice: a clear one by name, else American, else any English, a robotic one last. */
export function englishVoice<V extends { name: string; lang: string }>(voices: V[]): V | null {
  const rank = (v: V) => {
    const clear = CLEAR.findIndex((name) => v.name.startsWith(name));
    if (clear >= 0) return clear;
    return CLEAR.length + (ROBOTIC.test(v.name) ? 2 : /^en[-_]US/i.test(v.lang) ? 0 : 1);
  };
  return voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name)).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

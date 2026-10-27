// A grammar question as the class sees it, the same on the projector and the phones: the 지시문, the 우리말, then
// the sentence with its gap, blanks or underlined parts. At the reveal the gaps fill with the right answers, the
// wrong part of a 고치기 sentence is struck through, and the right whole sentence lights up.
import type { GrammarShow } from '@/lib/types';

const CIRCLED = '①②③④';

/**
 * What the answer zones show. Whole-sentence options show only the words that differ; when that is too long, just
 * their numbers (an empty label), since the sentences are listed above.
 */
export function zoneLabels(q: { options: string[]; grammar?: GrammarShow }): string[] {
  if (!q.grammar?.sentences) return q.options;
  return q.grammar.short ?? q.options.map(() => '');
}

/** The sentence as plain text with the right answers in place: the fix for a 고치기 part, each gap's answer. */
export function filledSentence(g: GrammarShow, fill: string[] = []): string {
  return g.parts
    .map((p) => ('gap' in p ? fill[p.gap] ?? '＿＿' : 'mark' in p ? (g.step === 'fix' && fill[0] !== undefined ? fill[0] : p.text) : p.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters in the sentence (or the whole-sentence options), to size the text. */
export function grammarLength(g: GrammarShow): number {
  const sentence = g.parts.reduce((n, p) => n + ('text' in p ? p.text.length : 4), 0);
  return Math.max(sentence, ...(g.sentences ?? []).map((s) => s.length));
}

const SIZES = {
  projector: {
    lead: 'text-[1.5vw] font-bold text-ink-3',
    ko: 'text-[1.9vw] font-bold text-ink-2',
    sentence: (n: number) => (n > 70 ? 'text-[2.3vw]' : n > 40 ? 'text-[2.8vw]' : 'text-[3.4vw]'),
    list: 'text-[2vw]',
    badge: 'h-[2.4vw] w-[2.4vw] text-[1.4vw]',
    chip: 'rounded-2xl px-[1vw] py-[0.4vw] text-[2.2vw]',
  },
  phone: {
    lead: 'text-xs font-bold text-ink-3',
    ko: 'text-sm font-bold text-ink-2',
    sentence: (n: number) => (n > 60 ? 'text-base' : n > 30 ? 'text-lg' : 'text-2xl'),
    list: 'text-sm',
    badge: 'h-5 w-5 text-[11px]',
    chip: 'rounded-xl px-2 py-1 text-sm',
  },
};

/**
 * `fill` (at the reveal) puts the right answers in the gaps; `correct` is the right option of a field question, which
 * marks the wrong part of a 고치기 sentence or the right whole sentence.
 */
export function GrammarCard({ g, fill, correct, variant }: { g: GrammarShow; fill?: string[]; correct?: number; variant: 'projector' | 'phone' }) {
  const size = SIZES[variant];
  const revealed = fill !== undefined || correct !== undefined;
  const n = grammarLength(g);
  return (
    <div className="flex flex-col items-center gap-[0.4em] text-center">
      <div className={size.lead}>{g.lead}</div>
      {g.ko && <div className={`${size.ko} break-keep`}>{g.ko}</div>}
      {g.parts.length > 0 && (
        <div className={`${size.sentence(n)} font-extrabold leading-snug tracking-tight [overflow-wrap:anywhere]`}>
          {g.parts.map((p, i) => {
            if ('gap' in p) {
              const answer = fill?.[p.gap];
              if (answer !== undefined) {
                return (
                  <span key={i} className="cls-pop mx-[0.15em] inline-block rounded-[0.3em] bg-good px-[0.3em] text-white" style={{ animationDelay: `${0.2 + p.gap * 0.25}s` }}>
                    {answer}
                  </span>
                );
              }
              return (
                <span key={i} className="mx-[0.15em] inline-block min-w-[2.6em] rounded-[0.3em] border-[0.08em] border-dashed border-[#B9BEC9] px-[0.2em] text-[#A3A8B4]">
                  {(g.blanks ?? 0) > 1 ? CIRCLED[p.gap] : '?'}
                </span>
              );
            }
            if ('mark' in p) {
              if (g.step === 'fix') {
                const fixed = fill?.[0];
                return (
                  <span key={i}>
                    <span className={fixed !== undefined ? 'text-bad line-through decoration-[0.08em]' : 'underline decoration-[0.1em] underline-offset-[0.2em]'}>{p.text}</span>
                    {fixed && (
                      <span className="cls-pop ml-[0.25em] inline-block rounded-[0.3em] bg-good px-[0.3em] text-white" style={{ animationDelay: '0.3s' }}>
                        {fixed}
                      </span>
                    )}
                  </span>
                );
              }
              const wrong = correct === p.mark;
              return (
                <span key={i} className={`zone-${p.mark} transition-opacity duration-500 ${revealed && !wrong ? 'opacity-40' : ''}`}>
                  <sup className="mr-[0.1em] font-extrabold" style={{ color: 'var(--zone)' }}>{CIRCLED[p.mark]}</sup>
                  <span
                    className={`underline decoration-[0.12em] underline-offset-[0.2em] ${wrong ? 'cls-pop inline-block rounded-[0.25em] bg-bad-soft px-[0.15em] text-bad' : ''}`}
                    style={{ textDecorationColor: wrong ? undefined : 'var(--zone)' }}
                  >
                    {p.text}
                  </span>
                </span>
              );
            }
            return <span key={i}>{p.text}</span>;
          })}
        </div>
      )}
      {g.sentences && (
        <ol className={`mt-[0.3em] flex flex-col gap-[0.35em] text-left ${size.list} font-bold`}>
          {g.sentences.map((s, i) => (
            <li
              key={i}
              className={`zone-${i} flex items-center gap-[0.5em] rounded-[0.6em] px-[0.5em] py-[0.15em] transition-[background-color,opacity] duration-500 ${revealed ? (i === correct ? 'bg-good-soft' : 'opacity-40') : ''}`}
            >
              <span className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-white ${size.badge}`} style={{ background: 'var(--zone)' }}>
                {i + 1}
              </span>
              <span className={i === correct ? 'text-good' : ''}>{s}</span>
            </li>
          ))}
        </ol>
      )}
      {/* The phone has its own chips to tap. */}
      {g.chips && !revealed && variant === 'projector' && (
        <div className="mt-[0.3em] flex flex-wrap justify-center gap-[0.4em]">
          {g.chips.map((c, i) => (
            <span key={i} className={`border-[0.08em] border-[#D5D8DF] bg-white font-extrabold ${size.chip}`}>
              {c}
            </span>
          ))}
        </div>
      )}
      {g.tab === '배열' && fill?.[0] && (
        <div className={`cls-pop ${size.sentence(fill[0].length)} rounded-[0.4em] bg-good px-[0.5em] py-[0.1em] font-extrabold text-white`} style={{ animationDelay: '0.2s' }}>
          {fill[0]}
        </div>
      )}
    </div>
  );
}

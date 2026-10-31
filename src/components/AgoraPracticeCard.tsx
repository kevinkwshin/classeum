'use client';
import { useState } from 'react';
import type { AvatarLook } from '@/lib/types';
import { Reaction } from './Reaction';

const KEY = 'classeum.agoraPracticed';
const TOPIC = 'What is your favorite color? Tell us why.';

function practiced(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 연습 for the 아고라: a pretend topic on the 대기실's waiting screen, answered the way the real one is, as PracticeCard
 * does for the arena. Nothing goes to the server; once sent it shows the answer as the class will see it.
 */
export function AgoraPracticeCard({ look }: { look: AvatarLook }) {
  const [hidden, setHidden] = useState(practiced);
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  if (hidden) return null;

  const typed = value.trim();
  const line = sent ? '✓ 냈어요' : typed ? '제출하면 끝' : '써 보고 제출!';
  return (
    <div className="cls-slide-up flex flex-col gap-3 rounded-3xl bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-extrabold text-white">연습</span>
        <span key={line} className={`cls-pop text-sm font-extrabold ${sent ? 'text-good' : 'text-ink-2'}`}>{line}</span>
      </div>
      <div className="rounded-2xl bg-bg px-4 py-3 text-center text-lg font-extrabold leading-snug">{TOPIC}</div>
      {sent ? (
        <div className="cls-slide-up flex items-center gap-3 rounded-2xl bg-good-soft p-3">
          <Reaction kind="happy" look={look} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-good">내 답 · 선생님이 공개하면 다 같이 봐요</div>
            <div className="whitespace-pre-wrap text-[15px] font-bold [overflow-wrap:anywhere]">{typed}</div>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed) setSent(true);
          }}
        >
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            maxLength={100}
            placeholder="여기에 답을 써요"
            aria-label="연습 답"
            className="resize-none rounded-2xl border-2 border-ink px-3 py-2 text-base font-bold outline-none"
          />
          <button type="submit" disabled={!typed} className="h-11 rounded-2xl bg-ink text-[15px] font-extrabold text-white disabled:opacity-40">
            제출
          </button>
        </form>
      )}
      {sent && (
        <div className="cls-slide-up flex items-center justify-between gap-3">
          <span className="text-sm text-ink-3">마감 전에는 고칠 수 있어요</span>
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(KEY, '1');
              } catch {
                // Private window: it shows again next time.
              }
            }}
            className="h-11 shrink-0 rounded-2xl bg-ink px-5 text-[15px] font-extrabold text-white"
          >
            알겠어요
          </button>
        </div>
      )}
    </div>
  );
}

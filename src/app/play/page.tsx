'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, remainingMs, SEND_TIMEOUT_MS, timeoutSignal, useLive, useTicker, type ConnState } from '@/client/live';
import type { StudentView, WrongNote } from '@/client/views';
import { CountUp } from '@/components/CountUp';
import { IdleAvatar } from '@/components/IdleAvatar';
import { PixelAvatar } from '@/components/PixelAvatar';
import { PracticeCard } from '@/components/PracticeCard';
import { Reaction, reactionLine } from '@/components/Reaction';
import { DEFAULT_LOOK, EYE_STYLES, HAIR_COLORS, HAIR_STYLES, normalizeLook, SKIN_TONES } from '@/lib/avatar';
import { MAX_TEXT_ANSWER } from '@/lib/text';
import { zoneCenter, zoneOf } from '@/lib/field';
import { ATTENDANCE_UNLOCKS, ITEMS, SLOTS, STAMPS_PER_UNLOCK, THEMES, attendanceStamps, itemById, previewLook } from '@/lib/items';
import type { AvatarLook, AvatarSlot, FieldPoint, ItemTheme, Question } from '@/lib/types';

function buzz(pattern: number | number[]) {
  // Android only; iPhone Safari has no vibration API.
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

// Moves are numbered across remounts and reloads, so the server never mistakes a new move for an old one.
const MOVE_BASE = Date.now() * 1000;
let moveCount = 0;
const nextMoveNumber = () => MOVE_BASE + ++moveCount;

export default function PlayPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const slot = new URLSearchParams(window.location.search).get('slot');
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryFetch = (n: number) => {
      // Timed out like every phone request, so a dead connection reaches the retries below instead of hanging.
      fetch(`/api/device${slot ? `?slot=${encodeURIComponent(slot)}` : ''}`, { method: 'POST', signal: timeoutSignal(SEND_TIMEOUT_MS) })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<{ token?: unknown }>;
        })
        .then((j) => {
          if (stop) return;
          if (typeof j.token !== 'string') throw new Error('no token');
          setToken(j.token);
        })
        .catch(() => {
          if (stop) return;
          if (n < 4) timer = setTimeout(() => tryFetch(n + 1), 500 * 2 ** n);
          else setTokenError(true);
        });
    };
    tryFetch(0);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  const { view, conn, send, serverNow } = useLive<StudentView>('student', token);

  if (tokenError) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="text-3xl font-bold">연결할 수 없어요</div>
          <div className="text-lg text-ink-3">노트북과 같은 와이파이인지 확인해 주세요.</div>
          <Button
            kind="dark"
            className="w-full"
            onClick={() => {
              setTokenError(false);
              setAttempt((a) => a + 1);
            }}
          >
            다시 시도
          </Button>
        </div>
      </Screen>
    );
  }
  if (!view) return <Screen><Message title="연결 중…" /></Screen>;

  return (
    <Screen>
      {conn === 'lost' && !view.refused && <div className="fixed inset-x-0 top-0 z-50 bg-bad py-2 text-center text-sm font-bold text-white">연결이 끊겼어요 · 다시 연결 중</div>}
      <Router view={view} send={send} serverNow={serverNow} conn={conn} />
    </Screen>
  );
}

type Send = (a: Record<string, unknown>) => Promise<unknown>;

function Router({ view, send, serverNow, conn }: { view: StudentView; send: Send; serverNow: () => number; conn: ConnState }) {
  const [lockerOpen, setLockerOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // Text drafts live here so the pause screen doesn't wipe them.
  const [drafts] = useState(() => new Map<string, string>());
  const s = view.session;
  // The locker and notes only show between questions; a starting quiz always wins.
  const between = !s || s.phase === 'lobby' || s.phase === 'summary';
  // A starting quiz closes the locker and notes for good, so they don't cover the results later.
  if (!between && (lockerOpen || notesOpen)) {
    setLockerOpen(false);
    setNotesOpen(false);
  }
  if (view.refused) return <Message title="잠시만 기다려 주세요" body={view.refused} />;
  if (!view.me) return <Register view={view} send={send} />;
  if (!view.me.look) return <CharacterPick send={send} name={view.me.name} />;
  if (lockerOpen && between) return <Locker me={view.me} send={send} onClose={() => setLockerOpen(false)} />;
  const notes = s?.phase === 'summary' && view.mySummary ? { eventName: s.eventName, wrong: view.mySummary.wrong, practice: view.mySummary.practice } : view.lastNotes;
  if (notesOpen && between && notes) return <Notes key="notes" eventName={notes.eventName} wrong={notes.wrong} practice={notes.practice} send={send} onBack={() => setNotesOpen(false)} />;
  const openNotes = notes ? () => setNotesOpen(true) : undefined;
  if (!s || s.phase === 'summary') {
    if (s?.phase === 'summary' && view.mySummary) return <Summary view={view} onLocker={() => setLockerOpen(true)} onNotes={() => setNotesOpen(true)} />;
    return <Home view={view} onLocker={() => setLockerOpen(true)} onNotes={openNotes} waiting={false} />;
  }
  if (s.paused) return <Message title="잠깐!" body="선생님을 봐 주세요" dark />;
  if (s.phase === 'lobby') return <Home view={view} onLocker={() => setLockerOpen(true)} onNotes={openNotes} waiting />;
  if (s.phase === 'checkpoint') {
    return s.checkpoint?.kind === 'retry' ? <Message title="다시 도전" body={`많이 틀린 단어 ${s.checkpoint.total}개를 한 번 더!`} dark /> : <Message title="잠깐 쉬어요" body="앞 화면을 봐 주세요" />;
  }
  if (!view.joined) return <Message title="다음 문제부터 참여해요" body="잠시만 기다려 주세요" />;
  if (s.phase === 'reveal') return <Result view={view} />;
  if (s.question?.kind === 'text') return <TextAnswer key={s.question.seq} view={view} send={send} serverNow={serverNow} drafts={drafts} />;
  return <GamePad key={s.question?.seq} view={view} send={send} serverNow={serverNow} conn={conn} />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-white text-ink">{children}</main>;
}

function Message({ title, body, dark }: { title: string; body?: string; dark?: boolean }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center ${dark ? 'bg-ink text-white' : ''}`}>
      <div className="text-3xl font-bold">{title}</div>
      {body && <div className={`text-lg ${dark ? 'text-[#A3A8B4]' : 'text-ink-3'}`}>{body}</div>}
    </div>
  );
}

function Button({ children, onClick, kind = 'primary', disabled, className = '' }: { children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'dark' | 'ghost'; disabled?: boolean; className?: string }) {
  const style = kind === 'primary' ? 'bg-accent text-ink' : kind === 'dark' ? 'bg-ink text-white' : 'border border-[#D5D8DF] bg-white text-ink';
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`h-14 rounded-2xl text-[17px] font-extrabold disabled:opacity-40 ${style} ${className}`}>
      {children}
    </button>
  );
}

// ---------- registration ----------

// Same rule as the server: Hangul or Latin letters, spaces, '·', '.', '-'; at most 20.
const NAME_RE = /^[가-힣A-Za-z][가-힣A-Za-z .·-]{0,19}$/;
const cleanName = (raw: string) => raw.normalize('NFC').trim().replace(/\s+/g, ' ');

/** First visit: the student writes 반, 번호 and 이름; the teacher approves with a matching symbol. */
function Register({ view, send }: { view: StudentView; send: Send }) {
  const req = view.request;
  const classes = view.classes ?? [];
  // After a rejection or timeout the form keeps what was typed, so only the mistake needs fixing.
  const [classPick, setClassPick] = useState<string | null>(() => classes.find((c) => c.name === req?.className)?.id ?? null);
  // The class from an earlier request, even if it isn't offered right now.
  const [prefillClass] = useState(() => req?.className ?? null);
  const [number, setNumber] = useState(() => (req ? String(req.number) : ''));
  const [name, setName] = useState(() => req?.name ?? '');
  const [error, setError] = useState('');
  // An error from before registration closed or reopened no longer applies.
  const [seenOpen, setSeenOpen] = useState(view.registrationOpen);
  if (seenOpen !== view.registrationOpen) {
    setSeenOpen(view.registrationOpen);
    setError('');
  }

  if (req?.status === 'pending') {
    return (
      <div className="flex flex-1 flex-col items-center px-6 pb-8 pt-14">
        <div className="flex flex-1 flex-col items-center justify-center gap-7">
          <div className="flex h-56 w-48 items-end justify-center rounded-t-full rounded-b-2xl bg-bg pb-5"><div className="cls-float"><PixelAvatar look={DEFAULT_LOOK} size={150} blink={1} /></div></div>
          <div className="text-center">
            <div className="text-2xl font-bold">선생님 확인 중</div>
            <div className="mt-2 text-ink-3">{req.className} {req.number}번 {req.name}</div>
          </div>
          <div className="rounded-2xl bg-bg px-7 py-3 text-center">
            <div className="text-xs font-bold text-ink-3">확인 기호</div>
            <div className="text-3xl font-extrabold">{req.symbol}</div>
          </div>
          <div className="-mt-4 text-sm text-ink-3">선생님 화면에도 같은 기호가 떠요</div>
        </div>
        <Button kind="ghost" className="w-full" onClick={() => send({ type: 'cancel-register' })}>취소하고 다시 쓰기</Button>
      </div>
    );
  }

  if (!view.registrationOpen || classes.length === 0) {
    return <Message title="잠시만요" body={view.registrationOpen ? '선생님이 반을 만들면 등록할 수 있어요.' : '선생님 화면이 켜지면 등록할 수 있어요.'} />;
  }

  // While a class is in the room only its 반 is offered. It's picked for the student unless
  // they had chosen (or earlier asked for) another class: then they must tap it on purpose.
  const offered = (id: string | null) => !!id && classes.some((c) => c.id === id);
  // Only a lesson in progress (one class offered) makes an earlier choice "another class"; a deleted class doesn't.
  const choseOther =
    classes.length === 1 &&
    req?.reason !== 'gone' &&
    ((classPick !== null && !offered(classPick)) || (classPick === null && !!prefillClass && !classes.some((c) => c.name === prefillClass)));
  const classId = offered(classPick) ? classPick : classes.length === 1 && !choseOther ? classes[0].id : null;
  const num = Number(number);
  const canSend = !!classId && Number.isInteger(num) && num >= 1 && num <= 99 && NAME_RE.test(cleanName(name));
  return (
    <form
      className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        setError('');
        send({ type: 'register', classId, number: num, name: cleanName(name) }).catch((err: Error) => setError(err.message));
      }}
    >
      <div className="font-display text-base font-bold">Classeum</div>
      <div className="text-3xl font-bold tracking-tight">처음 왔어요</div>
      {req?.status === 'rejected' && <div className="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad">선생님이 거절했어요. 반·번호·이름을 다시 확인해 주세요.</div>}
      {req?.status === 'expired' && req.reason === 'taken' && <div className="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad">그 번호는 다른 친구가 먼저 등록했어요. 번호를 다시 확인해 주세요.</div>}
      {req?.status === 'expired' && req.reason === 'class' && <div className="rounded-xl bg-bg px-4 py-3 text-sm font-semibold text-ink-2">다른 반 수업이 시작돼서 요청이 취소됐어요.</div>}
      {req?.status === 'expired' && req.reason === 'gone' && <div className="rounded-xl bg-bg px-4 py-3 text-sm font-semibold text-ink-2">그 반이 없어졌어요. 반을 다시 골라 주세요.</div>}
      {req?.status === 'expired' && (req.reason === 'timeout' || !req.reason) && <div className="rounded-xl bg-bg px-4 py-3 text-sm font-semibold text-ink-2">시간이 지나 다시 요청해야 해요.</div>}
      {choseOther && classes.length > 0 && (
        <div className="rounded-xl bg-bg px-4 py-3 text-sm font-semibold text-ink-2">지금은 {classes.map((c) => c.name).join(', ')} 수업이라 그 반만 등록할 수 있어요. 내 반이 맞는지 보고 골라 주세요.</div>
      )}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-bold text-ink-3">반</div>
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={classId === c.id}
              onClick={() => setClassPick(c.id)}
              className={`h-12 rounded-2xl px-5 text-base font-bold ${classId === c.id ? 'bg-ink text-white' : 'bg-bg'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-bold text-ink-3">번호</span>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 2))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="예: 15"
          className="h-14 rounded-2xl bg-bg px-4 text-xl font-bold outline-none"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-bold text-ink-3">이름</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          maxLength={20}
          placeholder="예: 김하윤"
          className="h-14 rounded-2xl bg-bg px-4 text-xl font-bold outline-none"
        />
      </label>
      {error && <div className="text-sm font-semibold text-bad">{error}</div>}
      <div className="flex-1" />
      <p className="text-center text-sm text-ink-3">선생님이 확인하면 들어가요. 폰을 바꿨다면 예전과 똑같이 쓰면 기록이 이어져요.</p>
      <button type="submit" disabled={!canSend} className="h-14 rounded-2xl bg-ink text-[17px] font-extrabold text-white disabled:opacity-40">
        등록 요청
      </button>
    </form>
  );
}

type PickTab = 'style' | 'hair' | 'skin' | 'eyes';
const PICK_TABS: [PickTab, string][] = [['style', '머리 모양'], ['hair', '머리색'], ['skin', '피부'], ['eyes', '눈']];

/**
 * First visit: pick the whole character. From the locker (`current` set): change hair, skin and eyes only;
 * items stay as they are.
 */
function CharacterPick({ send, name, current, onClose }: { send: Send; name: string; current?: AvatarLook; onClose?: () => void }) {
  const [look, setLook] = useState<AvatarLook>(current ?? { ...DEFAULT_LOOK });
  const [tab, setTab] = useState<PickTab>('style');
  const editing = current !== undefined;
  const options: Record<PickTab, { key: keyof AvatarLook; list: { id: string; name: string }[] }> = {
    style: { key: 'hairStyle', list: HAIR_STYLES },
    hair: { key: 'hair', list: HAIR_COLORS },
    skin: { key: 'skin', list: SKIN_TONES },
    eyes: { key: 'eyes', list: EYE_STYLES },
  };
  const { key, list } = options[tab];
  // While editing, hats and glasses come off in the pictures so every hair style and eye shape can be told apart.
  const shown: AvatarLook = editing ? { ...look, helmet: 'none', face: 'none' } : look;
  const save = () => {
    const { skin, hair, hairStyle, eyes } = look;
    send({ type: 'look', look: editing ? { skin, hair, hairStyle, eyes } : look })
      .then(() => onClose?.())
      .catch(() => undefined);
  };
  return (
    <div className="flex h-[100dvh] flex-col gap-4 bg-ink px-5 pb-5 pt-10 text-white">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl font-bold">{editing ? '캐릭터 바꾸기' : `반가워요, ${name.slice(-2)}`}</div>
          <div className="mt-1 text-[#A3A8B4]">{editing ? '모자·안경은 잠깐 벗어 둬요' : '내 캐릭터를 골라요 · 나중에 바꿀 수 있어요'}</div>
        </div>
        {editing && (
          <button type="button" onClick={onClose} className="shrink-0 rounded-full bg-[#24272F] px-4 py-1.5 text-sm font-bold">
            닫기
          </button>
        )}
      </div>
      <div className="mx-auto flex h-44 w-40 shrink-0 items-end justify-center rounded-t-full rounded-b-2xl bg-[#24272F] pb-3 [@media(max-height:640px)]:h-36 [@media(max-height:640px)]:w-32">
        <IdleAvatar look={shown} size={132} seed="me" />
      </div>
      <div className="flex shrink-0 gap-1 rounded-full bg-[#24272F] p-1" role="tablist">
        {PICK_TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-9 flex-1 rounded-full text-sm font-bold ${tab === t ? 'bg-accent text-ink' : 'text-[#A3A8B4]'}`}>
            {label}
          </button>
        ))}
      </div>
      {/* Each choice is shown on the character itself, so nobody has to guess what a name means. */}
      {/* A fresh grid per tab starts at the top; the padding keeps the selected ring from being clipped. */}
      <div key={tab} className="-mx-1 grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-2 overflow-y-auto p-1">
        {list.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={look[key] === o.id}
            onClick={() => setLook({ ...look, [key]: o.id })}
            className={`flex flex-col items-center gap-0.5 rounded-2xl bg-[#24272F] pb-1.5 pt-1 ${look[key] === o.id ? 'ring-2 ring-accent' : ''}`}
          >
            <IdleAvatar look={{ ...shown, [key]: o.id }} size={56} seed={`${key}:${o.id}`} />
            <span className="text-[11px] font-semibold text-[#A3A8B4]">{o.name}</span>
          </button>
        ))}
      </div>
      <Button onClick={save} className="shrink-0">{editing ? '저장' : '이걸로 할래요'}</Button>
    </div>
  );
}

// ---------- home & lobby ----------

const POKE_LINES = ['안녕!', '공부하자!', '간지러워', '배고파…', '오늘도 파이팅', '헤헤', '왜 불러?', '그만 눌러~', '나 귀엽지?', '영단어 좋아'];

/** Tap the character and it hops and says something; poke it too much and it spins dizzy. */
function PokeAvatar({ look, size }: { look: AvatarLook; size: number }) {
  const [pokes, setPokes] = useState(0);
  const [line, setLine] = useState<string | null>(null);
  const timers = useRef<{ line?: ReturnType<typeof setTimeout>; reset?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.line);
      clearTimeout(t.reset);
    };
  }, []);
  const dizzy = pokes >= 8;
  return (
    <button
      type="button"
      aria-label="캐릭터 쿡 찌르기"
      onClick={() => {
        const n = pokes + 1;
        setPokes(n);
        setLine(n >= 8 ? '어지러워~' : POKE_LINES[(n * 7 + look.skin.length) % POKE_LINES.length]);
        buzz(n >= 8 ? [20, 30, 20] : 8);
        clearTimeout(timers.current.line);
        clearTimeout(timers.current.reset);
        timers.current.line = setTimeout(() => setLine(null), 1600);
        timers.current.reset = setTimeout(() => setPokes(0), 3000);
      }}
      className="relative"
      style={{ touchAction: 'manipulation' }}
    >
      {line && (
        <span key={`${pokes}`} className="cls-bubble absolute bottom-full left-1/2 mb-1 whitespace-nowrap rounded-xl bg-white px-3 py-1 text-sm font-bold text-ink shadow-[0_2px_8px_rgba(16,18,24,0.15)]">
          {line}
        </span>
      )}
      <div className="cls-float">
        <div key={pokes} className={`origin-bottom ${pokes === 0 ? '' : dizzy ? 'cls-spin' : 'cls-poke'}`}>
          <PixelAvatar look={look} size={size} mood={dizzy ? 'dizzy' : line ? 'happy' : 'normal'} blink={4} />
        </div>
      </div>
    </button>
  );
}

function Home({ view, onLocker, onNotes, waiting }: { view: StudentView; onLocker: () => void; onNotes?: () => void; waiting: boolean }) {
  const me = view.me!;
  const look = normalizeLook(me.look ?? undefined);
  const s = view.session;
  // A gift every 5 footprints: show this round of 5 and what comes next.
  const stamps = me.stamps % STAMPS_PER_UNLOCK;
  const nextGift = itemById(ATTENDANCE_UNLOCKS[Math.floor(me.stamps / STAMPS_PER_UNLOCK)] ?? '');
  return (
    <div className="flex flex-1 flex-col gap-4 bg-bg px-5 pb-6 pt-10">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-bold tracking-tight">안녕, {me.name.slice(-2)}</div>
        <button type="button" onClick={onLocker} className="rounded-2xl bg-white px-3 py-2 text-sm font-bold">보관함</button>
      </div>
      <div className={`flex flex-col items-center gap-4 rounded-3xl p-6 transition-colors duration-500 ${waiting ? 'bg-ink text-white' : 'bg-white'}`}>
        <PokeAvatar look={look} size={128} />
        <div className="text-center">
          <div className="text-xl font-bold">{waiting ? '곧 시작해요' : view.elsewhere ? `지금은 ${view.elsewhere} 수업 중` : '퀴즈를 기다리는 중'}</div>
          <div className={`mt-1 text-sm ${waiting ? 'text-[#A3A8B4]' : 'text-ink-3'}`}>
            {waiting ? '앞 화면을 봐 주세요' : view.elsewhere ? `${me.className} 수업 때 다시 만나요` : '퀴즈가 열리면 자동으로 넘어가요'}
          </div>
        </div>
      </div>
      {waiting && s?.reward && (
        <div className="cls-slide-up flex items-center gap-4 rounded-3xl bg-gold p-4">
          {itemById(s.reward.itemId) && <IdleAvatar look={previewLook(itemById(s.reward.itemId)!, look)} size={64} seed={s.reward.itemId} />}
          <div>
            <div className="text-xs font-extrabold">오늘의 보상</div>
            <div className="text-xl font-extrabold">{s.reward.itemName}</div>
            <div className="text-xs font-semibold text-[#4A3A10]">정답 {s.reward.challengePct}%+ 또는 내 평균 +{s.reward.growthPp}%p</div>
          </div>
        </div>
      )}
      {/* A first-timer (no footprints yet) can try one pretend question while waiting. */}
      {me.stamps === 0 && <PracticeCard look={look} />}
      <div className="rounded-3xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-bold">
          <span>출석 발자국</span>
          <span className="tabular text-ink-3">총 {me.stamps}개</span>
        </div>
        <div className="grid grid-cols-6 items-center gap-2">
          {Array.from({ length: STAMPS_PER_UNLOCK }, (_, i) => (
            <div key={i} className={`flex aspect-square items-center justify-center gap-0.5 rounded-xl ${i < stamps ? 'bg-[#FFF6DE]' : 'border-2 border-dashed border-[#D5D8DF]'}`}>
              <span className="mt-1.5 h-3 w-2 rounded" style={{ background: i < stamps ? '#B86F50' : '#E3E5EA' }} />
              <span className="mb-1.5 h-3 w-2 rounded" style={{ background: i < stamps ? '#B86F50' : '#E3E5EA' }} />
            </div>
          ))}
          {nextGift && (
            <div className="flex aspect-square items-end justify-center rounded-xl bg-gold/30" title={`다음 선물: ${nextGift.name}`}>
              <IdleAvatar look={previewLook(nextGift, look)} size={40} seed={nextGift.id} />
            </div>
          )}
        </div>
        {nextGift && <div className="mt-2 text-right text-xs text-ink-3">발자국 {STAMPS_PER_UNLOCK - stamps}개 더 모으면 {nextGift.name}</div>}
      </div>
      {onNotes && view.lastNotes && (
        <button type="button" onClick={onNotes} className="flex items-center justify-between rounded-3xl bg-white p-4 text-left">
          <div>
            <div className="text-sm font-bold">지난 오답 노트</div>
            <div className="text-xs text-ink-3">{view.lastNotes.eventName} · {view.lastNotes.wrong.length}개</div>
          </div>
          <span className="text-xl text-ink-3" aria-hidden>›</span>
        </button>
      )}
    </div>
  );
}

// ---------- play ----------

function Countdown({ view, serverNow, small }: { view: StudentView; serverNow: () => number; small?: boolean }) {
  const s = view.session!;
  const q = s.question!;
  useTicker(true, 200);
  const ms = s.phase === 'intro' ? q.seconds * 1000 : remainingMs(s.phaseEndsAt, s.paused, s.pausedRemaining, serverNow());
  const pct = (ms / (q.seconds * 1000)) * 100;
  const urgent = s.phase === 'moving' && !s.paused && ms <= 3000;
  return (
    <div className={`flex items-center gap-2 rounded-full py-1 pl-1 text-white transition-colors ${urgent ? 'cls-urgent bg-accent' : 'bg-ink'} ${small ? 'pr-3' : 'pr-4'}`}>
      <div className="h-7 w-7 rounded-full" style={{ background: `conic-gradient(${urgent ? '#FFFFFF' : '#FF5B24'} 0 ${pct}%, ${urgent ? '#FF9A73' : '#3D4354'} 0 100%)` }} />
      <span className="tabular text-lg font-extrabold">{formatClock(ms)}</span>
    </div>
  );
}

function QuestionHeader({ view, serverNow }: { view: StudentView; serverNow: () => number }) {
  const s = view.session!;
  const total = s.round === 'retry' ? s.total : s.mainCount;
  return (
    <div className="flex items-center justify-between">
      <div className="tabular text-lg font-extrabold">{s.index + 1}<span className="text-[#A3A8B4]"> / {total}</span></div>
      <Countdown view={view} serverNow={serverNow} small />
    </div>
  );
}

function GamePad({ view, send, serverNow, conn }: { view: StudentView; send: Send; serverNow: () => number; conn: ConnState }) {
  const s = view.session!;
  const q = s.question!;
  const n = q.options.length;
  const look = normalizeLook(view.me?.look ?? undefined);
  const [point, setPoint] = useState<FieldPoint>(view.myPoint ?? { x: 0.5, y: 0.5 });
  const lastSent = useRef(0);
  const pending = useRef<NodeJS.Timeout | null>(null);
  const retry = useRef<NodeJS.Timeout | null>(null);
  // The newest spot and whether the server has it; a failed send is retried with that spot.
  const latest = useRef<FieldPoint | null>(null);
  const acked = useRef(true);
  const active = s.phase === 'moving' && !s.paused;
  const lastZone = useRef(zoneOf(view.myPoint ?? { x: 0.5, y: 0.5 }, n));

  const fire = useCallback(() => {
    const attempt = () => {
      const p = latest.current;
      if (!p) return;
      lastSent.current = Date.now();
      acked.current = false;
      send({ type: 'pos', seq: q.seq, n: nextMoveNumber(), x: p.x, y: p.y })
        .then(() => {
          if (latest.current === p) acked.current = true;
        })
        .catch(() => {
          if (retry.current) clearTimeout(retry.current);
          retry.current = setTimeout(() => {
            if (!acked.current) attempt();
          }, 400);
        });
    };
    attempt();
  }, [send, q.seq]);

  const push = useCallback(
    (p: FieldPoint) => {
      latest.current = p;
      if (pending.current) clearTimeout(pending.current);
      const wait = 120 - (Date.now() - lastSent.current);
      if (wait <= 0) fire();
      else pending.current = setTimeout(fire, wait);
    },
    [fire],
  );

  // After a reconnect, resend a move the server may not have.
  useEffect(() => {
    if (active && conn === 'open' && !acked.current) fire();
  }, [active, conn, fire]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );

  // Tapping a box sends the character to the middle of that box; tapping another one changes the answer.
  const moveTo = useCallback(
    (z: number) => {
      if (!active) return;
      if (z !== lastZone.current) buzz(25);
      lastZone.current = z;
      const c = zoneCenter(z, n);
      setPoint(c);
      push(c);
    },
    [active, n, push],
  );

  // On a laptop the number keys pick a box too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const z = Number(e.key) - 1;
      if (Number.isInteger(z) && z >= 0 && z < n) moveTo(z);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveTo, n]);

  const zone = zoneOf(point, n);
  const cells = n === 2 ? [0, 1] : [0, 1, 2, 3];

  return (
    // One screen on any phone: the answer boxes take whatever height is left under the question.
    <div className="flex h-[100dvh] select-none flex-col gap-3 px-5 pb-5 pt-5" style={{ WebkitTouchCallout: 'none', overscrollBehavior: 'none' }}>
      <QuestionHeader view={view} serverNow={serverNow} />
      <div className="flex flex-col items-center gap-1 rounded-3xl bg-bg px-4 py-4">
        <div className="text-xs font-bold text-ink-3">{s.round === 'retry' ? '다시 도전' : q.modeLabel}</div>
        <div
          className={`text-center font-extrabold tracking-tight ${s.phase === 'intro' && s.index === 0 ? 'invisible' : 'cls-drop-in'} ${q.prompt.length > 24 ? 'text-lg leading-snug' : 'text-[34px] leading-tight'}`}
        >
          {q.prompt}
        </div>
      </div>
      <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-3xl bg-bg">
        <div className="absolute inset-0 grid gap-2 p-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: n === 2 ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
          {cells.map((z) => {
            const label = q.options[z];
            const mine = zone === z;
            return (
              <button
                key={z}
                type="button"
                disabled={!active || label === undefined}
                onClick={() => moveTo(z)}
                className={`zone-${z} relative flex flex-col items-center justify-center overflow-hidden rounded-2xl px-3 pb-3 pt-9 text-center transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]`}
                style={
                  label === undefined
                    ? { background: '#ECEEF1' }
                    : { background: mine ? 'var(--zone-soft)' : '#FFFFFF', boxShadow: mine ? 'inset 0 0 0 4px var(--zone)' : 'inset 0 -3px 0 rgba(16,18,24,0.06)' }
                }
              >
                {label !== undefined && (
                  <>
                    <span className="absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold text-white" style={{ background: 'var(--zone)' }}>
                      {z + 1}
                    </span>
                    <span className={`font-extrabold leading-tight [overflow-wrap:anywhere] ${label.length > 20 ? 'text-base' : label.length > 10 ? 'text-lg' : 'text-2xl'}`} style={{ color: 'var(--zone-ink)' }}>
                      {label}
                    </span>
                    {/* My character hops into the box I picked, in a corner so the label doesn't move. */}
                    {mine && (
                      <span key={`${q.seq}-${z}`} className="cls-pop absolute bottom-1.5 right-1.5">
                        <PixelAvatar look={look} size={40} blink={3} />
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
        {/* Until a box is picked the character waits on the start line in the middle. */}
        {zone < 0 && (
          // With two boxes side by side the labels sit in the middle row, so the start line moves to the bottom edge.
          <div className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full border-2 border-dashed border-[#C9CDD6] bg-bg/90 p-2 ${n === 2 ? 'bottom-2' : 'top-1/2 -translate-y-1/2'}`}>
            <PixelAvatar look={look} size={44} blink={3} />
          </div>
        )}
        {s.phase === 'intro' && <IntroOverlay view={view} serverNow={serverNow} />}
      </div>
    </div>
  );
}

function IntroOverlay({ view, serverNow }: { view: StudentView; serverNow: () => number }) {
  const s = view.session!;
  useTicker(true, 150);
  const ms = remainingMs(s.phaseEndsAt, s.paused, s.pausedRemaining, serverNow());
  const n = Math.min(3, Math.ceil(ms / 1000));
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
      {s.index === 0 && n > 0 ? (
        <div key={n} className="cls-count font-display text-7xl font-bold text-accent">{n}</div>
      ) : (
        <div className="cls-pop text-3xl font-extrabold">준비!</div>
      )}
    </div>
  );
}

function TextAnswer({ view, send, serverNow, drafts }: { view: StudentView; send: Send; serverNow: () => number; drafts: Map<string, string> }) {
  const s = view.session!;
  const q = s.question!;
  const draftKey = `${s.id}:${q.seq}`;
  const [value, setValue] = useState(drafts.get(draftKey) ?? view.myText ?? '');
  // What the server holds, and whether it came from 제출: only a submitted answer counts as done
  // for closing early; drafts are still graded if time runs out.
  const [saved, setSaved] = useState({ text: view.myText ?? '', final: !!view.myTextFinal });
  const [error, setError] = useState('');
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = s.phase === 'moving' && !s.paused;
  const submit = useCallback(
    (text: string, final: boolean) => {
      if (!text.trim()) return;
      setError('');
      // 제출 cancels a pending autosave, so a late draft can't undo it.
      if (final && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const attempt = (left: number) => {
        // Numbered like moves, so the server drops a draft that arrives after a newer answer.
        send({ type: 'text', seq: q.seq, value: text, final, n: nextMoveNumber() })
          .then(() => setSaved((prev) => (!final && prev.final && prev.text === text ? prev : { text, final })))
          .catch(() => {
            if (left > 0 && latest.current === text) setTimeout(() => attempt(left - 1), 400);
            else setError('전송 실패 · 다시 눌러 주세요');
          });
      };
      attempt(1);
    },
    [send, q.seq],
  );
  // While typing, the latest text is saved at most every 0.3 s (not only after a pause).
  useEffect(() => {
    if (!active || value === saved.text || !value.trim() || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      submit(latest.current, false);
    }, 300);
  }, [active, value, saved.text, submit]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <form
      className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (active) submit(value, true);
      }}
    >
      <QuestionHeader view={view} serverNow={serverNow} />
      <div className="cls-drop-in rounded-3xl bg-bg px-4 py-6 text-center text-xl font-bold leading-snug">{q.prompt}</div>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          latest.current = e.target.value;
          drafts.set(draftKey, e.target.value);
        }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        lang="en"
        inputMode="text"
        enterKeyHint="send"
        maxLength={MAX_TEXT_ANSWER}
        disabled={!active}
        aria-label="답 쓰기"
        className="h-16 rounded-2xl border-2 border-ink px-4 text-2xl font-bold outline-none"
      />
      {error && <div className="text-sm font-semibold text-bad">{error}</div>}
      <button type="submit" disabled={!active || !value.trim()} className="h-14 rounded-2xl bg-ink text-[17px] font-extrabold text-white disabled:opacity-40">
        {saved.final && saved.text === value ? '제출했어요 · 고칠 수 있어요' : '제출'}
      </button>
    </form>
  );
}

function Result({ view }: { view: StudentView }) {
  const s = view.session!;
  const r = view.result;
  const counted = !!r?.counted;
  const correct = !!r?.correct;
  useEffect(() => {
    if (!counted) return;
    // Buzz in time with the cheer, or with the 펑 when the avatar bursts.
    const id = setTimeout(() => buzz(correct ? [30, 60, 30] : [30, 40, 140]), correct ? 300 : 720);
    return () => clearTimeout(id);
  }, [counted, correct]);
  if (!r || !r.counted) return <Message title="이번 문제는 쉬어요" body={r ? `정답: ${r.correctLabel}` : undefined} />;
  const kind = r.correct ? 'happy' : r.choice < 0 && !r.mineLabel ? 'sleep' : 'pop';
  const look = normalizeLook(view.me?.look ?? undefined);
  // A writing question has no start line or zones to talk about.
  const writing = s.question?.kind === 'text';
  return (
    // Short phones tighten the spacing so the friends row still fits on screen.
    <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-8 [@media(max-height:700px)]:gap-3 [@media(max-height:700px)]:pb-4 [@media(max-height:700px)]:pt-5">
      <div className="flex items-center justify-between">
        <div className="tabular text-lg font-extrabold">{s.index + 1}</div>
        <div className="flex items-center gap-1.5">
          {/* Only this phone sees its streak. */}
          {r.streak >= 2 && (
            <div key={r.streak} className="cls-pop rounded-full bg-[#FFF1E6] px-3 py-1 text-sm font-extrabold text-[#C2410C]" style={{ animationDelay: '0.5s' }}>
              🔥 {r.streak}연속
            </div>
          )}
          {r.broke >= 3 && (
            <div className="cls-pop rounded-full bg-bg px-3 py-1 text-sm font-extrabold text-ink-3" style={{ animationDelay: '0.9s' }}>
              🔥 {r.broke}연속 끝
            </div>
          )}
          <div
            className={`cls-pop rounded-full px-3 py-1 text-sm font-extrabold text-white ${kind === 'happy' ? 'bg-good' : kind === 'pop' ? 'bg-[#E5484D]' : 'bg-ink-3'}`}
            style={{ animationDelay: kind === 'pop' ? '0.75s' : '0.2s' }}
          >
            {kind === 'happy' ? '정답!' : kind === 'pop' ? '펑!' : '쿨쿨…'}
          </div>
        </div>
      </div>
      <div className="flex justify-center pt-4 [@media(max-height:700px)]:[zoom:0.75]">
        <Reaction kind={kind} look={look} size={96} delay={150} bubble={reactionLine(kind, `${view.me?.id}:${s.question?.seq}`)} />
      </div>
      <div className="cls-slide-up rounded-3xl bg-good p-6 text-white [@media(max-height:700px)]:px-5 [@media(max-height:700px)]:py-4">
        <div className="text-sm font-semibold text-[#CDEFDF]">{s.question?.prompt}</div>
        <div className="mt-1 text-[32px] font-extrabold leading-tight">{r.correctLabel}</div>
      </div>
      <div className={`flex items-center justify-between rounded-3xl px-5 py-4 ${r.correct ? 'bg-good-soft' : 'cls-shake bg-bad-soft'}`} style={{ animationDelay: '0.25s' }}>
        <div>
          <div className="text-xs font-bold text-ink-3">내 답</div>
          <div className="text-xl font-extrabold">{r.mineLabel ?? (writing ? '못 썼어요' : '못 골랐어요')}</div>
        </div>
        <div
          className={`cls-pop flex h-11 w-11 items-center justify-center rounded-full text-xl font-extrabold text-white ${r.correct ? 'bg-good' : 'bg-[#E5484D]'}`}
          style={{ animationDelay: '0.2s' }}
        >
          {r.correct ? '✓' : '✕'}
        </div>
      </div>
      {/* Right under my answer, so it stays on screen on a small phone even when the notes below run long. */}
      <CorrectFriends friends={r.friends} me={r.correct ? look : null} />
      {kind === 'sleep' && <div className="px-1 text-base leading-relaxed text-ink-2">{writing ? '다음엔 꼭 써 봐요!' : '출발선에서 졸았어요. 다음엔 칸으로 쏙!'}</div>}
      {!r.correct && r.feedback && <div className="px-1 text-base leading-relaxed text-ink-2">네가 고른 {r.feedback}</div>}
      {!r.correct && r.explanation && <div className="px-1 text-sm leading-relaxed text-ink-3">{r.explanation}</div>}
      <div className="mt-auto text-center text-sm text-ink-3 [@media(max-height:700px)]:hidden">다음 문제를 기다려요</div>
    </div>
  );
}

/** Classmates who got it right, as characters only, in one row; if I did too, I'm first. */
function CorrectFriends({ friends, me }: { friends: NonNullable<StudentView['result']>['friends']; me: AvatarLook | null }) {
  const looks = (me ? [me, ...friends.looks] : friends.looks).slice(0, 9);
  const total = friends.total + (me ? 1 : 0);
  return (
    <div className="cls-slide-up rounded-3xl bg-bg px-4 py-3" style={{ animationDelay: '0.9s' }}>
      {/* The count is friends only; my own character just leads the row. */}
      <div className="text-sm font-bold">{total === 0 ? '이번엔 아무도 못 맞혔어요' : friends.total === 0 ? '나만 맞혔어요!' : `맞힌 친구 ${friends.total}명`}</div>
      {total === 0 && <div className="mt-1 text-sm text-ink-3">다 같이 다음에!</div>}
      {/* Text questions send only the count, so there may be no characters to draw. */}
      {looks.length > 0 && (
        <div className="mt-2 flex items-end gap-1">
          {looks.map((l, i) => (
            <div key={i} className="cls-drop-in relative" style={{ animationDelay: `${1300 + i * 40}ms` }}>
              <div className="cls-float" style={{ animationDelay: `-${(i * 0.37) % 2.4}s` }}>
                <PixelAvatar look={l} size={24} />
              </div>
              {me && i === 0 && <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded bg-accent px-1 text-[9px] font-extrabold leading-tight text-ink">나</span>}
            </div>
          ))}
          {total > looks.length && <span className="ml-1 self-center text-xs font-bold text-ink-3">+{total - looks.length}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- summary & wrong-answer notes ----------

function Notes({ eventName, wrong, practice, send, onBack }: { eventName: string; wrong: WrongNote[]; practice: Question[]; send: Send; onBack: () => void }) {
  const [practicing, setPracticing] = useState(false);
  if (practicing) return <Practice questions={practice} send={send} onDone={() => setPracticing(false)} />;
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <div className="flex items-end justify-between px-5 pb-3 pt-10">
        <div className="text-2xl font-bold">오답 노트</div>
        <div className="text-sm font-semibold text-ink-3">{eventName} · {wrong.length}개</div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4">
        {wrong.length === 0 && <div className="py-10 text-center text-ink-3">틀린 문제가 없어요!</div>}
        {wrong.map((w, i) => (
          <div key={w.questionId} className="cls-slide-up flex flex-col gap-2 rounded-2xl bg-white p-4" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-extrabold">{w.spelling ?? w.prompt}</div>
                <div className="text-base font-bold text-good">{w.meaning ?? w.correctLabel}</div>
              </div>
              {w.spelling && (
                <button type="button" aria-label="발음 듣기" onClick={() => speak(w.spelling!)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#101218" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
                </button>
              )}
            </div>
            <div className="text-sm text-ink-3">내 답 <span className={`font-bold text-bad ${w.mineLabel.startsWith('(') ? '' : 'line-through'}`}>{w.mineLabel}</span>{w.feedback ? ` · ${w.feedback}` : ''}</div>
            {w.example && <div className="rounded-lg bg-bg px-3 py-2 text-sm leading-relaxed text-ink-2">{w.example}{w.exampleMeaning ? ` ${w.exampleMeaning}` : ''}</div>}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-6 pt-3">
        {practice.length > 0 && <Button kind="dark" onClick={() => setPracticing(true)}>틀린 단어 다시 풀기</Button>}
        <Button kind="ghost" onClick={onBack}>돌아가기</Button>
      </div>
    </div>
  );
}

function Summary({ view, onLocker, onNotes }: { view: StudentView; onLocker: () => void; onNotes: () => void }) {
  const sum = view.mySummary!;
  const me = view.me!;
  const look = normalizeLook(me.look ?? undefined);
  const item = sum.reward ? itemById(sum.reward.itemId) : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 bg-ink px-5 pb-6 pt-10 text-white">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-sm font-semibold text-[#A3A8B4]">{view.session?.eventName}</div>
          <div className="tabular text-6xl font-extrabold tracking-tight">
            <CountUp value={sum.mainCorrect} ms={900} delay={200} />
            <span className="text-3xl text-ink-3">/{sum.mainTotal}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {sum.stampAdded && (
            <div className="cls-pop rounded-xl bg-[#24272F] px-3 py-2 text-sm font-bold text-[#D5D8DF]" style={{ animationDelay: '0.9s' }}>
              발자국 +1
            </div>
          )}
          {(sum.bestStreak ?? 0) >= 2 && (
            <div className="cls-pop rounded-xl bg-[#24272F] px-3 py-2 text-sm font-bold text-[#FDBA74]" style={{ animationDelay: '1s' }}>
              🔥 최고 {sum.bestStreak}연속
            </div>
          )}
        </div>
      </div>
      {sum.reward && item ? (
        <div className="cls-unbox flex items-center gap-4 rounded-3xl bg-gold p-4 text-ink" style={{ animationDelay: '1.1s' }}>
          <div className="flex h-28 w-24 items-end justify-center rounded-t-full rounded-b-xl bg-[#FFE29A] pb-2">
            <div className="cls-float">
              <PixelAvatar look={{ ...look, effect: 'sparkle', [item.slot]: item.value } as AvatarLook} size={80} />
            </div>
          </div>
          <div>
            <div className="text-xs font-extrabold">오늘의 보상 · {sum.reward.reason === 'challenge' ? '도전' : '성장'} 달성</div>
            <div className="text-2xl font-extrabold">{item.name}</div>
            <div className="text-xs font-semibold text-[#4A3A10]">{sum.reward.alreadyOwned ? '이미 가지고 있어요' : '보관함에 들어갔어요'}</div>
          </div>
        </div>
      ) : (
        <div className="cls-slide-up rounded-3xl bg-[#24272F] p-4 text-sm text-[#D5D8DF]" style={{ animationDelay: '0.9s' }}>{sum.judged ? '이번엔 보상을 못 받았어요. 다음에 다시 도전!' : sum.shortQuiz ? '퀴즈가 일찍 끝나서 오늘은 보상 판정이 없어요.' : '오늘은 참여한 문제가 적어서 보상 판정이 없어요.'}</div>
      )}
      {sum.unlocked.length > 0 && <div className="rounded-2xl bg-[#24272F] p-4 text-sm font-semibold">발자국 보상: {sum.unlocked.map((id) => itemById(id)?.name).join(', ')}</div>}
      {sum.wrong.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-[#24272F] p-4">
          <div className="text-sm font-bold text-[#A3A8B4]">다시 볼 단어</div>
          <div className="flex flex-wrap gap-2">{sum.wrong.slice(0, 8).map((w) => <span key={w.questionId} className="rounded-full bg-[#3D4354] px-3 py-1.5 text-sm font-bold">{w.spelling ?? w.correctLabel}</span>)}</div>
        </div>
      )}
      <div className="flex-1" />
      <Button onClick={onNotes}>오답 노트 보기</Button>
      <Button kind="ghost" onClick={onLocker} className="!bg-transparent !text-white !border-[#3D4354]">보관함</Button>
    </div>
  );
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function Practice({ questions, send, onDone }: { questions: Question[]; send: Send; onDone: () => void }) {
  const [queue, setQueue] = useState<Question[]>(questions);
  const [picked, setPicked] = useState<number | null>(null);
  const q = queue[0];
  if (!q) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="text-3xl font-bold">모두 맞혔어요!</div>
        <Button kind="dark" className="w-full" onClick={onDone}>오답 노트로</Button>
      </div>
    );
  }
  const answered = picked !== null;
  const correct = picked === q.answerIndex;
  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-8">
      <div className="flex items-center justify-between text-sm font-bold text-ink-3"><span>다시 풀기</span><span className="tabular">남은 {queue.length}</span></div>
      <div className="rounded-3xl bg-bg px-4 py-6 text-center">
        <div className="text-xs font-bold text-ink-3">{q.modeLabel}</div>
        <div className="mt-1 text-3xl font-extrabold">{q.prompt}</div>
      </div>
      <div className="flex flex-col gap-2">
        {q.options.map((o, i) => (
          <button
            key={i}
            type="button"
            disabled={answered}
            onClick={() => {
              setPicked(i);
              send({ type: 'practice', questionId: q.id, choice: i }).catch(() => undefined);
            }}
            className={`flex h-14 items-center gap-3 rounded-2xl px-4 text-left text-base font-semibold ${
              answered && i === q.answerIndex ? 'bg-good-soft ring-2 ring-good' : answered && i === picked ? 'bg-bad-soft ring-2 ring-[#E5484D]' : 'bg-bg'
            }`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-extrabold">{i + 1}</span>
            {o.label}
          </button>
        ))}
      </div>
      {answered && !correct && q.options[picked!]?.feedback && <div className="text-ink-2">{q.options[picked!].feedback}</div>}
      <div className="flex-1" />
      {answered && (
        <Button
          kind="dark"
          onClick={() => {
            const [first, ...rest] = queue;
            // A missed word comes back after two others.
            setQueue(correct ? rest : [...rest.slice(0, 2), first, ...rest.slice(2)]);
            setPicked(null);
          }}
        >
          다음
        </Button>
      )}
    </div>
  );
}

// ---------- locker ----------

function Locker({ me, send, onClose }: { me: NonNullable<StudentView['me']>; send: Send; onClose: () => void }) {
  const look = normalizeLook(me.look ?? undefined);
  const owned = useMemo(() => new Set(me.inventory), [me.inventory]);
  const [slot, setSlot] = useState<AvatarSlot>('helmet');
  const [theme, setTheme] = useState<ItemTheme | null>(null);
  const [editing, setEditing] = useState(false);
  const items = ITEMS.filter((i) => i.slot === slot && (!theme || i.theme === theme));
  const ownedCount = ITEMS.filter((i) => owned.has(i.id)).length;
  if (editing) return <CharacterPick send={send} name={me.name} current={look} onClose={() => setEditing(false)} />;
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <div className="flex flex-col gap-4 rounded-b-[32px] bg-ink px-5 pb-5 pt-10 text-white">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">
            보관함 <span className="tabular text-base font-semibold text-[#A3A8B4]">{ownedCount}/{ITEMS.length}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded-full bg-[#24272F] px-4 py-1.5 text-sm font-bold">머리·눈 바꾸기</button>
            <button type="button" onClick={onClose} className="rounded-full bg-[#24272F] px-4 py-1.5 text-sm font-bold">닫기</button>
          </div>
        </div>
        <div className="mx-auto flex h-48 w-40 items-end justify-center rounded-t-full rounded-b-2xl bg-[#24272F] pb-4"><IdleAvatar look={look} size={128} seed="me" /></div>
      </div>
      {/* Which part to change, then optionally narrow to one theme. */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pt-4">
        {SLOTS.map((sl) => (
          <button key={sl.id} type="button" aria-pressed={slot === sl.id} onClick={() => setSlot(sl.id)} className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold ${slot === sl.id ? 'bg-ink text-white' : 'bg-white text-ink-2'}`}>
            {sl.name}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-4 pt-2">
        {[{ id: null, name: '모든 테마' } as { id: ItemTheme | null; name: string }, ...THEMES].map((th) => (
          <button key={th.id ?? 'all'} type="button" aria-pressed={theme === th.id} onClick={() => setTheme(th.id)} className={`h-8 shrink-0 rounded-full px-3 text-xs font-bold ${theme === th.id ? 'bg-accent text-ink' : 'bg-white text-ink-3'}`}>
            {th.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 overflow-y-auto px-4 py-4">
        <button type="button" onClick={() => send({ type: 'look', look: { [slot]: DEFAULT_LOOK[slot] } })} className={`flex h-28 items-center justify-center rounded-2xl text-sm font-bold ${look[slot] === DEFAULT_LOOK[slot] ? 'bg-white ring-2 ring-accent' : 'bg-white'}`}>
          {slot === 'tunic' ? '기본 옷' : '없음'}
        </button>
        {items.map((item) => {
          const has = owned.has(item.id);
          const on = look[slot] === item.value;
          const stampsNeeded = attendanceStamps(item.id);
          return (
            <button
              key={item.id}
              type="button"
              disabled={!has}
              onClick={() => send({ type: 'look', look: { [slot]: item.value } })}
              className={`flex h-28 flex-col items-center justify-center gap-0.5 rounded-2xl ${on ? 'bg-white ring-2 ring-accent' : has ? 'bg-white' : 'border-2 border-dashed border-[#D5D8DF] bg-[#ECEEF1]'}`}
            >
              {/* Items the student has stir now and then; locked ones stand still. */}
              <div className={has ? '' : 'opacity-30'}>{has ? <IdleAvatar look={previewLook(item, look)} size={52} seed={item.id} /> : <PixelAvatar look={previewLook(item, look)} size={52} />}</div>
              <span className="text-xs font-bold">{item.name}</span>
              {!has && <span className="text-[10px] font-semibold text-ink-3">{stampsNeeded ? `출석 ${stampsNeeded}회` : '퀴즈 보상'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

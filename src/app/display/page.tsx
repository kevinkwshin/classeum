'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatClock, remainingMs, shortcutAction, useLive, useTicker } from '@/client/live';
import type { DisplayView, SessionPublic } from '@/client/views';
import { CountUp } from '@/components/CountUp';
import { Field } from '@/components/Field';
import { PixelAvatar } from '@/components/PixelAvatar';
import { TeacherGate } from '@/components/TeacherGate';
import { DEFAULT_LOOK } from '@/lib/avatar';
import { itemById, previewLook } from '@/lib/items';

export default function DisplayPage() {
  return (
    <TeacherGate>
      <DisplayApp />
    </TeacherGate>
  );
}

function DisplayApp() {
  const { view, conn, send, serverNow } = useLive<DisplayView>('display');
  const s = view?.session ?? null;
  useTicker(!!s && (s.phase === 'moving' || s.phase === 'intro'), 200);

  // After clicking the projector window to make it full screen, keys land here; forward them.
  const paused = !!s?.paused;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const action = shortcutAction(e.code, paused);
      if (action) {
        e.preventDefault();
        send({ type: 'control', action }).catch(() => undefined);
      }
      if (e.code === 'KeyF') document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paused, send]);

  if (!view) return <Shell><Center>연결 중…</Center></Shell>;
  if (view.blank) return <Shell><Center><span className="font-display text-7xl font-bold">Classeum</span></Center></Shell>;
  if (!s) return <Shell><Idle view={view} /></Shell>;

  return (
    <Shell>
      {conn === 'lost' && <div className="absolute right-6 top-4 z-50 rounded-full bg-bad px-4 py-1 text-sm font-bold text-white">연결 끊김 · 다시 연결 중</div>}
      {s.paused && <div className="absolute inset-x-0 top-0 z-40 bg-ink py-3 text-center text-2xl font-bold text-white">잠깐! 선생님을 봐 주세요</div>}
      {s.phase === 'lobby' && <Lobby view={view} s={s} />}
      {(s.phase === 'intro' || s.phase === 'moving' || s.phase === 'reveal') && s.question && <Play view={view} s={s} now={serverNow()} />}
      {s.phase === 'checkpoint' && <Checkpoint s={s} />}
      {s.phase === 'summary' && <Summary s={s} parade={view.parade ?? []} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-bg p-[2.2vw] text-ink">{children}</main>;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-3xl font-bold text-ink-3">{children}</div>;
}

function Idle({ view }: { view: DisplayView }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-16">
      <div className="rounded-[32px] bg-white p-10" dangerouslySetInnerHTML={{ __html: view.qr }} style={{ width: '28vw' }} />
      <div className="flex flex-col gap-4">
        <div className="font-display text-6xl font-bold">Classeum</div>
        <div className="text-3xl font-semibold text-ink-2">QR을 찍고 이름을 등록해 두세요</div>
        <div className="tabular text-2xl text-ink-3">{view.joinUrl}</div>
      </div>
    </div>
  );
}

function RewardCard({ s }: { s: SessionPublic }) {
  if (!s.reward) return null;
  const item = itemById(s.reward.itemId);
  return (
    // Spacing is capped by the screen height too, so the card leaves room for the class at 1280×720.
    <div className="flex items-center gap-[min(2.5rem,3.7vh)] rounded-[32px] bg-ink p-[min(2.5rem,3.7vh)] text-white">
      <div className="flex h-[min(16vw,28.4vh)] w-[min(14vw,24.9vh)] shrink-0 items-end justify-center rounded-t-full rounded-b-3xl bg-gold pb-6">
        {item && (
          <div className="cls-float">
            <PixelAvatar look={previewLook(item, DEFAULT_LOOK)} size={168} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-5">
        <div className="text-2xl font-bold text-gold">오늘의 보상</div>
        <div className="text-6xl font-bold tracking-tight">{s.reward.itemName}</div>
        <div className="flex flex-wrap gap-3 text-2xl font-semibold">
          <span className="rounded-2xl bg-[#24272F] px-5 py-3">도전 <b className="text-gold">정답 {s.reward.challengePct}%+</b></span>
          <span className="rounded-2xl bg-[#24272F] px-5 py-3">성장 <b className="text-gold">내 평균 +{s.reward.growthPp}%p</b></span>
        </div>
      </div>
    </div>
  );
}

/** Largest lobby avatar (up to 52px, 8px gaps) that fits everyone in the w×h area. */
function lobbyAvatarSize(count: number, w: number, h: number) {
  if (!count || !w || !h) return 52;
  for (let size = 52; size > 20; size -= 2) {
    const perRow = Math.max(1, Math.floor((w + 8) / (size + 8)));
    if (Math.ceil(count / perRow) * (size + 8) - 8 <= h) return size;
  }
  return 20;
}

function Lobby({ view, s }: { view: DisplayView; s: SessionPublic }) {
  const avatars = view.lobby?.avatars ?? [];
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = lobbyAvatarSize(avatars.length, box.w, box.h);
  return (
    // min-h-0: a lobby opened with the class already connected must not stretch past the screen before it is measured.
    <div className="flex min-h-0 flex-1 gap-[3vw]">
      <div className="flex w-[34vw] shrink-0 flex-col items-center justify-center gap-6">
        <div className="flex aspect-[0.92] w-full items-end justify-center rounded-t-full rounded-b-[32px] bg-white pb-[3vw]">
          <div className="w-[62%]" dangerouslySetInnerHTML={{ __html: view.qr }} />
        </div>
        <div className="tabular text-2xl font-semibold text-ink-3">{view.joinUrl}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-3xl font-bold">Classeum</div>
            <div className="mt-4 text-3xl font-bold text-accent">{s.className}</div>
            <div className="mt-1 text-6xl font-bold tracking-tight">{s.eventName}</div>
            <div className="mt-2 text-3xl font-medium text-ink-3">{s.mainCount}문항</div>
          </div>
          <div key={avatars.length} className="cls-pop tabular text-[9vw] font-extrabold leading-none tracking-tighter">{avatars.length}</div>
        </div>
        {/* Takes whatever height the header and card leave; avatars shrink to fit, and the top padding (over the gap) gives hops room. */}
        <div ref={area} className="-mt-6 flex min-h-0 flex-1 flex-col justify-center overflow-y-clip pt-6">
          <div className="flex min-h-[min(18vh,100%)] flex-wrap content-start gap-2">
            {avatars.map((a, i) => (
              <div key={a.studentId} className="cls-drop-in">
                <div className="cls-float" style={{ animationDelay: `-${(i * 0.37) % 2.4}s` }}>
                  {/* Now and then someone hops or spins while the class waits. */}
                  <div className="cls-antic origin-bottom" style={{ animationDuration: `${7 + (i % 6)}s`, animationDelay: `-${(i * 2.3) % 9}s` }}>
                    <PixelAvatar look={a.look} size={size} blink={i} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <RewardCard s={s} />
      </div>
    </div>
  );
}

function Play({ view, s, now }: { view: DisplayView; s: SessionPublic; now: number }) {
  const q = s.question!;
  const ms = remainingMs(s.phaseEndsAt, s.paused, s.pausedRemaining, now);
  const reveal = s.phase === 'reveal' ? view.reveal : null;
  const total = s.round === 'retry' ? s.total : s.mainCount;
  const isText = q.kind === 'text';
  const countdown = s.phase === 'intro' && s.index === 0;
  const urgent = s.phase === 'moving' && !s.paused && ms <= 3000;
  return (
    <div className="relative flex flex-1 flex-col gap-[1.6vw]">
      {countdown && <StartCountdown ms={ms} />}
      {/* The side cells keep their width; a long prompt wraps instead. */}
      <div className="grid grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-6">
        <div className="flex items-center gap-4 whitespace-nowrap">
          <div className="tabular text-3xl font-extrabold">{s.index + 1}<span className="text-[#A3A8B4]"> / {total}</span></div>
          <div className="rounded-full bg-white px-4 py-2 text-xl font-bold text-ink-2">{s.round === 'retry' ? '다시 도전' : q.modeLabel}</div>
        </div>
        <div className="flex items-baseline gap-6">
          <div
            key={q.seq}
            className={`max-w-[56vw] text-center font-extrabold leading-tight tracking-tight ${countdown ? 'invisible' : 'cls-drop-in'} ${q.prompt.length > 24 ? 'text-[3.2vw]' : 'text-[4.6vw]'}`}
          >
            {q.prompt}
          </div>
          {reveal && q.mode !== 'CUSTOM_TEXT' && q.mode !== 'CUSTOM_OX' && <div className="cls-slide-up text-[3vw] font-bold text-good">{reveal.correctLabel}</div>}
        </div>
        <div className="flex justify-end whitespace-nowrap">
          {reveal ? (
            <div className="cls-pop tabular rounded-full bg-good px-7 py-3 text-3xl font-extrabold text-white">
              정답 <CountUp value={Math.round(reveal.accuracy * 100)} delay={300} suffix="%" />
            </div>
          ) : (
            <div className={`flex items-center gap-4 rounded-full py-2 pl-2 pr-7 text-white transition-colors ${urgent ? 'cls-urgent bg-accent' : 'bg-ink'}`}>
              <div
                className="h-14 w-14 rounded-full"
                style={{ background: `conic-gradient(${urgent ? '#FFFFFF' : '#FF5B24'} 0 ${s.phase === 'intro' ? 100 : (ms / (q.seconds * 1000)) * 100}%, ${urgent ? '#FF9A73' : '#3D4354'} 0 100%)` }}
              >
                <div className={`m-2 h-10 w-10 rounded-full ${urgent ? 'bg-accent' : 'bg-ink'}`} />
              </div>
              <div className="tabular text-5xl font-extrabold">{s.phase === 'intro' ? formatClock(q.seconds * 1000) : formatClock(ms)}</div>
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {isText ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 rounded-[36px] bg-white">
            {reveal ? (
              <>
                <div className="cls-pop text-[5vw] font-extrabold text-good">{reveal.correctLabel}</div>
                {reveal.textWrong && reveal.textWrong.length > 0 && <div className="text-3xl text-ink-3">자주 나온 답: {reveal.textWrong.join(', ')}</div>}
              </>
            ) : (
              <>
                <div className="text-4xl font-bold text-ink-2">폰에 답을 써 주세요</div>
                <div className="tabular text-6xl font-extrabold">✓ {view.settled ?? 0} / {view.participants ?? 0}</div>
              </>
            )}
          </div>
        ) : (
          <Field
            options={q.options}
            fog={!reveal}
            reveal={reveal}
            avatars={reveal?.avatars}
            nameLabels={view.nameLabels}
            seed={`${s.id}:${q.seq}`}
            center={
              !reveal ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-4 rounded-full bg-ink px-8 py-4 text-white">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3DDC97] text-2xl font-extrabold text-ink">✓</div>
                    <div className="tabular text-5xl font-extrabold">{view.settled ?? 0}<span className="text-ink-3"> / {view.participants ?? 0}</span></div>
                  </div>
                  <div className="text-2xl font-semibold text-ink-2">안개 속에서 자리 잡는 중</div>
                </div>
              ) : null
            }
            footer={
              reveal?.topWrong ? (
                <div className="cls-slide-up max-w-[40vw] rounded-3xl bg-ink px-7 py-3 text-center text-white" style={{ animationDelay: '1.2s' }}>
                  <div className="text-base font-semibold text-[#A3A8B4]">많이 고른 오답</div>
                  <div className="text-2xl font-bold">{reveal.topWrong.feedback ?? reveal.topWrong.label}</div>
                </div>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}

function StartCountdown({ ms }: { ms: number }) {
  const n = Math.min(3, Math.ceil(ms / 1000));
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[36px] bg-bg/80 backdrop-blur-sm">
      {n > 0 && (
        <div key={n} className="cls-count font-display text-[22vw] font-bold leading-none text-accent">
          {n}
        </div>
      )}
    </div>
  );
}

function Checkpoint({ s }: { s: SessionPublic }) {
  const c = s.checkpoint;
  if (!c) return null;
  if (c.kind === 'retry') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="cls-slide-up text-4xl font-bold text-accent">다시 도전</div>
        <div className="cls-pop text-[6vw] font-extrabold tracking-tight" style={{ animationDelay: '0.2s' }}>많이 틀린 단어 {c.total}개</div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="tabular text-4xl font-bold text-ink-3">{c.done} / {c.total}</div>
      <div className="cls-pop text-[5vw] font-extrabold tracking-tight">잠깐 쉬어요</div>
      <div className="h-5 w-[44vw] overflow-hidden rounded-full bg-white">
        <div className="cls-grow h-full rounded-full bg-accent" style={{ width: `${(c.done / Math.max(1, c.total)) * 100}%` }} />
      </div>
      <div className="tabular text-5xl font-bold">
        지금까지 정답률 <span className="text-good"><CountUp value={Math.round(c.accuracy * 100)} delay={300} suffix="%" /></span>
      </div>
    </div>
  );
}

function Summary({ s, parade }: { s: SessionPublic; parade: NonNullable<DisplayView['parade']> }) {
  const sum = s.summary;
  const size = parade.length > 30 ? 44 : 56;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10">
      <div className="cls-slide-up text-4xl font-bold text-ink-3">{s.className} · {s.eventName} 끝!</div>
      <div className="flex gap-8">
        <div className="cls-pop rounded-[32px] bg-ink px-14 py-10 text-white">
          <div className="text-2xl font-semibold text-[#A3A8B4]">반 정답률</div>
          <div className="tabular text-[8vw] font-extrabold leading-none text-[#3DDC97]">
            <CountUp value={Math.round((sum?.accuracy ?? 0) * 100)} ms={1200} delay={300} suffix="%" />
          </div>
        </div>
        <div className="cls-pop rounded-[32px] bg-white px-14 py-10" style={{ animationDelay: '0.15s' }}>
          <div className="text-2xl font-semibold text-ink-3">오늘의 보상 받은 친구</div>
          <div className="tabular text-[8vw] font-extrabold leading-none">
            <CountUp value={sum?.rewarded ?? 0} ms={1200} delay={450} />
          </div>
        </div>
      </div>
      {parade.length > 0 && (
        <div className="flex max-w-[88vw] flex-wrap items-end justify-center gap-x-2 gap-y-3">
          {parade.map((a, i) => (
            <div key={a.studentId} className="cls-drop-in" style={{ animationDelay: `${900 + i * 45}ms` }}>
              <div className="cls-jump relative" style={{ animationDelay: `${2200 + (i % 10) * 80}ms` }}>
                {a.rewarded && <div className="absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-gold" />}
                <PixelAvatar look={a.look} size={size} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="text-3xl font-semibold text-ink-2">각자 폰에서 결과와 오답 노트를 확인하세요</div>
    </div>
  );
}

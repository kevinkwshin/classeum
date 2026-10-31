'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatClock, remainingMs, shortcutAction, useLive, useTicker } from '@/client/live';
import { agoraMusicLevel, musicLevel, useAudioUnlock, useBackgroundMusic, useCountdownTick, useProjectorAudioBeacon, useRevealSound, useSoundPreview } from '@/client/revealSound';
import { AGORA_MUSIC_SRC, MUSIC_SRC } from '@/client/sound';
import type { AgoraCard, DisplayAgora, DisplayView, SessionPublic } from '@/client/views';
import { CountUp } from '@/components/CountUp';
import { Field } from '@/components/Field';
import { GrammarCard, zoneLabels } from '@/components/GrammarCard';
import { FullscreenHint } from '@/components/FullscreenHint';
import { HowTo } from '@/components/HowTo';
import { PixelAvatar } from '@/components/PixelAvatar';
import { TeacherGate } from '@/components/TeacherGate';
import { DEFAULT_LOOK } from '@/lib/avatar';
import { itemById, previewLook } from '@/lib/items';
import type { AvatarLook } from '@/lib/types';

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
  // The arena's clock while a question runs, and the 아고라's 입력 시간 while a topic is open with a limit.
  useTicker((!!s && (s.phase === 'moving' || s.phase === 'intro')) || !!view?.agora?.timer, 200);

  // Browsers allow sound only after a click or key press in this window; the first one turns it on. Until then
  // the teacher screen plays the sounds (src/client/revealSound.ts).
  const [audioOn, setAudioOn] = useState(false);
  useAudioUnlock(setAudioOn);
  const soundOn = view?.sound !== false;
  const musicOn = view?.music !== false;
  useProjectorAudioBeacon(audioOn);
  const reveal = s?.phase === 'reveal' ? view?.reveal ?? null : null;
  useRevealSound(s?.question?.seq ?? -1, reveal, soundOn && audioOn);
  useCountdownTick(s?.phase === 'moving' ? s.phaseEndsAt : null, serverNow, soundOn && audioOn);
  useSoundPreview(soundOn && audioOn);
  // An 아고라 topic is never up while a session is open; while one is, its own song plays instead.
  const agora = s ? null : (view?.agora ?? null);
  useBackgroundMusic(
    agora ? (agora.music && audioOn ? agoraMusicLevel(agora.phase, agora.reveal) : 0) : musicOn && audioOn ? musicLevel(s?.phase, view?.blank, s?.paused) : 0,
    agora ? AGORA_MUSIC_SRC : MUSIC_SRC,
  );

  // After clicking the projector window to make it full screen, keys land here; forward them.
  const paused = !!s?.paused;
  const agoraUp = !!agora;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift+S (다음 유형) asks for confirmation on the teacher screen, so it isn't taken here.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || (e.shiftKey && e.code === 'KeyS')) return;
      // With an 아고라 topic up, ←/→ turn the pages of answer cards.
      if (agoraUp && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault();
        send({ type: 'agora-page', dir: e.code === 'ArrowRight' ? 1 : -1 }).catch(() => undefined);
        return;
      }
      const action = shortcutAction(e.code, paused);
      if (action) {
        e.preventDefault();
        send({ type: 'control', action }).catch(() => undefined);
      }
      if (e.code === 'KeyF') document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paused, send, agoraUp]);

  if (!view) return <Shell><Center>연결 중…</Center></Shell>;
  if (view.blank) return <Shell><Center><span className="font-display text-7xl font-bold">Classeum</span></Center></Shell>;
  if (agora) {
    return (
      <Shell>
        {conn === 'lost' && <div className="absolute right-6 top-4 z-50 rounded-full bg-bad px-4 py-1 text-sm font-bold text-white">연결 끊김 · 다시 연결 중</div>}
        {agora.music && !audioOn && <div className="absolute bottom-3 right-4 z-50 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink-3">🔇 소리를 켜려면 이 화면을 한 번 클릭하세요</div>}
        {agora.phase === 'lobby' ? <AgoraLobby view={view} agora={agora} /> : <AgoraBoard agora={agora} joinUrl={view.joinUrl} now={serverNow()} send={send} />}
        <FullscreenHint />
      </Shell>
    );
  }
  if (!s) return <Shell><Idle view={view} /><FullscreenHint /></Shell>;

  return (
    <Shell>
      {conn === 'lost' && <div className="absolute right-6 top-4 z-50 rounded-full bg-bad px-4 py-1 text-sm font-bold text-white">연결 끊김 · 다시 연결 중</div>}
      {(soundOn || musicOn) && !audioOn && <div className="absolute bottom-3 right-4 z-50 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink-3">🔇 소리를 켜려면 이 화면을 한 번 클릭하세요</div>}
      {s.paused && <div className="absolute inset-x-0 top-0 z-40 bg-ink py-3 text-center text-2xl font-bold text-white">잠깐! 선생님을 봐 주세요</div>}
      {s.phase === 'lobby' && <Lobby view={view} s={s} serverNow={serverNow} />}
      {s.phase === 'lobby' && <FullscreenHint />}
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
        <div className="text-xl text-ink-3">같은 와이파이에서 접속</div>
      </div>
    </div>
  );
}

/**
 * 아고라 on the projector, in the arena's frame: the class and how many have answered on top, the topic in a white box,
 * and every student in the room as a card in the teacher's columns. A card carries an answer only once it shows;
 * before that the server sends no text, so the card just says whether one came.
 */
function AgoraBoard({ agora, joinUrl, now, send }: { agora: DisplayAgora; joinUrl: string; now: number; send: (a: Record<string, unknown>) => Promise<unknown> }) {
  const t = agora.topic;
  const sent = agora.cards.filter((c) => c.sent).length;
  const grid = { gridTemplateColumns: `repeat(${t.columns}, minmax(0, 1fr))` };
  // Pages that fit the screen: every card is laid out once, unseen, at the real width, and its rows (each as tall as
  // its tallest card) go onto a page for as long as they fit the space under the topic.
  const area = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>([]);
  const layout = agora.cards.map((c) => `${c.number}/${c.sent ? 1 : 0}/${c.text ?? ''}`).join('|');
  useLayoutEffect(() => {
    const measure = () => {
      const box = area.current;
      if (!box || !ruler.current) return;
      const cards = [...ruler.current.children] as HTMLElement[];
      const next: number[][] = [];
      let page: number[] = [];
      let top = 0;
      for (let i = 0; i < cards.length; i += t.columns) {
        const row = cards.slice(i, i + t.columns);
        const bottom = Math.max(...row.map((el) => el.offsetTop + el.offsetHeight));
        if (page.length && bottom - top > box.clientHeight) {
          next.push(page);
          page = [];
        }
        if (!page.length) top = row[0].offsetTop;
        row.forEach((_, k) => page.push(i + k));
      }
      if (page.length || !next.length) next.push(page);
      setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    // Again when the window changes size (full screen) or the cards do (fonts arriving).
    const ro = new ResizeObserver(measure);
    if (area.current) ro.observe(area.current);
    if (ruler.current) ro.observe(ruler.current);
    return () => ro.disconnect();
  }, [layout, t.columns]);
  const count = Math.max(1, pages.length);
  // The server keeps the page the teacher turns to, so it needs to know how many there are.
  useEffect(() => {
    send({ type: 'agora-pages', count }).catch(() => undefined);
  }, [count, t.id, send]);
  const page = Math.min(agora.page, count - 1);
  const shown = (pages[page] ?? agora.cards.map((_, i) => i)).map((i) => agora.cards[i]).filter(Boolean);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.4vw]">
      <div className="flex items-center gap-4">
        <div className="text-3xl font-bold text-accent">{agora.className}</div>
        <div className="rounded-full bg-white px-4 py-2 text-xl font-bold text-ink-2">아고라</div>
        {agora.phase === 'closed' && <div className="rounded-full bg-ink px-4 py-2 text-xl font-bold text-white">마감</div>}
        <div className="ml-auto flex items-center gap-3">
          {agora.timer && <AgoraClock timer={agora.timer} now={now} />}
          <div className="flex items-center gap-4 rounded-full bg-ink py-2 pl-2 pr-7 text-white">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3DDC97] text-2xl font-extrabold text-ink">✓</div>
            <div className="tabular text-4xl font-extrabold">
              {sent}
              <span className="text-ink-3"> / {agora.cards.length}</span>
            </div>
          </div>
        </div>
      </div>
      <div key={t.id} className="cls-drop-in rounded-[2vw] bg-white px-[3vw] py-[1.8vw] text-center">
        <div className={`whitespace-pre-wrap break-keep font-extrabold leading-tight tracking-tight [overflow-wrap:anywhere] ${t.text.length > 40 ? 'text-[2.6vw]' : 'text-[3.4vw]'}`}>{t.text}</div>
        {/* Often an example sentence, so it is read from the back of the room too. */}
        {t.note && <div className="mt-[0.6vw] whitespace-pre-wrap text-[1.9vw] font-semibold text-ink-2 [overflow-wrap:anywhere]">{t.note}</div>}
      </div>
      <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={ruler} aria-hidden className="invisible absolute inset-x-0 top-0 grid content-start gap-[1vw]" style={grid}>
          {agora.cards.map((c) => (
            <AgoraCardView key={c.number} c={c} open={agora.phase === 'writing'} />
          ))}
        </div>
        {/* A card taller than the whole space (a long answer in four columns) can still be scrolled to. */}
        <div className="grid h-full content-start gap-[1vw] overflow-y-auto" style={grid}>
          {/* The teacher can click an answer here too, to show or hide just that one. */}
          {shown.map((c) => (
            <AgoraCardView key={c.number} c={c} open={agora.phase === 'writing'} onFlip={c.sent ? () => send({ type: 'agora-card', number: c.number }).catch(() => undefined) : undefined} />
          ))}
          {agora.cards.length === 0 && <div className="col-span-full py-[4vw] text-center text-[2vw] font-semibold text-ink-3">태블릿에 주제가 떴어요 · 들어온 학생이 여기에 나와요</div>}
        </div>
      </div>
      <div className="flex items-center justify-between text-lg text-ink-3">
        <span className="tabular">{joinUrl}</span>
        {count > 1 && (
          <span className="tabular rounded-full bg-white px-4 py-1 font-bold text-ink-2">
            {page + 1} / {count}
          </span>
        )}
      </div>
    </div>
  );
}

/** A student's card: character, number and name, then the answer once it shows, or else whether one came. */
function AgoraCardView({ c, open, onFlip }: { c: AgoraCard; open: boolean; onFlip?: () => void }) {
  return (
    <div
      onClick={onFlip}
      title={onFlip ? (c.text === undefined ? '눌러서 이 답 공개' : '눌러서 이 답 숨기기') : undefined}
      className={`flex min-w-0 flex-col gap-[0.6vw] rounded-[1.4vw] bg-white px-[1.2vw] py-[0.9vw] ${onFlip ? 'cursor-pointer' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-[0.8vw]">
        {/* Sized by the screen, like the rest of the projector. */}
        <div className="h-[3.4vw] w-[3.4vw] shrink-0 [&>svg]:h-full [&>svg]:w-full">
          <PixelAvatar look={c.look} size={64} mood={c.sent ? 'happy' : 'normal'} blink={c.number} />
        </div>
        <span className="tabular text-[1.3vw] font-bold text-ink-3">{c.number}</span>
        <span className="truncate text-[1.6vw] font-extrabold">{c.name}</span>
        {c.text === undefined && (
          <span className={`ml-auto shrink-0 rounded-full px-[0.9vw] py-[0.3vw] text-[1.2vw] font-extrabold ${c.sent ? 'bg-good-soft text-good' : 'bg-bg text-ink-3'}`}>
            {c.sent ? '✓ 냈어요' : open ? '생각 중…' : '미답변'}
          </span>
        )}
      </div>
      {/* A long answer in a smaller size, so one card doesn't take a whole page. */}
      {c.text !== undefined && <div className={`whitespace-pre-wrap font-bold leading-snug [overflow-wrap:anywhere] ${c.text.length > 120 ? 'text-[1.45vw]' : 'text-[1.8vw]'}`}>{c.text}</div>}
    </div>
  );
}

/** The 입력 시간 left, in the arena's clock pill; it turns orange for the last minute. */
function AgoraClock({ timer, now }: { timer: NonNullable<DisplayAgora['timer']>; now: number }) {
  const ms = Math.max(0, timer.endsAt - now);
  const urgent = ms <= 60_000;
  return (
    <div className={`flex items-center gap-4 rounded-full py-2 pl-2 pr-7 text-white transition-colors ${urgent ? 'bg-accent' : 'bg-ink'}`}>
      <div className="h-12 w-12 rounded-full" style={{ background: `conic-gradient(${urgent ? '#FFFFFF' : '#FF5B24'} 0 ${(ms / (timer.endsAt - timer.startedAt)) * 100}%, ${urgent ? '#FF9A73' : '#3D4354'} 0 100%)` }}>
        <div className={`m-2 h-8 w-8 rounded-full ${urgent ? 'bg-accent' : 'bg-ink'}`} />
      </div>
      <div className="tabular text-4xl font-extrabold">{formatClock(ms)}</div>
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

// With name tags each lobby slot is at least this wide (a three-syllable name) and this much taller.
const LOBBY_NAME_W = 52;
const LOBBY_NAME_H = 16;

/**
 * Largest lobby avatar (up to 52px, 8px gaps) that fits everyone in the w×h area, with names under them when
 * asked and there is room; a class too big for names on this screen shows the characters alone instead.
 */
function lobbyLayout(count: number, w: number, h: number, wantNames: boolean): { size: number; names: boolean } {
  if (!count || !w || !h) return { size: 52, names: wantNames };
  const fits = (size: number, names: boolean) => {
    const perRow = Math.max(1, Math.floor((w + 8) / (Math.max(size, names ? LOBBY_NAME_W : 0) + 8)));
    return Math.ceil(count / perRow) * (size + (names ? LOBBY_NAME_H : 0) + 8) - 8 <= h;
  };
  if (wantNames) for (let size = 52; size >= 20; size -= 2) if (fits(size, true)) return { size, names: true };
  for (let size = 52; size > 20; size -= 2) if (fits(size, false)) return { size, names: false };
  return { size: 20, names: false };
}

function Lobby({ view, s, serverNow }: { view: DisplayView; s: SessionPublic; serverNow: () => number }) {
  const avatars = view.lobby?.avatars ?? [];
  // While the teacher's 놀이 방법 plays, the demo takes the characters' and the reward card's place.
  const howtoAt = view.howto && view.howtoAt ? view.howtoAt : null;
  return (
    // min-h-0: a lobby opened with the class already connected must not stretch past the screen before it is measured.
    <div className="flex min-h-0 flex-1 gap-[3vw]">
      <LobbyQr view={view} />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
        <LobbyHeader className={s.className} title={s.eventName} sub={`${s.mainCount}문항`} count={avatars.length} />
        {howtoAt !== null && <HowTo key={howtoAt} startedAt={howtoAt} serverNow={serverNow} sound={view.sound !== false} />}
        {/* The teacher's 이름표 switch decides whether names show here too. */}
        <LobbyCrowd avatars={avatars.map((a) => ({ key: a.studentId, name: a.name, look: a.look }))} wantNames={view.nameLabels !== false} hidden={howtoAt !== null} />
        {howtoAt === null && <RewardCard s={s} />}
      </div>
    </div>
  );
}

/**
 * The 아고라's 대기실, in the arena lobby's frame: the QR, the class and who has come in, and the topic in the card where
 * the arena shows today's reward. Names always show, as they do on the answer cards that follow.
 */
function AgoraLobby({ view, agora }: { view: DisplayView; agora: DisplayAgora }) {
  const t = agora.topic;
  return (
    <div className="flex min-h-0 flex-1 gap-[3vw]">
      <LobbyQr view={view} />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
        <LobbyHeader className={agora.className} title="아고라" sub={t.minutes ? `입력 시간 ${t.minutes}분` : '시간 제한 없음'} count={agora.joined.length} />
        <LobbyCrowd avatars={agora.joined.map((a) => ({ key: String(a.number), name: a.name, look: a.look }))} wantNames />
        {/* Spacing is capped by the screen height too, as on the reward card, so the class keeps its room at 1280×720. */}
        <div className="flex flex-col gap-[min(1.25rem,1.9vh)] rounded-[32px] bg-ink p-[min(2.5rem,3.7vh)] text-white">
          <div className="text-2xl font-bold text-gold">오늘의 주제</div>
          <div className={`line-clamp-3 whitespace-pre-wrap break-keep font-bold leading-snug tracking-tight [overflow-wrap:anywhere] ${[...t.text].length > 60 ? 'text-[2vw]' : 'text-[2.7vw]'}`}>{t.text}</div>
          {t.note && <div className="line-clamp-2 self-start whitespace-pre-wrap rounded-2xl bg-[#24272F] px-5 py-3 text-2xl font-semibold text-[#D5D8DF] [overflow-wrap:anywhere]">{t.note}</div>}
        </div>
      </div>
    </div>
  );
}

/** The lobby's QR in its arch, with the address under it. */
function LobbyQr({ view }: { view: DisplayView }) {
  return (
    <div className="flex w-[34vw] shrink-0 flex-col items-center justify-center gap-6">
      <div className="flex aspect-[0.92] w-full items-end justify-center rounded-t-full rounded-b-[32px] bg-white pb-[3vw]">
        <div className="w-[62%]" dangerouslySetInnerHTML={{ __html: view.qr }} />
      </div>
      <div className="tabular text-2xl font-semibold text-ink-3">{view.joinUrl}</div>
    </div>
  );
}

/** The lobby's header: the class, what is about to start, and how many have come in. */
function LobbyHeader({ className, title, sub, count }: { className: string; title: string; sub: string; count: number }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        {/* A shorter header on 720p projectors leaves the room to the characters and their names. */}
        <div className="font-display text-3xl font-bold [@media(max-height:800px)]:text-2xl">Classeum</div>
        <div className="mt-4 text-3xl font-bold text-accent [@media(max-height:800px)]:mt-2 [@media(max-height:800px)]:text-2xl">{className}</div>
        <div className="mt-1 text-6xl font-bold tracking-tight [@media(max-height:800px)]:text-5xl">{title}</div>
        <div className="mt-2 text-3xl font-semibold text-ink-3 [@media(max-height:800px)]:mt-1 [@media(max-height:800px)]:text-2xl">{sub}</div>
      </div>
      <div key={count} className="cls-pop tabular text-[9vw] font-extrabold leading-none tracking-tighter">{count}</div>
    </div>
  );
}

/** The characters who have come in, as large as fits the height the header and card leave. */
function LobbyCrowd({ avatars, wantNames, hidden = false }: { avatars: { key: string; name: string; look: AvatarLook }[]; wantNames: boolean; hidden?: boolean }) {
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
  const { size, names } = lobbyLayout(avatars.length, box.w, box.h, wantNames);
  return (
    // Takes whatever height the header and card leave; avatars shrink to fit, and the top padding (over the gap) gives hops room.
    // Hidden, not unmounted, during the arena's demo, so its size keeps being measured.
    <div ref={area} className={`-mt-6 flex min-h-0 flex-1 flex-col justify-center overflow-y-clip pt-6 ${hidden ? 'hidden' : ''}`}>
      <div className="flex min-h-[min(18vh,100%)] flex-wrap content-start gap-2">
        {avatars.map((a, i) => (
          <div key={a.key} className="cls-drop-in flex flex-col items-center" style={{ width: names ? Math.max(size, LOBBY_NAME_W) : undefined }}>
            <div className="cls-float" style={{ animationDelay: `-${(i * 0.37) % 2.4}s` }}>
              {/* Now and then someone hops or spins while the class waits. */}
              <div className="cls-antic origin-bottom" style={{ animationDuration: `${7 + (i % 6)}s`, animationDelay: `-${(i * 2.3) % 9}s` }}>
                <PixelAvatar look={a.look} size={size} blink={i} />
              </div>
            </div>
            {names && <span className="max-w-full truncate text-[13px] font-bold leading-4 text-ink-2">{a.name}</span>}
          </div>
        ))}
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
  const g = q.grammar;
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
        {/* A grammar question has its own card below, across the whole width. */}
        {g ? (
          <div />
        ) : (
          <div className="flex items-baseline gap-6">
            <div
              key={q.seq}
              className={`max-w-[56vw] text-center font-extrabold leading-tight tracking-tight ${countdown ? 'invisible' : 'cls-drop-in'} ${q.prompt.length > 24 ? 'text-[3.2vw]' : 'text-[4.6vw]'}`}
            >
              {q.prompt}
            </div>
            {reveal && q.mode !== 'CUSTOM_TEXT' && q.mode !== 'CUSTOM_OX' && <div className="cls-slide-up text-[3vw] font-bold text-good">{reveal.correctLabel}</div>}
          </div>
        )}
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
      {g && (
        // Hidden under the 3·2·1 and under the '이제 문법!' card, which opens the grammar.
        <div key={q.seq} className={`rounded-[2vw] bg-white px-[2.5vw] py-[1.2vw] ${countdown || s.grammarStart ? 'invisible' : 'cls-drop-in'}`}>
          <GrammarCard g={g} variant="projector" fill={reveal ? (reveal.fill ?? []) : undefined} correct={reveal && !isText ? reveal.correctIndex : undefined} />
          {/* The rule behind the answer: the point of a grammar question, so it shows at every reveal. */}
          {reveal?.explanation && (
            <div className="cls-slide-up mt-[1vw] flex items-center justify-center gap-3 text-[1.8vw] font-bold text-ink-2" style={{ animationDelay: '0.8s' }}>
              <span className="rounded-full bg-accent px-4 py-1 text-[1.3vw] font-extrabold text-white">규칙</span>
              {reveal.explanation}
            </div>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {s.grammarStart && <GrammarStart />}
        {isText ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 rounded-[36px] bg-white">
            {reveal ? (
              <>
                <div className={`cls-pop px-[2vw] text-center font-extrabold text-good ${reveal.correctLabel.length > 24 ? 'text-[3vw]' : 'text-[5vw]'}`}>{reveal.correctLabel}</div>
                {reveal.textWrong && reveal.textWrong.length > 0 && <div className="text-3xl text-ink-3">자주 나온 답: {reveal.textWrong.join(', ')}</div>}
              </>
            ) : (
              <>
                <div className="text-4xl font-bold text-ink-2">{g?.chips ? '폰에서 조각을 순서대로 눌러 주세요' : '폰에 답을 써 주세요'}</div>
                <div className="tabular text-6xl font-extrabold">✓ {view.settled ?? 0} / {view.participants ?? 0}</div>
              </>
            )}
          </div>
        ) : (
          <Field
            options={zoneLabels(q)}
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

/** Between the words and the grammar: the first grammar question's intro shows this card. */
function GrammarStart() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[36px] bg-bg/80 backdrop-blur-sm">
      <div className="cls-pop rounded-[3vw] bg-ink px-[5vw] py-[2.4vw] text-[6vw] font-extrabold tracking-tight text-white">이제 문법!</div>
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

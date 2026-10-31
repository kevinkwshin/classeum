'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, remainingMs, shortcutAction, useLive, useTicker } from '@/client/live';
import type { TeacherEvent, TeacherLive, TeacherStudent, TeacherTopic, TeacherView } from '@/client/views';
import { Field } from '@/components/Field';
import { HelpButton } from '@/components/HelpButton';
import { AGORA_MUSIC_SRC, AGORA_MUSIC_TITLE, MUSIC_TITLE } from '@/client/sound';
import { agoraMusicLevel, musicLevel, useAudioUnlock, useBackgroundMusic, useCountdownTick, useRevealSound, useSoundPreview, useTeacherPlaysSound } from '@/client/revealSound';
import { IdleAvatar } from '@/components/IdleAvatar';
import { Logo } from '@/components/Logo';
import { ProjectorLink, openProjector } from '@/components/ProjectorLink';
import { SetupGuide } from '@/components/SetupGuide';
import { TeacherGate } from '@/components/TeacherGate';
import { DEFAULT_LOOK, normalizeLook } from '@/lib/avatar';
import { ATTENDANCE_UNLOCKS, ITEMS, THEMES, itemById, previewLook } from '@/lib/items';
import { COLUMN_CHOICES, DEFAULT_MINUTES, MINUTE_CHOICES, NOTE_MAX, TOPIC_MAX, type TopicSort } from '@/lib/agora';

type Send = (a: Record<string, unknown>) => Promise<unknown>;
type Tab = 'arena' | 'students' | 'agora';
type ArenaView = 'events' | 'stats';

export default function TeacherPage() {
  return (
    <TeacherGate>
      <TeacherApp />
    </TeacherGate>
  );
}

function TeacherApp() {
  const { view, conn, send, serverNow } = useLive<TeacherView>('teacher');
  // Any click here (opening the lobby, starting the quiz) lets this screen play the sounds when the projector can't.
  useAudioUnlock();
  const plays = useTeacherPlaysSound();
  const [tab, setTab] = useState<Tab>('students');
  // The arena tab shows its events or, switched by its title, the statistics.
  const [arenaView, setArenaView] = useState<ArenaView>('events');
  // The [직접 작성하기] editor; kept here so the setup card on 반 관리 can open it on the arena.
  const [writing, setWriting] = useState(false);
  const [toast, setToast] = useState('');
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  }, []);
  const act: Send = useCallback(
    (a) =>
      send(a).catch((e: Error) => {
        notify(e.message);
        throw e;
      }),
    [send, notify],
  );
  // A quiz started from another window brings this one to the arena, where it stays through the summary.
  const quizOn = !!view?.live && view.live.phase !== 'lobby' && view.live.phase !== 'summary';
  const [wasQuizOn, setWasQuizOn] = useState(quizOn);
  if (quizOn !== wasQuizOn) {
    setWasQuizOn(quizOn);
    if (quizOn) setTab('arena');
  }
  // The first screen is 반 관리, the top of the menu, unless a lobby or quiz is already open (after a reload, say).
  const [landed, setLanded] = useState(false);
  if (view && !landed) {
    setLanded(true);
    if (view.live) setTab('arena');
  }

  if (!view) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-3">
        {conn === 'lost' ? '서버와 연결이 끊겼어요 · 다시 연결 중' : '연결 중…'}
      </main>
    );
  }

  const running = view.live && view.live.phase !== 'lobby' && view.live.phase !== 'summary';
  return (
    <div className="flex min-h-screen bg-bg">
      {!running && (
        <nav aria-label="선생님 메뉴" className="sticky top-0 flex h-screen w-52 shrink-0 flex-col gap-1 self-start overflow-y-auto bg-ink px-3.5 py-7">
          <div className="px-3 pb-7">
            <Logo width={60} />
            <div className="mt-2.5 font-display text-[22px] font-bold tracking-tight text-white">Classeum</div>
          </div>
          {([
            ['students', '반 관리'],
            ['arena', '아레나'],
            ['agora', '아고라'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[15px] ${tab === key ? 'bg-[#24272F] font-bold text-white' : 'text-[#A3A8B4]'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tab === key ? 'bg-accent' : 'bg-transparent'}`} />
              {label}
              {key === 'students' && view.requests.length > 0 && <span className="ml-auto rounded-full bg-accent px-2 text-xs font-extrabold text-ink">{view.requests.length}</span>}
              {key === 'agora' && view.agora.screen && <span className="ml-auto rounded-full bg-accent px-2 text-xs font-extrabold text-ink">화면</span>}
            </button>
          ))}
          <div className="mt-auto flex flex-col gap-2 px-1">
            <div className="flex items-center gap-1.5">
              <ProjectorLink className="min-w-0 flex-1 whitespace-nowrap rounded-xl border border-[#3D4354] px-2 py-2.5 text-center text-sm font-semibold text-white">프로젝터 화면 열기</ProjectorLink>
              {/* Its setup steps lead to the arena's events, not its statistics. */}
              <HelpButton
                view={view}
                onTab={(next) => {
                  setTab(next);
                  if (next === 'arena') setArenaView('events');
                }}
              />
            </div>
            <div className="break-all px-2 text-[11px] leading-snug text-[#737887]">학생 주소 {view.joinUrl}</div>
          </div>
        </nav>
      )}
      <main className="min-w-0 flex-1">
        {conn === 'lost' && <div className="bg-bad py-1.5 text-center text-sm font-bold text-white">서버 연결이 끊겼어요 · 다시 연결 중</div>}
        {view.live && <TeacherSounds live={view.live} plays={plays} serverNow={serverNow} />}
        {!view.live && view.agora.screen && <AgoraSounds agora={view.agora} plays={plays} />}
        {/* A quiz started from another window shows the console whatever tab this one was on (the menu is hidden then). */}
        {(tab === 'arena' || running) &&
          (view.live ? (
            <Console view={view} live={view.live} act={act} serverNow={serverNow} />
          ) : arenaView === 'stats' ? (
            <Stats classes={view.classes} title={<ArenaTitle value={arenaView} onChange={setArenaView} />} />
          ) : (
            <Events view={view} act={act} notify={notify} writing={writing} setWriting={setWriting} onStudents={() => setTab('students')} title={<ArenaTitle value={arenaView} onChange={setArenaView} />} />
          ))}
        {tab === 'students' && !running && (
          <Students
            view={view}
            act={act}
            onWrite={() => {
              setTab('arena');
              setArenaView('events');
              setWriting(true);
            }}
          />
        )}
        {tab === 'agora' && !running && <Agora view={view} act={act} notify={notify} serverNow={serverNow} />}
      </main>
      {/* During a quiz it floats over the console; otherwise it gets its own column on wide screens so it covers no buttons. */}
      {view.requests.length > 0 &&
        (view.live ? (
          <Requests view={view} act={act} />
        ) : (
          <div className="shrink-0 min-[1500px]:pr-5 min-[1500px]:pt-6">
            <Requests view={view} act={act} inline />
          </div>
        ))}
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white">{toast}</div>}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[20px] bg-white p-6 ${className}`}>{children}</section>;
}

/**
 * The background song's switch at the top of the console: its name, level bars that bounce while it is on, and 켜짐
 * or 꺼짐. `dark` is for the quiz bar.
 */
function MusicSwitch({ on, onToggle, dark = false, title = MUSIC_TITLE }: { on: boolean; onToggle: () => void; dark?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={`${title} · ${on ? '끄기' : '켜기'}`}
      onClick={(e) => {
        onToggle();
        e.currentTarget.blur();
      }}
      className={`flex items-center gap-2.5 rounded-xl border font-bold ${dark ? 'h-10 border-[#3D4354] px-4 text-sm' : 'h-11 border-[#D5D8DF] bg-white px-3.5 text-[15px]'}`}
    >
      <span aria-hidden className={`flex h-3.5 items-end gap-[2px] ${on ? 'cls-eq' : ''}`}>
        {[0.6, 1, 0.8].map((h, i) => (
          <i key={i} className={`block w-[3px] rounded-sm ${on ? (dark ? 'bg-accent' : 'bg-ink') : 'bg-[#A3A8B4]'}`} style={{ height: `${h * 100}%` }} />
        ))}
      </span>
      {/* On the quiz bar the name gives way on a narrow screen; the bars, the badge and the tooltip stay. */}
      <span className={`${on ? '' : 'text-ink-3'} ${dark ? 'hidden min-[1200px]:inline' : ''}`}>{title}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${on ? (dark ? 'bg-accent text-ink' : 'bg-ink text-white') : dark ? 'bg-[#24272F] text-ink-3' : 'bg-bg text-ink-3'}`}>{on ? '켜짐' : '꺼짐'}</span>
    </button>
  );
}

function Btn({ children, onClick, kind = 'dark', disabled, className = '', title }: { children: React.ReactNode; onClick?: () => void; kind?: 'dark' | 'ghost' | 'gold' | 'accent'; disabled?: boolean; className?: string; title?: string }) {
  const style = kind === 'dark' ? 'bg-ink text-white' : kind === 'gold' ? 'bg-gold text-ink' : kind === 'accent' ? 'bg-accent text-ink' : 'border border-[#D5D8DF] bg-white text-ink';
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`h-11 rounded-xl px-4 text-[15px] font-bold disabled:opacity-40 ${style} ${className}`}>
      {children}
    </button>
  );
}

/** The arena tab's title: 이벤트 or 통계, with the other one in gray to switch to. */
function ArenaTitle({ value, onChange }: { value: ArenaView; onChange: (next: ArenaView) => void }) {
  return (
    <div className="flex items-baseline gap-4">
      {(['events', 'stats'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`text-2xl font-bold ${value === v ? 'text-ink' : 'text-[#A3A8B4] hover:text-ink-2'}`}>
          {v === 'events' ? '이벤트' : '통계'}
        </button>
      ))}
    </div>
  );
}

// ---------- device requests ----------

/** The class picked last (in any tab), remembered on this laptop; falls back to the first class. */
function useClassChoice(classes: { id: string }[]) {
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem('classeum.class');
    } catch {
      return null;
    }
  });
  const id = picked && classes.some((c) => c.id === picked) ? picked : classes[0]?.id ?? '';
  const choose = (next: string) => {
    setPicked(next);
    try {
      localStorage.setItem('classeum.class', next);
    } catch {
      // Private window: the choice just isn't remembered.
    }
  };
  return [id, choose] as const;
}

function ClassTabs({ classes, value, onChange, extra }: { classes: { id: string; name: string; students?: number }[]; value: string; onChange: (id: string) => void; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {classes.map((c) => (
        <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(c.id)} className={`h-10 rounded-xl px-4 text-sm font-bold ${value === c.id ? 'bg-ink text-white' : 'bg-white text-ink-2'}`}>
          {c.name}
          {c.students !== undefined && <span className={`ml-1.5 tabular ${value === c.id ? 'text-[#A3A8B4]' : 'text-ink-3'}`}>{c.students}</span>}
        </button>
      ))}
      {extra}
    </div>
  );
}

const REQUEST_KIND: Record<TeacherView['requests'][number]['kind'], { label: string; tone: string; action: string }> = {
  match: { label: '명단 확인', tone: 'font-semibold text-good', action: '승인' },
  new: { label: '새 학생', tone: 'text-ink-3', action: '추가' },
  replace: { label: '기기 교체', tone: 'font-semibold text-bad', action: '교체' },
  conflict: { label: '번호 겹침', tone: 'font-semibold text-bad', action: '이름 바꿔 승인' },
};

function Requests({ view, act, inline = false }: { view: TeacherView; act: Send; inline?: boolean }) {
  // Floating, it sits below the top bars (so 퀴즈 시작 / 종료 stay clickable) and folds away to a pill.
  // Inline it is a column only on wide screens; on laptops it floats bottom-right, clear of the page's top buttons (대기실 열기).
  const [open, setOpen] = useState(true);
  const autoCount = view.requests.filter((r) => r.auto).length;
  return (
    <aside
      className={`cls-slide-up rounded-[20px] bg-white shadow-[0_8px_30px_rgba(16,18,24,0.12)] ${inline ? 'fixed bottom-5 right-5 z-40 min-[1500px]:sticky min-[1500px]:bottom-auto min-[1500px]:right-auto min-[1500px]:top-6' : 'fixed right-5 top-24 z-40'} ${open ? 'w-80 p-5' : 'px-4 py-2.5'}`}
    >
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex w-full items-center justify-between gap-3 ${open ? 'mb-3' : ''}`}>
        <h2 className={`font-bold ${open ? 'text-lg' : 'text-sm'}`}>기기 등록 요청</h2>
        <span className="flex items-center gap-2">
          <span key={view.requests.length} className="cls-pop rounded-full bg-accent px-2.5 text-sm font-extrabold">{view.requests.length}</span>
          <span className="text-ink-3" aria-hidden>{open ? '–' : '+'}</span>
        </span>
      </button>
      {open && (
        <>
          {view.requests.length > 1 && autoCount > 0 && (
            <Btn kind="ghost" className="mb-2 w-full text-sm" onClick={() => act({ type: 'approve-all' }).catch(() => undefined)} title="명단과 맞거나 새로 온 학생을 한 번에 승인해요. '따로 확인' 표시가 있는 요청은 하나씩 보고 승인하세요.">
              {autoCount === view.requests.length ? `모두 승인 (${autoCount}명)` : `${autoCount}명 한 번에 승인 · ${view.requests.length - autoCount}명은 따로 확인`}
            </Btn>
          )}
          {/* During a quiz the panel must end above the console's bottom bar (지금 정답 공개 / 다음). */}
          <div className={`flex flex-col overflow-y-auto ${inline ? 'max-h-[40vh] min-[1500px]:max-h-[60vh]' : 'max-h-[min(60vh,calc(100vh-22rem))]'}`}>
            {view.requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-t border-[#EEF0F3] py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    <span className="text-ink-3">{r.className}</span> {r.number} {r.name}
                  </div>
                  <div className={`text-[13px] ${REQUEST_KIND[r.kind].tone}`}>
                    {/* 모두 승인 leaves these alone: a device swap, a taken number, or a same name at another number. */}
                    {!r.auto && view.requests.length > 1 && <span className="mr-1 rounded bg-[#FFF1E6] px-1.5 py-px text-[12px] font-bold text-[#C2410C]">따로 확인</span>}
                    {REQUEST_KIND[r.kind].label}
                    {r.note && ` · ${r.note}`} · <b className="text-ink">{r.symbol}</b>
                  </div>
                </div>
                <button type="button" aria-label="거절" onClick={() => act({ type: 'reject', requestId: r.id })} className="h-10 w-10 shrink-0 rounded-xl border border-[#D5D8DF] text-lg">✕</button>
                <Btn
                  onClick={() => {
                    if (r.kind === 'conflict') {
                      const message =
                        r.bound || r.records
                          ? `${r.className} ${r.number}번 ${r.holder}의 ${r.bound ? '폰 연결이 끊기고, ' : ''}캐릭터와 기록이 '${r.name}'에게 넘어가요.\n번호를 잘못 쓴 건 아닌지 확인했나요?`
                          : `${r.className} ${r.number}번의 이름을 '${r.holder}'에서 '${r.name}'(으)로 바꾸고 승인할까요?`;
                      if (!confirm(message)) return;
                    }
                    // The kind shown here goes along, so a roster change in between can't approve something else.
                    act({ type: 'approve', requestId: r.id, kind: r.kind }).catch(() => undefined);
                  }}
                  className="h-10 shrink-0 px-3 text-sm"
                >
                  {REQUEST_KIND[r.kind].action}
                </Btn>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">학생 폰의 확인 기호와 같은지 보고 승인하세요.</p>
        </>
      )}
    </aside>
  );
}

// ---------- events ----------

interface UploadResult {
  ok: boolean;
  error?: string;
  draftId?: string;
  issues?: { level: 'error' | 'warning'; sheet: string; row?: number; column?: string; message: string }[];
  hasErrors?: boolean;
  rosterCount?: number;
  groups?: { name: string; wordCount: number; reviewCount: number; customCount: number; grammarCount: number; grammarByTab: Record<string, number>; warnings: string[]; questions: { prompt: string; modeLabel: string; options: string[]; answerIndex: number; answers?: string[] }[] }[];
}

type TypedRow = { spelling: string; meaning: string; example: string };
type TypedDraft = { title: string; rows: TypedRow[] };
const TYPED_KEY = 'classeum.typed';
const blankRows = (n: number): TypedRow[] => Array.from({ length: n }, () => ({ spelling: '', meaning: '', example: '' }));

/** What was being typed in [직접 작성하기] survives closing the window or reloading the page, on this laptop only. */
function loadTyped(): TypedDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(TYPED_KEY) ?? 'null') as TypedDraft | null;
    if (saved && typeof saved.title === 'string' && Array.isArray(saved.rows) && saved.rows.length) return saved;
  } catch {
    // Storage blocked or broken: start empty.
  }
  return { title: '', rows: blankRows(10) };
}

function Events({ view, act, notify, writing, setWriting, onStudents, title }: { view: TeacherView; act: Send; notify: (message: string) => void; writing: boolean; setWriting: (on: boolean) => void; onStudents: () => void; title: React.ReactNode }) {
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the open preview came from [직접 작성하기], so 고치기 goes back to the editor.
  const [typedPreview, setTypedPreview] = useState(false);
  const [typed, setTyped] = useState<TypedDraft>(loadTyped);
  useEffect(() => {
    try {
      localStorage.setItem(TYPED_KEY, JSON.stringify(typed));
    } catch {
      // Not saved; the editor still works.
    }
  }, [typed]);
  const [selected, setSelected] = useState<string | null>(null);
  const event = view.events.find((e) => e.id === selected) ?? view.events[0] ?? null;

  const onFile = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    const res = (await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ ok: false, error: '업로드에 실패했어요.' }))) as UploadResult;
    setUpload(res);
    setTypedPreview(false);
    setBusy(false);
  };

  const previewTyped = async () => {
    setBusy(true);
    const res = (await fetch('/api/words', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: typed.title, words: typed.rows }) })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: '미리보기를 만들지 못했어요.' }))) as UploadResult;
    setBusy(false);
    setWriting(false);
    setTypedPreview(true);
    setUpload(res);
  };

  // [엑셀로 받기]: the server fills our template and names the file after the title or the event.
  const saveExcel = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/words/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) {
      notify(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? '엑셀 파일을 만들지 못했어요.');
      return;
    }
    const name = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name ? decodeURIComponent(name) : '단어장.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  return (
    <div className="flex flex-col gap-5 p-8">
      <div className="flex items-center justify-between">
        {title}
        {/* One width for all three; the two Excel buttons are dark, typing in the screen is white. */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setWriting(true)} className="flex h-11 w-32 items-center justify-center rounded-xl border border-[#D5D8DF] bg-white text-[15px] font-bold">직접 작성하기</button>
          {/* Saved under a name that also becomes the event's name when it comes back filled in. */}
          <a href="/templates/M2_L7.xlsx" download="M2_L7.xlsx" className="flex h-11 w-32 items-center justify-center rounded-xl bg-ink text-[15px] font-bold text-white">템플릿 받기</a>
          <label className={`flex h-11 w-32 cursor-pointer items-center justify-center rounded-xl bg-ink text-[15px] font-bold text-white ${busy ? 'opacity-50' : ''}`}>
            {busy ? '읽는 중…' : '엑셀 올리기'}
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* Hidden while requests wait: their popup is step 4's action and would cover 대기실 열기 below the card. */}
      {view.requests.length === 0 && <SetupGuide view={view} onStudents={onStudents} onWrite={() => setWriting(true)} />}

      {view.events.length === 0 && !upload && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-xl font-bold">아직 이벤트가 없어요</div>
          <div className="text-ink-3">단어장 엑셀을 올리거나 [직접 작성하기]로 단어와 뜻을 쓰면 문제가 자동으로 만들어져요.</div>
        </Card>
      )}

      {view.events.length > 0 && (
        <div className="flex gap-5">
          <div className="flex w-80 shrink-0 flex-col gap-2">
            {view.events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected(e.id)}
                className={`rounded-2xl p-4 text-left ${event?.id === e.id ? 'bg-ink text-white' : 'bg-white'}`}
              >
                <div className="text-lg font-bold">{e.name}</div>
                <div className={`text-sm ${event?.id === e.id ? 'text-[#A3A8B4]' : 'text-ink-3'}`}>
                  {e.count}문항 · 약 {Math.round(e.estimateSec / 60)}분{view.classes.length > 0 ? ` · ${e.classRuns.length}/${view.classes.length}반` : ''}
                </div>
                {/* The classes that have had it, so a week's quiz can be rotated without opening each event. */}
                {e.classRuns.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {view.classes
                      .filter((c) => e.classRuns.some((r) => r.classId === c.id))
                      .map((c) => (
                        <span key={c.id} className={`rounded-full px-2 py-0.5 text-xs font-bold ${event?.id === e.id ? 'bg-[#24272F] text-[#7FD8A6]' : 'bg-good-soft text-good'}`}>
                          {c.name}
                        </span>
                      ))}
                  </div>
                )}
              </button>
            ))}
          </div>
          {event && <EventDetail key={event.id} view={view} event={event} act={act} onStudents={onStudents} onExcel={() => saveExcel({ eventId: event.id })} />}
        </div>
      )}

      {writing && <WordEditor draft={typed} setDraft={setTyped} busy={busy} onClose={() => setWriting(false)} onPreview={previewTyped} onExcel={() => saveExcel({ name: typed.title, words: typed.rows })} />}
      {upload && <UploadPreview result={upload} typed={typedPreview} onClose={() => {
        setUpload(null);
        if (typedPreview) setWriting(true);
      }} onCreate={async () => {
        const res = (await act({ type: 'create-event', draftId: upload.draftId })) as { eventIds?: string[] };
        setUpload(null);
        if (typedPreview) setTyped({ title: '', rows: blankRows(10) });
        if (res.eventIds?.[0]) setSelected(res.eventIds[0]);
        else notify('단어만 저장했어요 (만들 문제가 없어요)');
      }} />}
    </div>
  );
}

const dayOf = (at: number) => new Date(at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }).replace(/\.\s?/g, '/').replace(/\/$/, '');

/**
 * Which classes have had this quiz, for a teacher who rotates one week's quiz through several classes.
 * The class picked for 대기실 열기 is outlined, and a note warns when it has already played it.
 */
function ClassRuns({ view, event, chosen }: { view: TeacherView; event: TeacherEvent; chosen: string }) {
  if (view.classes.length === 0) return null;
  const runs = new Map(event.classRuns.map((r) => [r.classId, r]));
  const again = runs.get(chosen);
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {/* Green: had it; grey: not yet. The day, accuracy and runs are in the tooltip. */}
        {view.classes.map((c) => {
          const r = runs.get(c.id);
          const detail = r ? `${dayOf(r.last)}${r.partial ? ' · 중간에 끝냄' : ` · 정답률 ${Math.round(r.accuracy * 100)}%`}${r.runs > 1 ? ` · ${r.runs}번` : ''}` : '아직 안 했어요';
          return (
            <span
              key={c.id}
              title={`${c.name} · ${detail}`}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${r ? 'bg-good-soft text-good' : 'bg-bg text-ink-3'} ${c.id === chosen ? 'ring-2 ring-ink/70' : ''}`}
            >
              {c.name}
            </span>
          );
        })}
      </div>
      {again && (
        <div className="text-sm font-semibold text-[#8A6100]">
          {view.classes.find((c) => c.id === chosen)?.name}은 {dayOf(again.last)}에 이 퀴즈를 {again.partial ? '일부만 ' : ''}했어요. 다시 열어도 돼요.
        </div>
      )}
    </div>
  );
}

function EventDetail({ view, event, act, onStudents, onExcel }: { view: TeacherView; event: TeacherEvent; act: Send; onStudents: () => void; onExcel: () => void }) {
  const [classId, setClassId] = useClassChoice(view.classes);
  const [itemId, setItemId] = useState(event.reward.itemId);
  const [challenge, setChallenge] = useState(event.reward.challengePct);
  const [growth, setGrowth] = useState(event.reward.growthPp);
  const item = itemById(itemId);
  const dirty = itemId !== event.reward.itemId || challenge !== event.reward.challengePct || growth !== event.reward.growthPp;
  // Same limits as the server, written back so the editor shows what will really be used.
  const saveReward = () => {
    const c = Math.min(100, Math.max(30, Math.round(challenge) || 30));
    const g = Math.min(50, Math.max(1, Math.round(growth) || 1));
    setChallenge(c);
    setGrowth(g);
    return act({ type: 'reward', eventId: event.id, itemId, challengePct: c, growthPp: g });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="text-2xl font-bold">{event.name}</div>
          <div className="text-ink-3">{event.count}문항 · 문항당 {event.seconds}초 · 약 {Math.round(event.estimateSec / 60)}분</div>
          {event.fileName && (
            <div className="mt-0.5 break-all text-sm text-ink-3">
              📄 {event.fileName} · {new Date(event.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 올림
            </div>
          )}
          {event.typed && <div className="mt-0.5 text-sm text-ink-3">✏️ 직접 작성 · {new Date(event.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <Btn kind="ghost" onClick={onExcel}>엑셀로 받기</Btn>
          <Btn kind="ghost" onClick={() => { if (confirm(`'${event.name}' 이벤트를 지울까요? 기록은 통계에 남아요.`)) act({ type: 'delete-event', eventId: event.id }); }}>지우기</Btn>
          {view.classes.length === 0 ? (
            <Btn onClick={onStudents}>반 만들기 →</Btn>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink-3">오늘 반</span>
                <select value={classId} onChange={(e) => setClassId(e.target.value)} className="h-11 rounded-xl border border-[#D5D8DF] bg-white px-3 text-[15px] font-bold">
                  {view.classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              {/* The projector window opens first, inside the click: Safari blocks one opened after the awaits. */}
              <Btn kind="accent" onClick={async () => { if (view.agora.screen && !confirm('아고라 주제가 화면에 떠 있어요. 마감하고 내린 뒤 대기실을 열까요?')) return; if (!view.displayOn) openProjector(); if (dirty) await saveReward(); await act({ type: 'open-lobby', eventId: event.id, classId }); }}>대기실 열기</Btn>
            </>
          )}
        </div>
        <ClassRuns view={view} event={event} chosen={classId} />
      </Card>
      {event.warnings.length > 0 && (
        <Card className="!bg-[#FFF8E6]">
          <div className="mb-2 font-bold">확인할 점</div>
          <ul className="list-disc pl-5 text-sm text-ink-2">{event.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Card>
      )}
      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-bold">이번 퀴즈 보상</h2>
        <div className="flex gap-6">
          <div className="flex w-48 shrink-0 flex-col items-center gap-3">
            <div className="flex h-56 w-48 items-end justify-center rounded-t-full rounded-b-2xl bg-gold pb-4">{item && <IdleAvatar key={item.id} look={previewLook(item, DEFAULT_LOOK)} size={150} seed={item.id} />}</div>
            <div className="text-lg font-bold">{item?.name}</div>
          </div>
          {/* Grouped by theme; attendance items are earned by coming, so they aren't offered here. The scroll box clips
              what sticks out, so 4 px of padding (cancelled by the margin) keeps the chosen item's ring whole. */}
          <div className="-m-1 flex max-h-[428px] flex-1 flex-col gap-4 overflow-y-auto p-1">
            {THEMES.map((th) => {
              const list = ITEMS.filter((it) => it.theme === th.id && !ATTENDANCE_UNLOCKS.includes(it.id));
              if (list.length === 0) return null;
              return (
                <div key={th.id}>
                  <div className="mb-1.5 text-xs font-bold text-ink-3">{th.name}</div>
                  {/* Five per row when there's room, fewer (at least 72px each) in a narrow column. */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(max(72px,calc(20%_-_0.5rem)),1fr))] gap-2">
                    {list.map((it) => (
                      <button key={it.id} type="button" aria-pressed={itemId === it.id} onClick={() => setItemId(it.id)} className={`flex flex-col items-center gap-1 rounded-2xl p-2 ${itemId === it.id ? 'bg-[#FFF6DE] ring-2 ring-gold' : 'bg-bg'}`}>
                        <IdleAvatar look={previewLook(it, DEFAULT_LOOK)} size={48} seed={it.id} />
                        <span className="text-[11px] font-semibold leading-tight">{it.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-xl bg-bg px-4 py-2 text-[15px] font-semibold">도전 · 정답률
            <input type="number" min={30} max={100} value={challenge} onChange={(e) => setChallenge(Number(e.target.value))} className="h-9 w-16 rounded-lg bg-white text-center font-bold" />%+
          </label>
          <label className="flex items-center gap-2 rounded-xl bg-bg px-4 py-2 text-[15px] font-semibold">성장 · 내 평균 +
            <input type="number" min={1} max={50} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} className="h-9 w-14 rounded-lg bg-white text-center font-bold" />%p
          </label>
          <span className="text-sm text-ink-3">둘 중 하나만 달성하면 받아요</span>
          <Btn kind="gold" disabled={!dirty} onClick={saveReward} className="ml-auto">저장</Btn>
        </div>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex items-center gap-3 text-[15px] font-semibold">
          <input
            type="checkbox"
            checked={event.retryRound}
            onChange={(e) => act({ type: 'retry-round', eventId: event.id, on: e.target.checked }).catch(() => undefined)}
            className="h-5 w-5 accent-ink"
          />
          끝나고 많이 틀린 단어 다시 풀기
        </label>
        <span className="text-sm text-ink-3">반 정답률 70% 아래 단어, 최대 5문제 · 보통은 꺼 두세요</span>
      </Card>
    </div>
  );
}

/**
 * [직접 작성하기]: a title and a table of word / meaning / example. Pasting several lines copied from Excel or a
 * Hangul table fills the rows from there (columns split by tabs); Enter moves down a row.
 */
function WordEditor({ draft, setDraft, busy, onClose, onPreview, onExcel }: { draft: TypedDraft; setDraft: (f: (d: TypedDraft) => TypedDraft) => void; busy: boolean; onClose: () => void; onPreview: () => void; onExcel: () => void }) {
  const cells = useRef<(HTMLInputElement | null)[][]>([]);
  const keys = ['spelling', 'meaning', 'example'] as const;
  const filled = draft.rows.filter((r) => r.spelling.trim() && r.meaning.trim()).length;
  // Half-written rows go into the file too, to finish in Excel.
  const anyRow = draft.rows.some((r) => keys.some((k) => r[k].trim()));
  const setCell = (row: number, col: number, value: string) => setDraft((d) => ({ ...d, rows: d.rows.map((r, i) => (i === row ? { ...r, [keys[col]]: value } : r)) }));
  const focus = (row: number, col: number) => requestAnimationFrame(() => cells.current[row]?.[col]?.focus());
  const paste = (row: number, col: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\r/g, '');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.split('\n').filter((l) => l.trim());
    setDraft((d) => {
      const rows = [...d.rows];
      lines.forEach((line, k) => {
        while (rows.length <= row + k) rows.push(...blankRows(1));
        const next = { ...rows[row + k] };
        line.split('\t').slice(0, 3 - col).forEach((value, j) => (next[keys[col + j]] = value.trim()));
        rows[row + k] = next;
      });
      return { ...d, rows };
    });
  };
  const down = (row: number, col: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (row + 1 >= draft.rows.length) setDraft((d) => ({ ...d, rows: [...d.rows, ...blankRows(5)] }));
    focus(row + 1, col);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8">
      <div className="flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-hidden rounded-[24px] bg-white p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">직접 작성하기</h2>
          <span className="rounded-full bg-good-soft px-3 py-1 text-sm font-bold text-good">단어 {filled}</span>
        </div>
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="제목 (예: 8주차 영단어)"
          maxLength={40}
          autoFocus
          aria-label="제목"
          className="h-12 rounded-xl border border-[#D5D8DF] px-4 text-lg font-bold outline-none focus:border-ink"
        />
        <p className="text-sm text-ink-3">
          단어와 뜻만 쓰면 문제가 자동으로 만들어져요. 엑셀이나 한글 표에서 여러 줄을 복사해 붙여 넣어도 돼요. 예문은 빈칸 자리를 [ ]로 감싸면 빈칸 문제도 생겨요. (예: Can I [borrow] your pen?)
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#EEF0F3]">
          <table className="w-full text-[15px]">
            <thead className="sticky top-0 bg-bg text-left text-sm text-ink-3">
              <tr>
                <th className="w-10 py-2 pl-3 font-semibold">#</th>
                <th className="w-[26%] py-2 font-semibold">단어 (영어)</th>
                <th className="w-[26%] py-2 font-semibold">뜻</th>
                <th className="py-2 font-semibold">예문 (선택)</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, i) => (
                <tr key={i} className="border-t border-[#EEF0F3]">
                  <td className="tabular pl-3 text-sm text-ink-3">{i + 1}</td>
                  {keys.map((k, c) => (
                    <td key={k} className="py-1 pr-2">
                      <input
                        ref={(el) => {
                          (cells.current[i] ??= [])[c] = el;
                        }}
                        value={r[k]}
                        onChange={(e) => setCell(i, c, e.target.value)}
                        onPaste={paste(i, c)}
                        onKeyDown={down(i, c)}
                        lang={k === 'meaning' ? 'ko' : 'en'}
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-label={`${i + 1}번 ${k === 'spelling' ? '단어' : k === 'meaning' ? '뜻' : '예문'}`}
                        className="h-10 w-full rounded-lg bg-bg px-3 outline-none focus:bg-white focus:ring-2 focus:ring-ink/20"
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" aria-label={`${i + 1}번 줄 지우기`} onClick={() => setDraft((d) => ({ ...d, rows: d.rows.length > 1 ? d.rows.filter((_, k) => k !== i) : blankRows(1) }))} className="h-8 w-8 rounded-lg text-ink-3 hover:bg-bg">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Btn kind="ghost" onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, ...blankRows(10)] }))}>10줄 추가</Btn>
            <Btn kind="ghost" onClick={() => { if (confirm('쓴 내용을 모두 지울까요?')) setDraft(() => ({ title: '', rows: blankRows(10) })); }}>비우기</Btn>
            <Btn kind="ghost" disabled={!anyRow} onClick={onExcel}>엑셀로 받기</Btn>
          </div>
          <div className="flex items-center gap-3">
            {filled > 0 && filled < 4 && <span className="text-sm text-ink-3">단어가 4개 이상이면 보기를 잘 만들 수 있어요</span>}
            <Btn kind="ghost" onClick={onClose}>닫기</Btn>
            <Btn disabled={busy || filled === 0} onClick={onPreview}>{busy ? '만드는 중…' : '미리보기'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadPreview({ result, typed = false, onClose, onCreate }: { result: UploadResult; typed?: boolean; onClose: () => void; onCreate: () => void }) {
  const errors = result.issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = result.issues?.filter((i) => i.level === 'warning') ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8">
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-[24px] bg-white p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{typed ? '직접 작성 확인' : '파일 확인'}</h2>
          <div className="flex gap-2 text-sm font-bold">
            <span className="rounded-full bg-good-soft px-3 py-1 text-good">문제 {result.groups?.reduce((n, g) => n + g.questions.length, 0) ?? 0}</span>
            {warnings.length > 0 && <span className="rounded-full bg-[#FFF8E6] px-3 py-1">경고 {warnings.length}</span>}
            {errors.length > 0 && <span className="rounded-full bg-bad-soft px-3 py-1 text-bad">오류 {errors.length}</span>}
          </div>
        </div>
        {!result.ok && <div className="text-bad">{result.error}</div>}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {[...errors, ...warnings].length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="text-ink-3"><tr>{!typed && <th className="py-1">시트</th>}<th className="py-1">행</th><th>칸</th><th>내용</th></tr></thead>
              <tbody>
                {[...errors, ...warnings].map((i, k) => (
                  <tr key={k} className="border-t border-[#EEF0F3]">
                    {!typed && <td className="py-1.5 pr-3">{i.sheet}</td>}<td className="tabular py-1.5 pr-3">{i.row ?? ''}</td><td className="pr-3">{i.column ?? ''}</td>
                    <td className={i.level === 'error' ? 'font-semibold text-bad' : ''}>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.groups?.map((g) => (
            <div key={g.name} className="rounded-2xl bg-bg p-4">
              <div className="mb-2 flex items-baseline gap-3">
                <div className="text-lg font-bold">{g.name}</div>
                <div className="text-sm text-ink-3">단어 {g.wordCount}{g.reviewCount ? ` · 검토 ${g.reviewCount}` : ''}{g.grammarCount ? ` · 문법 ${Object.entries(g.grammarByTab).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(' · ')}` : ''}{g.customCount ? ` · 직접 문항 ${g.customCount}` : ''}{result.rosterCount ? ` · 명단 ${result.rosterCount}명` : ''}</div>
              </div>
              {g.warnings.length > 0 && <ul className="mb-2 list-disc pl-5 text-sm text-ink-2">{g.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {g.questions.map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tabular w-6 shrink-0 text-ink-3">{i + 1}</span>
                    <span className="min-w-0">
                      <b>{q.prompt}</b> <span className="text-ink-3">{q.modeLabel}</span>
                      <br />
                      {q.options.length ? q.options.map((o, j) => <span key={j} className={j === q.answerIndex ? 'font-bold text-good' : 'text-ink-2'}>{j > 0 ? ' · ' : ''}{o}</span>) : <span className="text-good">{q.answers?.join(' | ')}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Btn kind="ghost" onClick={onClose}>{typed ? '고치기' : '취소'}</Btn>
          <Btn disabled={!result.ok || result.hasErrors || !result.groups?.length} onClick={onCreate}>{result.hasErrors ? (typed ? '고치기를 눌러 오류를 고쳐 주세요' : '오류를 고친 뒤 다시 올려 주세요') : '이벤트 만들기'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- live console ----------

/**
 * The projector plays the sounds once it has been clicked; until then, or without one, this screen does, whichever
 * menu tab is open (src/client/revealSound.ts).
 */
function TeacherSounds({ live, plays, serverNow }: { live: TeacherLive; plays: { now: () => boolean; on: boolean }; serverNow: () => number }) {
  useRevealSound(live.question?.seq ?? -1, live.phase === 'reveal' ? live.reveal : null, live.sound, plays.now);
  useCountdownTick(live.phase === 'moving' ? live.phaseEndsAt : null, serverNow, live.sound, plays.now);
  useSoundPreview(live.sound, plays.now);
  useBackgroundMusic(live.music && plays.on ? musicLevel(live.phase, live.blank, live.paused) : 0);
  return null;
}

/** The 아고라's song from this screen while the projector can't play it, as TeacherSounds does for the arena's. */
function AgoraSounds({ agora, plays }: { agora: TeacherView['agora']; plays: { on: boolean } }) {
  const topic = agora.topics.find((t) => t.id === agora.screen?.topicId);
  useBackgroundMusic(agora.screen?.music && topic && plays.on ? agoraMusicLevel(topic.status, topic.reveal) : 0, AGORA_MUSIC_SRC);
  return null;
}

/** '단어로', '문법 배열로', '보너스 문항으로': 으로 after a final consonant other than ㄹ. */
function toward(label: string): string {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  const final = code >= 0 && code < 11172 ? code % 28 : 0;
  return `${label}${final !== 0 && final !== 8 ? '으로' : '로'}`;
}

function Console({ view, live, act, serverNow }: { view: TeacherView; live: TeacherLive; act: Send; serverNow: () => number }) {
  const control = useCallback((action: string) => act({ type: 'control', action }).catch(() => undefined), [act]);
  // 다음 유형 passes over the rest of a type in one go, so it asks first (the button and Shift+S alike). The quiz is
  // held while the dialog is open, so it can't move on to another type underneath.
  const skipSection = useCallback(() => {
    const s = live.section;
    if (!s || s.left === 0) return;
    const wasPaused = !!live.paused;
    if (!wasPaused) control('pause');
    const after = s.next ? '건너뛴 문제는 기록과 보상 기준에서 빠져요.' : '건너뛴 문제는 빼고, 지금까지 낸 문제로 보상을 판정해요.';
    if (confirm(`남은 ${s.label} ${s.left}문제를 건너뛰고 ${s.next ? toward(s.next) : '마무리로'} 넘어갈까요?\n${after}`)) control(`skip-section:${s.key}`);
    else if (!wasPaused) control('resume');
  }, [live.section, live.paused, control]);
  const running = live.phase !== 'lobby' && live.phase !== 'summary';
  // Hidden until the reveal, in case the laptop screen ends up mirrored on the projector; asked again for each question.
  const [shownSeq, setShownSeq] = useState<number | null>(null);
  // The end screen's questions opened to show who missed them (names stay folded in case the screen is mirrored).
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (id: string) => setOpenRows((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const showAnswer = live.phase === 'reveal' || (shownSeq !== null && shownSeq === live.question?.seq);
  const setShowAnswer = () => setShownSeq(live.question?.seq ?? null);
  useTicker(running, 250);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      // Typing fields keep their keys; checkboxes and buttons don't swallow the shortcuts.
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type)));
      if (typing) return;
      const action = shortcutAction(e.code, live.paused, e.shiftKey);
      if (action) {
        e.preventDefault();
        if (action === 'skip-section') skipSection();
        else control(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, live.paused, control, skipSection]);

  if (live.phase === 'lobby') return <Lobby view={view} live={live} act={act} control={control} />;
  if (live.phase === 'summary') {
    return (
      <div className="flex flex-col items-center gap-8 p-12">
        <div className="flex w-full justify-end">
          <MusicSwitch on={live.music} onToggle={() => control('music')} />
        </div>
        <h1 className="text-3xl font-bold">{live.className} · {live.eventName} 끝</h1>
        <div className="flex gap-5">
          <Card className="min-w-56 !bg-ink text-white"><div className="text-[#A3A8B4]">반 정답률</div><div className="tabular text-6xl font-extrabold text-[#3DDC97]">{Math.round((live.summary?.accuracy ?? 0) * 100)}%</div></Card>
          <Card className="min-w-56"><div className="text-ink-3">보상 받은 학생</div><div className="tabular text-6xl font-extrabold">{live.summary?.rewarded ?? 0}<span className="text-2xl text-ink-3"> / {live.summary?.judged ?? 0}</span></div></Card>
        </div>
        <p className="text-ink-3">학생들은 각자 폰에서 결과와 오답 노트를 보고 있어요. 학생별 기록은 통계에 쌓였어요.</p>
        <Btn onClick={() => act({ type: 'close-session' })}>아레나 닫기</Btn>
        {live.hardest && live.hardest.length > 0 && (
          // What the class missed most this time, to go over together before closing.
          <Card className="w-full max-w-5xl !p-2">
            <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
              <h2 className="text-lg font-bold">많이 틀린 문제</h2>
              <span className="text-sm text-ink-3">반 정답률이 낮은 순 · {live.hardest.length}문제 · 줄을 누르면 틀린 학생</span>
            </div>
            <table className="w-full text-left text-[15px]">
              <thead className="text-xs font-bold text-ink-3"><tr><th className="w-20 px-4 py-2">정답률</th><th>문제</th><th>정답</th><th>많이 고른 오답</th><th className="pr-4 text-right">틀린 학생</th></tr></thead>
              <tbody>
                {live.hardest.map((h) => {
                  const open = openRows.has(h.id);
                  return (
                    <Fragment key={h.id}>
                      <tr onClick={() => h.missed.length && toggleRow(h.id)} className={`border-t border-[#EEF0F3] align-top ${h.missed.length ? 'cursor-pointer hover:bg-bg' : ''} ${open ? 'bg-bg' : ''}`}>
                        <td className={`tabular px-4 py-2.5 font-extrabold ${h.accuracy < 0.6 ? 'text-bad' : ''}`}>{Math.round(h.accuracy * 100)}%</td>
                        <td className="py-2.5 pr-4">
                          <span className="mr-2 whitespace-nowrap rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-ink-2">{h.kind}</span>
                          <span className="break-keep">{h.text}</span>
                        </td>
                        <td className="py-2.5 pr-4 font-bold">{h.answer}</td>
                        <td className="py-2.5 pr-4 text-ink-2">{h.topWrong ?? '-'}</td>
                        <td className="tabular whitespace-nowrap py-2.5 pr-4 text-right text-sm font-bold text-ink-2">{h.missed.length ? `${h.missed.length}명 ${open ? '▴' : '▾'}` : '-'}</td>
                      </tr>
                      {open && (
                        <tr className="bg-bg">
                          <td />
                          <td colSpan={4} className="pb-3 pr-4">
                            <div className="flex flex-wrap gap-1.5">
                              {h.missed.map((m) => (
                                <span key={`${m.number}-${m.name}`} className="rounded-full bg-white px-3 py-1 text-sm">
                                  <span className="tabular mr-1 text-ink-3">{m.number}</span><span className="font-semibold">{m.name}</span><span className="ml-1.5 text-bad">{m.mine}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    );
  }

  // A checkpoint keeps the last question as current; show the rest screen instead of it.
  const q = live.phase === 'checkpoint' ? null : live.current;
  const ms = remainingMs(live.phaseEndsAt, live.paused, live.pausedRemaining, serverNow());
  const total = live.round === 'retry' ? live.total : live.mainCount;
  const steps: [string, boolean][] = [
    ['출발', live.phase === 'intro'],
    ['이동', live.phase === 'moving'],
    ['정답', live.phase === 'reveal'],
    [live.phase === 'checkpoint' ? (live.checkpoint?.kind === 'retry' ? '다시 도전' : '관문') : '다음', live.phase === 'checkpoint'],
  ];
  const counts = live.phase === 'reveal' ? live.reveal?.zoneCounts ?? [] : live.counts ?? [];
  const maxCount = Math.max(1, ...counts, live.participants);
  const text = q?.mode === 'CUSTOM_TEXT';
  // On a short laptop window the preview shrinks so the whole console fits above the bottom bar
  // (424px = the bars, paddings and the rows under the preview; one more line when the explanation shows).
  const previewMax = `max(320px, calc((100vh - ${showAnswer && q?.explanation ? 456 : 424}px) * 2))`;
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex h-[76px] items-center justify-between gap-5 whitespace-nowrap bg-ink px-7 text-white">
        <div className="flex items-center gap-6">
          <div className="text-sm font-bold text-[#A3A8B4]">{live.className}</div>
          <div className="tabular text-[22px] font-extrabold">{live.index + 1 > 0 ? live.index + 1 : '-'}<span className="text-ink-3"> / {total}</span></div>
          {live.round === 'retry' && <span className="rounded-full bg-gold px-3 py-1 text-sm font-bold text-ink">다시 도전</span>}
          <div className="flex gap-1.5">
            {steps.map(([label, on]) => <span key={label} className={`rounded-full px-3.5 py-2 text-sm font-semibold ${on ? 'bg-accent text-ink' : 'text-ink-3'}`}>{label}</span>)}
          </div>
          {live.phase === 'moving' && <div className="tabular text-[26px] font-extrabold text-[#FF8A5C]">{formatClock(ms)}</div>}
          {live.paused && <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-ink">멈춤</span>}
        </div>
        <div className="flex gap-2">
          <MusicSwitch dark on={live.music} onToggle={() => control('music')} />
          <button type="button" onClick={() => control('blank')} className={`h-10 rounded-xl border border-[#3D4354] px-4 text-sm font-semibold ${live.blank ? 'bg-white text-ink' : ''}`}>잠시 멈춤 B</button>
          <button
            type="button"
            onClick={() => {
              // Hold the quiz while the dialog is open, so the count it shows is what gets saved.
              const wasPaused = !!live.paused;
              if (!wasPaused) control('pause');
              const short = live.round === 'main' && live.mainDone < Math.ceil(live.mainPlanned / 2);
              const message = `지금까지 푼 ${live.mainDone}문제로 결과를 저장하고 끝낼까요?${short ? `\n절반(${Math.ceil(live.mainPlanned / 2)}문제)이 안 돼서 오늘은 보상 판정이 없어요.` : ''}`;
              if (confirm(message)) control('end');
              else if (!wasPaused) control('resume');
            }}
            className="h-10 rounded-xl border border-[#3D4354] px-4 text-sm font-semibold"
          >
            종료
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-5 p-6">
        <div className="flex min-w-0 flex-[1.35] flex-col gap-4">
          <Card className="flex flex-col gap-3 !p-4">
            <div className="flex items-center justify-between text-sm font-semibold text-ink-3">
              <span>프로젝터</span>
              <span className="text-xl font-extrabold text-ink">{q?.prompt}</span>
              <span>{live.phase === 'moving' && !text ? '안개' : live.phase === 'reveal' ? '공개' : ''}</span>
            </div>
            <div className="mx-auto aspect-[16/8] w-full" style={{ maxWidth: previewMax }}>
              {q && !text ? (
                <Field compact options={q.options.map((o) => o.label)} fog={live.phase !== 'reveal'} reveal={live.phase === 'reveal' ? live.reveal : null} avatars={live.phase === 'reveal' ? live.reveal?.avatars : undefined} />              ) : (
                <div className="flex h-full items-center justify-center rounded-xl bg-bg text-ink-3">{q ? '쓰기 문제 (폰에 입력)' : live.phase === 'checkpoint' ? '쉬는 화면' : ''}</div>
              )}
            </div>
          </Card>
          {q && (
            <Card className="flex flex-col gap-3 !p-5">
              <div className="flex flex-wrap items-center gap-3">
                {showAnswer ? (
                  <span className="rounded-full bg-good-soft px-3 py-1 text-sm font-bold text-good">정답 {q.mode === 'CUSTOM_TEXT' ? q.answers?.join(' | ') : `${q.answerIndex + 1} ${q.options[q.answerIndex]?.label}`}</span>
                ) : (
                  <button type="button" onClick={setShowAnswer} className="rounded-full bg-bg px-3 py-1 text-sm font-bold text-ink-2">정답 보기</button>
                )}
                <span className="text-sm text-ink-3">선생님만 보임</span>
              </div>
              {showAnswer && q.explanation && <div className="text-sm text-ink-2">{q.explanation}</div>}
            </Card>
          )}
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold"><input type="checkbox" checked={live.autoAdvance} onChange={(e) => { control('auto'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />자동 진행</label>
            <label className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold"><input type="checkbox" checked={live.nameLabels} onChange={(e) => { control('names'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />이름표</label>
            <label className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold"><input type="checkbox" checked={live.sound} onChange={(e) => { control('sound'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />효과음</label>
          </div>
        </div>

        <Card className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex items-end justify-between">
            <div className="text-[15px] font-semibold text-ink-3">{live.phase === 'reveal' ? '결과' : text ? '제출' : '자리 잡음'}</div>
            <div className="tabular text-5xl font-extrabold leading-none tracking-tight">
              {live.phase === 'reveal' ? `${Math.round((live.reveal?.accuracy ?? 0) * 100)}%` : <>{live.settled}<span className="text-2xl text-[#A3A8B4]">/{live.participants}</span></>}
            </div>
          </div>
          {q && !text && (
            <div className="flex flex-col gap-3">
              {q.options.map((o, i) => (
                <div key={i} className={`zone-${i} flex items-center gap-3`}>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white ${showAnswer && i === q.answerIndex ? 'bg-good' : ''}`}
                    style={showAnswer && i === q.answerIndex ? undefined : { background: 'var(--zone)' }}
                  >
                    {showAnswer && i === q.answerIndex ? '✓' : i + 1}
                  </div>
                  <div className="w-24 shrink-0 truncate text-sm font-semibold" title={o.label}>{q.grammar?.short?.[i] ?? o.label}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-bg">
                    <div className="cls-bar h-6 rounded-r" style={{ width: `${((counts[i] ?? 0) / maxCount) * 100}%`, background: showAnswer && i === q.answerIndex ? '#0E9F6E' : 'var(--zone)' }} />
                  </div>
                  <div className="tabular w-8 text-right text-lg font-extrabold">{counts[i] ?? 0}</div>
                </div>
              ))}
            </div>
          )}
          {/* Takes only the height left beside the preview and scrolls, so a long list never pushes the card down. */}
          {live.phase === 'moving' && live.unsettled.length > 0 && (
            <div className="flex min-h-12 flex-[1_1_0px] flex-wrap content-start items-center gap-1.5 overflow-y-auto">
              <span className="mr-1 text-[13px] font-semibold text-ink-3">{text ? '아직 제출 안 함' : '가운데 남음'}</span>
              {live.unsettled.map((u) => <span key={u.number} className="rounded-full bg-bg px-2.5 py-1 text-[13px] font-semibold">{u.number} {u.name}</span>)}
            </div>
          )}
          {live.phase === 'reveal' && live.reveal?.topWrong && <div className="rounded-xl bg-bad-soft px-4 py-3 text-sm"><b>많이 고른 오답</b> {live.reveal.topWrong.label}{live.reveal.topWrong.feedback ? ` · ${live.reveal.topWrong.feedback}` : ''}</div>}
          <div className="mt-auto grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-bg px-4 py-3"><div className="text-[13px] font-bold text-ink-2">지금까지 정답률</div><div className="tabular text-3xl font-extrabold">{live.accuracySoFar === null ? '-' : `${Math.round(live.accuracySoFar * 100)}%`}</div></div>
            <div className="rounded-xl bg-bg px-4 py-3"><div className="text-[13px] font-bold text-ink-2">남은 시간</div><div className="tabular text-3xl font-extrabold">약 {Math.max(1, Math.round(live.remainingSec / 60))}분</div></div>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 flex h-[88px] items-center justify-between border-t border-line bg-white px-7">
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={() => control(live.paused ? 'resume' : 'pause')}>{live.paused ? '다시 시작' : '멈춤'} <span className="text-xs text-ink-3">Space</span></Btn>
          <Btn kind="ghost" disabled={live.phase !== 'moving'} onClick={() => control('add-time')}>+5초 <span className="text-xs text-ink-3">↑</span></Btn>
          <Btn kind="ghost" onClick={() => control('skip')}>건너뛰기 <span className="text-xs text-ink-3">S</span></Btn>
          {/* The rest of this type at once: words → 문법 고르기 → 쓰기 → 고치기 → 배열. */}
          {live.round === 'main' && live.section && live.section.left > 0 && (
            <Btn kind="ghost" onClick={skipSection} title={`남은 ${live.section.label} ${live.section.left}문제 건너뛰기 (Shift+S)`}>
              <span className="flex flex-col items-start leading-tight">
                <span>{live.section.next ? `${toward(live.section.next)} →` : '마무리로 →'} <span className="text-xs text-ink-3">⇧S</span></span>
                <span className="text-xs font-semibold text-ink-3">남은 {live.section.label} {live.section.left}개 건너뛰기</span>
              </span>
            </Btn>
          )}
          {live.round === 'retry' && <Btn kind="ghost" onClick={() => control('skip-retry')}>다시 도전 건너뛰기</Btn>}
        </div>
        {/* Separate keys: a fresh button each time, so a double click can't carry over to the other action. */}
        {live.phase === 'moving' ? (
          <Btn key="close-now" onClick={() => control('close-now')} className="h-14 px-8 text-lg">지금 정답 공개 <span className="ml-2 rounded bg-[#3D4354] px-2 py-0.5 text-xs">Enter</span></Btn>
        ) : (
          <Btn key="next" onClick={() => control('next')} disabled={live.phase !== 'reveal' && live.phase !== 'checkpoint'} className="h-14 px-8 text-lg">다음 <span className="ml-2 rounded bg-[#3D4354] px-2 py-0.5 text-xs">→</span></Btn>
        )}
      </div>
    </div>
  );
}

function Lobby({ view, live, act, control }: { view: TeacherView; live: TeacherLive; act: Send; control: (a: string) => void }) {
  const mine = view.students.filter((s) => s.classId === live.classId);
  const joined = mine.filter((s) => s.joined);
  const notJoined = mine.filter((s) => !s.joined);
  return (
    <div className="flex flex-col gap-5 p-8">
      {/* Top-aligned, so 퀴즈 시작 stays above the floating 기기 등록 요청 card (top-24). */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-ink-3">대기실</div>
          <h1 className="break-keep text-2xl font-bold">{live.className} · {live.eventName} · {live.mainCount}문항</h1>
          {/* Under the title, so the buttons on the right keep 퀴즈 시작 on their first row. */}
          <div className="mt-3 flex">
            <MusicSwitch on={live.music} onToggle={() => control('music')} />
          </div>
        </div>
        {/* With 놀이 방법 the buttons can outgrow a laptop screen; they wrap rather than squeeze the title. */}
        <div className="flex flex-wrap justify-end gap-2">
          {/* Names show under the characters on the projector, in the lobby and at each reveal. */}
          <label className="flex h-11 items-center gap-2 rounded-xl border border-[#D5D8DF] bg-white px-3.5 text-[15px] font-bold"><input type="checkbox" checked={live.nameLabels} onChange={(e) => { control('names'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />이름표</label>
          <label className="flex h-11 items-center gap-2 rounded-xl border border-[#D5D8DF] bg-white px-3.5 text-[15px] font-bold"><input type="checkbox" checked={live.sound} onChange={(e) => { control('sound'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />효과음</label>
          <ProjectorLink className="flex h-11 items-center rounded-xl border border-[#D5D8DF] bg-white px-4 text-[15px] font-bold">프로젝터 화면 열기</ProjectorLink>
          {/* A 12-second demo on the projector; pressed again it starts over. */}
          <Btn kind="ghost" onClick={() => control('howto')} className={live.howto ? '!border-ink !bg-ink !text-white' : ''}>
            {live.howto && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" />}
            놀이 방법
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: 'close-session' })}>대기실 닫기</Btn>
          <Btn kind="accent" onClick={() => control('start')} className="px-6">퀴즈 시작</Btn>
        </div>
      </div>
      <div className="flex gap-5">
        {/* The right column is where the floating 등록 요청 card sits, so the controls stay on the left. */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {live.plan && (
            // 오늘 낼 문제: a type left out here isn't asked today, and doesn't count toward the reward bar.
            <Card className="flex flex-wrap items-center gap-2.5 !py-4">
              <h2 className="mr-2 text-lg font-bold">오늘 낼 문제</h2>
              {live.plan.sections.map((s, _, all) => {
                // One type has to stay in.
                const last = s.on && all.filter((x) => x.on).length === 1;
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={s.on}
                    aria-disabled={last}
                    title={last ? '하나는 남아야 해요' : undefined}
                    onClick={(e) => {
                      if (!last) control(`section:${s.key}`);
                      e.currentTarget.blur();
                    }}
                    className={`flex h-10 items-center gap-1.5 rounded-full border px-4 text-[15px] font-bold transition-colors ${s.on ? 'border-ink bg-ink text-white' : 'border-[#D5D8DF] bg-white text-ink-3'} ${last ? 'cursor-not-allowed' : ''}`}
                  >
                    <span aria-hidden>{s.on ? '✓' : '+'}</span>
                    {s.label} <span className="tabular">{s.count}</span>
                  </button>
                );
              })}
              <span className="ml-1 text-sm font-semibold text-ink-3">약 {Math.max(1, Math.round(live.plan.estimateSec / 60))}분</span>
              <label className="ml-auto flex items-center gap-2 text-[15px] font-bold">
                <input type="checkbox" checked={live.plan.breaks} onChange={(e) => { control('breaks'); e.currentTarget.blur(); }} className="h-4 w-4 accent-ink" />
                10문제마다 쉬기
              </label>
            </Card>
          )}
          <Card className="flex-1">
            <div className="mb-4 flex items-baseline justify-between"><h2 className="text-lg font-bold">들어온 학생</h2><span className="tabular text-2xl font-extrabold">{joined.length}</span></div>
            <div className="flex flex-wrap gap-2">
              {joined.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-xl bg-bg py-1.5 pl-1.5 pr-3">
                  <IdleAvatar look={normalizeLook(s.look ?? undefined)} size={28} seed={s.id} />
                  <span className="text-sm font-semibold">{s.number} {s.name}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card className="w-80 shrink-0">
          <h2 className="mb-3 text-lg font-bold">아직 안 들어옴</h2>
          <div className="flex flex-wrap gap-1.5">{notJoined.map((s) => <span key={s.id} className="rounded-full bg-bg px-2.5 py-1 text-sm font-semibold">{s.number} {s.name}{!s.hasDevice ? ' ·미등록' : ''}</span>)}</div>
          <p className="mt-4 text-xs leading-relaxed text-ink-3">처음 온 학생은 QR을 찍고 반·번호·이름을 쓰면 오른쪽 위에 등록 요청이 떠요. 지금은 {live.className} 학생만 들어올 수 있어요.</p>
        </Card>
      </div>
    </div>
  );
}

// ---------- students ----------

function Students({ view, act, onWrite }: { view: TeacherView; act: Send; onWrite: () => void }) {
  const [classId, setClassId] = useClassChoice(view.classes);
  const [text, setText] = useState('');
  const [newClass, setNewClass] = useState('');
  const current = view.classes.find((c) => c.id === classId);
  const students = view.students.filter((s) => s.classId === classId);
  // Checked students of this class only; switching classes or deleting simply drops the rest.
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const picked = students.filter((s) => checked.has(s.id));
  const allPicked = students.length > 0 && picked.length === students.length;
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const removePicked = () => {
    if (!confirm(`${current?.name} 학생 ${picked.length}명을 명단에서 지울까요?\n폰 연결, 캐릭터, 오답 노트, 출석 발자국도 함께 지워지고 되돌릴 수 없어요.`)) return;
    act({ type: 'remove-students', studentIds: picked.map((s) => s.id) })
      .then(() => setChecked(new Set()))
      .catch(() => undefined);
  };
  const addClass = () =>
    act({ type: 'add-class', name: newClass })
      .then((res) => {
        setNewClass('');
        const id = (res as { classId?: string }).classId;
        if (id) setClassId(id);
      })
      .catch(() => undefined);
  return (
    <div className="flex flex-col gap-5 p-8">
      {/* Same height as the 이벤트 and 통계 header rows (their buttons are 44 px), so titles line up across tabs. */}
      <div className="flex min-h-11 items-center">
        <h1 className="text-2xl font-bold">반 관리</h1>
      </div>
      {/* The first screen on a new laptop, so the setup card shows here too (its first step is this page). */}
      <SetupGuide view={view} onWrite={onWrite} />
      <ClassTabs
        classes={view.classes}
        value={classId}
        onChange={setClassId}
        extra={
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (newClass.trim()) addClass();
            }}
          >
            <input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="새 반 이름 (예: 2-3반)" aria-label="새 반 이름" className="h-10 w-44 rounded-xl bg-white px-3 text-sm outline-none" />
            <Btn kind="ghost" disabled={!newClass.trim()} className="!h-10 text-sm" onClick={() => { if (newClass.trim()) addClass(); }}>반 추가</Btn>
          </form>
        }
      />
      {!current ? (
        <Card className="text-ink-3">반을 먼저 만들어 주세요. 반마다 명단을 따로 넣고, 대기실을 열 때 오늘 수업할 반을 골라요.</Card>
      ) : (
        <div className="flex gap-5">
          <Card className="min-w-0 flex-1 !p-2">
            {picked.length > 0 && (
              <div className="mb-1 flex items-center justify-between rounded-xl bg-bad-soft px-4 py-2.5">
                <span className="text-sm font-bold">{picked.length}명 선택</span>
                <span className="flex gap-2">
                  <Btn kind="ghost" className="!h-9 text-sm" onClick={() => setChecked(new Set())}>선택 해제</Btn>
                  <Btn className="!h-9 !bg-bad text-sm" onClick={removePicked}>선택한 학생 지우기</Btn>
                </span>
              </div>
            )}
            <table className="w-full text-left text-[15px]">
              <thead className="text-xs font-bold text-ink-3">
                <tr>
                  <th className="w-10 pl-4">
                    <input
                      type="checkbox"
                      aria-label="이 반 학생 모두 선택"
                      checked={allPicked}
                      disabled={students.length === 0}
                      onChange={() => setChecked(allPicked ? new Set() : new Set(students.map((s) => s.id)))}
                      className="h-4 w-4 accent-ink"
                    />
                  </th>
                  <th className="px-2 py-3">번호</th><th>이름</th><th>캐릭터</th><th>기기</th><th>출석</th><th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className={`border-t border-[#EEF0F3] ${checked.has(s.id) ? 'bg-bad-soft/50' : ''}`}>
                    <td className="pl-4">
                      <input type="checkbox" aria-label={`${s.number} ${s.name} 선택`} checked={checked.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-ink" />
                    </td>
                    <td className="tabular px-2 py-2.5 text-ink-3">{s.number}</td>
                    <td className="font-semibold">{s.name}</td>
                    <td>{s.look ? <IdleAvatar look={normalizeLook(s.look)} size={28} seed={s.id} /> : <span className="text-xs text-ink-3">-</span>}</td>
                    <td className="text-sm">{s.hasDevice ? <span className={s.connected ? 'font-semibold text-good' : 'text-ink-2'}>{s.connected ? '접속 중' : '등록됨'}</span> : <span className="text-ink-3">미등록</span>}</td>
                    <td className="tabular text-sm">{s.stamps}</td>
                    <td className="pr-3 text-right">
                      {s.hasDevice && <button type="button" className="text-sm font-semibold text-ink-2 underline" onClick={() => { if (confirm(`${s.name}의 기기 연결을 해제할까요? 다시 등록하면 기록은 그대로예요.`)) act({ type: 'revoke', studentId: s.id }); }}>연결 해제</button>}
                      <button type="button" className="ml-3 text-sm font-semibold text-bad underline" onClick={() => { if (confirm(`${s.name}을 명단에서 지울까요?`)) act({ type: 'remove-student', studentId: s.id }); }}>삭제</button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-3">{current.name} 학생이 아직 없어요. 학생이 처음 접속해 등록하면 여기에 생겨요. 명단을 미리 넣어 둘 수도 있어요.</td></tr>}
              </tbody>
            </table>
          </Card>
          <div className="flex w-80 shrink-0 flex-col gap-4">
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">{current.name} 명단 추가</h2>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={'1 강하람\n2 김도윤'} className="rounded-xl bg-bg p-3 text-sm outline-none" />
              <p className="text-xs text-ink-3">넣지 않아도 돼요. 학생이 처음 접속해 반·번호·이름을 쓰면 승인할 때 명단에 들어가요. 미리 넣어 두면 학생이 쓴 이름과 맞춰 보여 줘서 승인이 쉬워요. 한 줄에 ‘번호 이름’, 같은 번호는 이름을 바꿔요.</p>
              <Btn disabled={!text.trim()} onClick={() => act({ type: 'roster', classId, text }).then(() => setText('')).catch(() => undefined)}>저장</Btn>
            </Card>
            <Card className="flex flex-col gap-2">
              <h2 className="font-bold">반 관리</h2>
              <Btn kind="ghost" className="text-sm" onClick={() => { const name = prompt('새 반 이름', current.name); if (name && name.trim() !== current.name) act({ type: 'rename-class', classId, name }).catch(() => undefined); }}>이름 바꾸기</Btn>
              <Btn
                kind="ghost"
                className="text-sm"
                disabled={current.devices === 0}
                onClick={() => { if (confirm(`${current.name} 학생 ${current.devices}명의 기기 연결을 모두 해제할까요? 다음에 다시 등록해야 하고, 기록과 캐릭터는 그대로예요.`)) act({ type: 'revoke-class', classId }).catch(() => undefined); }}
              >
                이 반 기기 모두 해제
              </Btn>
              <Btn
                kind="ghost"
                className="text-sm !text-bad"
                onClick={() => {
                  const message = current.students
                    ? `${current.name}과 학생 ${current.students}명을 모두 지울까요?\n폰 연결, 캐릭터, 오답 노트, 출석 발자국도 함께 지워지고 되돌릴 수 없어요.`
                    : `${current.name}을 지울까요?`;
                  if (confirm(message)) act({ type: 'delete-class', classId, withStudents: current.students > 0 }).catch(() => undefined);
                }}
              >
                반 지우기
              </Btn>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 아고라 ----------

type TopicDraft = { text: string; note: string; columns: number; sort: TopicSort; minutes: number | null };
const NEW_TOPIC: TopicDraft = { text: '', note: '', columns: 2, sort: 'number', minutes: DEFAULT_MINUTES };
const TOPIC_STATUS: Record<TeacherTopic['status'], string> = { draft: '대기', open: '진행 중', closed: '마감' };

/** A topic's status; on the selected (dark) row the colours turn over. */
function TopicChip({ status, dark = false }: { status: TeacherTopic['status']; dark?: boolean }) {
  const tone = status === 'open' ? 'bg-accent text-ink' : status === 'closed' ? (dark ? 'bg-white text-ink' : 'bg-ink text-white') : dark ? 'bg-[#24272F] text-[#A3A8B4]' : 'bg-bg text-ink-2';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{TOPIC_STATUS[status]}</span>;
}

/** The 아고라 tab: each class's topics, made before class, in the order the teacher wants them. */
function Agora({ view, act, notify, serverNow }: { view: TeacherView; act: Send; notify: (message: string) => void; serverNow: () => number }) {
  const [classId, setClassId] = useClassChoice(view.classes);
  const current = view.classes.find((c) => c.id === classId);
  const topics = view.agora.topics.filter((t) => t.classId === classId);
  const others = view.classes.filter((c) => c.id !== classId);
  const [selected, setSelected] = useState<string | null>(null);
  const topic = topics.find((t) => t.id === selected) ?? topics[0] ?? null;
  const screen = view.agora.screen;
  const live = !!topic && screen?.topicId === topic.id;
  // The 입력 시간 left, while the topic on screen is open and has a limit.
  const timer = live && topic?.status === 'open' ? (screen?.timer ?? null) : null;
  useTicker(!!timer, 500);
  const left = timer ? Math.max(0, timer.endsAt - serverNow()) : 0;
  // The form, for a new topic (topicId null) or the one being changed.
  const [form, setForm] = useState<{ topicId: string | null; draft: TopicDraft } | null>(null);
  // The other classes picked for [다른 반에 복사], while that box is open.
  const [copyTo, setCopyTo] = useState<Set<string> | null>(null);
  const pick = (id: string | null) => {
    setSelected(id);
    setForm(null);
    setCopyTo(null);
  };
  const move = (id: string, by: number) => {
    const ids = topics.map((t) => t.id);
    const i = ids.indexOf(id);
    if (i < 0 || i + by < 0 || i + by >= ids.length) return;
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    act({ type: 'agora-order', classId, topicIds: ids }).catch(() => undefined);
  };
  const save = () => {
    if (!form) return;
    const sent = form.topicId ? act({ type: 'agora-edit', topicId: form.topicId, ...form.draft }) : act({ type: 'agora-add', classId, ...form.draft });
    sent
      .then((res) => {
        const id = (res as { topicId?: string }).topicId;
        if (id) setSelected(id);
        setForm(null);
      })
      .catch(() => undefined);
  };
  const remove = (t: TeacherTopic) => {
    const answers = t.answers.length ? `\n학생 답 ${t.answers.length}개도 함께 지워지고 되돌릴 수 없어요.` : '';
    const up = screen?.topicId === t.id ? '\n화면에 떠 있는 주제라 화면에서도 내려가요.' : '';
    if (confirm(`이 주제를 지울까요?${answers}${up}`)) act({ type: 'agora-delete', topicId: t.id }).catch(() => undefined);
  };
  // [수업에 띄우기] opens the projector window too, as [대기실 열기] does (only from a click, before any await).
  const show = (t: TeacherTopic) => {
    if (!view.displayOn) openProjector();
    act({ type: 'agora-show', topicId: t.id }).catch(() => undefined);
  };
  const copy = (t: TeacherTopic, to: Set<string>) =>
    act({ type: 'agora-copy', topicId: t.id, classIds: [...to] })
      .then((res) => {
        notify(`${(res as { copied?: number }).copied ?? 0}개 반에 대기 상태로 복사했어요`);
        setCopyTo(null);
      })
      .catch(() => undefined);

  if (view.classes.length === 0) return <div className="p-8 text-ink-3">반 관리에서 반을 먼저 만들어 주세요.</div>;
  return (
    <div className="flex flex-col gap-5 p-8">
      {/* Same height as the other tabs' header rows, so titles line up across tabs. */}
      <div className="flex min-h-11 items-center justify-between">
        <h1 className="text-2xl font-bold">아고라</h1>
        <Btn
          onClick={() => {
            setCopyTo(null);
            setForm({ topicId: null, draft: NEW_TOPIC });
          }}
        >
          새 주제
        </Btn>
      </div>
      {/* Each class with how many topics it has here, rather than its students. */}
      <ClassTabs
        classes={view.classes.map((c) => ({ id: c.id, name: c.name, students: view.agora.topics.filter((t) => t.classId === c.id).length }))}
        value={classId}
        onChange={(id) => {
          setClassId(id);
          pick(null);
        }}
      />
      {topics.length === 0 && !form ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-xl font-bold">{current?.name} 주제가 아직 없어요</div>
          <div className="text-ink-3">수업 전에 [새 주제]로 만들어 두면, 수업 중에 눌러서 프로젝터와 학생 화면에 띄울 수 있어요.</div>
        </Card>
      ) : (
        // Side by side on a laptop; on a narrower window the list goes on top, so the answers keep a readable width.
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          {topics.length > 0 && (
            <div className="flex flex-col gap-2 xl:w-80 xl:shrink-0">
              {topics.map((t, i) => {
                const on = form ? form.topicId === t.id : topic?.id === t.id;
                // The topic on screen is ringed in the accent colour, as in the plan.
                return (
                  <div key={t.id} className={`flex items-stretch rounded-2xl ${on ? 'bg-ink text-white' : 'bg-white'} ${screen?.topicId === t.id ? 'ring-[3px] ring-accent' : ''}`}>
                    <button type="button" onClick={() => pick(t.id)} className="min-w-0 flex-1 p-4 text-left">
                      <div className="flex items-center gap-2">
                        <TopicChip status={t.status} dark={on} />
                        {t.status !== 'draft' && <span className={`tabular text-xs font-bold ${on ? 'text-[#A3A8B4]' : 'text-ink-3'}`}>답 {t.answers.length}</span>}
                      </div>
                      <div className="mt-1.5 line-clamp-2 break-keep font-bold [overflow-wrap:anywhere]">{t.text}</div>
                    </button>
                    <div className="flex flex-col justify-center gap-0.5 pr-2">
                      {([['위로', -1, '▲'], ['아래로', 1, '▼']] as const).map(([label, by, mark]) => (
                        <button
                          key={label}
                          type="button"
                          aria-label={`${label} 옮기기`}
                          title={`${label} 옮기기`}
                          disabled={by < 0 ? i === 0 : i === topics.length - 1}
                          onClick={() => move(t.id, by)}
                          className={`h-8 w-8 rounded-lg text-xs disabled:opacity-20 ${on ? 'text-[#A3A8B4] hover:bg-[#24272F]' : 'text-ink-3 hover:bg-bg'}`}
                        >
                          {mark}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {form ? (
              <TopicForm key={form.topicId ?? 'new'} draft={form.draft} setDraft={(draft) => setForm({ ...form, draft })} isNew={!form.topicId} className={current?.name ?? ''} onSave={save} onCancel={() => setForm(null)} />
            ) : (
              topic && (
                <Card className="flex flex-col gap-5">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-ink-3">
                      <TopicChip status={topic.status} />
                      {dayOf(topic.createdAt)} 만듦
                      {live && <span className="font-bold text-accent">· 화면에 떠 있어요</span>}
                    </div>
                    <h2 className="mt-3 whitespace-pre-wrap break-keep text-2xl font-bold leading-snug [overflow-wrap:anywhere]">{topic.text}</h2>
                    {topic.note && <p className="mt-2 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{topic.note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm font-semibold text-ink-2">
                    <span className="rounded-full bg-bg px-3 py-1">{topic.minutes ? `입력 시간 ${topic.minutes}분` : '시간 제한 없음'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {live && topic.status === 'open' ? (
                      <Btn onClick={() => act({ type: 'agora-close' }).catch(() => undefined)}>마감</Btn>
                    ) : (
                      <Btn kind="accent" disabled={!!view.live} title={view.live ? '아레나를 닫은 뒤 띄울 수 있어요' : undefined} onClick={() => show(topic)}>
                        {topic.status === 'closed' ? '다시 열기' : '수업에 띄우기'}
                      </Btn>
                    )}
                    {live && (
                      <Btn kind="ghost" onClick={() => act({ type: 'agora-down' }).catch(() => undefined)}>
                        화면에서 내리기
                      </Btn>
                    )}
                  </div>
                  {live && topic.status === 'open' && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg px-4 py-3">
                      <span className="text-sm font-bold text-ink-2">남은 입력 시간</span>
                      {timer ? (
                        <>
                          <span className={`tabular text-3xl font-extrabold ${left <= 60_000 ? 'text-accent' : ''}`}>{formatClock(left)}</span>
                          <span className="ml-auto flex gap-2">
                            <Btn kind="ghost" className="!h-9 !px-3 text-sm" onClick={() => act({ type: 'agora-time', minutes: -1 }).catch(() => undefined)}>
                              −1분
                            </Btn>
                            <Btn kind="ghost" className="!h-9 !px-3 text-sm" onClick={() => act({ type: 'agora-time', minutes: 1 }).catch(() => undefined)}>
                              +1분
                            </Btn>
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-ink-3">시간 제한 없음 · [마감]으로 닫아요</span>
                      )}
                    </div>
                  )}
                  {/* What the projector shows, switched in class too: answers, columns, order, its page and the song. */}
                  <div className="flex flex-col gap-3 rounded-xl border border-[#EEF0F3] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                      <Choices label="학생 답" value={topic.reveal} options={[['hidden', '전체 비공개'], ['public', '전체 공개']] as const} onPick={(v) => act({ type: 'agora-reveal', topicId: topic.id, public: v === 'public' }).catch(() => undefined)} />
                      <Choices label="열" value={topic.columns} options={COLUMN_CHOICES.map((n) => [n, String(n)] as const)} onPick={(n) => act({ type: 'agora-layout', topicId: topic.id, columns: n }).catch(() => undefined)} />
                      <Choices label="순서" value={topic.sort} options={[['number', '번호순'], ['time', '낸 순서']] as const} onPick={(v) => act({ type: 'agora-layout', topicId: topic.id, sort: v }).catch(() => undefined)} />
                    </div>
                    {live && screen && (
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        <div className="flex items-center gap-1.5">
                          <span className="mr-1 text-sm font-bold text-ink-2">프로젝터 페이지</span>
                          <button type="button" aria-label="이전 페이지" disabled={screen.page === 0} onClick={() => act({ type: 'agora-page', dir: -1 }).catch(() => undefined)} className="h-9 w-9 rounded-full border border-[#D5D8DF] bg-white text-sm font-bold disabled:opacity-30">
                            ◀
                          </button>
                          <span className="tabular w-14 text-center text-sm font-bold">
                            {screen.page + 1} / {screen.pages}
                          </span>
                          <button type="button" aria-label="다음 페이지" disabled={screen.page >= screen.pages - 1} onClick={() => act({ type: 'agora-page', dir: 1 }).catch(() => undefined)} className="h-9 w-9 rounded-full border border-[#D5D8DF] bg-white text-sm font-bold disabled:opacity-30">
                            ▶
                          </button>
                        </div>
                        <MusicSwitch on={screen.music} onToggle={() => act({ type: 'agora-music' }).catch(() => undefined)} title={AGORA_MUSIC_TITLE} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn kind="ghost" onClick={() => setForm({ topicId: topic.id, draft: { text: topic.text, note: topic.note, columns: topic.columns, sort: topic.sort, minutes: topic.minutes } })}>수정</Btn>
                    <Btn kind="ghost" disabled={others.length === 0} title={others.length === 0 ? '다른 반이 없어요' : undefined} onClick={() => setCopyTo(new Set())}>다른 반에 복사</Btn>
                    <Btn kind="ghost" className="!text-bad" onClick={() => remove(topic)}>지우기</Btn>
                  </div>
                  {copyTo && (
                    <div className="flex flex-col gap-3 rounded-xl bg-bg p-4">
                      <div className="text-sm font-bold">
                        어느 반에 복사할까요? <span className="font-semibold text-ink-3">대기 상태로, 학생 답은 빼고</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {others.map((c) => {
                          const on = copyTo.has(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                setCopyTo((prev) => {
                                  const next = new Set(prev ?? []);
                                  if (next.has(c.id)) next.delete(c.id);
                                  else next.add(c.id);
                                  return next;
                                })
                              }
                              className={`flex h-10 items-center gap-1.5 rounded-full border px-4 text-[15px] font-bold ${on ? 'border-ink bg-ink text-white' : 'border-[#D5D8DF] bg-white text-ink-3'}`}
                            >
                              <span aria-hidden>{on ? '✓' : '+'}</span>
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Btn disabled={copyTo.size === 0} onClick={() => copy(topic, copyTo)}>복사</Btn>
                        <Btn kind="ghost" onClick={() => setCopyTo(null)}>취소</Btn>
                      </div>
                    </div>
                  )}
                </Card>
              )
            )}
            {topic && !form && <TopicAnswers view={view} topic={topic} live={live} act={act} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** A labelled row of pill buttons with one pressed, in the look of the lobby's '오늘 낼 문제'. */
function Choices<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: readonly (readonly [T, string])[]; onPick: (next: T) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-sm font-bold text-ink-2">{label}</span>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => value !== v && onPick(v)}
          className={`h-9 min-w-9 rounded-full border px-3 text-sm font-bold ${value === v ? 'border-ink bg-ink text-white' : 'border-[#D5D8DF] bg-white text-ink-3'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Who has answered a topic and what: the teacher sees every answer, shown on the projector or not, and clicks one to
 * show or hide just that answer. While the topic is up, the students in its room who haven't answered are listed too.
 */
function TopicAnswers({ view, topic, live, act }: { view: TeacherView; topic: TeacherTopic; live: boolean; act: Send }) {
  if (topic.status === 'draft' && topic.answers.length === 0) return null;
  const byId = new Map(view.students.map((s) => [s.id, s]));
  const rows = topic.answers
    .map((a) => ({ a, s: byId.get(a.studentId) }))
    .filter((r): r is { a: TeacherTopic['answers'][number]; s: TeacherStudent } => !!r.s)
    .sort((x, y) => (topic.sort === 'time' ? x.a.createdAt - y.a.createdAt : 0) || x.s.number - y.s.number);
  const answered = new Set(topic.answers.map((a) => a.studentId));
  const waiting = live
    ? view.agora.present
        .map((id) => byId.get(id))
        .filter((s): s is TeacherStudent => !!s && !answered.has(s.id))
        .sort((a, b) => a.number - b.number)
    : [];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">
          낸 학생 <span className="ml-1 text-sm font-semibold text-ink-3">답을 누르면 그 답만 공개·비공개</span>
        </h2>
        <span className="tabular text-2xl font-extrabold">
          {rows.length}
          {live && <span className="text-base font-semibold text-ink-3"> / {rows.length + waiting.length}</span>}
        </span>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-col">
          {rows.map(({ a, s }) => {
            const shown = a.shown === null ? topic.reveal === 'public' : a.shown;
            return (
              <div key={s.id} className="flex items-start gap-1 border-t border-[#EEF0F3] py-1 first:border-t-0">
                <button
                  type="button"
                  aria-pressed={shown}
                  title={shown ? '눌러서 이 답만 비공개' : '눌러서 이 답만 공개'}
                  onClick={() => act({ type: 'agora-card', topicId: topic.id, studentId: s.id }).catch(() => undefined)}
                  className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl px-2 py-1.5 text-left hover:bg-bg"
                >
                  <span className="flex items-center gap-2">
                    <IdleAvatar look={normalizeLook(s.look ?? undefined)} size={28} seed={s.id} />
                    <span className="text-sm font-semibold">
                      <span className="tabular mr-1 text-ink-3">{s.number}</span>
                      {s.name}
                    </span>
                    {/* '따로': set for this answer alone, apart from 전체 공개·비공개. */}
                    <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${shown ? 'bg-good-soft text-good' : 'bg-bg text-ink-3'}`}>
                      {shown ? '공개' : '비공개'}
                      {a.shown !== null ? ' · 따로' : ''}
                    </span>
                  </span>
                  {/* Under the name, across the whole row. */}
                  <span className={`whitespace-pre-wrap pl-9 text-[15px] [overflow-wrap:anywhere] ${shown ? '' : 'text-ink-3'}`}>{a.text}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${s.number} ${s.name}의 답 지우기`}
                  onClick={() => {
                    if (confirm(`${s.number} ${s.name}의 답을 지울까요?`)) act({ type: 'agora-card-delete', topicId: topic.id, studentId: s.id }).catch(() => undefined);
                  }}
                  className="mt-1 h-8 shrink-0 rounded-lg px-2 text-xs font-semibold text-ink-3 hover:bg-bad-soft hover:text-bad"
                >
                  지우기
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-ink-3">아직 낸 학생이 없어요</div>
      )}
      {waiting.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[#EEF0F3] pt-3">
          <div className="text-sm font-bold text-ink-2">아직 안 냄 {waiting.length}</div>
          <div className="flex flex-wrap gap-1.5">
            {waiting.map((s) => (
              <span key={s.id} className="rounded-full bg-bg px-2.5 py-1 text-sm font-semibold">
                {s.number} {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Writing a topic: the question, an optional note under it, and how the projector lays out the answer cards. */
function TopicForm({ draft, setDraft, isNew, className, onSave, onCancel }: { draft: TopicDraft; setDraft: (next: TopicDraft) => void; isNew: boolean; className: string; onSave: () => void; onCancel: () => void }) {
  const choice = (on: boolean) => `flex h-10 min-w-10 items-center justify-center rounded-full border px-4 text-[15px] font-bold ${on ? 'border-ink bg-ink text-white' : 'border-[#D5D8DF] bg-white text-ink-3'}`;
  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg font-bold">{isNew ? `${className} 새 주제` : '주제 고치기'}</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">주제</span>
        <textarea
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          rows={3}
          maxLength={TOPIC_MAX}
          autoFocus
          placeholder="주말에 가족이 허락해 준 일을 let으로 한 문장 써 보세요"
          className="resize-none rounded-xl bg-bg p-3 text-lg font-bold outline-none"
        />
        <span className="tabular self-end text-xs text-ink-3">{[...draft.text].length} / {TOPIC_MAX}</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">
          보조 설명 · 예시 문장 <span className="font-semibold text-ink-3">선택 · 질문 아래에 나와요</span>
        </span>
        <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={2} maxLength={NOTE_MAX} placeholder="예) My mom let me play games after dinner." className="resize-none rounded-xl bg-bg p-3 text-[15px] outline-none" />
      </label>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="입력 시간">
        <span className="mr-1 text-sm font-bold">입력 시간</span>
        {[...MINUTE_CHOICES, null].map((m) => (
          <button key={m ?? 'none'} type="button" aria-pressed={draft.minutes === m} onClick={() => setDraft({ ...draft, minutes: m })} className={choice(draft.minutes === m)}>
            {m === null ? '제한 없음' : `${m}분`}
          </button>
        ))}
        <span className="ml-1 text-xs text-ink-3">띄우면 줄어들고, 0이 되면 저절로 마감돼요</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2" role="group" aria-label="프로젝터 열 수">
          <span className="mr-1 text-sm font-bold">프로젝터</span>
          {COLUMN_CHOICES.map((n) => (
            <button key={n} type="button" aria-pressed={draft.columns === n} onClick={() => setDraft({ ...draft, columns: n })} className={choice(draft.columns === n)}>
              {n}열
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="카드 순서">
          <span className="mr-1 text-sm font-bold">카드 순서</span>
          {([['number', '번호순'], ['time', '낸 순서']] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={draft.sort === v} onClick={() => setDraft({ ...draft, sort: v })} className={choice(draft.sort === v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Btn disabled={!draft.text.trim()} onClick={onSave}>
          {isNew ? '만들기' : '저장'}
        </Btn>
        <Btn kind="ghost" onClick={onCancel}>
          취소
        </Btn>
      </div>
    </Card>
  );
}

// ---------- stats ----------

interface StatsData {
  students: { id: string; classId: string; className: string; number: number; name: string; attendance: number; sessions: { sessionId: string; eventName: string; date: number; accuracy: number | null }[]; average: number | null; missed: { word: string; count: number }[]; fixed: string[]; rewards: number }[];
  words: { key: string; word: string; meaning: string; attempts: number; accuracy: number; topWrong: string | null }[];
}

interface QuizMistakes {
  sessionId: string;
  eventName: string;
  date: number;
  total: number;
  correct: number;
  wrong: { questionId: string; kind: string; text: string; mine: string; answer: string; fixedInRetry: boolean }[];
  gone: boolean;
}

/** One student's quizzes, the latest first: what they got wrong in the one picked, what they answered, and the answer. */
function StudentMistakes({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{ studentId: string; quizzes: QuizMistakes[] } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    fetch(`/api/stats?student=${encodeURIComponent(studentId)}`)
      .then((r) => r.json())
      .then((d: { quizzes: QuizMistakes[] }) => !stop && setData({ studentId, quizzes: d.quizzes }))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [studentId]);
  const quizzes = data && data.studentId === studentId ? data.quizzes : null;
  const quiz = quizzes?.find((x) => x.sessionId === picked) ?? quizzes?.[0];
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-bold">퀴즈별 틀린 문제</h2>
        {quiz && !quiz.gone && <span className="tabular text-sm text-ink-3">{quiz.total}문제 중 {quiz.correct}개 맞힘</span>}
      </div>
      {!quizzes ? (
        <div className="text-sm text-ink-3">불러오는 중…</div>
      ) : quizzes.length === 0 ? (
        <div className="text-sm text-ink-3">아직 푼 퀴즈가 없어요.</div>
      ) : (
        <>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {quizzes.map((x) => (
              <button key={x.sessionId} type="button" aria-pressed={x.sessionId === quiz?.sessionId} onClick={() => setPicked(x.sessionId)} className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm ${x.sessionId === quiz?.sessionId ? 'border-ink bg-ink font-bold text-white' : 'border-[#D5D8DF] bg-white font-semibold text-ink-2'}`}>
                {x.eventName} · {dayOf(x.date)}
              </button>
            ))}
          </div>
          {quiz?.gone ? (
            <div className="text-sm text-ink-3">이벤트를 지워서 문제를 볼 수 없어요.</div>
          ) : !quiz || quiz.wrong.length === 0 ? (
            <div className="text-sm text-ink-3">틀린 문제가 없어요.</div>
          ) : (
            <table className="w-full text-left text-[15px]">
              <thead className="text-xs font-bold text-ink-3"><tr><th className="py-2 pr-3">문제</th><th className="pr-3">학생 답</th><th>정답</th></tr></thead>
              <tbody>
                {quiz.wrong.map((w) => (
                  <tr key={w.questionId} className="border-t border-[#EEF0F3] align-top">
                    <td className="py-2 pr-3"><span className="mr-2 whitespace-nowrap rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-ink-2">{w.kind}</span><span className="break-keep">{w.text}</span></td>
                    <td className="py-2 pr-3 font-semibold text-bad">{w.mine}</td>
                    <td className="py-2 font-bold">{w.answer}{w.fixedInRetry && <span className="ml-1.5 whitespace-nowrap rounded-full bg-good-soft px-2 py-0.5 text-xs font-bold text-good">다시 도전에서 맞힘</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}

function Stats({ classes, title }: { classes: TeacherView['classes']; title: React.ReactNode }) {
  const [classId, setClassId] = useClassChoice(classes);
  const [data, setData] = useState<{ classId: string; stats: StatsData } | null>(null);
  const [mode, setMode] = useState<'students' | 'words'>('students');
  const [picked, setPicked] = useState<string | null>(null);
  // 학생별: by number, or the lowest average first (no quiz yet goes last).
  const [order, setOrder] = useState<'number' | 'missed'>('number');
  useEffect(() => {
    let stop = false;
    fetch(`/api/stats?class=${encodeURIComponent(classId)}`)
      .then((r) => r.json())
      .then((stats: StatsData) => !stop && setData({ classId, stats }))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [classId]);
  const stats = data && data.classId === classId ? data.stats : null;
  const students = useMemo(
    () => (!stats ? [] : order === 'number' ? stats.students : [...stats.students].sort((a, b) => (a.average ?? 2) - (b.average ?? 2) || b.missed.length - a.missed.length)),
    [stats, order],
  );
  const student = useMemo(() => students.find((s) => s.id === picked) ?? students[0], [students, picked]);
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
  // The title switches back to 이벤트, so it shows while there is nothing to show too.
  if (classes.length === 0 || !stats) {
    return (
      <div className="flex flex-col gap-5 p-8">
        <div className="flex min-h-11 items-center">{title}</div>
        <div className="text-ink-3">{classes.length === 0 ? '반 관리에서 반을 먼저 만들어 주세요.' : '불러오는 중…'}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {title}
          <div className="flex gap-1 rounded-xl bg-[#E9EBEF] p-1">
            {(['students', 'words'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`h-9 rounded-lg px-3.5 text-sm ${mode === m ? 'bg-white font-bold' : 'font-semibold text-ink-2'}`}>{m === 'students' ? '학생별' : '단어별'}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`/api/stats?format=csv&class=${encodeURIComponent(classId)}`} className="flex h-10 items-center rounded-xl border border-[#D5D8DF] bg-white px-4 text-sm font-semibold">이 반 엑셀로</a>
          <a href="/api/stats?format=csv" className="flex h-10 items-center rounded-xl border border-[#D5D8DF] bg-white px-4 text-sm font-semibold">전체 엑셀로</a>
        </div>
      </div>
      <ClassTabs classes={classes} value={classId} onChange={(id) => { setClassId(id); setPicked(null); }} />
      {mode === 'words' ? (
        <Card className="!p-2">
          <table className="w-full text-left text-[15px]">
            <thead className="text-xs font-bold text-ink-3"><tr><th className="px-4 py-3">단어</th><th>뜻</th><th>정답률</th><th>푼 횟수</th><th>많이 고른 오답</th></tr></thead>
            <tbody>
              {stats.words.map((w) => (
                <tr key={w.key} className="border-t border-[#EEF0F3]">
                  <td className="px-4 py-2.5 font-bold">{w.word}</td><td className="text-ink-2">{w.meaning}</td>
                  <td className={`tabular font-extrabold ${w.accuracy < 0.6 ? 'text-bad' : ''}`}>{pct(w.accuracy)}</td><td className="tabular">{w.attempts}</td><td className="text-ink-2">{w.topWrong ?? '-'}</td>
                </tr>
              ))}
              {stats.words.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-3">아직 기록이 없어요.</td></tr>}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="flex gap-5">
          <Card className="w-[560px] shrink-0 !p-2">
            <div className="flex justify-end px-2 pt-1">
              <div className="flex gap-1 rounded-lg bg-[#E9EBEF] p-0.5">
                {(['number', 'missed'] as const).map((o) => (
                  <button key={o} type="button" aria-pressed={order === o} onClick={() => setOrder(o)} title={o === 'missed' ? '평균 정답률이 낮은 학생부터' : undefined} className={`h-7 rounded-md px-2.5 text-xs ${order === o ? 'bg-white font-bold' : 'font-semibold text-ink-2'}`}>
                    {o === 'number' ? '번호 순' : '많이 틀린 순'}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-left text-[15px]">
              <thead className="text-xs font-bold text-ink-3"><tr><th className="px-4 py-3">학생</th><th>출석</th><th className="text-right">평균</th><th className="text-right">최근</th><th className="text-center">최근 5회</th><th className="pr-4 text-right">자주 틀림</th></tr></thead>
              <tbody>
                {students.map((s) => {
                  const recent = s.sessions.slice(-5);
                  const last = [...s.sessions].reverse().find((x) => x.accuracy !== null)?.accuracy ?? null;
                  return (
                    <tr key={s.id} onClick={() => setPicked(s.id)} className={`cursor-pointer border-t border-[#EEF0F3] ${student?.id === s.id ? 'bg-bg' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold"><span className="tabular mr-1.5 text-[#A3A8B4]">{s.number}</span>{s.name}</td>
                      <td className="tabular text-sm text-ink-2">{s.attendance}</td>
                      <td className={`tabular text-right font-extrabold ${s.average !== null && s.average < 0.6 ? 'text-bad' : ''}`}>{pct(s.average)}</td>
                      <td className="tabular text-right font-semibold text-ink-2">{pct(last)}</td>
                      <td><div className="flex h-6 items-end justify-center gap-[3px]">{recent.map((x) => <div key={x.sessionId} title={`${x.eventName} ${pct(x.accuracy)}`} className="w-2.5 rounded-t-[3px]" style={{ height: x.accuracy === null ? 3 : Math.max(3, x.accuracy * 24), background: x.accuracy === null ? '#E3E5EA' : '#101218' }} />)}</div></td>
                      <td className={`tabular pr-4 text-right text-sm font-bold ${s.missed.length >= 5 ? 'text-bad' : 'text-ink-2'}`}>{s.missed.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {student && (
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Card className="flex items-center gap-6">
                <div className="flex-1"><div className="text-2xl font-bold">{student.number} {student.name}</div></div>
                <div className="rounded-xl bg-bg px-4 py-2"><div className="text-xs font-bold text-ink-3">평균 정답률</div><div className="tabular text-2xl font-extrabold">{pct(student.average)}</div></div>
                <div className="rounded-xl bg-bg px-4 py-2"><div className="text-xs font-bold text-ink-3">출석</div><div className="tabular text-2xl font-extrabold">{student.attendance}</div></div>
                <div className="rounded-xl bg-bg px-4 py-2"><div className="text-xs font-bold text-ink-3">받은 보상</div><div className="tabular text-2xl font-extrabold">{student.rewards}</div></div>
              </Card>
              <Card>
                <h2 className="mb-3 font-bold">이벤트별 정답률</h2>
                <div className="flex h-44 items-end gap-4 border-b border-line">
                  {student.sessions.slice(-8).map((x) => (
                    <div key={x.sessionId} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${x.eventName} ${pct(x.accuracy)}`}>
                      <div className="tabular text-xs font-bold">{pct(x.accuracy)}</div>
                      <div className="w-full max-w-10 rounded-t" style={{ height: `${(x.accuracy ?? 0) * 140}px`, background: x.accuracy === null ? '#E3E5EA' : '#101218' }} />
                    </div>
                  ))}
                  {student.sessions.length === 0 && <div className="self-center text-ink-3">아직 기록이 없어요</div>}
                </div>
                <div className="mt-1.5 flex gap-4 text-center text-xs text-ink-3">{student.sessions.slice(-8).map((x) => <div key={x.sessionId} className="min-w-0 flex-1 truncate">{x.eventName}</div>)}</div>
              </Card>
              <StudentMistakes key={student.id} studentId={student.id} />
              <div className="grid grid-cols-2 gap-4">
                <Card><h2 className="mb-3 font-bold">자주 틀리는 단어</h2><div className="flex flex-wrap gap-2">{student.missed.map((m) => <span key={m.word} className="rounded-full bg-bad-soft px-3 py-1.5 text-sm font-bold">{m.word} <span className="text-bad">×{m.count}</span></span>)}{student.missed.length === 0 && <span className="text-sm text-ink-3">없음</span>}</div></Card>
                <Card><h2 className="mb-3 font-bold">이제 맞히는 단어</h2><div className="flex flex-wrap gap-2">{student.fixed.map((w) => <span key={w} className="rounded-full bg-good-soft px-3 py-1.5 text-sm font-bold text-good">{w}</span>)}{student.fixed.length === 0 && <span className="text-sm text-ink-3">없음</span>}</div></Card>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

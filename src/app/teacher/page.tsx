'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatClock, remainingMs, shortcutAction, useLive, useTicker } from '@/client/live';
import type { TeacherEvent, TeacherLive, TeacherView } from '@/client/views';
import { Field } from '@/components/Field';
import { PixelAvatar } from '@/components/PixelAvatar';
import { TeacherGate } from '@/components/TeacherGate';
import { DEFAULT_LOOK, normalizeLook } from '@/lib/avatar';
import { ATTENDANCE_UNLOCKS, ITEMS, THEMES, itemById, previewLook } from '@/lib/items';

type Send = (a: Record<string, unknown>) => Promise<unknown>;
type Tab = 'arena' | 'students' | 'stats';

export default function TeacherPage() {
  return (
    <TeacherGate>
      <TeacherApp />
    </TeacherGate>
  );
}

function TeacherApp() {
  const { view, conn, send, serverNow } = useLive<TeacherView>('teacher');
  const [tab, setTab] = useState<Tab>('arena');
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
        <nav aria-label="선생님 메뉴" className="flex w-52 shrink-0 flex-col gap-1 bg-ink px-3.5 py-7">
          <div className="px-3 pb-7 font-display text-[22px] font-bold tracking-tight text-white">Classeum</div>
          {([
            ['arena', '아레나'],
            ['students', '학생·기기'],
            ['stats', '통계'],
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
            </button>
          ))}
          <div className="mt-auto flex flex-col gap-2 px-1">
            <a href="/display" target="classeum-display" className="rounded-xl border border-[#3D4354] px-3 py-2.5 text-center text-sm font-semibold text-white">프로젝터 화면 열기</a>
            <div className="break-all px-2 text-[11px] leading-snug text-[#737887]">학생 주소 {view.joinUrl}</div>
          </div>
        </nav>
      )}
      <main className="min-w-0 flex-1">
        {conn === 'lost' && <div className="bg-bad py-1.5 text-center text-sm font-bold text-white">서버 연결이 끊겼어요 · 다시 연결 중</div>}
        {tab === 'arena' && (view.live ? <Console view={view} live={view.live} act={act} serverNow={serverNow} /> : <Events view={view} act={act} notify={notify} />)}
        {tab === 'students' && !running && <Students view={view} act={act} />}
        {tab === 'stats' && !running && <Stats classes={view.classes} />}
      </main>
      {/* During a quiz it floats over the console; otherwise it gets its own column so it covers no buttons. */}
      {view.requests.length > 0 &&
        (view.live ? (
          <Requests view={view} act={act} />
        ) : (
          <div className="w-80 shrink-0 pr-5 pt-6">
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

function Btn({ children, onClick, kind = 'dark', disabled, className = '', title }: { children: React.ReactNode; onClick?: () => void; kind?: 'dark' | 'ghost' | 'gold' | 'accent'; disabled?: boolean; className?: string; title?: string }) {
  const style = kind === 'dark' ? 'bg-ink text-white' : kind === 'gold' ? 'bg-gold text-ink' : kind === 'accent' ? 'bg-accent text-ink' : 'border border-[#D5D8DF] bg-white text-ink';
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`h-11 rounded-xl px-4 text-[15px] font-bold disabled:opacity-40 ${style} ${className}`}>
      {children}
    </button>
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
  const [open, setOpen] = useState(true);
  return (
    <aside
      className={`cls-slide-up rounded-[20px] bg-white shadow-[0_8px_30px_rgba(16,18,24,0.12)] ${inline ? 'sticky top-6' : 'fixed right-5 top-24 z-40'} ${open || inline ? 'w-80 p-5' : 'px-4 py-2.5'}`}
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
          {view.requests.length > 1 && (
            <Btn kind="ghost" className="mb-2 w-full text-sm" onClick={() => act({ type: 'approve-all' }).catch(() => undefined)} title="명단과 맞거나 새로 온 학생을 한 번에 승인해요. 기기 교체와 번호 겹침은 하나씩 확인하세요.">
              모두 승인 (교체·겹침 빼고)
            </Btn>
          )}
          <div className="flex max-h-[60vh] flex-col overflow-y-auto">
            {view.requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-t border-[#EEF0F3] py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    <span className="text-ink-3">{r.className}</span> {r.number} {r.name}
                  </div>
                  <div className={`text-[13px] ${REQUEST_KIND[r.kind].tone}`}>
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
  groups?: { name: string; wordCount: number; reviewCount: number; customCount: number; warnings: string[]; questions: { prompt: string; modeLabel: string; options: string[]; answerIndex: number; answers?: string[] }[] }[];
}

function Events({ view, act, notify }: { view: TeacherView; act: Send; notify: (message: string) => void }) {
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const event = view.events.find((e) => e.id === selected) ?? view.events[0] ?? null;

  const onFile = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    const res = (await fetch('/api/upload', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ ok: false, error: '업로드에 실패했어요.' }))) as UploadResult;
    setUpload(res);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">이벤트</h1>
        <div className="flex gap-2">
          <a href="/templates/classeum-vocab-week1.xlsx" className="flex h-11 items-center rounded-xl border border-[#D5D8DF] bg-white px-4 text-[15px] font-bold">템플릿 받기</a>
          <label className={`flex h-11 cursor-pointer items-center rounded-xl bg-ink px-4 text-[15px] font-bold text-white ${busy ? 'opacity-50' : ''}`}>
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

      {view.events.length === 0 && !upload && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-xl font-bold">아직 이벤트가 없어요</div>
          <div className="text-ink-3">단어장 엑셀을 올리면 문제가 자동으로 만들어져요.</div>
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
                  {e.count}문항 · 약 {Math.round(e.estimateSec / 60)}분{e.played ? ` · ${e.played}번 진행` : ''}
                </div>
              </button>
            ))}
          </div>
          {event && <EventDetail key={event.id} view={view} event={event} act={act} />}
        </div>
      )}

      {upload && <UploadPreview result={upload} onClose={() => setUpload(null)} onCreate={async () => {
        const res = (await act({ type: 'create-event', draftId: upload.draftId })) as { eventIds?: string[] };
        setUpload(null);
        if (res.eventIds?.[0]) setSelected(res.eventIds[0]);
        else notify('단어만 저장했어요 (만들 문제가 없어요)');
      }} />}
    </div>
  );
}

function EventDetail({ view, event, act }: { view: TeacherView; event: TeacherEvent; act: Send }) {
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
      <Card className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">{event.name}</div>
          <div className="text-ink-3">{event.count}문항 · 기본 15초 · 약 {Math.round(event.estimateSec / 60)}분</div>
        </div>
        <div className="flex items-center gap-2">
          <Btn kind="ghost" onClick={() => { if (confirm(`'${event.name}' 이벤트를 지울까요?`)) act({ type: 'delete-event', eventId: event.id }); }}>지우기</Btn>
          {view.classes.length === 0 ? (
            <span className="text-sm font-semibold text-ink-3">학생·기기에서 반을 먼저 만들어 주세요</span>
          ) : (
            <>
              <select aria-label="오늘 수업할 반" value={classId} onChange={(e) => setClassId(e.target.value)} className="h-11 rounded-xl border border-[#D5D8DF] bg-white px-3 text-[15px] font-bold">
                {view.classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Btn kind="accent" onClick={async () => { if (dirty) await saveReward(); await act({ type: 'open-lobby', eventId: event.id, classId }); window.open('/display', 'classeum-display'); }}>대기실 열기</Btn>
            </>
          )}
        </div>
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
            <div className="flex h-56 w-48 items-end justify-center rounded-t-full rounded-b-2xl bg-gold pb-4">{item && <PixelAvatar look={previewLook(item, DEFAULT_LOOK)} size={150} />}</div>
            <div className="text-lg font-bold">{item?.name}</div>
          </div>
          {/* Grouped by theme; attendance items are earned by coming, so they aren't offered here. */}
          <div className="flex max-h-[420px] flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {THEMES.map((th) => {
              const list = view.items.filter((it) => it.theme === th.id && !ATTENDANCE_UNLOCKS.includes(it.id));
              if (list.length === 0) return null;
              return (
                <div key={th.id}>
                  <div className="mb-1.5 text-xs font-bold text-ink-3">{th.name}</div>
                  <div className="grid grid-cols-5 gap-2">
                    {list.map((it) => (
                      <button key={it.id} type="button" aria-pressed={itemId === it.id} onClick={() => setItemId(it.id)} className={`flex flex-col items-center gap-1 rounded-2xl p-2 ${itemId === it.id ? 'bg-[#FFF6DE] ring-2 ring-gold' : 'bg-bg'}`}>
                        <PixelAvatar look={previewLook(it, DEFAULT_LOOK)} size={48} />
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
    </div>
  );
}

function UploadPreview({ result, onClose, onCreate }: { result: UploadResult; onClose: () => void; onCreate: () => void }) {
  const errors = result.issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = result.issues?.filter((i) => i.level === 'warning') ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8">
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-[24px] bg-white p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">파일 확인</h2>
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
              <thead className="text-ink-3"><tr><th className="py-1">시트</th><th>행</th><th>칸</th><th>내용</th></tr></thead>
              <tbody>
                {[...errors, ...warnings].map((i, k) => (
                  <tr key={k} className="border-t border-[#EEF0F3]">
                    <td className="py-1.5 pr-3">{i.sheet}</td><td className="tabular pr-3">{i.row ?? ''}</td><td className="pr-3">{i.column ?? ''}</td>
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
                <div className="text-sm text-ink-3">단어 {g.wordCount}{g.reviewCount ? ` · 검토 ${g.reviewCount}` : ''}{g.customCount ? ` · 직접 문항 ${g.customCount}` : ''}{result.rosterCount ? ` · 명단 ${result.rosterCount}명` : ''}</div>
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
          <Btn kind="ghost" onClick={onClose}>취소</Btn>
          <Btn disabled={!result.ok || result.hasErrors || !result.groups?.length} onClick={onCreate}>{result.hasErrors ? '오류를 고친 뒤 다시 올려 주세요' : '이벤트 만들기'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- live console ----------

function Console({ view, live, act, serverNow }: { view: TeacherView; live: TeacherLive; act: Send; serverNow: () => number }) {
  const control = useCallback((action: string) => act({ type: 'control', action }).catch(() => undefined), [act]);
  const running = live.phase !== 'lobby' && live.phase !== 'summary';
  // Hidden until the reveal, in case the laptop screen ends up mirrored on the projector; asked again for each question.
  const [shownSeq, setShownSeq] = useState<number | null>(null);
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
      const action = shortcutAction(e.code, live.paused);
      if (action) {
        e.preventDefault();
        control(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, live.paused, control]);

  if (live.phase === 'lobby') return <Lobby view={view} live={live} act={act} control={control} />;
  if (live.phase === 'summary') {
    return (
      <div className="flex flex-col items-center gap-8 p-12">
        <h1 className="text-3xl font-bold">{live.className} · {live.eventName} 끝</h1>
        <div className="flex gap-5">
          <Card className="min-w-56 !bg-ink text-white"><div className="text-[#A3A8B4]">반 정답률</div><div className="tabular text-6xl font-extrabold text-[#3DDC97]">{Math.round((live.summary?.accuracy ?? 0) * 100)}%</div></Card>
          <Card className="min-w-56"><div className="text-ink-3">보상 받은 학생</div><div className="tabular text-6xl font-extrabold">{live.summary?.rewarded ?? 0}<span className="text-2xl text-ink-3"> / {live.summary?.judged ?? 0}</span></div></Card>
        </div>
        <p className="text-ink-3">학생들은 각자 폰에서 결과와 오답 노트를 보고 있어요. 학생별 기록은 통계에 쌓였어요.</p>
        <Btn onClick={() => act({ type: 'close-session' })}>아레나 닫기</Btn>
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
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex h-[76px] items-center justify-between gap-5 bg-ink px-7 text-white">
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
          <button type="button" onClick={() => control('blank')} className={`h-10 rounded-xl border border-[#3D4354] px-4 text-sm font-semibold ${live.blank ? 'bg-white text-ink' : ''}`}>화면 가리기 B</button>
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
              <span>{live.phase === 'moving' ? '안개' : live.phase === 'reveal' ? '공개' : ''}</span>
            </div>
            <div className="aspect-[16/8]">
              {q && q.mode !== 'CUSTOM_TEXT' ? (
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
          </div>
        </div>

        <Card className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex items-end justify-between">
            <div className="text-[15px] font-semibold text-ink-3">{live.phase === 'reveal' ? '결과' : '자리 잡음'}</div>
            <div className="tabular text-5xl font-extrabold leading-none tracking-tight">
              {live.phase === 'reveal' ? `${Math.round((live.reveal?.accuracy ?? 0) * 100)}%` : <>{live.settled}<span className="text-2xl text-[#A3A8B4]">/{live.participants}</span></>}
            </div>
          </div>
          {q && q.mode !== 'CUSTOM_TEXT' && (
            <div className="flex flex-col gap-3">
              {q.options.map((o, i) => (
                <div key={i} className={`zone-${i} flex items-center gap-3`}>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white ${showAnswer && i === q.answerIndex ? 'bg-good' : ''}`}
                    style={showAnswer && i === q.answerIndex ? undefined : { background: 'var(--zone)' }}
                  >
                    {showAnswer && i === q.answerIndex ? '✓' : i + 1}
                  </div>
                  <div className="w-24 shrink-0 truncate text-sm font-semibold">{o.label}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-bg">
                    <div className="cls-bar h-6 rounded-r" style={{ width: `${((counts[i] ?? 0) / maxCount) * 100}%`, background: showAnswer && i === q.answerIndex ? '#0E9F6E' : 'var(--zone)' }} />
                  </div>
                  <div className="tabular w-8 text-right text-lg font-extrabold">{counts[i] ?? 0}</div>
                </div>
              ))}
            </div>
          )}
          {live.phase === 'moving' && live.unsettled.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] font-semibold text-ink-3">가운데 남음</span>
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

      <div className="flex h-[88px] items-center justify-between border-t border-line bg-white px-7">
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={() => control(live.paused ? 'resume' : 'pause')}>{live.paused ? '다시 시작' : '멈춤'} <span className="text-xs text-ink-3">Space</span></Btn>
          <Btn kind="ghost" disabled={live.phase !== 'moving'} onClick={() => control('add-time')}>+5초 <span className="text-xs text-ink-3">↑</span></Btn>
          <Btn kind="ghost" onClick={() => control('skip')}>건너뛰기 <span className="text-xs text-ink-3">S</span></Btn>
          {live.round === 'retry' && <Btn kind="ghost" onClick={() => control('skip-retry')}>다시 도전 건너뛰기</Btn>}
        </div>
        {live.phase === 'moving' ? (
          <Btn onClick={() => control('close-now')} className="h-14 px-8 text-lg">지금 정답 공개 <span className="ml-2 rounded bg-[#3D4354] px-2 py-0.5 text-xs">Enter</span></Btn>
        ) : (
          <Btn onClick={() => control('next')} disabled={live.phase !== 'reveal' && live.phase !== 'checkpoint'} className="h-14 px-8 text-lg">다음 <span className="ml-2 rounded bg-[#3D4354] px-2 py-0.5 text-xs">→</span></Btn>
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
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-ink-3">대기실</div>
          <h1 className="text-2xl font-bold">{live.className} · {live.eventName} · {live.mainCount}문항</h1>
        </div>
        <div className="flex gap-2">
          <a href="/display" target="classeum-display" className="flex h-11 items-center rounded-xl border border-[#D5D8DF] bg-white px-4 text-[15px] font-bold">프로젝터 화면 열기</a>
          <Btn kind="ghost" onClick={() => act({ type: 'close-session' })}>대기실 닫기</Btn>
          <Btn kind="accent" onClick={() => control('start')} className="px-6">퀴즈 시작</Btn>
        </div>
      </div>
      <div className="flex gap-5">
        <Card className="flex-1">
          <div className="mb-4 flex items-baseline justify-between"><h2 className="text-lg font-bold">들어온 학생</h2><span className="tabular text-2xl font-extrabold">{joined.length}</span></div>
          <div className="flex flex-wrap gap-2">
            {joined.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl bg-bg py-1.5 pl-1.5 pr-3">
                <PixelAvatar look={normalizeLook(s.look ?? undefined)} size={28} />
                <span className="text-sm font-semibold">{s.number} {s.name}</span>
              </div>
            ))}
          </div>
        </Card>
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

function Students({ view, act }: { view: TeacherView; act: Send }) {
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
      <h1 className="text-2xl font-bold">학생·기기</h1>
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
                    <td>{s.look ? <PixelAvatar look={normalizeLook(s.look)} size={28} /> : <span className="text-xs text-ink-3">-</span>}</td>
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

// ---------- stats ----------

interface StatsData {
  students: { id: string; classId: string; className: string; number: number; name: string; attendance: number; sessions: { sessionId: string; eventName: string; date: number; accuracy: number | null }[]; average: number | null; missed: { word: string; count: number }[]; fixed: string[]; rewards: number }[];
  words: { key: string; word: string; meaning: string; attempts: number; accuracy: number; topWrong: string | null }[];
}

function Stats({ classes }: { classes: TeacherView['classes'] }) {
  const [classId, setClassId] = useClassChoice(classes);
  const [data, setData] = useState<{ classId: string; stats: StatsData } | null>(null);
  const [mode, setMode] = useState<'students' | 'words'>('students');
  const [picked, setPicked] = useState<string | null>(null);
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
  const student = useMemo(() => stats?.students.find((s) => s.id === picked) ?? stats?.students[0], [stats, picked]);
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
  if (classes.length === 0) return <div className="p-8 text-ink-3">학생·기기에서 반을 먼저 만들어 주세요.</div>;
  if (!stats) return <div className="p-8 text-ink-3">불러오는 중…</div>;
  return (
    <div className="flex flex-col gap-5 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">통계</h1>
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
          <Card className="w-[520px] shrink-0 !p-2">
            <table className="w-full text-left text-[15px]">
              <thead className="text-xs font-bold text-ink-3"><tr><th className="px-4 py-3">학생</th><th>출석</th><th className="text-right">최근</th><th className="text-center">최근 5회</th><th className="pr-4 text-right">자주 틀림</th></tr></thead>
              <tbody>
                {stats.students.map((s) => {
                  const recent = s.sessions.slice(-5);
                  const last = [...s.sessions].reverse().find((x) => x.accuracy !== null)?.accuracy ?? null;
                  return (
                    <tr key={s.id} onClick={() => setPicked(s.id)} className={`cursor-pointer border-t border-[#EEF0F3] ${student?.id === s.id ? 'bg-bg' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold"><span className="tabular mr-1.5 text-[#A3A8B4]">{s.number}</span>{s.name}</td>
                      <td className="tabular text-sm text-ink-2">{s.attendance}</td>
                      <td className="tabular text-right font-extrabold">{pct(last)}</td>
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

void ITEMS;

// Checks 아고라's safety rules against a running Classeum server the way a class uses it: the teacher screen, the
// projector and five phones over the real streams and actions, through 대기실, 쓰기, 마감, 다음 주제 and the 끝, then
// 다시 보기 and 다시 쓰기 in a later lesson, each phone's 내 답 노트, the teacher's ⭐ with its reward, that answer texts reach the
// teacher screen only for the class in session or when its 답 card asks, and 받아쓰기 (a sentence the laptop reads,
// which reaches no phone or projector before [정답 공개]). It makes two classes of its own (아고라점검A
// and 아고라점검B) and 아고라 titled [아고라점검], and deletes them with their students and answers at the end, so real
// classes, 아고라 and records are never touched. It stops before doing anything if the arena or an 아고라 is open.
// Usage (from the project folder, with the server on): npm run check:agora -- [baseUrl=http://localhost:3000]
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_MAX, TITLE_MAX, TOPICS_MAX } from '../src/lib/agora';
import { gradeDictation } from '../src/lib/dictation';
import { ATTENDANCE_UNLOCKS, QUIZ_REWARD_ITEMS, RANDOM_REWARD } from '../src/lib/items';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PREFIX = '아고라점검';
const MARK = `[${PREFIX}]`;
const DATA = join(process.cwd(), '.data');
// Acts as the teacher with the key the server keeps in .data, like npm run sim.
const TEACHER = { Cookie: `cls_teacher=${readFileSync(join(DATA, 'teacher-key'), 'utf8').trim()}` };
const TEACHER_ONLY = [
  'agora-add', 'agora-edit', 'agora-delete', 'agora-open', 'agora-review', 'agora-howto', 'agora-start', 'agora-rewrite', 'agora-close',
  'agora-next', 'agora-end', 'agora-time', 'agora-reveal', 'agora-settings', 'agora-page', 'agora-pages', 'agora-music', 'agora-card',
  'agora-card-delete', 'agora-reward', 'agora-star', 'agora-speak', 'agora-accept', 'agora-nudge', 'draw-reward',
];
// The one place a page takes HTML: the QR picture the server draws itself.
const QR_HTML = 'dangerouslySetInnerHTML={{ __html: view.qr }}';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test reader for the server views
type View = Record<string, any>;
interface Stream {
  raw: string[];
  view: View;
  controller: AbortController;
}
interface Phone {
  cls: { id: string; name: string };
  number: number;
  name: string;
  token: string;
  s: Stream;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const streams: Stream[] = [];
let failures = 0;

function check(label: string, ok: unknown, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

const section = (title: string) => console.log(`\n[${title}]`);

async function post(body: View, headers: Record<string, string> = TEACHER): Promise<View> {
  const res = await fetch(`${BASE}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, ...((await res.json()) as View) };
}

/** One class's answers to an 아고라 as the teacher screen's 답 card fetches them, with the status. */
async function classAnswers(agoraId: string, classId: string, headers: Record<string, string> = TEACHER): Promise<View> {
  const res = await fetch(`${BASE}/api/agora-answers?agoraId=${encodeURIComponent(agoraId)}&classId=${encodeURIComponent(classId)}`, { headers });
  return { status: res.status, ...((await res.json()) as View) };
}

/** Every view a screen receives, as sent, and the latest one read. */
function stream(url: string, headers: Record<string, string> = {}): Stream {
  const s: Stream = { raw: [], view: {}, controller: new AbortController() };
  streams.push(s);
  (async () => {
    const res = await fetch(url, { headers, signal: s.controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        // Views come as plain messages; 'ping' and 'replaced' events are the stream's own.
        if (chunk.split('\n').some((l) => l.startsWith('event: '))) continue;
        const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
        if (data) {
          s.raw.push(data);
          s.view = JSON.parse(data);
        }
      }
    }
  })().catch(() => undefined);
  return s;
}

/** The status a screen's stream answers with when opened without the teacher cookie, as a phone would. */
async function streamStatus(role: string): Promise<number> {
  const res = await fetch(`${BASE}/api/stream?role=${role}`);
  await res.body?.cancel();
  return res.status;
}

/** Code that puts text into a page as HTML rather than letters. */
function htmlSinks(dir: string): string[] {
  const found: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) found.push(...htmlSinks(path));
    else if (/\.tsx?$/.test(e.name)) {
      for (const m of readFileSync(path, 'utf8').matchAll(/dangerouslySetInnerHTML=\{\{[^}]*\}\}|\.(?:inner|outer)HTML\s*=|insertAdjacentHTML/g)) found.push(m[0]);
    }
  }
  return found;
}

/** Closes this check's 아고라 and deletes its classes and 아고라, also those a run stopped half-way left behind. */
async function cleanUp(teacher: Stream) {
  const v = teacher.view;
  const ours = new Set((v.classes as { id: string; name: string }[]).filter((c) => c.name.startsWith(PREFIX)).map((c) => c.id));
  if (v.agora.live && ours.has(v.agora.live.classId)) await post({ type: 'agora-end' });
  // A run stopped half-way in 아레나 뒤 아고라: its quiz ended and closed, and its event deleted.
  if (v.live && ours.has(v.live.classId)) {
    await post({ type: 'control', action: 'end' });
    await sleep(300);
    await post({ type: 'close-session' });
  }
  for (const e of v.events as { id: string; name: string }[]) if (e.name.startsWith(MARK)) await post({ type: 'delete-event', eventId: e.id });
  for (const a of v.agora.agoras as { id: string; title: string }[]) if (a.title.startsWith(MARK)) await post({ type: 'agora-delete', agoraId: a.id });
  for (const id of ours) await post({ type: 'delete-class', classId: id, withStudents: true });
  await sleep(300);
}

async function run(teacher: Stream, display: Stream) {
  section('준비');
  const A = { name: `${PREFIX}A`, id: '' };
  const B = { name: `${PREFIX}B`, id: '' };
  A.id = (await post({ type: 'add-class', name: A.name })).classId;
  B.id = (await post({ type: 'add-class', name: B.name })).classId;
  const roster = await post({ type: 'roster', classId: A.id, text: '1 김하람\n2 이도윤\n3 박지후\n4 최아린' });
  check('명단 추가는 몇 명을 넣었는지 말한다', roster.added === 4 && roster.renamed === 0 && roster.skipped?.length === 0, JSON.stringify(roster));
  // A renamed seat and two lines it can't read (no number, a number students can't type): said, and given back for the box.
  const again = await post({ type: 'roster', classId: A.id, text: '4 최아인\n가나다\n150 홍길동\n1 김하람' });
  check('같은 번호의 새 이름은 이름 바꿈으로, 못 읽은 줄은 그대로 돌려준다', again.added === 0 && again.renamed === 1 && JSON.stringify(again.skipped) === JSON.stringify(['가나다', '150 홍길동']), JSON.stringify(again));
  await post({ type: 'roster', classId: A.id, text: '4 최아린' });
  await post({ type: 'roster', classId: B.id, text: '7 정서윤' });
  const phone = (cls: Phone['cls'], number: number, name: string): Phone => {
    const token = randomBytes(24).toString('hex');
    return { cls, number, name, token, s: stream(`${BASE}/api/stream?role=student&token=${token}`) };
  };
  // Three phones in A and one in B; a fourth of A asks to register later and is never approved.
  const phones = [phone(A, 1, '김하람'), phone(A, 2, '이도윤'), phone(A, 3, '박지후'), phone(B, 7, '정서윤')];
  const [a1, a2, a3, b1] = phones;
  await sleep(500);
  for (const p of phones) await post({ type: 'register', token: p.token, classId: p.cls.id, number: p.number, name: p.name }, {});
  await sleep(300);
  // Only this check's requests: a real student's request is the teacher's to decide.
  for (const r of teacher.view.requests as { id: string; kind: string; className: string }[]) {
    if (r.className === A.name || r.className === B.name) await post({ type: 'approve', requestId: r.id, kind: r.kind });
  }
  await sleep(300);
  // A character first, as on a real phone: only students with one come into a 대기실.
  for (const p of phones) await post({ type: 'look', token: p.token, look: { hairStyle: 'bob', hair: 'pink' } }, {});
  await sleep(300);
  check('시험반 두 개에 기기 네 대가 등록됐다', phones.every((p) => p.s.view.me), phones.map((p) => (p.s.view.me ? 'ok' : 'no')).join(','));

  const created = await post({
    type: 'agora-add',
    title: `${MARK} 시험 아고라`,
    topics: [
      { text: '시험 주제', note: '예) 시험', sort: 'time', columns: 3 },
      { text: '두 번째 주제', minutes: 5, columns: 2 },
      { text: '세 번째 주제', minutes: null },
    ],
  });
  check('아고라는 반 없이, 주제 여러 개를 묶어 만든다 (아레나 이벤트처럼)', created.ok, created.error);
  const agoraId: string = created.agoraId;
  const other: string = (await post({ type: 'agora-add', title: `${MARK} 다른 아고라`, topics: [{ text: '다른 주제' }] })).agoraId;
  await sleep(200);
  const agora = (id = agoraId): View => (teacher.view.agora.agoras as View[]).find((a) => a.id === id)!;
  const [t1, t2, t3] = (agora().topics as View[]).map((t) => t.id as string);
  const topic = (id = t1): View => (teacher.view.agora.agoras as View[]).flatMap((a) => a.topics as View[]).find((t) => t.id === id)!;
  /** The open session's answers to a topic, as the teacher screen's console has them: its class's only. */
  const liveAnswers = (id = t1): View[] => (teacher.view.agora.live?.answers?.[id] as View[] | undefined) ?? [];
  check('주제는 쓴 순서대로, 주제마다 입력 시간·열·순서를 따로 가진다', agora().topics.length === 3 && topic(t1).minutes === 10 && topic(t1).columns === 3 && topic(t1).sort === 'time' && topic(t2).minutes === 5 && topic(t3).minutes === null);
  const REWARD = QUIZ_REWARD_ITEMS[3];
  check('새 아고라의 보상은 무작위로 시작한다 (수업마다 대기실에서 뽑는다)', agora().reward?.itemId === RANDOM_REWARD);
  check('출석 아이템은 보상으로 고를 수 없다', (await post({ type: 'agora-reward', agoraId, itemId: ATTENDANCE_UNLOCKS[0] })).error === '그 아이템은 보상으로 고를 수 없어요.');
  check('없는 아이템도 고를 수 없다', (await post({ type: 'agora-reward', agoraId, itemId: 'no-such-item' })).error === '그 아이템은 보상으로 고를 수 없어요.');
  check('선생님이 이번 아고라 보상을 고른다', (await post({ type: 'agora-reward', agoraId, itemId: REWARD.id })).ok);
  await sleep(200);
  check('고른 보상이 아고라에 남는다', agora().reward.itemId === REWARD.id);
  const card = (n: number): View | undefined => (display.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const phoneCard = (p: Phone, n: number): View | undefined => (p.s.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const studentId = (cls: Phone['cls'], n: number): string => (teacher.view.students as View[]).find((s) => s.classId === cls.id && s.number === n)!.id;
  /** Class A student n's answer to a topic, as the teacher screen's console has it. */
  const answerOf = (n: number, id = t1): View | undefined => liveAnswers(id).find((a) => a.studentId === studentId(A, n));
  const owns = (p: Phone) => !!(p.s.view.me?.inventory as string[] | undefined)?.includes(REWARD.id);
  const rewarded = (): string[] => teacher.view.agora.live?.rewarded ?? [];
  /** Waits out 오늘의 보상's draw (a 무작위 reward's 대기실 draws as it opens): nothing starts while the projector plays it. */
  const drawDone = async () => {
    const at = Math.max(teacher.view.agora.live?.reward?.revealAt ?? 0, teacher.view.live?.reward?.revealAt ?? 0);
    await sleep(Math.max(0, at - Date.now()) + 150);
  };
  // When the teacher last gave a ⭐, as the projector and the teacher screen see it (the applause plays when it changes).
  const praisedAt = (): [number, number] => [display.view.agora?.praisedAt ?? -1, teacher.view.agora.live?.praisedAt ?? -1];
  /** Whether a stream ever carried this answer's text. */
  const leaks = (s: Stream, secret: string) => s.raw.some((r) => r.includes(secret.split(' ')[1]));

  section('대기실');
  check('선생님이 오늘 반을 골라 대기실을 연다', (await post({ type: 'agora-open', agoraId, classId: A.id })).ok);
  await sleep(300);
  const lobby = display.view.agora;
  check('프로젝터는 대기실: 첫 주제(1/3)와 들어온 학생, 카드는 아직 없다', lobby?.phase === 'lobby' && lobby.topic.id === t1 && lobby.index === 0 && lobby.count === 3 && lobby.cards.length === 0 && [1, 2, 3].every((n) => lobby.joined.some((j: View) => j.number === n)));
  check('대기실의 프로젝터와 그 반 기기에 오늘의 보상이 뜬다', lobby?.reward?.itemId === REWARD.id && lobby.reward.name === REWARD.name && [a1, a2, a3].every((p) => p.s.view.agora?.reward?.itemId === REWARD.id));
  check('그 반 기기는 대기실에서 첫 주제를 미리 본다 (친구 카드는 아직 없음)', [a1, a2, a3].every((p) => p.s.view.agora?.phase === 'lobby' && p.s.view.agora.topic.id === t1 && p.s.view.agora.cards.length === 0));
  check('다른 반 기기에는 주제가 가지 않고, 지금 수업 중인 반 이름만 간다', !b1.s.view.agora && b1.s.view.elsewhere === A.name, b1.s.view.elsewhere);
  check('그 반 기기에 내 답 노트는 수업 동안 가지 않는다', [a1, a2, a3].every((p) => p.s.view.agoraNotes === null));
  check('선생님 화면에 대기실과 들어온 학생이 보인다', teacher.view.agora.live?.phase === 'lobby' && [1, 2, 3].every((n) => teacher.view.agora.live.joined.includes(studentId(A, n))));
  // A phone's tab showing its 오답 노트 or quiz results says so with its numbered heartbeats, and the teacher's 아고라
  // screens mark that student: this class only, tab by tab, until the tab says otherwise or goes.
  const reviewing = (): string[] => teacher.view.agora.live?.reviewing ?? [];
  const tab = (p: Phone, sid: string) => stream(`${BASE}/api/stream?role=student&token=${p.token}&s=${sid}`);
  const beat = (p: Phone, sid: string, r: boolean, n: number) => post({ type: 'hb', token: p.token, s: sid, r, n }, {});
  const a2tab = tab(a2, 'chkA2tab');
  const b1tab = tab(b1, 'chkB1tab');
  await sleep(400);
  await beat(a2, 'chkA2tab', true, 1);
  await beat(b1, 'chkB1tab', true, 1);
  await sleep(200);
  check('오답 노트나 결과를 띄운 폰(탭)은 선생님 화면에 오답 정리 중으로 뜬다 (수업 중인 반만)', reviewing().length === 1 && reviewing()[0] === studentId(A, 2), JSON.stringify(reviewing()));
  await beat(a2, 'chkA2tab', false, 3);
  // A late heartbeat (an older number) and one from a tab the server doesn't have change nothing.
  await beat(a2, 'chkA2tab', true, 2);
  await beat(a3, 'noSuchTab', true, 1);
  // A heartbeat's push waits for the 300 ms since the last one.
  await sleep(400);
  check('…닫으면 사라지고, 늦게 온 신호나 없는 탭의 신호는 무시된다', reviewing().length === 0, JSON.stringify(reviewing()));
  const a3tab = tab(a3, 'chkA3tab');
  await sleep(400);
  await beat(a3, 'chkA3tab', true, 1);
  await sleep(200);
  const a3Marked = reviewing().length === 1 && reviewing()[0] === studentId(A, 3);
  a3tab.controller.abort();
  await sleep(300);
  check('…그 탭이 나가면 사라지고(같은 폰의 다른 탭이 남아 있어도), 학생은 대기실에 그대로 있다', a3Marked && reviewing().length === 0 && teacher.view.agora.live.joined.includes(studentId(A, 3)), JSON.stringify(reviewing()));
  a2tab.controller.abort();
  b1tab.controller.abort();
  await sleep(200);
  check('놀이 방법을 누른다', (await post({ type: 'agora-howto' })).ok);
  await sleep(200);
  check('프로젝터에 놀이 방법 시범이 나오고, 선생님 화면도 안다', typeof display.view.agora?.howtoAt === 'number' && teacher.view.agora.live?.howto === true);
  check('대기실에서는 아직 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: 'x' }, {})).error === '선생님이 시작하면 쓸 수 있어요.');
  check('아고라는 한 번에 하나만 연다', (await post({ type: 'agora-open', agoraId: other, classId: B.id })).error?.includes('이미 열려'));
  const stampsBefore = a1.s.view.me?.stamps;

  section('쓰기 시작');
  check('쓰기 시작', (await post({ type: 'agora-start' })).ok);
  await sleep(300);
  check('쓰기를 시작하면 놀이 방법은 멈춘다', display.view.agora?.howtoAt === null && teacher.view.agora.live?.howto === false);
  await post({ type: 'agora-howto' });
  await sleep(200);
  check('쓰는 중에는 놀이 방법이 나오지 않는다', display.view.agora?.howtoAt === null);
  check('프로젝터와 기기가 쓰기로 바뀌고, 들어온 세 명의 카드가 생긴다', display.view.agora?.phase === 'writing' && a1.s.view.agora?.phase === 'writing' && [1, 2, 3].every((n) => card(n) && !card(n)!.sent));
  const t10 = display.view.agora?.timer;
  check('첫 주제의 입력 시간(10분)이 쓰기 시작부터 흐른다', t10 && t10.endsAt - t10.startedAt === 600_000, t10 && `${t10.endsAt - t10.startedAt} ms`);
  check('들어온 학생은 출석 발자국을 받는다 (아레나처럼)', typeof stampsBefore === 'number' && a1.s.view.me?.stamps === stampsBefore + 1, `${stampsBefore} → ${a1.s.view.me?.stamps}`);
  check('아고라에 이 반이 한 기록이 남는다', (agora().runs as View[]).some((r) => r.classId === A.id));

  section('비공개일 때');
  const SECRET1 = '비밀1 SECRET-ONE';
  const SECRET2 = '<b>비밀2</b> SECRET-TWO <img src=x onerror=alert(1)>';
  check('1번이 답을 낸다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: `  ${SECRET1}‮  ` }, {})).ok);
  await sleep(50);
  check('2번이 답을 낸다', (await post({ type: 'agora-answer', token: a2.token, topicId: t1, text: SECRET2 }, {})).ok);
  await sleep(300);
  check('프로젝터에는 두 답의 글이 한 번도 가지 않았다', !leaks(display, SECRET1) && !leaks(display, SECRET2));
  check('프로젝터 카드는 낸 사람만 표시하고 글은 없다', card(1)?.sent && card(2)?.sent && !card(3)?.sent && (display.view.agora.cards as View[]).every((c) => c.text === undefined));
  check('1번 기기는 자기 답을 받는다 (보이지 않는 글자는 빠진 채)', a1.s.view.agora.mine?.text === SECRET1, JSON.stringify(a1.s.view.agora.mine));
  check('1번 기기는 2번 답을 받지 않았다', !leaks(a1.s, SECRET2));
  check('2번 기기는 1번 답을 받지 않았다', !leaks(a2.s, SECRET1));
  check('3번 기기는 아무 답도 받지 않았다', !leaks(a3.s, SECRET1) && !leaks(a3.s, SECRET2));
  check('다른 반 기기는 아무 답도 받지 않았다', !leaks(b1.s, SECRET1) && !leaks(b1.s, SECRET2));
  check('선생님 화면은 수업 중인 반의 두 답을 다 받는다', JSON.stringify(liveAnswers()).includes('SECRET-ONE') && JSON.stringify(liveAnswers()).includes('SECRET-TWO'));
  check('선생님 화면의 아고라 목록에는 답의 글 없이 반별 답 수만 있다', !JSON.stringify(teacher.view.agora.agoras).includes('SECRET-ONE') && topic().counts[A.id] === 2 && topic().total === 2, JSON.stringify(topic().counts));
  const order = (display.view.agora.cards as View[]).map((c) => c.number).join(',');
  check('낸 순서: 낸 사람이 먼저, 나머지는 번호순', order.startsWith('1,2,') && order.indexOf('3') > order.indexOf('2'), order);

  section('누가 쓸 수 있나');
  check('다른 반 기기는 이 주제에 답할 수 없다', (await post({ type: 'agora-answer', token: b1.token, topicId: t1, text: 'x' }, {})).error === '우리 반 주제가 아니에요.');
  check('등록 안 된 기기는 답할 수 없다', (await post({ type: 'agora-answer', token: randomBytes(24).toString('hex'), topicId: t1, text: 'x' }, {})).error === '등록된 기기가 아니에요.');
  const a4 = phone(A, 4, '최아린');
  await sleep(300);
  check('새 기기가 등록을 요청한다', (await post({ type: 'register', token: a4.token, classId: A.id, number: 4, name: a4.name }, {})).ok);
  check('승인 전에는 답할 수 없다', (await post({ type: 'agora-answer', token: a4.token, topicId: t1, text: 'x' }, {})).error === '등록된 기기가 아니에요.');
  check('기기 토큰 없이 보낸 답은 거절', (await post({ type: 'agora-answer', topicId: t1, text: 'x' }, {})).status === 400);
  check('지금 떠 있지 않은 주제(다음 주제)에는 답할 수 없다', (await post({ type: 'agora-answer', token: a3.token, topicId: t2, text: 'x' }, {})).error === '주제가 바뀌었어요. 화면을 확인해 주세요.');
  check('빈 답은 거절', (await post({ type: 'agora-answer', token: a3.token, topicId: t1, text: ' ​ ' }, {})).error === '답을 써 주세요.');
  check(`${ANSWER_MAX + 1}자는 거절`, (await post({ type: 'agora-answer', token: a3.token, topicId: t1, text: 'ㄱ'.repeat(ANSWER_MAX + 1) }, {})).error?.includes(`${ANSWER_MAX}자`));
  const burst: string[] = [];
  for (let i = 0; i < 6; i++) burst.push((await post({ type: 'agora-answer', token: a3.token, topicId: t1, text: i ? `다시 ${i}` : 'ㄱ'.repeat(ANSWER_MAX) }, {})).error ?? 'ok');
  // 3번 can write again 10 s after the burst's first write.
  const burstAt = Date.now();
  check(`${ANSWER_MAX}자까지는 받는다`, burst[0] === 'ok');
  check('한 기기가 10초에 다섯 번 넘게 쓰면 잠시 막힌다', burst.filter((r) => r === 'ok').length === 3 && burst[5] === '조금 있다가 다시 해 주세요.', burst.join(' | '));

  section('선생님만 할 수 있는 일');
  const notBlocked: string[] = [];
  for (const type of TEACHER_ONLY) {
    const r = await post({ type, agoraId, topicId: t1, classId: A.id, token: a1.token, public: true, number: 1, studentId: studentId(A, 1) }, {});
    if (r.status !== 403) notBlocked.push(type);
  }
  check(`아고라의 선생님 동작 ${TEACHER_ONLY.length}가지는 선생님 쿠키 없이 모두 막힌다 (등록된 기기라도)`, notBlocked.length === 0, notBlocked.join(','));
  check('다른 사이트에서 온 요청은 선생님 쿠키가 있어도 막힌다', (await post({ type: 'agora-reveal', public: true }, { ...TEACHER, Origin: 'http://evil.example' })).status === 403);
  check('브라우저가 다른 사이트라고 알린 요청도 막힌다', (await post({ type: 'agora-reveal', public: true }, { ...TEACHER, 'Sec-Fetch-Site': 'cross-site' })).status === 403);
  await sleep(200);
  check('그래서 답은 여전히 비공개다', teacher.view.agora.live?.reveal === 'hidden' && !leaks(display, SECRET1) && !leaks(a3.s, SECRET1));
  check('학생 기기는 프로젝터 화면의 데이터를 열 수 없다', (await streamStatus('display')) === 403);
  check('학생 기기는 선생님 화면의 데이터를 열 수 없다', (await streamStatus('teacher')) === 403);

  section('고치기와 지우기');
  await sleep(200);
  const firstAt = liveAnswers().find((a) => a.text === SECRET1)?.createdAt;
  const keyBefore = agora().answersKey;
  check('1번이 답을 고친다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '고친 답' }, {})).ok);
  await sleep(200);
  const changed = liveAnswers().find((a) => a.text === '고친 답');
  check('답이 바뀌면 아고라의 answersKey도 바뀐다 (열려 있는 답 카드가 다시 받아 오게)', typeof keyBefore === 'string' && agora().answersKey !== keyBefore);
  check('고친 답은 처음 낸 시각을 지킨다 (낸 순서가 바뀌지 않게)', changed && changed.createdAt === firstAt && changed.updatedAt >= changed.createdAt);
  check('수업 중에 고친 답은 처음 답을 따로 남기지 않는다 (다시 쓰기에서만)', changed && changed.first === null);
  // A phone numbers its writes; one sent earlier that arrives later (a retry, a second tab) must not win.
  const writeAt = Date.now() * 1000;
  check('번호가 붙은 새 답이 먼저 도착한다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '고친 답', n: writeAt + 2 }, {})).ok);
  check('번호가 더 작은 옛 답이 늦게 도착한다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '늦게 온 옛 답', n: writeAt + 1 }, {})).ok);
  await sleep(200);
  check('…늦게 온 옛 답은 새 답을 덮지 않는다', a1.s.view.agora.mine?.text === '고친 답' && !liveAnswers().some((a) => a.text === '늦게 온 옛 답'));
  check('2번이 자기 답을 지운다', (await post({ type: 'agora-unanswer', token: a2.token, topicId: t1 }, {})).ok);
  await sleep(200);
  check('2번 답이 사라졌다', a2.s.view.agora.mine === null && !liveAnswers().some((a) => a.text === SECRET2));

  section('다시 생각해 봐');
  // [🤔 다시] on the console: that student's phone alone hears it, while writing is open on the topic the console showed.
  const nudgedAt = (p: Phone): number => p.s.view.agora?.nudgedAt ?? 0;
  check('선생님이 1번에게 [🤔 다시]를 보낸다', (await post({ type: 'agora-nudge', studentId: studentId(A, 1), topicId: t1 })).ok);
  await sleep(200);
  check('…1번 폰만 받고, 선생님 화면도 보낸 것을 안다', nudgedAt(a1) > 0 && nudgedAt(a3) === 0 && teacher.view.agora.live?.nudges?.[studentId(A, 1)] === nudgedAt(a1));
  check('…프로젝터와 다른 반 폰에는 가지 않는다', !display.raw.some((r) => r.includes('nudge')) && !b1.s.raw.some((r) => r.includes('nudge')));
  const nudged1 = nudgedAt(a1);
  await post({ type: 'agora-nudge', studentId: studentId(A, 1), topicId: t1 });
  await sleep(200);
  check('…4초 안에 또 눌러도 한 번만 간다', nudgedAt(a1) === nudged1);
  await post({ type: 'agora-nudge', studentId: studentId(A, 2), topicId: t1 });
  await post({ type: 'agora-nudge', studentId: studentId(B, 7), topicId: t1 });
  await post({ type: 'agora-nudge', studentId: studentId(A, 3), topicId: t2 });
  await sleep(200);
  check('답이 없는 학생, 다른 반 학생, 떠 있지 않은 주제(늦게 도착한 클릭)에는 가지 않는다', nudgedAt(a2) === 0 && nudgedAt(a3) === 0 && Object.keys(teacher.view.agora.live?.nudges ?? {}).join() === studentId(A, 1));

  section('공개');
  check('2번이 다시 낸다', (await post({ type: 'agora-answer', token: a2.token, topicId: t1, text: SECRET2 }, {})).ok);
  await sleep(200);
  check('비공개 중에 답 하나만 공개한다 (프로젝터 카드 클릭: 번호로)', (await post({ type: 'agora-card', number: 2 })).ok);
  await sleep(200);
  check('그 답만 프로젝터와 그 반 기기에 간다', card(2)?.text === SECRET2 && card(1)?.text === undefined && phoneCard(a3, 2)?.text === SECRET2 && phoneCard(a3, 1)?.text === undefined);
  check('꺾쇠(< >)가 든 답도 바뀌지 않고 쓴 글자 그대로 간다', card(2)?.text === SECRET2);
  check('다른 반 기기는 여전히 아무 답도 받지 않았다', !leaks(b1.s, SECRET2) && !leaks(b1.s, SECRET1));
  check('전체 공개', (await post({ type: 'agora-reveal', public: true })).ok);
  await sleep(200);
  check('공개: 모든 답이 프로젝터와 그 반 기기에 간다', card(1)?.text === '고친 답' && card(2)?.text === SECRET2 && phoneCard(a3, 1)?.text === '고친 답' && a3.s.view.agora.reveal === 'public');
  check('전체 공개하면 따로 공개했던 답은 다시 전체를 따른다', liveAnswers().every((x) => x.shown === null));
  check('답 하나만 숨긴다 (선생님 화면 클릭: 학생으로)', (await post({ type: 'agora-card', studentId: studentId(A, 1) })).ok);
  await sleep(200);
  check('숨긴 답은 프로젝터와 기기에서 빠지고, 카드는 낸 것으로 남는다', card(1)?.sent && card(1)?.text === undefined && phoneCard(a3, 1)?.text === undefined);
  check('쓴 학생은 자기 답을 그대로 본다', a1.s.view.agora.mine?.text === '고친 답');
  await post({ type: 'agora-reveal', public: false });
  await post({ type: 'agora-reveal', public: true });
  await sleep(200);
  check('숨긴 답은 전체 비공개 → 전체 공개를 거쳐도 숨겨져 있다', card(1)?.text === undefined && card(2)?.text === SECRET2);
  check('다시 누르면 보인다', (await post({ type: 'agora-card', studentId: studentId(A, 1) })).ok);
  await sleep(200);
  check('…그리고 다시 전체를 따른다', card(1)?.text === '고친 답' && liveAnswers().every((x) => x.shown === null));
  // A click says the topic it was on and what it wants, so a late one can't touch another topic, and a repeat changes nothing.
  check('다른 주제를 가리키는 숨기기 요청 (늦게 도착한 클릭)', (await post({ type: 'agora-card', studentId: studentId(A, 2), topicId: t2, shown: false })).ok);
  await sleep(200);
  check('…은 무시되고 그 답은 그대로 보인다', card(2)?.text === SECRET2);
  for (let i = 0; i < 2; i++) await post({ type: 'agora-card', studentId: studentId(A, 2), topicId: t1, shown: false });
  await sleep(200);
  check('숨기기를 두 번 보내도 숨긴 그대로다 (뒤집지 않는다)', card(2)?.sent && card(2)?.text === undefined);
  check('보이기로 되돌린다', (await post({ type: 'agora-card', number: 2, topicId: t1, shown: true })).ok);
  await sleep(200);
  check('…보이고, 다시 전체를 따른다', card(2)?.text === SECRET2 && liveAnswers().every((x) => x.shown === null));

  section('화면 설정');
  check('열 4개, 번호순', (await post({ type: 'agora-settings', columns: 4, sort: 'number' })).ok);
  await sleep(200);
  check('프로젝터가 그 배치를 받고, 지금 주제에만 남는다', display.view.agora.topic.columns === 4 && display.view.agora.topic.sort === 'number' && (display.view.agora.cards as View[]).map((c) => c.number).join(',').startsWith('1,2,3') && topic(t2).columns === 2);
  await post({ type: 'agora-settings', columns: 9, sort: 'x', minutes: 3 });
  await sleep(100);
  check('잘못된 배치는 아무것도 바꾸지 않고, 입력 시간은 진행 중에 바꾸지 않는다', display.view.agora.topic.columns === 4 && display.view.agora.topic.sort === 'number' && topic().minutes === 10);
  await post({ type: 'agora-pages', count: 3 });
  for (let i = 0; i < 3; i++) await post({ type: 'agora-page', dir: 1 });
  await sleep(200);
  check('쪽 넘기기는 세 쪽 중 마지막에서 멈춘다', teacher.view.agora.live.pages === 3 && display.view.agora.page === 2);
  await post({ type: 'agora-pages', count: 2 });
  await sleep(100);
  check('쪽이 줄면 보던 쪽도 그 안으로 돌아온다', display.view.agora.page === 1);
  await post({ type: 'agora-reveal', public: false });
  await sleep(100);
  check('공개를 바꾸면 첫 쪽으로 간다', display.view.agora.page === 0);
  const keyNow = agora().answersKey;
  check('배경음을 끈다', (await post({ type: 'agora-music' })).ok);
  await sleep(100);
  check('프로젝터가 배경음 꺼짐을 받는다', display.view.agora.music === false);
  check('답과 상관없는 변화에는 answersKey가 그대로다 (답 카드가 괜히 다시 받아 오지 않게)', agora().answersKey === keyNow);
  await post({ type: 'agora-music' });
  check('선생님이 2번 답을 지운다', (await post({ type: 'agora-card-delete', topicId: t1, studentId: studentId(A, 2) })).ok);
  await sleep(200);
  check('2번은 답이 없어지고 다시 쓸 수 있다', a2.s.view.agora.mine === null && (await post({ type: 'agora-answer', token: a2.token, topicId: t1, text: 'again' }, {})).ok);

  section('개인정보');
  // The server saves 0.4 s after a change.
  await sleep(800);
  const saved = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  const records = Object.values(saved.topicAnswers?.[t1] ?? {}) as View[];
  check('저장된 답에는 글·공개 여부·시각만 있다 (번호·이름 말고 새로 모으는 정보 없음)', records.length >= 2 && records.every((r) => Object.keys(r).sort().join(',') === 'createdAt,shown,text,updatedAt'), records.map((r) => Object.keys(r).join('+')).join(' '));
  const savedAgora = saved.agoras?.[agoraId];
  check('저장된 아고라에는 반이 없고, 한 반의 기록과 주제 목록만 있다', savedAgora && !('classId' in savedAgora) && Object.keys(savedAgora.runs).join() === A.id && savedAgora.topics.map((t: View) => t.id).join() === [t1, t2, t3].join() && saved.topics === undefined);

  section('칭찬 별과 보상');
  check('별을 받기 전에는 그 아이템이 없다', !owns(a1) && !owns(a2));
  check('별을 주기 전에는 박수 신호가 없다', praisedAt().every((t) => t === 0), praisedAt().join());
  check('선생님이 1번 답에 칭찬 별을 준다', (await post({ type: 'agora-star', studentId: studentId(A, 1) })).ok);
  await sleep(300);
  check('그 답에 별이 남고, 프로젝터 카드에도 별이 뜬다', answerOf(1)?.star === true && card(1)?.star === true);
  const clapped = praisedAt();
  check('별을 주면 프로젝터와 선생님 화면에 박수 신호가 간다', clapped[0] > 0 && clapped[0] === clapped[1], clapped.join());
  check('비공개 카드에도 별은 보이고 답은 숨겨진 그대로다', display.view.agora.reveal === 'hidden' && card(1)?.text === undefined);
  check('1번은 그 자리에서 보상을 받는다: 보관함에 들어가고 폰에 상자가 열린다', owns(a1) && a1.s.view.agora?.praise?.itemId === REWARD.id && a1.s.view.agora.praise.alreadyOwned === false && rewarded().includes(studentId(A, 1)));
  check('보상 상자는 받은 학생 폰에만 간다', a2.s.view.agora?.praise === null && a3.s.view.agora?.praise === null && !b1.s.view.agora);
  check('2번 답에도 별', (await post({ type: 'agora-star', studentId: studentId(A, 2) })).ok);
  await sleep(200);
  check('보상 받은 학생이 둘', rewarded().length === 2 && owns(a2));
  check('별마다 박수 신호가 새로 간다', praisedAt()[0] > clapped[0], praisedAt().join());
  const before = praisedAt()[0];
  check('별을 다시 누르면 뺀다', (await post({ type: 'agora-star', studentId: studentId(A, 1) })).ok);
  await sleep(200);
  check('…답과 카드에서 별이 빠진다', answerOf(1)?.star === false && card(1)?.star === undefined);
  check('…받은 보상은 그대로다', owns(a1) && rewarded().includes(studentId(A, 1)));
  check('…별을 뺄 때는 박수 신호가 없다', praisedAt()[0] === before, praisedAt().join());
  await post({ type: 'agora-star', studentId: studentId(A, 1) });
  // The server saves 0.4 s after a change.
  await sleep(800);
  const praises = (JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')).rewards as View[]).filter((x) => x.reason === 'praise' && x.eventId === agoraId);
  check('같은 수업에서 별을 다시 줘도 보상은 한 사람에 한 번 (기록 둘)', praises.length === 2 && praises.every((x) => x.itemId === REWARD.id && /^agl_/.test(x.sessionId)), praises.map((x) => x.studentId).join());
  check('답이 없는 학생에게는 별을 줄 수 없다', (await post({ type: 'agora-star', studentId: studentId(A, 4) })).ok && rewarded().length === 2 && !answerOf(4));
  check('다른 반 학생에게도 줄 수 없다', (await post({ type: 'agora-star', studentId: studentId(B, 7) })).ok && rewarded().length === 2);
  check('다른 주제를 가리키는 별 요청 (늦게 도착한 클릭)', (await post({ type: 'agora-star', studentId: studentId(A, 3), topicId: t2, star: true })).ok);
  await sleep(200);
  check('…은 무시된다', !answerOf(3)?.star && rewarded().length === 2);
  check('별 주기를 이미 별이 있는 답에 또 보낸다 (두 번 클릭)', (await post({ type: 'agora-star', studentId: studentId(A, 2), topicId: t1, star: true })).ok);
  await sleep(200);
  check('…별은 빠지지 않는다', answerOf(2)?.star === true);

  section('마감');
  check('선생님이 지금 마감한다', (await post({ type: 'agora-close' })).ok);
  await sleep(200);
  check('마감: 기기는 마감을 보고, 프로젝터는 그대로 띄워 둔다', a1.s.view.agora?.phase === 'closed' && display.view.agora?.phase === 'closed' && display.view.agora.timer === null);
  check('마감 뒤에는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: 'late' }, {})).error === '마감됐어요.');
  await post({ type: 'agora-nudge', studentId: studentId(A, 3), topicId: t1 });
  await sleep(150);
  check('마감 뒤에는 [🤔 다시]가 가지 않는다', nudgedAt(a3) === 0);
  check('마감 뒤 +1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.phase === 'closed' && display.view.agora.timer === null);
  check('열려 있는 동안에는 그 반만 등록할 수 있다', (await post({ type: 'register', token: randomBytes(24).toString('hex'), classId: B.id, number: 9, name: '늦은학생' }, {})).error?.includes(`${A.name} 수업`));
  // One answer shown on its own, to see a new session let go of it.
  await post({ type: 'agora-card', studentId: studentId(A, 1) });
  check('아고라가 열린 반은 지울 수 없다', (await post({ type: 'delete-class', classId: A.id, withStudents: true })).error?.includes('아고라가 열려 있는 반'));
  check('열려 있는 아고라는 지울 수 없다', (await post({ type: 'agora-delete', agoraId })).error?.includes('열려 있는 아고라'));
  check('열려 있는 아고라는 고칠 수 없다', (await post({ type: 'agora-edit', agoraId, title: `${MARK} 바꿈`, topics: [{ text: '바꿈' }] })).error?.includes('열려 있는 아고라'));

  section('다음 주제와 건너뛰기');
  const T2A = '주제2 ALPHA-T2';
  check('다음 주제 (선생님 화면이 보던 주제 1에서)', (await post({ type: 'agora-next', index: 0 })).ok);
  check('같은 [다음 주제]가 한 번 더 온다 (두 번 클릭)', (await post({ type: 'agora-next', index: 0 })).ok);
  await sleep(300);
  const ready = display.view.agora;
  check('준비: 두 번째 클릭은 주제를 건너뛰지 않고, 프로젝터에 주제 2/3이 먼저 뜨고, 카드와 시계는 없다', ready?.phase === 'ready' && ready.index === 1 && ready.topic.id === t2 && ready.cards.length === 0 && ready.timer === null && ready.reveal === 'hidden');
  check('그 반 기기도 주제 2를 보고 기다린다 (친구 카드 없음)', [a1, a2, a3].every((p) => p.s.view.agora?.phase === 'ready' && p.s.view.agora.topic.id === t2 && p.s.view.agora.cards.length === 0));
  check('준비 중에는 별을 줄 수 없다', (await post({ type: 'agora-star', studentId: studentId(A, 3) })).ok && rewarded().length === 2 && !answerOf(3)?.star);
  check('준비 중에는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t2, text: 'x' }, {})).error === '선생님이 시작하면 쓸 수 있어요.');
  check('지나간 주제에는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: 'x' }, {})).error === '주제가 바뀌었어요. 화면을 확인해 주세요.');
  check('주제 2 쓰기 시작', (await post({ type: 'agora-start' })).ok);
  await sleep(300);
  const t5 = display.view.agora?.timer;
  check('주제 2는 자기 입력 시간(5분)으로 흐르고, 들어온 학생 카드가 다시 생긴다', display.view.agora?.phase === 'writing' && t5 && t5.endsAt - t5.startedAt === 300_000 && [1, 2, 3].every((n) => card(n) && !card(n)!.sent));
  check('1번이 주제 2에 답한다', (await post({ type: 'agora-answer', token: a1.token, topicId: t2, text: T2A }, {})).ok);
  await sleep(Math.max(0, burstAt + 10_500 - Date.now()));
  check('3번이 주제 2에 답한다', (await post({ type: 'agora-answer', token: a3.token, topicId: t2, text: '주제2 BETA-T2' }, {})).ok);
  check('쓰는 중에 건너뛰기', (await post({ type: 'agora-next' })).ok);
  await sleep(300);
  check('건너뛰면 쓰기가 끝나고 주제 3이 준비로 뜬다', display.view.agora?.phase === 'ready' && display.view.agora.index === 2 && display.view.agora.timer === null && teacher.view.agora.live?.timer === null);
  check('건너뛴 주제 2의 답은 남는다', liveAnswers(t2).length === 2 && topic(t2).counts[A.id] === 2);
  check('건너뛴 주제에는 더 쓸 수 없다', (await post({ type: 'agora-answer', token: a2.token, topicId: t2, text: 'x' }, {})).error === '주제가 바뀌었어요. 화면을 확인해 주세요.');
  check('주제 3은 쓰지 않고 건너뛴다', (await post({ type: 'agora-next' })).ok);
  await sleep(300);
  const end = display.view.agora;
  check('마지막 주제 뒤는 끝: 함께 쓴 답 수와 주제마다 낸 수, 건너뛴 주제', end?.phase === 'end' && end.end?.answers === 5 && end.end.topics.map((t: View) => (t.skipped ? '-' : `${t.sent}/${t.of}`)).join() === '3/3,2/3,-', JSON.stringify(end?.end?.topics));
  check('끝 화면의 캐릭터 행진은 들어온 학생들', end?.end?.parade.map((p: View) => p.number).join() === '1,2,3');
  check('끝 화면에 오늘의 보상 받은 친구 수, 행진에는 받은 친구 표시', end?.end?.rewarded === 2 && end.end.parade.map((p: View) => (p.rewarded ? 1 : 0)).join() === '1,1,0');
  check('끝에서 받은 학생 폰은 받은 보상을 본다', a1.s.view.agora?.praise?.itemId === REWARD.id && a3.s.view.agora?.praise === null);
  check('끝 화면에는 답의 글이 없다 (수만)', !JSON.stringify(end?.end).includes('ALPHA-T2') && !JSON.stringify(end?.end).includes('고친 답') && end?.cards.length === 0);
  check('1번 기기는 끝에서 오늘 쓴 자기 답을 본다', JSON.stringify(a1.s.view.agora?.end?.map((x: View) => [x.n, x.text])) === JSON.stringify([[1, '고친 답'], [2, T2A]]));
  check('2번 기기의 끝에는 자기 답만 있다', JSON.stringify(a2.s.view.agora?.end?.map((x: View) => x.text)) === JSON.stringify(['again']) && !leaks(a2.s, T2A));
  check('끝에서는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t3, text: 'x' }, {})).error === '마감됐어요.');
  await post({ type: 'agora-next' });
  await sleep(100);
  check('끝 뒤에는 다음이 없다', display.view.agora?.phase === 'end');

  section('닫기와 다시 열기');
  check('선생님이 아고라를 닫는다', (await post({ type: 'agora-end' })).ok);
  await sleep(200);
  check('닫음: 프로젝터와 기기는 처음 화면으로', !display.view.agora && phones.every((p) => !p.s.view.agora) && teacher.view.agora.live === null);
  const closedA = await classAnswers(agoraId, A.id);
  check('그때 따로 공개한 답이 있었다', (closedA.answers?.[t1] as View[] | undefined)?.some((x) => x.shown === true));

  section('선생님 화면의 답');
  const seen = JSON.stringify(teacher.view);
  const runAt = (agora().runs as View[]).find((r) => r.classId === A.id)?.at;
  check('수업이 없으면 선생님 화면에 답의 글은 없고, 주제마다 반별 답 수·쓴 학생 수·수업 날만 있다', !seen.includes('고친 답') && !seen.includes('ALPHA-T2') && topic(t1).counts[A.id] === 3 && topic(t2).counts[A.id] === 2 && topic(t3).total === 0 && agora().writers[A.id] === 3 && agora().lessons[A.id] === runAt, JSON.stringify([agora().writers, agora().lessons]));
  check('답 카드는 고른 반의 답을 주제마다 받아 온다', closedA.ok && closedA.answers[t1].length === 3 && closedA.answers[t2].length === 2 && closedA.answers[t3].length === 0 && JSON.stringify(closedA.answers).includes('고친 답'));
  const closedB = await classAnswers(agoraId, B.id);
  check('…다른 반을 고르면 그 반의 답만 (여기서는 하나도 없음)', closedB.ok && Object.values(closedB.answers as Record<string, View[]>).every((x) => x.length === 0) && !JSON.stringify(closedB).includes('고친 답'));
  check('답 받아 오기는 선생님만: 선생님 쿠키가 없으면 막힌다 (학생 기기처럼)', (await classAnswers(agoraId, A.id, {})).status === 403);
  check('…다른 사이트에서 온 요청도 막힌다', (await classAnswers(agoraId, A.id, { ...TEACHER, 'Sec-Fetch-Site': 'cross-site' })).status === 403);
  check('없는 아고라의 답은 받아 오지 못한다', (await classAnswers('no-such-agora', A.id)).status === 404);
  await post({ type: 'agora-open', agoraId, classId: A.id });
  await sleep(300);
  check('같은 반에서 다시 열면 첫 주제부터, 그 반의 답이 이어진다', a1.s.view.agora?.topic.id === t1 && a1.s.view.agora.mine?.text === '고친 답');
  check('다시 열면 한 장씩 공개·숨김은 풀리고 비공개로 시작한다', teacher.view.agora.live?.reveal === 'hidden' && liveAnswers().length === 3 && liveAnswers().every((x) => x.shown === null));
  await post({ type: 'agora-end' });
  await post({ type: 'agora-open', agoraId, classId: B.id });
  await post({ type: 'agora-start' });
  await sleep(300);
  check('다른 반으로 열면 그 반 카드만 나온다', display.view.agora?.className === B.name && (display.view.agora.cards as View[]).map((c) => c.number).join() === '7');
  check('그 반 기기에는 앞 반의 답이 가지 않는다', !JSON.stringify(b1.s.raw).includes('고친 답') && !display.view.agora.cards.some((c: View) => c.text !== undefined));
  check('선생님 화면에도 다른 반의 답 글은 오지 않는다 (지금 수업 중인 반의 답만)', !JSON.stringify(teacher.view).includes('고친 답') && Object.values(teacher.view.agora.live?.answers ?? {}).every((x) => (x as View[]).length === 0));
  await post({ type: 'agora-end' });
  await sleep(200);

  section('다시 보기');
  const runA = (agora().runs as View[]).find((r) => r.classId === A.id)?.at;
  check('답이 없는 반은 다시 볼 수 없다', (await post({ type: 'agora-review', agoraId, classId: B.id })).error === '이 반은 이 아고라에 쓴 답이 없어요.');
  check('다음 시간에 그 반의 답을 다시 연다', (await post({ type: 'agora-review', agoraId, classId: A.id })).ok);
  await sleep(300);
  check('대기실: 프로젝터와 기기는 다시 보기와 그 수업 날을 안다', display.view.agora?.phase === 'lobby' && display.view.agora.review === runA && a1.s.view.agora?.review === runA);
  check('함께 보기', (await post({ type: 'agora-start' })).ok);
  await sleep(300);
  check('함께 보기: 쓰기 없이 지난 답 카드가 비공개로 뜬다', display.view.agora?.phase === 'closed' && display.view.agora.reveal === 'hidden' && display.view.agora.timer === null && (display.view.agora.cards as View[]).every((c) => c.sent && c.text === undefined));
  check('다시 보기에서는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: 'x' }, {})).error === '마감됐어요.');
  check('지난 수업의 별이 카드에 남아 있다', card(1)?.star === true && card(2)?.star === true && card(3)?.star === undefined);
  check('다시 보기에서도 별을 준다 (3번)', (await post({ type: 'agora-star', studentId: studentId(A, 3) })).ok);
  await sleep(200);
  check('다시 보기는 새 수업이라 3번이 보상을 받는다', owns(a3) && a3.s.view.agora?.praise?.itemId === REWARD.id && rewarded().join() === studentId(A, 3));
  await post({ type: 'agora-reveal', public: true });
  await sleep(200);
  check('공개하면 지난 답이 프로젝터와 그 반 기기에 간다', card(1)?.text === '고친 답' && phoneCard(a2, 1)?.text === '고친 답');
  check('다른 반 기기는 여전히 아무 답도 받지 않았다', !JSON.stringify(b1.s.raw).includes('고친 답'));
  check('다시 쓰기', (await post({ type: 'agora-rewrite' })).ok);
  await sleep(300);
  const tr = display.view.agora?.timer;
  check('다시 쓰기: 그 주제의 입력 시간으로 쓰기가 열린다', display.view.agora?.phase === 'writing' && tr && tr.endsAt - tr.startedAt === 600_000);
  check('1번이 고쳐 쓴다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '다시 쓴 답' }, {})).ok);
  await sleep(300);
  const rewritten = liveAnswers().find((a) => a.studentId === studentId(A, 1));
  check('선생님 화면에 처음 답과 고친 답이 함께 남는다', rewritten?.text === '다시 쓴 답' && rewritten.first === '고친 답');
  check('1번 기기는 자기 처음 답을 받는다', a1.s.view.agora?.mine?.text === '다시 쓴 답' && a1.s.view.agora.mine.first === '고친 답');
  check('처음 답은 프로젝터와 친구 기기에 가지 않는다', !display.raw.some((r) => r.includes('"first"')) && ![a2, a3, b1].some((p) => p.s.raw.some((r) => r.includes('"first":"고친 답"'))));
  check('다시 쓰기에서는 답을 지울 수 없다', (await post({ type: 'agora-unanswer', token: a1.token, topicId: t1 }, {})).error?.includes('지울 수 없어요'));
  check('한 번 더 고친다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '또 고친 답' }, {})).ok);
  await sleep(200);
  check('처음 답은 맨 처음 것 그대로다', liveAnswers().find((a) => a.studentId === studentId(A, 1))?.first === '고친 답');
  check('고쳐 써도 별은 답에 남는다', answerOf(1)?.star === true);
  await post({ type: 'agora-star', studentId: studentId(A, 1) });
  await post({ type: 'agora-star', studentId: studentId(A, 1) });
  await sleep(200);
  check('이미 가진 아이템을 다시 받으면 이미 가지고 있다고 알린다', a1.s.view.agora?.praise?.alreadyOwned === true && rewarded().length === 2);
  await post({ type: 'agora-close' });
  check('다시 보기의 다음 주제', (await post({ type: 'agora-next' })).ok);
  await sleep(300);
  check('다음 주제도 지난 답만 비공개로: 그 주제에 답한 학생 카드만 (들어왔어도 안 쓴 2번은 없음)', display.view.agora?.phase === 'closed' && display.view.agora.index === 1 && display.view.agora.reveal === 'hidden' && (display.view.agora.cards as View[]).map((c) => c.number).join() === '1,3');
  await post({ type: 'agora-next' });
  await sleep(200);
  check('답이 없는 주제는 카드 없이 뜬다', display.view.agora?.index === 2 && display.view.agora.cards.length === 0);
  await post({ type: 'agora-next' });
  await sleep(200);
  check('다시 보기는 마지막 주제 뒤에 끝 화면 없이 머문다 (아고라 닫기로 마침)', display.view.agora?.phase === 'closed' && display.view.agora.index === 2);
  check('다시 보기는 반 기록(수업 날)을 바꾸지 않는다', (agora().runs as View[]).find((r) => r.classId === A.id)?.at === runA);
  await post({ type: 'agora-end' });
  await sleep(300);

  section('내 답 노트');
  const note = (p: Phone) => (p.s.view.agoraNotes as View[] | null | undefined)?.find((n) => n.id === agoraId);
  check('1번 기기의 내 답 노트에 자기 답이 주제마다, 처음 답과 함께 있다', JSON.stringify(note(a1)?.topics.map((x: View) => [x.n, x.text, x.first])) === JSON.stringify([[1, '또 고친 답', '고친 답'], [2, T2A, null]]), JSON.stringify(note(a1)?.topics));
  check('2번 기기의 노트에는 자기 답만 있다', JSON.stringify(note(a2)?.topics.map((x: View) => x.text)) === JSON.stringify(['again']) && !JSON.stringify(a2.s.view.agoraNotes).includes('고친 답'));
  check('답이 없는 반 기기의 노트에는 그 아고라가 없다', !note(b1));
  check('내 답 노트에도 별이 남는다', note(a1)?.topics[0]?.star === true && note(a2)?.topics[0]?.star === true && note(a1)?.topics[1]?.star === false);

  section('아고라 만들기와 고치기');
  check('제목이 없으면 만들지 않는다', (await post({ type: 'agora-add', title: ' ', topics: [{ text: 'x' }] })).error === '제목을 써 주세요.');
  check(`제목은 ${TITLE_MAX}자까지`, (await post({ type: 'agora-add', title: 'ㄱ'.repeat(TITLE_MAX + 1), topics: [{ text: 'x' }] })).error?.includes(`${TITLE_MAX}자`));
  check('주제가 없으면 만들지 않는다', (await post({ type: 'agora-add', title: `${MARK} 빈`, topics: [{ text: '', note: '' }] })).error === '주제를 하나 이상 써 주세요.');
  check('보조 설명만 쓴 줄은 몇 번 줄인지 알려 준다', (await post({ type: 'agora-add', title: `${MARK} 빈`, topics: [{ text: '하나' }, { note: '설명만' }] })).error === '2번 줄의 주제(질문)를 써 주세요.');
  check(`주제는 ${TOPICS_MAX}개까지`, (await post({ type: 'agora-add', title: `${MARK} 많음`, topics: Array.from({ length: TOPICS_MAX + 1 }, (_, i) => ({ text: `주제 ${i}` })) })).error?.includes(`${TOPICS_MAX}개`));
  const gaps: string = (await post({ type: 'agora-add', title: `${MARK} 빈 줄`, topics: [{ text: '하나' }, { text: '', note: '' }, { text: '둘' }] })).agoraId;
  await sleep(200);
  check('빈 줄은 빼고 만든다', agora(gaps)?.topics.map((t: View) => t.text).join() === '하나,둘');
  const otherTopic = agora(other).topics[0].id;
  const edited = await post({
    type: 'agora-edit',
    agoraId,
    title: `${MARK} 고친 아고라`,
    topics: [{ id: t3, text: '세 번째 주제', minutes: null }, { id: t1, text: '시험 주제 (고침)', minutes: 3 }, { text: '새 주제' }, { id: otherTopic, text: '남의 주제' }],
  });
  await sleep(300);
  const after = agora();
  check('아고라를 고친다: 순서를 바꾸고, 고치고, 더하고, 뺀다', edited.ok && after.title === `${MARK} 고친 아고라` && after.topics.map((t: View) => t.text).join() === '세 번째 주제,시험 주제 (고침),새 주제,남의 주제');
  check('고친 주제는 그 답을 지킨다', after.topics[1].id === t1 && after.topics[1].minutes === 3 && after.topics[1].total === 3);
  check('뺀 주제는 그 답과 함께 지워진다', !after.topics.some((t: View) => t.id === t2) && !(teacher.view.agora.agoras as View[]).some((a) => (a.topics as View[]).some((t) => t.id === t2)));
  check('다른 아고라의 주제 id를 보내도 새 주제가 된다 (남의 주제는 그대로)', after.topics[3].id !== otherTopic && agora(other).topics[0].id === otherTopic && agora(other).topics[0].text === '다른 주제');

  section('입력 시간');
  const a3m: string = (await post({ type: 'agora-add', title: `${MARK} 3분`, topics: [{ text: '3분 주제', minutes: 3 }] })).agoraId;
  const aNone: string = (await post({ type: 'agora-add', title: `${MARK} 시간 제한 없음`, topics: [{ text: '시간 제한 없는 주제', minutes: null }] })).agoraId;
  await sleep(200);
  const t3m: string = agora(a3m).topics[0].id;
  const tNone: string = agora(aNone).topics[0].id;
  await post({ type: 'agora-open', agoraId: a3m, classId: A.id });
  await sleep(200);
  check('대기실에서는 시계가 흐르지 않는다', display.view.agora?.phase === 'lobby' && display.view.agora.timer === null);
  await post({ type: 'agora-howto' });
  await sleep(12_500);
  check('놀이 방법은 12초 뒤 저절로 끝난다', display.view.agora?.howtoAt === null && teacher.view.agora.live?.howto === false);
  await post({ type: 'agora-start' });
  await sleep(200);
  const tm = display.view.agora?.timer;
  check('3분 주제: 프로젝터·기기·선생님 화면이 같은 시계를 받는다', tm && tm.endsAt - tm.startedAt === 180_000 && a1.s.view.agora?.timer?.endsAt === tm.endsAt && teacher.view.agora.live?.timer?.endsAt === tm.endsAt);
  check('+1분', (await post({ type: 'agora-time', minutes: 1 })).ok);
  await sleep(200);
  check('+1분은 끝을 1분 늦춘다', display.view.agora.timer.endsAt - tm.endsAt === 60_000);
  for (let i = 0; i < 5; i++) await post({ type: 'agora-time', minutes: -1 });
  await sleep(200);
  const left = display.view.agora.timer.endsAt - Date.now();
  check('−1분을 거듭해도 10초는 남는다', left > 8000 && left <= 10_500, `${left} ms`);
  await sleep(left + 1500);
  check('0이 되면 저절로 마감되고 화면에는 남는다', display.view.agora?.phase === 'closed' && display.view.agora.timer === null && a1.s.view.agora?.phase === 'closed');
  check('시간이 끝나면 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t3m, text: 'late' }, {})).error === '마감됐어요.');
  await post({ type: 'agora-end' });
  await post({ type: 'agora-open', agoraId: aNone, classId: A.id });
  await sleep(200);
  await drawDone();
  await post({ type: 'agora-start' });
  await sleep(200);
  check('시간 제한이 없는 주제에는 시계가 없다', display.view.agora?.topic.id === tNone && display.view.agora.phase === 'writing' && display.view.agora.timer === null);
  check('시간 제한이 없으면 ±1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.timer === null);
  await post({ type: 'agora-end' });

  section('오늘의 보상 뽑기');
  // 무작위: each lesson draws in its 대기실, at random among the items the fewest of the class own (here all but REWARD,
  // which 1~3번 got for their ⭐), never the one just drawn, and the item is fixed as the lesson leaves the 대기실.
  check('[다른 아고라]의 보상은 무작위 그대로다', agora(other).reward?.itemId === RANDOM_REWARD);
  const openedAt = Date.now();
  await post({ type: 'agora-open', agoraId: other, classId: A.id });
  await sleep(300);
  const prize = (): View => teacher.view.agora.live?.reward ?? {};
  const lesson: string = teacher.view.agora.live?.id;
  const drawn1 = prize();
  check('대기실을 열면 저절로 뽑는다: 선생님 화면·프로젝터·폰이 같은 뽑기를 받는다', drawn1.random === true && typeof drawn1.itemId === 'string' && drawn1.seq === 1 && drawn1.revealAt > openedAt && display.view.agora?.reward?.itemId === drawn1.itemId && display.view.agora.reward.revealAt === drawn1.revealAt && a2.s.view.agora?.reward?.seq === 1, JSON.stringify(drawn1));
  check('…반 학생들이 가진 아이템(시험 보상)은 뽑지 않는다', drawn1.itemId !== REWARD.id);
  check('뽑는 동안에는 쓰기를 시작할 수 없다', (await post({ type: 'agora-start' })).error === '보상을 뽑는 중이에요. 다 뽑히면 시작해요.' && teacher.view.agora.live?.phase === 'lobby');
  await post({ type: 'draw-reward', id: lesson, seq: 1 });
  await sleep(200);
  check('…뽑는 동안 [다시 뽑기]는 아무것도 하지 않는다', prize().seq === 1 && prize().itemId === drawn1.itemId);
  await drawDone();
  await post({ type: 'draw-reward', id: lesson, seq: 0 });
  await post({ type: 'draw-reward', id: 'an-older-lesson', seq: 1 });
  await sleep(200);
  check('지난 뽑기나 다른 수업을 가리키는(늦게 도착한) [다시 뽑기]는 무시된다', prize().seq === 1 && prize().itemId === drawn1.itemId);
  check('[다시 뽑기]', (await post({ type: 'draw-reward', id: lesson, seq: 1 })).ok);
  await post({ type: 'draw-reward', id: lesson, seq: 1 });
  await sleep(200);
  const drawn2 = prize();
  check('…방금 것과 다른 아이템을 한 번만 새로 뽑는다 (두 번 온 클릭은 무시)', drawn2.seq === 2 && drawn2.itemId !== drawn1.itemId && drawn2.itemId !== REWARD.id && display.view.agora?.reward?.itemId === drawn2.itemId, JSON.stringify(drawn2));
  await drawDone();
  check('다 뽑히면 쓰기를 시작한다', (await post({ type: 'agora-start' })).ok);
  await post({ type: 'draw-reward', id: lesson, seq: 2 });
  await sleep(200);
  check('…시작하면 보상이 정해져 [다시 뽑기]는 아무것도 하지 않는다', prize().seq === 2 && prize().itemId === drawn2.itemId);
  const tOther: string = agora(other).topics[0].id;
  await post({ type: 'agora-answer', token: a1.token, topicId: tOther, text: '뽑기 점검' }, {});
  await sleep(200);
  await post({ type: 'agora-star', studentId: studentId(A, 1), topicId: tOther, star: true });
  await sleep(300);
  check('⭐을 받으면 그 수업에 뽑힌 아이템을 받는다', a1.s.view.agora?.praise?.itemId === drawn2.itemId && (a1.s.view.me?.inventory as string[]).includes(drawn2.itemId));
  await post({ type: 'agora-end' });
  await sleep(200);

  section('받아쓰기');
  const SENTENCE = 'Where did you go last weekend?';
  const SKIPPED = 'My brother let me ride his bike.';
  /** Whether a stream ever carried words only the sentence has. */
  const carried = (st: Stream, words: string) => st.raw.some((r) => r.includes(words));
  check('받아쓰기 문장이 없으면 만들지 않는다', (await post({ type: 'agora-add', title: `${MARK} 빈 받아쓰기`, topics: [{ kind: 'dictation', text: '', note: 'x' }] })).error === '1번 줄의 받아쓰기 문장을 써 주세요.');
  const dict: string = (
    await post({
      type: 'agora-add',
      title: `${MARK} 받아쓰기`,
      topics: [{ kind: 'dictation', text: SENTENCE, note: '정답이 들어간 설명' }, { text: SENTENCE, note: 'e.g. I went to the park.' }, { kind: 'dictation', text: SKIPPED }],
    })
  ).agoraId;
  await sleep(200);
  const dt = agora(dict).topics as View[];
  const [d1, w2, d3] = dt.map((t) => t.id as string);
  check('받아쓰기 주제는 문장을 따로 갖고(질문 칸은 비어 있음), 보조 설명은 없고, 입력 시간은 제한 없음', dt[0].dictation === SENTENCE && dt[0].text === '' && dt[0].note === '' && dt[0].minutes === null && dt[1].dictation === null && dt[1].text === SENTENCE);
  await post({ type: 'agora-open', agoraId: dict, classId: A.id });
  await sleep(300);
  check('대기실: 프로젝터와 폰에는 받아쓰기라는 것만 가고 문장은 없다', display.view.agora?.topic.kind === 'dictation' && display.view.agora.topic.text === '' && display.view.agora.topic.answer === undefined && a1.s.view.agora?.topic.kind === 'dictation' && a1.s.view.agora.topic.answer === undefined);
  check('[정답 공개]는 쓰기 전에는 아무것도 하지 않는다', (await post({ type: 'agora-reveal', public: true, index: 0 })).ok);
  await drawDone();
  await post({ type: 'agora-start' });
  await sleep(300);
  check('쓰기 시작: 폰과 프로젝터는 받아쓰기로 바뀌고 시계는 없다', display.view.agora?.phase === 'writing' && display.view.agora.timer === null && a1.s.view.agora?.phase === 'writing');
  check('[▶ 읽어 주기]: 프로젝터와 그 반 폰이 읽는 중인 걸 안다', (await post({ type: 'agora-speak', index: 0, on: true })).ok);
  await sleep(200);
  check('…읽는 중', display.view.agora?.listening !== null && a2.s.view.agora?.listening !== null);
  await post({ type: 'agora-speak', index: 3, on: false });
  await sleep(150);
  check('다른 주제를 가리키는 읽기 신호(늦게 도착)는 무시된다', display.view.agora?.listening !== null);
  await post({ type: 'agora-speak', index: 0, on: false });
  await sleep(150);
  check('…다 읽으면 읽는 중이 아니다', display.view.agora?.listening === null);
  check('1번이 들은 대로 쓴다(대문자·물음표 없이)', (await post({ type: 'agora-answer', token: a1.token, topicId: d1, text: 'where did you go last weekend' }, {})).ok);
  check('2번은 한 단어를 틀린다', (await post({ type: 'agora-answer', token: a2.token, topicId: d1, text: 'Where did you go last week?' }, {})).ok);
  await sleep(300);
  check('쓰는 중에 [정답 공개]는 거절된다', (await post({ type: 'agora-reveal', public: true, index: 0 })).ok && display.view.agora?.reveal === 'hidden' && display.view.agora.topic.answer === undefined);
  await post({ type: 'agora-card', number: 1, topicId: d1, shown: true });
  await post({ type: 'agora-star', studentId: studentId(A, 2), topicId: d1, star: true });
  await sleep(200);
  check('받아쓰기 카드는 하나씩 공개되지 않고, 쓰는 중에는 ⭐도 없다', (display.view.agora.cards as View[]).every((c) => c.text === undefined && !c.star));
  check('공개 전에는 문장이 프로젝터, 쓰지 않은 3번, 다른 반 폰에 한 번도 가지 않았다', !carried(display, 'go last weekend') && !carried(a3.s, 'go last weekend') && !carried(b1.s, 'go last weekend') && !carried(a2.s, 'go last weekend'));
  check('공개 전 보조 설명도 어디에도 가지 않았다', !carried(display, '정답이 들어간 설명') && !carried(a1.s, '정답이 들어간 설명'));
  check('선생님 화면은 수업 중인 반의 받아쓰기 답을 받는다', liveAnswers(d1).length === 2);
  check('3번은 한 단어를 바꿔 쓰고 두 단어를 놓친다', (await post({ type: 'agora-answer', token: a3.token, topicId: d1, text: 'Where do you go' }, {})).ok);
  await post({ type: 'agora-close' });
  await sleep(200);
  check('늦게 도착한(다른 주제를 가리키는) [정답 공개]는 무시된다', (await post({ type: 'agora-reveal', public: true, index: 2 })).ok && display.view.agora?.topic.answer === undefined);
  await sleep(150);
  check('[정답 공개]: 마감 뒤에', (await post({ type: 'agora-reveal', public: true, index: 0 })).ok);
  await sleep(300);
  check('정답 공개: 프로젝터와 그 반 폰에 문장이 간다', display.view.agora?.topic.answer === SENTENCE && a1.s.view.agora?.topic.answer === SENTENCE && a3.s.view.agora?.topic.answer === SENTENCE);
  check('…다른 반 폰에는 여전히 가지 않는다', !carried(b1.s, 'go last weekend'));
  check('…학생 카드에는 여전히 답 글이 없다', (display.view.agora.cards as View[]).every((c) => c.text === undefined) && (a3.s.view.agora.cards as View[]).every((c: View) => c.text === undefined));
  check('…2번 폰은 자기 답만 받는다(1번 답 없음)', !carried(a2.s, 'where did you go last weekend'));
  check('마감 뒤에는 ⭐를 줄 수 있다', (await post({ type: 'agora-star', studentId: studentId(A, 2), topicId: d1, star: true })).ok);
  await sleep(200);
  check('…2번 카드에 ⭐', (display.view.agora.cards as View[]).find((c) => c.number === 2)?.star === true);
  await sleep(800);
  let file = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  check('저장 파일에 예전 보상을 무작위로 바꾼 때가 남는다 (서버를 다시 켜도 한 번만 바꾸게)', typeof file.randomRewardsAt === 'number');
  check('저장: 마감 때의 답이 남고, 이 반에 공개한 받아쓰기가 남는다(서버를 다시 켜도)', file.topicAnswers[d1][studentId(A, 1)].closed === 'where did you go last weekend' && file.agoras[dict].released[A.id].includes(d1) && !file.agoras[dict].released[B.id]);
  check('정답 인정은 선생님만', (await post({ type: 'agora-accept', topicId: d1, studentId: studentId(A, 2), accepted: true }, {})).status === 403);
  check('선생님이 2번 답을 정답으로 인정한다', (await post({ type: 'agora-accept', topicId: d1, studentId: studentId(A, 2), accepted: true })).ok);
  await sleep(200);
  check('…선생님 화면에 인정이 보인다', liveAnswers(d1).find((x) => x.studentId === studentId(A, 2))?.accepted === true);
  await post({ type: 'agora-next' });
  await sleep(200);
  check('다음: 같은 질문의 작문 주제가 뜬다', display.view.agora?.topic.kind === 'writing' && display.view.agora.topic.text === SENTENCE);
  await post({ type: 'agora-next' });
  await post({ type: 'agora-start' });
  await sleep(200);
  check('세 번째 받아쓰기를 쓰다가 건너뛴다', (await post({ type: 'agora-answer', token: a1.token, topicId: d3, text: 'My brother let me ride' }, {})).ok && (await post({ type: 'agora-next' })).ok);
  await sleep(300);
  const dEnd = display.view.agora?.end;
  check('끝 화면: 받아쓰기는 문장 없이 수만', dEnd?.topics[0].kind === 'dictation' && dEnd.topics[0].text === '' && !JSON.stringify(dEnd).includes('ride his bike'));
  const myEnd = (a1.s.view.agora?.end ?? []) as View[];
  check('1번 폰의 끝: 공개한 받아쓰기는 문장과 함께, 공개하지 않은 것은 문장 없이', myEnd.find((x) => x.n === 1)?.answer === SENTENCE && myEnd.find((x) => x.n === 3)?.answer === null);
  check('공개하지 않은 받아쓰기 문장은 어느 화면에도 가지 않았다', ![display, a1.s, a2.s, a3.s, b1.s].some((st) => carried(st, 'ride his bike')));
  await post({ type: 'agora-end' });
  await sleep(300);
  const dNote = (a1.s.view.agoraNotes as View[] | null | undefined)?.find((n) => n.id === dict);
  check('내 답 노트: 공개한 받아쓰기는 문장과 내 답, 공개하지 않은 것은 내 답만', dNote?.topics.find((x: View) => x.n === 1)?.answer === SENTENCE && dNote?.topics.find((x: View) => x.n === 3)?.answer === null);
  await sleep(800);
  file = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  check('쓰다가 건너뛴 받아쓰기 답은 마감된 답이 아니다(통계에서 뺌)', file.topicAnswers[d3][studentId(A, 1)].closed === undefined);
  const csv = await fetch(`${BASE}/api/agora-answers?agoraId=${dict}&classId=${A.id}&format=csv`, { headers: TEACHER });
  const csvText = await csv.text();
  check('받아쓰기 CSV: 선생님은 받는다(정답 · 정답 인정 · 안 냄 · 중단)', csv.status === 200 && csvText.includes('받아쓰기 문장') && csvText.includes(',정답,') && csvText.includes(',정답 인정,') && csvText.includes(',안 냄,') && csvText.includes(',중단,'));
  check('…선생님 쿠키 없이는 막힌다', (await fetch(`${BASE}/api/agora-answers?agoraId=${dict}&classId=${A.id}&format=csv`)).status === 403);
  check('답이 있는 받아쓰기는 문장을 바꿀 수 없다', (await post({ type: 'agora-edit', agoraId: dict, title: `${MARK} 받아쓰기`, topics: [{ id: d1, kind: 'dictation', text: 'Where did you go?' }, { id: w2, text: SENTENCE }, { id: d3, kind: 'dictation', text: SKIPPED }] })).error?.includes('답이 있는 받아쓰기는'));
  check('…작문으로 바꿀 수도 없다', (await post({ type: 'agora-edit', agoraId: dict, title: `${MARK} 받아쓰기`, topics: [{ id: d1, text: SENTENCE }, { id: w2, text: SENTENCE }, { id: d3, kind: 'dictation', text: SKIPPED }] })).error?.includes('답이 있는 받아쓰기는'));
  // The same 아고라 opened again for the class: its 받아쓰기 opens to write again, but an answer a 마감 kept stays.
  await post({ type: 'agora-open', agoraId: dict, classId: A.id });
  await sleep(300);
  await drawDone();
  await post({ type: 'agora-start' });
  await sleep(300);
  check('같은 반에서 다시 열면 폰은 마감된 받아쓰기 답을 안다 ([내 답 지우기] 없음)', a1.s.view.agora?.phase === 'writing' && a1.s.view.agora.mine?.kept === true && a3.s.view.agora?.mine?.kept === true);
  check('…그 답은 지울 수 없다 (고쳐 내기만)', (await post({ type: 'agora-unanswer', token: a1.token, topicId: d1 }, {})).error === '마감된 받아쓰기 답은 지울 수 없어요. 고쳐서 제출해 주세요.');
  await post({ type: 'agora-end' });
  await sleep(300);

  section('아고라 통계');
  const statsRes = await fetch(`${BASE}/api/agora-stats?class=${A.id}`, { headers: TEACHER });
  const st = (await statsRes.json()) as View;
  const g2 = gradeDictation(SENTENCE, 'Where did you go last week?');
  const g3 = gradeDictation(SENTENCE, 'Where do you go');
  const near = (x: unknown, y: number) => typeof x === 'number' && Math.abs(x - y) < 1e-9;
  const sOf = (n: number): View => (st.students as View[]).find((x) => x.number === n)!;
  const sentence = (id: string): View | undefined => (st.sentences as View[]).find((x) => x.topicId === id);
  check('아고라 통계는 선생님만 (쿠키 없이는 화면용도 엑셀도 막힌다)', statsRes.status === 200 && (await fetch(`${BASE}/api/agora-stats?class=${A.id}`)).status === 403 && (await fetch(`${BASE}/api/agora-stats?class=${A.id}&format=csv`)).status === 403);
  check('…없는 반은 없다고 답한다', (await fetch(`${BASE}/api/agora-stats?class=no-such-class`, { headers: TEACHER })).status === 404);
  check('받아쓰기는 처음 마감 때 답으로: 1번 정답, 2번 정답 인정, 3번 틀림, 4번은 기록 없음', sOf(1).dictation.right === 1 && sOf(1).dictation.graded === 1 && sOf(2).dictation.right === 1 && sOf(2).dictation.accepted === 1 && near(sOf(2).dictation.accuracy, g2.accuracy) && sOf(3).dictation.right === 0 && sOf(3).dictation.graded === 1 && near(sOf(3).dictation.accuracy, g3.accuracy) && sOf(4).dictation.graded === 0 && sOf(4).dictation.accuracy === null, JSON.stringify((st.students as View[]).map((x) => x.dictation)));
  check('…쓰다가 건너뛴 받아쓰기는 중단: 0점으로 세지 않는다', sOf(1).dictation.stopped === 1 && near(sOf(1).dictation.accuracy, 1) && (sOf(1).entries as View[]).map((e) => e.result).join() === 'right,stopped');
  check('…반 전체는 모든 답을 한꺼번에 (정답 2/3, 정확도는 세 답의 평균)', st.class.right === 2 && st.class.graded === 3 && near(st.class.accuracy, (1 + g2.accuracy + g3.accuracy) / 3), JSON.stringify(st.class));
  check('자주 놓친 말: 정답 인정 답은 빼고, 한 답에서 한 번씩', (sOf(2).missed as View[]).length === 0 && (sOf(3).missed as View[]).map((m) => m.word).sort().join() === 'did,last,weekend', JSON.stringify(sOf(3).missed));
  check('문장별: 반이 한 순서대로, 반이 놓친 말은 두 명 이상만', sentence(d1)?.right === 2 && sentence(d1)?.graded === 3 && sentence(d1)?.missed.length === 0 && sentence(d3)?.graded === 0 && sentence(d3)?.accuracy === null && (st.sentences as View[]).findIndex((x) => x.topicId === d1) < (st.sentences as View[]).findIndex((x) => x.topicId === d3));
  check('작문은 점수 없이 낸 수만 (받아쓰기 기록에 작문은 없다)', sOf(1).writing >= 1 && sOf(4).writing === 0 && sOf(4).stars === 0 && (st.students as View[]).every((x) => (x.entries as View[]).every((e) => e.topicId === d1 || e.topicId === d3)));
  check('다른 반 통계에는 이 반 받아쓰기가 없다', ((await (await fetch(`${BASE}/api/agora-stats?class=${B.id}`, { headers: TEACHER })).json()) as View).sentences.length === 0);
  const sCsv = await fetch(`${BASE}/api/agora-stats?class=${A.id}&format=csv`, { headers: TEACHER });
  const sCsvText = await sCsv.text();
  check('반 전체 받아쓰기 엑셀: 아고라 이름과 결과(정답 · 정답 인정 · 틀림 · 중단 · 안 냄)', sCsv.status === 200 && sCsvText.includes(`${MARK} 받아쓰기`) && [',정답,', ',정답 인정,', ',틀림,', ',중단,', ',안 냄,'].every((x) => sCsvText.includes(x)));
  const g = (target: string, answer: string) => gradeDictation(target, answer);
  check('채점: 대소문자와 문장부호는 보지 않는다', g('What did you do?', 'what did you do').perfect);
  check('채점: 15와 fifteen은 같다', g('I have 15 apples.', 'I have fifteen apples').perfect);
  check('채점: 21은 twenty-one과 하이픈 없는 twenty one 모두 (쉼표로 나눈 twenty, one은 아님)', g('I am 21 years old.', 'I am twenty one years old').perfect && g('He is twenty one.', 'he is twenty-one').perfect && !g('I am 21.', 'I am twenty, one').perfect);
  check('채점: 줄임말은 들린 대로(don’t ≠ do not)', !g("I don't like it.", 'I do not like it').perfect && g("I don’t like it.", "I don't like it").perfect);
  check('채점: 한 단어가 빠져도 뒤는 맞게 줄을 맞춘다(5/6)', Math.round(g('I go to school every day.', 'I go school every day').accuracy * 6) === 5);
  // [▶ 읽어 주기]'s sound file: on a Mac the laptop's own voice as a WAV, slow and loud; elsewhere 501 (the browser reads).
  const speech = (text: string, headers: Record<string, string> = TEACHER) =>
    fetch(`${BASE}/api/speech`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const wav = await speech(SENTENCE);
  const wavBytes = Buffer.from(await wav.arrayBuffer());
  check('읽어 주기 소리 파일: 맥이면 문장을 천천히 읽은 WAV(6단어에 2초 넘게), 아니면 501', wav.status === 501 || (wav.status === 200 && wav.headers.get('content-type') === 'audio/wav' && wavBytes.toString('ascii', 0, 4) === 'RIFF' && wavBytes.length > 44 + 22050 * 2 * 2));
  check('…선생님 쿠키 없이는 막힌다', (await speech(SENTENCE, {})).status === 403);
  check('…다른 사이트에서 온 요청도 막힌다', (await speech(SENTENCE, { ...TEACHER, 'Sec-Fetch-Site': 'cross-site' })).status === 403);
  check('…빈 문장과 너무 긴 문장은 받지 않는다', (await speech('  ')).status === 400 && (await speech('a'.repeat(301))).status === 400);
  // Whether the laptop makes them, which keeps [▶ 읽어 주기] on whatever voices the browser lists: teacher only.
  const can = await fetch(`${BASE}/api/speech`, { headers: TEACHER });
  check('…만들 수 있는지는 선생님만 묻고, 맥이면 된다고(아니면 501) 답한다', (await fetch(`${BASE}/api/speech`)).status === 403 && (can.status === 200 || can.status === 501) && can.status === wav.status);

  section('아레나 뒤 아고라');
  // The arena's results stay up until the teacher closes it, and only then does an 아고라 open. [대기실 닫기] and
  // [아레나 닫기] carry the arena they meant, and close only a 대기실 or results, never a quiz going on.
  if (teacher.view.agora.live) await post({ type: 'agora-end' });
  const draft = await fetch(`${BASE}/api/words`, { method: 'POST', headers: { ...TEACHER, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${MARK} 아레나`, words: [{ spelling: 'apple', meaning: '사과' }, { spelling: 'banana', meaning: '바나나' }, { spelling: 'cherry', meaning: '체리' }, { spelling: 'grape', meaning: '포도' }] }) }).then((r) => r.json() as Promise<View>);
  const quizId: string | undefined = (await post({ type: 'create-event', draftId: draft.draftId })).eventIds?.[0];
  check('시험 아레나 이벤트를 만든다', !!quizId, draft.error);
  await post({ type: 'open-lobby', eventId: quizId, classId: A.id });
  await sleep(300);
  check('새 아레나 이벤트의 보상도 무작위로 시작한다', (teacher.view.events as View[]).find((e) => e.id === quizId)?.reward?.itemId === RANDOM_REWARD);
  const arenaId: string | undefined = teacher.view.live?.id;
  const arenaPrize = (): View => teacher.view.live?.reward ?? {};
  const arenaDrawn = arenaPrize();
  check('아레나 대기실도 열 때 저절로 뽑고, 프로젝터가 같은 뽑기를 받는다', arenaDrawn.random === true && typeof arenaDrawn.itemId === 'string' && arenaDrawn.seq === 1 && display.view.session?.reward?.itemId === arenaDrawn.itemId && display.view.session.reward.revealAt === arenaDrawn.revealAt, JSON.stringify(arenaDrawn));
  check('…뽑는 동안에는 퀴즈를 시작할 수 없다', (await post({ type: 'control', action: 'start' })).error === '보상을 뽑는 중이에요. 다 뽑히면 시작해요.' && teacher.view.live?.phase === 'lobby');
  check('아레나(대기실)가 열려 있으면 아고라는 열리지 않는다', !!arenaId && !!(await post({ type: 'agora-open', agoraId, classId: A.id })).error?.includes('아레나가 열려'));
  await post({ type: 'close-session', id: 'an-older-arena' });
  await sleep(200);
  check('다른(지난) 아레나를 가리키는 닫기는 아무것도 닫지 않는다', teacher.view.live?.id === arenaId);
  await drawDone();
  check('아레나 대기실의 [다시 뽑기]', (await post({ type: 'draw-reward', id: arenaId, seq: 1 })).ok);
  await sleep(200);
  check('…다른 아이템을 뽑아 프로젝터도 같은 것을 받는다', arenaPrize().seq === 2 && arenaPrize().itemId !== arenaDrawn.itemId && display.view.session?.reward?.itemId === arenaPrize().itemId);
  await drawDone();
  await post({ type: 'control', action: 'start' });
  await sleep(500);
  check('퀴즈가 진행 중이면 닫기를 거절한다(결과를 잃지 않게)', !!(await post({ type: 'close-session', id: arenaId })).error?.includes('진행 중') && teacher.view.live?.id === arenaId);
  await post({ type: 'control', action: 'end' });
  await sleep(500);
  const summaryUp = teacher.view.live?.phase === 'summary';
  const closed = (await post({ type: 'close-session', id: arenaId })).ok;
  await sleep(200);
  check('결과 화면은 [아레나 닫기]로 닫힌다', summaryUp && closed && !teacher.view.live);
  check('아레나를 닫으면 아고라를 연다', (await post({ type: 'agora-open', agoraId, classId: A.id })).ok);
  await post({ type: 'agora-end' });
  // Nobody answered a question, so no class has a record of it: [지우기] takes it out of the file too (one a class
  // played would only leave the list, for its records).
  if (quizId) await post({ type: 'delete-event', eventId: quizId });
  await sleep(700);
  const afterDelete = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  check('아무도 안 푼 이벤트를 지우면 목록과 저장 파일에서 모두 사라진다', !!quizId && !(teacher.view.events as View[]).some((e) => e.id === quizId) && !afterDelete.events?.[quizId]);

  section('코드');
  const sinks = htmlSinks(join(process.cwd(), 'src'));
  check('화면은 답을 HTML로 넣지 않는다 (HTML로 넣는 곳은 서버가 그린 QR 그림뿐)', sinks.every((m) => m === QR_HTML), sinks.filter((m) => m !== QR_HTML).join(' | '));
  return { classIds: [A.id, B.id], agoraIds: [agoraId, other, gaps, a3m, aNone, dict], topicIds: [t1, t2, t3, t3m, tNone, d1, w2, d3] };
}

async function main() {
  const teacher = stream(`${BASE}/api/stream?role=teacher`, TEACHER);
  const display = stream(`${BASE}/api/stream?role=display`, TEACHER);
  await sleep(600);
  if (!teacher.view.classes) throw new Error('선생님 화면 연결 실패: 서버가 켜져 있나요?');
  let made: Awaited<ReturnType<typeof run>>;
  try {
    await cleanUp(teacher);
    if (teacher.view.live || teacher.view.agora.live) throw new Error('아레나나 아고라가 열려 있어요. 수업이 끝난 뒤에 다시 해 주세요.');
    made = await run(teacher, display);
  } finally {
    await cleanUp(teacher);
  }

  section('뒷정리');
  await sleep(800);
  const saved = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  const left = [
    ...(Object.values(saved.classes ?? {}) as View[]).filter((c) => made.classIds.includes(c.id)).map((c) => c.name),
    ...(Object.values(saved.students ?? {}) as View[]).filter((s) => made.classIds.includes(s.classId)).map((s) => s.name),
    ...made.agoraIds.filter((id) => saved.agoras?.[id]),
    ...made.topicIds.filter((id) => saved.topicAnswers?.[id]),
  ];
  check('시험반과 그 학생·아고라·답이 저장 파일에 남지 않았다', left.length === 0, left.join(', '));
  for (const s of streams) s.controller.abort();
  console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  for (const s of streams) s.controller.abort();
  process.exit(1);
});

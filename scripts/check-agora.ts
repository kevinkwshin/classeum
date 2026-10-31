// Checks 아고라's safety rules against a running Classeum server the way a class uses it: the teacher screen, the
// projector and five phones over the real streams and actions, through 대기실, 쓰기, 마감, 다음 주제 and the 끝, then
// 다시 보기 and 다시 쓰기 in a later lesson, each phone's 내 답 노트, and the teacher's ⭐ with its reward. It makes two classes of its own (아고라점검A
// and 아고라점검B) and 아고라 titled [아고라점검], and deletes them with their students and answers at the end, so real
// classes, 아고라 and records are never touched. It stops before doing anything if the arena or an 아고라 is open.
// Usage (from the project folder, with the server on): npm run check:agora -- [baseUrl=http://localhost:3000]
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_MAX, TITLE_MAX, TOPICS_MAX } from '../src/lib/agora';
import { ATTENDANCE_UNLOCKS, QUIZ_REWARD_ITEMS } from '../src/lib/items';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PREFIX = '아고라점검';
const MARK = `[${PREFIX}]`;
const DATA = join(process.cwd(), '.data');
// Acts as the teacher with the key the server keeps in .data, like npm run sim.
const TEACHER = { Cookie: `cls_teacher=${readFileSync(join(DATA, 'teacher-key'), 'utf8').trim()}` };
const TEACHER_ONLY = [
  'agora-add', 'agora-edit', 'agora-delete', 'agora-open', 'agora-review', 'agora-howto', 'agora-start', 'agora-rewrite', 'agora-close',
  'agora-next', 'agora-end', 'agora-time', 'agora-reveal', 'agora-settings', 'agora-page', 'agora-pages', 'agora-music', 'agora-card',
  'agora-card-delete', 'agora-reward', 'agora-star',
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
  await post({ type: 'roster', classId: A.id, text: '1 김하람\n2 이도윤\n3 박지후\n4 최아린' });
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
  check('주제는 쓴 순서대로, 주제마다 입력 시간·열·순서를 따로 가진다', agora().topics.length === 3 && topic(t1).minutes === 10 && topic(t1).columns === 3 && topic(t1).sort === 'time' && topic(t2).minutes === 5 && topic(t3).minutes === null);
  const REWARD = QUIZ_REWARD_ITEMS[3];
  check('아고라는 만들 때 보상 아이템을 하나 가진다 (아레나 이벤트처럼)', QUIZ_REWARD_ITEMS.some((i) => i.id === agora().reward?.itemId));
  check('출석 아이템은 보상으로 고를 수 없다', (await post({ type: 'agora-reward', agoraId, itemId: ATTENDANCE_UNLOCKS[0] })).error === '그 아이템은 보상으로 고를 수 없어요.');
  check('없는 아이템도 고를 수 없다', (await post({ type: 'agora-reward', agoraId, itemId: 'no-such-item' })).error === '그 아이템은 보상으로 고를 수 없어요.');
  check('선생님이 이번 아고라 보상을 고른다', (await post({ type: 'agora-reward', agoraId, itemId: REWARD.id })).ok);
  await sleep(200);
  check('고른 보상이 아고라에 남는다', agora().reward.itemId === REWARD.id);
  const card = (n: number): View | undefined => (display.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const phoneCard = (p: Phone, n: number): View | undefined => (p.s.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const studentId = (cls: Phone['cls'], n: number): string => (teacher.view.students as View[]).find((s) => s.classId === cls.id && s.number === n)!.id;
  /** Class A student n's answer to a topic, as the teacher screen has it. */
  const answerOf = (n: number, id = t1): View | undefined => (topic(id).answers as View[]).find((a) => a.studentId === studentId(A, n));
  const owns = (p: Phone) => !!(p.s.view.me?.inventory as string[] | undefined)?.includes(REWARD.id);
  const rewarded = (): string[] => teacher.view.agora.live?.rewarded ?? [];
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
  check('선생님 화면은 두 답을 다 받는다', JSON.stringify(topic().answers).includes('SECRET-ONE') && JSON.stringify(topic().answers).includes('SECRET-TWO'));
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
  const firstAt = (topic().answers as View[]).find((a) => a.text === SECRET1)?.createdAt;
  check('1번이 답을 고친다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '고친 답' }, {})).ok);
  await sleep(200);
  const changed = (topic().answers as View[]).find((a) => a.text === '고친 답');
  check('고친 답은 처음 낸 시각을 지킨다 (낸 순서가 바뀌지 않게)', changed && changed.createdAt === firstAt && changed.updatedAt >= changed.createdAt);
  check('수업 중에 고친 답은 처음 답을 따로 남기지 않는다 (다시 쓰기에서만)', changed && changed.first === null);
  check('2번이 자기 답을 지운다', (await post({ type: 'agora-unanswer', token: a2.token, topicId: t1 }, {})).ok);
  await sleep(200);
  check('2번 답이 사라졌다', a2.s.view.agora.mine === null && !(topic().answers as View[]).some((a) => a.text === SECRET2));

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
  check('전체 공개하면 따로 공개했던 답은 다시 전체를 따른다', (topic().answers as View[]).every((x) => x.shown === null));
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
  check('…그리고 다시 전체를 따른다', card(1)?.text === '고친 답' && (topic().answers as View[]).every((x) => x.shown === null));

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
  check('배경음을 끈다', (await post({ type: 'agora-music' })).ok);
  await sleep(100);
  check('프로젝터가 배경음 꺼짐을 받는다', display.view.agora.music === false);
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
  check('선생님이 1번 답에 칭찬 별을 준다', (await post({ type: 'agora-star', studentId: studentId(A, 1) })).ok);
  await sleep(300);
  check('그 답에 별이 남고, 프로젝터 카드에도 별이 뜬다', answerOf(1)?.star === true && card(1)?.star === true);
  check('비공개 카드에도 별은 보이고 답은 숨겨진 그대로다', display.view.agora.reveal === 'hidden' && card(1)?.text === undefined);
  check('1번은 그 자리에서 보상을 받는다: 보관함에 들어가고 폰에 상자가 열린다', owns(a1) && a1.s.view.agora?.praise?.itemId === REWARD.id && a1.s.view.agora.praise.alreadyOwned === false && rewarded().includes(studentId(A, 1)));
  check('보상 상자는 받은 학생 폰에만 간다', a2.s.view.agora?.praise === null && a3.s.view.agora?.praise === null && !b1.s.view.agora);
  check('2번 답에도 별', (await post({ type: 'agora-star', studentId: studentId(A, 2) })).ok);
  await sleep(200);
  check('보상 받은 학생이 둘', rewarded().length === 2 && owns(a2));
  check('별을 다시 누르면 뺀다', (await post({ type: 'agora-star', studentId: studentId(A, 1) })).ok);
  await sleep(200);
  check('…답과 카드에서 별이 빠진다', answerOf(1)?.star === false && card(1)?.star === undefined);
  check('…받은 보상은 그대로다', owns(a1) && rewarded().includes(studentId(A, 1)));
  await post({ type: 'agora-star', studentId: studentId(A, 1) });
  // The server saves 0.4 s after a change.
  await sleep(800);
  const praises = (JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')).rewards as View[]).filter((x) => x.reason === 'praise' && x.eventId === agoraId);
  check('같은 수업에서 별을 다시 줘도 보상은 한 사람에 한 번 (기록 둘)', praises.length === 2 && praises.every((x) => x.itemId === REWARD.id && /^agl_/.test(x.sessionId)), praises.map((x) => x.studentId).join());
  check('답이 없는 학생에게는 별을 줄 수 없다', (await post({ type: 'agora-star', studentId: studentId(A, 4) })).ok && rewarded().length === 2 && !answerOf(4));
  check('다른 반 학생에게도 줄 수 없다', (await post({ type: 'agora-star', studentId: studentId(B, 7) })).ok && rewarded().length === 2);

  section('마감');
  check('선생님이 지금 마감한다', (await post({ type: 'agora-close' })).ok);
  await sleep(200);
  check('마감: 기기는 마감을 보고, 프로젝터는 그대로 띄워 둔다', a1.s.view.agora?.phase === 'closed' && display.view.agora?.phase === 'closed' && display.view.agora.timer === null);
  check('마감 뒤에는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: 'late' }, {})).error === '마감됐어요.');
  check('마감 뒤 +1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.phase === 'closed' && display.view.agora.timer === null);
  check('열려 있는 동안에는 그 반만 등록할 수 있다', (await post({ type: 'register', token: randomBytes(24).toString('hex'), classId: B.id, number: 9, name: '늦은학생' }, {})).error?.includes(`${A.name} 수업`));
  // One answer shown on its own, to see a new session let go of it.
  await post({ type: 'agora-card', studentId: studentId(A, 1) });
  check('아고라가 열린 반은 지울 수 없다', (await post({ type: 'delete-class', classId: A.id, withStudents: true })).error?.includes('아고라가 열려 있는 반'));
  check('열려 있는 아고라는 지울 수 없다', (await post({ type: 'agora-delete', agoraId })).error?.includes('열려 있는 아고라'));
  check('열려 있는 아고라는 고칠 수 없다', (await post({ type: 'agora-edit', agoraId, title: `${MARK} 바꿈`, topics: [{ text: '바꿈' }] })).error?.includes('열려 있는 아고라'));

  section('다음 주제와 건너뛰기');
  const T2A = '주제2 ALPHA-T2';
  check('다음 주제', (await post({ type: 'agora-next' })).ok);
  await sleep(300);
  const ready = display.view.agora;
  check('준비: 프로젝터에 주제 2/3이 먼저 뜨고, 카드와 시계는 없다', ready?.phase === 'ready' && ready.index === 1 && ready.topic.id === t2 && ready.cards.length === 0 && ready.timer === null && ready.reveal === 'hidden');
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
  check('건너뛴 주제 2의 답은 남는다', (topic(t2).answers as View[]).length === 2);
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
  check('그때 따로 공개한 답이 있었다', (topic().answers as View[]).some((x) => x.shown === true));
  await post({ type: 'agora-open', agoraId, classId: A.id });
  await sleep(300);
  check('같은 반에서 다시 열면 첫 주제부터, 그 반의 답이 이어진다', a1.s.view.agora?.topic.id === t1 && a1.s.view.agora.mine?.text === '고친 답');
  check('다시 열면 한 장씩 공개·숨김은 풀리고 비공개로 시작한다', teacher.view.agora.live?.reveal === 'hidden' && (topic().answers as View[]).every((x) => x.shown === null));
  await post({ type: 'agora-end' });
  await post({ type: 'agora-open', agoraId, classId: B.id });
  await post({ type: 'agora-start' });
  await sleep(300);
  check('다른 반으로 열면 그 반 카드만 나온다', display.view.agora?.className === B.name && (display.view.agora.cards as View[]).map((c) => c.number).join() === '7');
  check('그 반 기기에는 앞 반의 답이 가지 않는다', !JSON.stringify(b1.s.raw).includes('고친 답') && !display.view.agora.cards.some((c: View) => c.text !== undefined));
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
  const rewritten = (topic().answers as View[]).find((a) => a.studentId === studentId(A, 1));
  check('선생님 화면에 처음 답과 고친 답이 함께 남는다', rewritten?.text === '다시 쓴 답' && rewritten.first === '고친 답');
  check('1번 기기는 자기 처음 답을 받는다', a1.s.view.agora?.mine?.text === '다시 쓴 답' && a1.s.view.agora.mine.first === '고친 답');
  check('처음 답은 프로젝터와 친구 기기에 가지 않는다', !display.raw.some((r) => r.includes('"first"')) && ![a2, a3, b1].some((p) => p.s.raw.some((r) => r.includes('"first":"고친 답"'))));
  check('다시 쓰기에서는 답을 지울 수 없다', (await post({ type: 'agora-unanswer', token: a1.token, topicId: t1 }, {})).error?.includes('지울 수 없어요'));
  check('한 번 더 고친다', (await post({ type: 'agora-answer', token: a1.token, topicId: t1, text: '또 고친 답' }, {})).ok);
  await sleep(200);
  check('처음 답은 맨 처음 것 그대로다', (topic().answers as View[]).find((a) => a.studentId === studentId(A, 1))?.first === '고친 답');
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
  check('고친 주제는 그 답을 지킨다', after.topics[1].id === t1 && after.topics[1].minutes === 3 && (after.topics[1].answers as View[]).length === 3);
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
  await post({ type: 'agora-start' });
  await sleep(200);
  check('시간 제한이 없는 주제에는 시계가 없다', display.view.agora?.topic.id === tNone && display.view.agora.phase === 'writing' && display.view.agora.timer === null);
  check('시간 제한이 없으면 ±1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.timer === null);
  await post({ type: 'agora-end' });

  section('코드');
  const sinks = htmlSinks(join(process.cwd(), 'src'));
  check('화면은 답을 HTML로 넣지 않는다 (HTML로 넣는 곳은 서버가 그린 QR 그림뿐)', sinks.every((m) => m === QR_HTML), sinks.filter((m) => m !== QR_HTML).join(' | '));
  return { classIds: [A.id, B.id], agoraIds: [agoraId, other, gaps, a3m, aNone], topicIds: [t1, t2, t3, t3m, tNone] };
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

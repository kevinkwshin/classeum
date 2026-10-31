// Checks 아고라's safety rules against a running Classeum server the way a class uses it: the teacher screen, the
// projector and five phones over the real streams and actions, through 대기실, 쓰기, 마감 and 닫기. It makes two
// classes of its own (아고라점검A and 아고라점검B) and topics marked [아고라점검], and deletes them with their students
// and answers at the end, so real classes, topics and records are never touched. It stops before doing anything if the
// arena or an 아고라 is open.
// Usage (from the project folder, with the server on): npm run check:agora -- [baseUrl=http://localhost:3000]
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_MAX } from '../src/lib/agora';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PREFIX = '아고라점검';
const MARK = `[${PREFIX}]`;
const DATA = join(process.cwd(), '.data');
// Acts as the teacher with the key the server keeps in .data, like npm run sim.
const TEACHER = { Cookie: `cls_teacher=${readFileSync(join(DATA, 'teacher-key'), 'utf8').trim()}` };
const TEACHER_ONLY = [
  'agora-add', 'agora-edit', 'agora-delete', 'agora-open', 'agora-start', 'agora-close', 'agora-end', 'agora-time',
  'agora-reveal', 'agora-settings', 'agora-page', 'agora-pages', 'agora-music', 'agora-card', 'agora-card-delete',
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

/** Closes this check's 아고라 and deletes its classes and topics, also those a run stopped half-way left behind. */
async function cleanUp(teacher: Stream) {
  const v = teacher.view;
  const ours = new Set((v.classes as { id: string; name: string }[]).filter((c) => c.name.startsWith(PREFIX)).map((c) => c.id));
  if (v.agora.live && ours.has(v.agora.live.classId)) await post({ type: 'agora-end' });
  for (const t of v.agora.topics as { id: string; text: string }[]) if (t.text.startsWith(MARK)) await post({ type: 'agora-delete', topicId: t.id });
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

  const created = await post({ type: 'agora-add', text: `${MARK} 시험 주제`, note: '예) 시험', sort: 'time', columns: 3 });
  check('주제는 반 없이 만든다 (아레나 이벤트처럼)', created.ok);
  const topicId: string = created.topicId;
  const other: string = (await post({ type: 'agora-add', text: `${MARK} 두 번째 주제`, columns: 2, sort: 'number' })).topicId;
  const topic = (id = topicId): View => (teacher.view.agora.topics as View[]).find((t) => t.id === id)!;
  const card = (n: number): View | undefined => (display.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const phoneCard = (p: Phone, n: number): View | undefined => (p.s.view.agora?.cards as View[] | undefined)?.find((c) => c.number === n);
  const studentId = (cls: Phone['cls'], n: number): string => (teacher.view.students as View[]).find((s) => s.classId === cls.id && s.number === n)!.id;
  /** Whether a stream ever carried this answer's text. */
  const leaks = (s: Stream, secret: string) => s.raw.some((r) => r.includes(secret.split(' ')[1]));

  section('대기실');
  check('선생님이 오늘 반을 골라 대기실을 연다', (await post({ type: 'agora-open', topicId, classId: A.id })).ok);
  await sleep(300);
  const lobby = display.view.agora;
  check('프로젝터는 대기실: 주제와 들어온 학생, 카드는 아직 없다', lobby?.phase === 'lobby' && lobby.topic.id === topicId && lobby.cards.length === 0 && [1, 2, 3].every((n) => lobby.joined.some((j: View) => j.number === n)));
  check('그 반 기기는 대기실에서 주제를 미리 본다 (친구 카드는 아직 없음)', [a1, a2, a3].every((p) => p.s.view.agora?.phase === 'lobby' && p.s.view.agora.topic.id === topicId && p.s.view.agora.cards.length === 0));
  check('다른 반 기기에는 주제가 가지 않고, 지금 수업 중인 반 이름만 간다', !b1.s.view.agora && b1.s.view.elsewhere === A.name, b1.s.view.elsewhere);
  check('선생님 화면에 대기실과 들어온 학생이 보인다', teacher.view.agora.live?.phase === 'lobby' && [1, 2, 3].every((n) => teacher.view.agora.live.joined.includes(studentId(A, n))));
  check('대기실에서는 아직 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId, text: 'x' }, {})).error === '선생님이 시작하면 쓸 수 있어요.');
  check('아고라는 한 번에 하나만 연다', (await post({ type: 'agora-open', topicId: other, classId: B.id })).error?.includes('이미 열려'));
  await post({ type: 'agora-settings', minutes: 5 });
  await sleep(200);
  check('대기실에서 입력 시간을 바꾸면 주제에 남는다', topic().minutes === 5);
  await post({ type: 'agora-settings', minutes: 10 });
  await sleep(200);
  const stampsBefore = a1.s.view.me?.stamps;

  section('쓰기 시작');
  check('쓰기 시작', (await post({ type: 'agora-start' })).ok);
  await sleep(300);
  check('프로젝터와 기기가 쓰기로 바뀌고, 들어온 세 명의 카드가 생긴다', display.view.agora?.phase === 'writing' && a1.s.view.agora?.phase === 'writing' && [1, 2, 3].every((n) => card(n) && !card(n)!.sent));
  const t10 = display.view.agora?.timer;
  check('입력 시간(10분)이 쓰기 시작부터 흐른다', t10 && t10.endsAt - t10.startedAt === 600_000, t10 && `${t10.endsAt - t10.startedAt} ms`);
  check('들어온 학생은 출석 발자국을 받는다 (아레나처럼)', typeof stampsBefore === 'number' && a1.s.view.me?.stamps === stampsBefore + 1, `${stampsBefore} → ${a1.s.view.me?.stamps}`);
  check('주제에 이 반이 한 기록이 남는다', (topic().runs as View[]).some((r) => r.classId === A.id));
  await post({ type: 'agora-settings', minutes: 3 });
  await sleep(200);
  check('쓰는 중에는 입력 시간을 대기실 설정으로 바꾸지 못한다', topic().minutes === 10);

  section('비공개일 때');
  const SECRET1 = '비밀1 SECRET-ONE';
  const SECRET2 = '<b>비밀2</b> SECRET-TWO <img src=x onerror=alert(1)>';
  check('1번이 답을 낸다', (await post({ type: 'agora-answer', token: a1.token, topicId, text: `  ${SECRET1}‮  ` }, {})).ok);
  await sleep(50);
  check('2번이 답을 낸다', (await post({ type: 'agora-answer', token: a2.token, topicId, text: SECRET2 }, {})).ok);
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
  check('다른 반 기기는 이 주제에 답할 수 없다', (await post({ type: 'agora-answer', token: b1.token, topicId, text: 'x' }, {})).error === '우리 반 주제가 아니에요.');
  check('등록 안 된 기기는 답할 수 없다', (await post({ type: 'agora-answer', token: randomBytes(24).toString('hex'), topicId, text: 'x' }, {})).error === '등록된 기기가 아니에요.');
  const a4 = phone(A, 4, '최아린');
  await sleep(300);
  check('새 기기가 등록을 요청한다', (await post({ type: 'register', token: a4.token, classId: A.id, number: 4, name: a4.name }, {})).ok);
  check('승인 전에는 답할 수 없다', (await post({ type: 'agora-answer', token: a4.token, topicId, text: 'x' }, {})).error === '등록된 기기가 아니에요.');
  check('기기 토큰 없이 보낸 답은 거절', (await post({ type: 'agora-answer', topicId, text: 'x' }, {})).status === 400);
  check('열려 있지 않은 주제에는 답할 수 없다', (await post({ type: 'agora-answer', token: a3.token, topicId: other, text: 'x' }, {})).error === '주제가 바뀌었어요. 화면을 확인해 주세요.');
  check('빈 답은 거절', (await post({ type: 'agora-answer', token: a3.token, topicId, text: ' ​ ' }, {})).error === '답을 써 주세요.');
  check(`${ANSWER_MAX + 1}자는 거절`, (await post({ type: 'agora-answer', token: a3.token, topicId, text: 'ㄱ'.repeat(ANSWER_MAX + 1) }, {})).error?.includes(`${ANSWER_MAX}자`));
  const burst: string[] = [];
  for (let i = 0; i < 6; i++) burst.push((await post({ type: 'agora-answer', token: a3.token, topicId, text: i ? `다시 ${i}` : 'ㄱ'.repeat(ANSWER_MAX) }, {})).error ?? 'ok');
  check(`${ANSWER_MAX}자까지는 받는다`, burst[0] === 'ok');
  check('한 기기가 10초에 다섯 번 넘게 쓰면 잠시 막힌다', burst.filter((r) => r === 'ok').length === 3 && burst[5] === '조금 있다가 다시 해 주세요.', burst.join(' | '));

  section('선생님만 할 수 있는 일');
  const notBlocked: string[] = [];
  for (const type of TEACHER_ONLY) {
    const r = await post({ type, topicId, classId: A.id, token: a1.token, public: true, number: 1, studentId: studentId(A, 1) }, {});
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
  check('1번이 답을 고친다', (await post({ type: 'agora-answer', token: a1.token, topicId, text: '고친 답' }, {})).ok);
  await sleep(200);
  const changed = (topic().answers as View[]).find((a) => a.text === '고친 답');
  check('고친 답은 처음 낸 시각을 지킨다 (낸 순서가 바뀌지 않게)', changed && changed.createdAt === firstAt && changed.updatedAt >= changed.createdAt);
  check('2번이 자기 답을 지운다', (await post({ type: 'agora-unanswer', token: a2.token, topicId }, {})).ok);
  await sleep(200);
  check('2번 답이 사라졌다', a2.s.view.agora.mine === null && !(topic().answers as View[]).some((a) => a.text === SECRET2));

  section('공개');
  check('2번이 다시 낸다', (await post({ type: 'agora-answer', token: a2.token, topicId, text: SECRET2 }, {})).ok);
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
  check('프로젝터가 그 배치를 받는다', display.view.agora.topic.columns === 4 && display.view.agora.topic.sort === 'number' && (display.view.agora.cards as View[]).map((c) => c.number).join(',').startsWith('1,2,3'));
  await post({ type: 'agora-settings', columns: 9, sort: 'x' });
  await sleep(100);
  check('잘못된 배치는 아무것도 바꾸지 않는다', display.view.agora.topic.columns === 4 && display.view.agora.topic.sort === 'number');
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
  check('선생님이 2번 답을 지운다', (await post({ type: 'agora-card-delete', topicId, studentId: studentId(A, 2) })).ok);
  await sleep(200);
  check('2번은 답이 없어지고 다시 쓸 수 있다', a2.s.view.agora.mine === null && (await post({ type: 'agora-answer', token: a2.token, topicId, text: 'again' }, {})).ok);

  section('개인정보');
  // The server saves 0.4 s after a change.
  await sleep(800);
  const saved = JSON.parse(readFileSync(join(DATA, 'classeum.json'), 'utf8')) as View;
  const records = Object.values(saved.topicAnswers?.[topicId] ?? {}) as View[];
  check('저장된 답에는 글·공개 여부·시각만 있다 (번호·이름 말고 새로 모으는 정보 없음)', records.length >= 2 && records.every((r) => Object.keys(r).sort().join(',') === 'createdAt,shown,text,updatedAt'), records.map((r) => Object.keys(r).join('+')).join(' '));
  check('저장된 주제에는 반이 없고, 한 반의 기록만 있다', saved.topics?.[topicId] && !('classId' in saved.topics[topicId]) && Object.keys(saved.topics[topicId].runs).join() === A.id);

  section('마감');
  check('선생님이 지금 마감한다', (await post({ type: 'agora-close' })).ok);
  await sleep(200);
  check('마감: 기기는 마감을 보고, 프로젝터는 그대로 띄워 둔다', a1.s.view.agora?.phase === 'closed' && display.view.agora?.phase === 'closed' && display.view.agora.timer === null);
  check('마감 뒤에는 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId, text: 'late' }, {})).error === '마감됐어요.');
  check('마감 뒤 +1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.phase === 'closed' && display.view.agora.timer === null);
  check('열려 있는 동안에는 그 반만 등록할 수 있다', (await post({ type: 'register', token: randomBytes(24).toString('hex'), classId: B.id, number: 9, name: '늦은학생' }, {})).error?.includes(`${A.name} 수업`));
  // One answer shown on its own, to see a new session let go of it.
  await post({ type: 'agora-card', studentId: studentId(A, 1) });
  check('아고라가 열린 반은 지울 수 없다', (await post({ type: 'delete-class', classId: A.id, withStudents: true })).error?.includes('아고라가 열려 있는 반'));
  check('열려 있는 주제는 지울 수 없다', (await post({ type: 'agora-delete', topicId })).error?.includes('열려 있는 주제'));

  section('닫기와 다시 열기');
  check('선생님이 아고라를 닫는다', (await post({ type: 'agora-end' })).ok);
  await sleep(200);
  check('닫음: 프로젝터와 기기는 처음 화면으로', !display.view.agora && phones.every((p) => !p.s.view.agora) && teacher.view.agora.live === null);
  check('그때 따로 공개한 답이 있었다', (topic().answers as View[]).some((x) => x.shown === true));
  await post({ type: 'agora-open', topicId, classId: A.id });
  await sleep(300);
  check('같은 반에서 다시 열면 그 반의 답이 이어진다', a1.s.view.agora?.mine?.text === '고친 답');
  check('다시 열면 한 장씩 공개·숨김은 풀리고 비공개로 시작한다', teacher.view.agora.live?.reveal === 'hidden' && (topic().answers as View[]).every((x) => x.shown === null));
  await post({ type: 'agora-end' });
  await post({ type: 'agora-open', topicId, classId: B.id });
  await post({ type: 'agora-start' });
  await sleep(300);
  check('다른 반으로 열면 그 반 카드만 나온다', display.view.agora?.className === B.name && (display.view.agora.cards as View[]).map((c) => c.number).join() === '7');
  check('그 반 기기에는 앞 반의 답이 가지 않는다', !JSON.stringify(b1.s.raw).includes('고친 답') && !display.view.agora.cards.some((c: View) => c.text !== undefined));
  await post({ type: 'agora-end' });

  section('입력 시간');
  const t3: string = (await post({ type: 'agora-add', text: `${MARK} 3분 주제`, minutes: 3 })).topicId;
  const tNone: string = (await post({ type: 'agora-add', text: `${MARK} 시간 제한 없는 주제`, minutes: null })).topicId;
  await post({ type: 'agora-open', topicId: t3, classId: A.id });
  await sleep(200);
  check('대기실에서는 시계가 흐르지 않는다', display.view.agora?.phase === 'lobby' && display.view.agora.timer === null);
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
  check('시간이 끝나면 쓸 수 없다', (await post({ type: 'agora-answer', token: a1.token, topicId: t3, text: 'late' }, {})).error === '마감됐어요.');
  await post({ type: 'agora-end' });
  await post({ type: 'agora-open', topicId: tNone, classId: A.id });
  await post({ type: 'agora-start' });
  await sleep(200);
  check('시간 제한이 없는 주제에는 시계가 없다', display.view.agora?.topic.id === tNone && display.view.agora.phase === 'writing' && display.view.agora.timer === null);
  check('시간 제한이 없으면 ±1분은 아무것도 바꾸지 않는다', (await post({ type: 'agora-time', minutes: 1 })).ok && display.view.agora.timer === null);
  await post({ type: 'agora-end' });

  section('코드');
  const sinks = htmlSinks(join(process.cwd(), 'src'));
  check('화면은 답을 HTML로 넣지 않는다 (HTML로 넣는 곳은 서버가 그린 QR 그림뿐)', sinks.every((m) => m === QR_HTML), sinks.filter((m) => m !== QR_HTML).join(' | '));
  return { classIds: [A.id, B.id], topicIds: [topicId, other, t3, tNone] };
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
    ...made.topicIds.filter((id) => saved.topics?.[id] || saved.topicAnswers?.[id]),
  ];
  check('시험반과 그 학생·주제·답이 저장 파일에 남지 않았다', left.length === 0, left.join(', '));
  for (const s of streams) s.controller.abort();
  console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  for (const s of streams) s.controller.abort();
  process.exit(1);
});

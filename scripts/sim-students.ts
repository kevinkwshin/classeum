// Simulates a class of phones against a running Classeum server, for testing without 30 real devices.
// Usage: npm run sim -- [count=30] [baseUrl=http://localhost:3000] [class=시험반] [noroster]
// It makes the class (and, unless 'noroster', its roster), registers each fake phone by typing
// 반·번호·이름 like a student, approves them as the teacher, picks a look, and then answers every
// question of that class's quiz the way a phone does: one tap on an answer box (now and then a second,
// different one), 단답형 sent with 제출, and about one phone in twenty leaving a box question unanswered.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zoneCenter } from '../src/lib/field';

const COUNT = Number(process.argv[2] ?? 30);
const BASE = process.argv[3] ?? 'http://localhost:3000';
const CLASS = process.argv[4] ?? '시험반';
const WITH_ROSTER = process.argv[5] !== 'noroster';
const NAMES = ['하람', '도윤', '지후', '시온', '아린', '세린', '서윤', '다온', '하준', '유찬', '도하', '가온', '예준', '서아', '민재', '지안', '은우', '수아', '건우', '나은', '태윤', '채원', '준서', '하린', '시우', '유나', '현우', '소율', '지호', '다은', '우진', '서진', '라온', '윤슬', '주원', '예린', '도현', '하은', '지민', '서준'];
const FAMILY = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test reader for the server views
type View = Record<string, any>;

// Acts as the teacher with the key the server keeps in .data (run from the project folder).
const TEACHER = { Cookie: `cls_teacher=${readFileSync(join(process.cwd(), '.data', 'teacher-key'), 'utf8').trim()}` };

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...TEACHER }, body: JSON.stringify(body) });
  return res.json() as Promise<{ ok: boolean; error?: string } & Record<string, unknown>>;
}

/** Minimal SSE reader on top of fetch streaming. */
async function subscribe(url: string, onView: (v: View) => void, signal: AbortSignal) {
  const res = await fetch(url, { signal, headers: TEACHER });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
      if (data) onView(JSON.parse(data));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Numbered like a real phone's taps, so the server keeps only each phone's newest one.
const MOVE_BASE = Date.now() * 1000;
let moveCount = 0;
const nextMoveNumber = () => MOVE_BASE + ++moveCount;

async function main() {
  const controller = new AbortController();
  let teacher: View | null = null;
  subscribe(`${BASE}/api/stream?role=teacher`, (v) => (teacher = v), controller.signal).catch(() => undefined);
  await sleep(500);
  if (!teacher) throw new Error('선생님 화면 연결 실패: 서버가 켜져 있나요?');

  let classId = ((teacher as View).classes as { id: string; name: string }[]).find((c) => c.name === CLASS)?.id;
  if (!classId) classId = ((await post({ type: 'add-class', name: CLASS })) as { classId?: string }).classId;
  if (!classId) throw new Error(`'${CLASS}' 반을 만들지 못했어요.`);
  await sleep(300);
  // Different classes get different given names.
  const offset = CLASS.length * 7;
  const generated = (i: number) => `${FAMILY[i % FAMILY.length]}${NAMES[(i + offset) % NAMES.length]}`;
  const existing = ((teacher as View).students as { classId: string }[]).filter((s) => s.classId === classId);
  if (WITH_ROSTER && existing.length < COUNT) {
    const lines = Array.from({ length: COUNT }, (_, i) => `${i + 1} ${generated(i)}`);
    await post({ type: 'roster', classId, text: lines.join('\n') });
    await sleep(300);
  }
  const rosterName = (n: number) => ((teacher as View).students as { classId: string; number: number; name: string }[]).find((s) => s.classId === classId && s.number === n)?.name;

  const phones = Array.from({ length: COUNT }, (_, i) => ({ i, token: randomBytes(24).toString('hex'), view: null as View | null, skill: 0.45 + Math.random() * 0.5, answeredSeq: -1 }));
  for (const p of phones) {
    subscribe(`${BASE}/api/stream?role=student&token=${p.token}`, (v) => (p.view = v), controller.signal).catch(() => undefined);
  }
  await sleep(800);

  for (const p of phones) {
    // Students type their own details; with a roster this matches it, without one it's a new student.
    const res = await post({ type: 'register', token: p.token, classId, number: p.i + 1, name: rosterName(p.i + 1) ?? generated(p.i) });
    if (!res.ok) console.log(`${p.i + 1}번 등록 요청 실패: ${res.error}`);
  }
  await sleep(300);
  await post({ type: 'approve-all' });
  // Requests for students who already had a device show as replacements; approve those one by one.
  await sleep(300);
  for (const r of ((teacher as View).requests ?? []) as { id: string; kind: string }[]) await post({ type: 'approve', requestId: r.id, kind: r.kind });
  await sleep(500);

  const skins = ['light', 'medium', 'tan', 'deep'];
  const hairs = ['black', 'brown', 'blond', 'red', 'pink', 'blue', 'silver'];
  const styles = ['short', 'long', 'bob', 'ponytail', 'pigtails', 'braid', 'side', 'curly', 'spiky', 'bun', 'twinbun', 'buzz'];
  const eyes = ['round', 'big', 'smile', 'sharp', 'dot'];
  for (const p of phones) {
    // Mostly natural hair colours, with a few bright ones, so the field looks like a real class.
    const hair = p.i % 5 === 4 ? hairs[3 + ((p.i / 5) | 0) % 4] : hairs[p.i % 3];
    await post({ type: 'look', token: p.token, look: { skin: skins[(p.i * 3) % 4], hair, hairStyle: styles[(p.i * 7) % 12], eyes: eyes[(p.i * 2) % 5] } });
  }
  console.log(`${COUNT}명 등록 완료. 선생님 화면에서 대기실을 열고 퀴즈를 시작하세요. (Ctrl+C로 종료)`);

  // Play loop: each phone answers once per question, a second or a few after it opens.
  for (;;) {
    await sleep(250);
    const live = (teacher as View | null)?.live;
    for (const p of phones) {
      const s = p.view?.session;
      const q = s?.question;
      if (!s || s.phase !== 'moving' || !q || q.seq === p.answeredSeq || !live?.current) continue;
      p.answeredSeq = q.seq;
      const answer: number = live.current.answerIndex;
      const n: number = q.options.length;
      const delay = 1000 + Math.random() * 6000;
      setTimeout(async () => {
        if (q.kind === 'text') {
          const ok = Math.random() < p.skill;
          await post({ type: 'text', token: p.token, seq: q.seq, value: ok ? (live.current.answers?.[0] ?? 'x') : 'wrong', final: true, n: nextMoveNumber() });
          return;
        }
        if (Math.random() < 0.05) return; // someone always stays on the start line
        // A tap puts the character in the middle of that box, as on the phone.
        const tap = (z: number) => {
          const c = zoneCenter(z, n);
          return post({ type: 'pos', token: p.token, seq: q.seq, n: nextMoveNumber(), x: c.x, y: c.y });
        };
        const pick = Math.random() < p.skill ? answer : Math.floor(Math.random() * n);
        await tap(pick);
        // Now and then someone changes their mind.
        if (Math.random() < 0.1) {
          await sleep(400 + Math.random() * 1200);
          await tap((pick + 1 + Math.floor(Math.random() * (n - 1))) % n);
        }
      }, delay);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

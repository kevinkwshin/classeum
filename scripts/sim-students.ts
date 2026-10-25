// Simulates a class of phones against a running Classeum server, for testing without 30 real devices.
// Usage: npm run sim -- [count=30] [baseUrl=http://localhost:3000]
// It adds a roster if needed, registers each fake phone, approves them as the teacher,
// picks a look, and then walks each avatar into an answer zone during every question.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COUNT = Number(process.argv[2] ?? 30);
const BASE = process.argv[3] ?? 'http://localhost:3000';
const NAMES = ['하람', '도윤', '지후', '시온', '아린', '세린', '서윤', '다온', '하준', '유찬', '도하', '가온', '예준', '서아', '민재', '지안', '은우', '수아', '건우', '나은', '태윤', '채원', '준서', '하린', '시우', '유나', '현우', '소율', '지호', '다은', '우진', '서진', '라온', '윤슬', '주원', '예린', '도현', '하은', '지민', '서준'];
const FAMILY = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test reader for the server views
type View = Record<string, any>;

// Acts as the teacher with the key the server keeps in .data (run from the project folder).
const TEACHER = { Cookie: `cls_teacher=${readFileSync(join(process.cwd(), '.data', 'teacher-key'), 'utf8').trim()}` };

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...TEACHER }, body: JSON.stringify(body) });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
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

function zoneCenter(z: number, n: number) {
  if (n === 2) return { x: z === 0 ? 0.25 : 0.75, y: 0.5 };
  return { x: z % 2 === 0 ? 0.25 : 0.75, y: z < 2 ? 0.27 : 0.73 };
}

async function main() {
  const controller = new AbortController();
  let teacher: View | null = null;
  subscribe(`${BASE}/api/stream?role=teacher`, (v) => (teacher = v), controller.signal).catch(() => undefined);
  await sleep(500);
  if (!teacher) throw new Error('선생님 화면 연결 실패: 서버가 켜져 있나요?');

  const existing = (teacher as View).students as { number: number }[];
  if (existing.length < COUNT) {
    const lines = Array.from({ length: COUNT }, (_, i) => `${i + 1} ${FAMILY[i % FAMILY.length]}${NAMES[i % NAMES.length]}`);
    await post({ type: 'roster', text: lines.join('\n') });
    await sleep(300);
  }

  const phones = Array.from({ length: COUNT }, (_, i) => ({ i, token: randomBytes(24).toString('hex'), view: null as View | null, skill: 0.45 + Math.random() * 0.5, answeredSeq: -1 }));
  for (const p of phones) {
    subscribe(`${BASE}/api/stream?role=student&token=${p.token}`, (v) => (p.view = v), controller.signal).catch(() => undefined);
  }
  await sleep(800);

  for (const p of phones) {
    const roster = (p.view?.roster ?? []) as { id: string; number: number }[];
    const target = roster.find((r) => r.number === p.i + 1);
    if (target) await post({ type: 'register', token: p.token, studentId: target.id });
  }
  await sleep(300);
  await post({ type: 'approve-all' });
  // Requests for students who already had a device show as replacements; approve those one by one.
  await sleep(300);
  for (const r of ((teacher as View).requests ?? []) as { id: string }[]) await post({ type: 'approve', requestId: r.id });
  await sleep(500);

  const skins = ['light', 'medium', 'tan'];
  const hairs = ['black', 'brown', 'blond'];
  const styles = ['short', 'long', 'ponytail'];
  for (const p of phones) {
    await post({ type: 'look', token: p.token, look: { skin: skins[p.i % 3], hair: hairs[(p.i * 2) % 3], hairStyle: styles[(p.i * 5) % 3] } });
  }
  console.log(`${COUNT}명 등록 완료. 선생님 화면에서 대기실을 열고 퀴즈를 시작하세요. (Ctrl+C로 종료)`);

  // Play loop: each phone answers once per question, walking a few steps like a real student.
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
          await post({ type: 'text', token: p.token, seq: q.seq, value: ok ? (live.current.answers?.[0] ?? 'x') : 'wrong' });
          return;
        }
        if (Math.random() < 0.05) return; // someone always stays on the start line
        const pick = Math.random() < p.skill ? answer : Math.floor(Math.random() * n);
        const target = zoneCenter(pick, n);
        const jitter = { x: target.x + (Math.random() - 0.5) * 0.2, y: target.y + (Math.random() - 0.5) * 0.2 };
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          await post({ type: 'pos', token: p.token, seq: q.seq, x: 0.5 + (jitter.x - 0.5) * t, y: 0.5 + (jitter.y - 0.5) * t });
          await sleep(160);
        }
      }, delay);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

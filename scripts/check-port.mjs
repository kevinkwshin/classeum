// Runs before `npm run class`. An older Classeum server still on the port is stopped so the new one can
// start (asking first if a quiz or an 아고라 is under way); any other program on the port stops the run instead, before
// the build. Plain Node, so it works on Mac and Windows.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const port = Number(process.env.PORT) || 3000;
const windows = process.platform === 'win32';
const say = (...lines) => console.log(['', ...lines, ''].map((l) => (l ? `  ${l}` : '')).join('\n'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function free() {
  return new Promise((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

/** Whether the program on the port answers like Classeum (its teacher check returns { ok, local }). */
async function isClasseum() {
  try {
    const res = await fetch(`http://localhost:${port}/api/teacher/me`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return typeof body === 'object' && body !== null && 'ok' in body && 'local' in body;
  } catch {
    return false;
  }
}

const teacherKey = () => readFileSync(join(process.cwd(), '.data', 'teacher-key'), 'utf8').trim();

/**
 * What the running server is doing, read with this folder's teacher key: the arena's phase and the 아고라's ('' for
 * none), or known: false when it can't tell (no answer in time, or another folder's server with another key).
 */
async function liveState() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`http://localhost:${port}/api/stream?role=teacher`, { headers: { Cookie: `cls_teacher=${teacherKey()}` }, signal: ctrl.signal });
    if (!res.ok) return { known: false };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { known: false };
      buf += decoder.decode(value, { stream: true });
      const m = buf.match(/data: (.+)\n\n/);
      if (m) {
        const view = JSON.parse(m[1]);
        return { known: true, arena: view.live?.phase ?? '', agora: view.agora?.live?.phase ?? '' };
      }
    }
  } catch {
    return { known: false };
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

/**
 * Has the old server write its records before it is stopped: on Windows the stop below ends it at once, without the
 * save Ctrl+C gets. False when it answers that it couldn't save; then it is left running. An older server without this
 * request just answers no, and the stop still goes ahead.
 */
async function saveFirst() {
  try {
    const res = await fetch(`http://localhost:${port}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}`, Cookie: `cls_teacher=${teacherKey()}` },
      body: JSON.stringify({ type: 'save-now' }),
      signal: AbortSignal.timeout(3000),
    });
    const body = await res.json();
    // Its save failed (a full disk, a locked folder): stopping it now would lose what only it holds.
    if (body.ok && body.saved === false) return false;
  } catch {
    // An older Classeum, or another folder's server: nothing to ask it.
  }
  return true;
}

/** Node processes listening on the port. */
function listeners() {
  try {
    if (windows) {
      // Listening sockets have no remote end (0.0.0.0:0); this avoids the state word, which Windows may translate.
      const rows = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).split(/\r?\n/).map((l) => l.trim().split(/\s+/));
      const pids = rows.filter((c) => c[1]?.endsWith(`:${port}`) && /^(0\.0\.0\.0|\[::\]):0$/.test(c[2] ?? '')).map((c) => Number(c[c.length - 1]));
      return [...new Set(pids)].filter((pid) => pid > 0 && /node\.exe/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })));
    }
    const pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(/\s+/).map(Number);
    return pids.filter((pid) => pid > 0 && /node|next-server/i.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })));
  } catch {
    return [];
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Asks the old server to stop and waits for the process itself to end, not just the port: Next keeps running
 * after a stop request while phones, the projector or the teacher still hold their live connections.
 */
async function stop(pids) {
  const kill = (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone, or not ours to stop; the checks below decide.
    }
  };
  pids.forEach((pid) => kill(pid));
  // About 3 s to finish on its own (its pending save goes out meanwhile), then it is stopped for good.
  for (let i = 0; i < 10 && pids.some(alive); i++) await sleep(300);
  pids.filter(alive).forEach((pid) => kill(pid, 'SIGKILL'));
  for (let i = 0; i < 30; i++) {
    if (!pids.some(alive) && (await free())) return true;
    await sleep(300);
  }
  return false;
}

const manual = windows
  ? `직접 끄려면: netstat -ano | findstr :${port} 로 맨 끝 번호(PID)를 보고 taskkill /PID 그번호 /F`
  : `직접 끄려면: lsof -ti tcp:${port} | xargs kill`;

if (!(await free())) {
  if (!(await isClasseum())) {
    say(`다른 프로그램이 ${port}번 포트를 쓰고 있어요. 그 프로그램을 끈 다음 다시 실행하세요.`, manual);
    process.exit(1);
  }
  // A quiz or an 아고라 under way (not just a 대기실 or the results) is asked about first, and so is a server whose
  // state can't be read: it may be in the middle of one.
  const state = await liveState();
  const busy = !state.known
    ? '켜져 있는 서버가 수업 중인지 확인하지 못했어요.'
    : state.arena && state.arena !== 'lobby' && state.arena !== 'summary'
      ? '지금 퀴즈가 진행 중이에요. 끄면 이번 퀴즈는 처음부터 다시 해야 해요.'
      : ['ready', 'writing', 'closed'].includes(state.agora)
        ? '지금 아고라가 진행 중이에요. 쓴 답은 남지만, 끄면 [대기실 열기]부터 다시 해야 해요.'
        : '';
  if (busy) {
    if (!process.stdin.isTTY) {
      say(busy, '켜져 있는 서버를 그대로 둘게요. 끝난 다음 다시 실행하세요.');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n  ${busy} 끄고 다시 켤까요? (y/N) `);
    rl.close();
    if (!/^(y|yes|ㅛ|네|예)/i.test(answer.trim())) {
      say('켜져 있는 서버를 그대로 둘게요.');
      process.exit(1);
    }
  }
  if (!(await saveFirst())) {
    say('켜져 있던 서버가 기록을 저장하지 못하고 있어서 끄지 않았어요. 지금 끄면 저장하지 못한 기록이 사라져요.', '디스크 남은 공간과 .data 폴더를 확인한 뒤 다시 실행하세요.');
    process.exit(1);
  }
  say('켜져 있던 Classeum 서버를 끄고 새로 켤게요.');
  if (!(await stop(listeners()))) {
    say(`${port}번 포트의 서버를 끄지 못했어요.`, manual);
    process.exit(1);
  }
}

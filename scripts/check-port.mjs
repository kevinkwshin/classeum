// Runs before `npm run class`: stops before the build if the port is taken, so a server that is
// still running never has its files rebuilt underneath it. Plain Node, so it works on Mac and Windows.
import { createServer } from 'node:net';

const port = Number(process.env.PORT) || 3000;

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

if (!(await free())) {
  const windows = process.platform === 'win32';
  const lines = (await isClasseum())
    ? [`Classeum 서버가 이미 ${port}번 포트에서 켜져 있어요.`, '그 서버를 켠 터미널 창에서 Ctrl+C를 눌러 끈 다음, npm run class를 다시 실행하세요.']
    : [`다른 프로그램이 ${port}번 포트를 쓰고 있어요.`, '그 프로그램을 끈 다음 npm run class를 다시 실행하세요.'];
  const how = windows
    ? [`창을 못 찾겠으면: netstat -ano | findstr :${port} 로 맨 끝 번호(PID)를 보고 taskkill /PID 그번호 /F`]
    : [`창을 못 찾겠으면: lsof -ti tcp:${port} | xargs kill`];
  console.error(['', ...lines, ...how, ''].map((l) => (l ? `  ${l}` : '')).join('\n'));
  process.exit(1);
}

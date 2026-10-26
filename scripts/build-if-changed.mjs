// Runs before `next start` in `npm run class`, and builds only when something the build reads has changed since
// the last build made here: the app's code and public files, the configs, the lockfile, the installed packages,
// the Next and Node versions. It compares a SHA-256 of their contents (not dates, which git and unzipping reset)
// with a stamp written in .next after a good build. The stamp also keeps that build's BUILD_ID, so a build made
// by hand (`next build`) is never taken for ours: the next run builds again. CLASSEUM_REBUILD=1 forces a build.
//
// It also deletes .next/dev, the build `next dev` keeps (often over 100 MB), which class mode never reads.
//
// `--forget` runs when `next start` exits with an error. Next exits that way whenever it stops (Ctrl+C, or the next
// `npm run class` replacing it), so the stamp is dropped only when the server stopped within 20 seconds of starting,
// which points at a broken build; the next start then builds again. It always exits 1, like the failed start.
// Plain Node, so it works on Mac and Windows.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const NEXT_DIR = join(root, '.next');
const STAMP = join(NEXT_DIR, 'classeum-build-hash');
const STARTED = join(NEXT_DIR, 'classeum-started');
const INPUTS = [
  'src', 'public', 'package.json', 'package-lock.json', 'node_modules/.package-lock.json',
  'next.config.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json', 'postcss.config.mjs', 'postcss.config.js', 'eslint.config.mjs',
  '.env', '.env.local', '.env.production', '.env.production.local',
];
// Finder, Explorer and an open Excel file leave these next to the real files; they don't change the build.
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*)$/i;
const say = (...lines) => console.log(['', ...lines, ''].map((l) => (l ? `  ${l}` : '')).join('\n'));
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '');

if (process.argv.includes('--forget')) {
  const started = Number(read(STARTED)) || 0;
  if (Date.now() - started < 20_000) {
    rmSync(STAMP, { force: true });
    say('다음에 켤 때는 빌드부터 다시 할게요.');
  }
  process.exit(1);
}

function files(path, out = []) {
  if (!existsSync(path)) return out;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) if (!JUNK.test(name)) files(join(path, name), out);
  } else out.push(path);
  return out;
}

/** Size of a file or folder, not following links. */
function bytes(path) {
  try {
    const st = lstatSync(path);
    return st.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + bytes(join(path, name)), 0) : st.size;
  } catch {
    return 0;
  }
}

/** Whether a `next dev` still runs from this folder: it writes its process id in .next/dev/lock while it runs. */
function devServerRunning(devDir) {
  try {
    process.kill(JSON.parse(readFileSync(join(devDir, 'lock'), 'utf8')).pid, 0); // signal 0 only asks whether it exists
    return true;
  } catch (e) {
    return e.code === 'EPERM' || e.code === 'EBUSY';
  }
}

function removeDevBuild() {
  const devDir = join(NEXT_DIR, 'dev');
  if (!existsSync(devDir) || devServerRunning(devDir)) return;
  const before = bytes(devDir);
  try {
    rmSync(devDir, { recursive: true, force: true });
  } catch {
    // Windows keeps files a program has open; what is left goes next time.
  }
  const mb = Math.round((before - bytes(devDir)) / 2 ** 20);
  if (mb > 0) say(`안 쓰는 개발용 파일 ${mb}MB를 지웠어요.`);
}

function fingerprint(nextVersion) {
  const h = createHash('sha256');
  h.update(`node ${process.versions.node.split('.')[0]}\0next ${nextVersion}\0`);
  for (const input of INPUTS) {
    for (const f of files(join(root, input))) {
      const body = readFileSync(f);
      h.update(`${relative(root, f).split(sep).join('/')}\0${body.length}\0`);
      h.update(body);
    }
  }
  return h.digest('hex');
}

/** Whether a package package-lock.json asks for is missing or at another version (platform-only ones aside). */
function needsInstall() {
  try {
    const want = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages ?? {};
    const have = JSON.parse(readFileSync(join(root, 'node_modules', '.package-lock.json'), 'utf8')).packages ?? {};
    return Object.entries(want).some(([path, p]) => path.startsWith('node_modules/') && !p.optional && !p.devOptional && have[path]?.version !== p.version);
  } catch {
    // npm writes node_modules/.package-lock.json only when an install finishes.
    return existsSync(join(root, 'package-lock.json'));
  }
}

const require = createRequire(join(root, 'package.json'));
let nextBin, nextVersion;
try {
  nextBin = require.resolve('next/dist/bin/next');
  nextVersion = require('next/package.json').version;
} catch {
  say('필요한 파일이 아직 설치되지 않았어요. 이 폴더에서 npm install을 먼저 실행하세요.');
  process.exit(1);
}
removeDevBuild();
if (needsInstall()) say('설치된 파일이 package-lock.json과 달라요. 서버를 끄고 이 폴더에서 npm install을 한 번 실행하세요.');

const want = fingerprint(nextVersion);
const buildId = read(join(NEXT_DIR, 'BUILD_ID'));
const [stampHash, stampId] = read(STAMP).split('\n');
if (buildId && stampHash === want && stampId === buildId && process.env.CLASSEUM_REBUILD !== '1') {
  writeFileSync(STARTED, String(Date.now()));
  say('바뀐 게 없어서 바로 켜요.');
  process.exit(0);
}

// A build stopped halfway leaves no stamp, so the next run builds again.
rmSync(STAMP, { force: true });
const run = spawnSync(process.execPath, [nextBin, 'build'], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
// The fingerprint from before the build: a file edited while it ran makes the next run build again.
writeFileSync(STAMP, `${want}\n${read(join(NEXT_DIR, 'BUILD_ID'))}`);
writeFileSync(STARTED, String(Date.now()));

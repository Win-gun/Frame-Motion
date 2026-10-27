import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';

const root = process.cwd();
const data = join(root, '.frame-motion');
const artifacts = join(data, 'verification');
const port = 5174;
const base = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let smoke;
let log;
let interrupted = false;

async function entries(path) {
  try { return await readdir(path); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
async function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await delay(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
function run(args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root, env: options.env, detached: process.platform !== 'win32',
    stdio: options.stdio ?? 'inherit',
  });
  child.on('error', (error) => console.error(error));
  return child;
}
async function checkPortFree() {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => listener.close(resolve));
  });
}
async function request(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response;
}
async function main() {
  assert.equal(process.env.CI, 'true', 'CI=true is required');
  const existing = await entries(data);
  assert(existing.every((name) => name === 'verification'), 'Refusing to use existing .frame-motion data');
  assert.equal((await entries(artifacts)).length, 0, 'Refusing to overwrite verification artifacts');
  await checkPortFree();
  await mkdir(artifacts, { recursive: true });
  log = createWriteStream(join(artifacts, 'server.log'), { flags: 'wx' });
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), FRAME_MOTION_HOST: '127.0.0.1' };
  delete env.FRAME_MOTION_PUBLIC_ORIGIN;
  server = run(['scripts/start-production.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  let exited = false;
  server.once('exit', () => { exited = true; });
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !interrupted) {
    if (exited || server.exitCode !== null) throw new Error('Production server exited before readiness; inspect server.log');
    try {
      const health = await request('/api/health');
      assert.equal((await health.json()).ok, true);
      ready = true;
      break;
    } catch { await delay(250); }
  }
  assert(ready, 'Production server did not become ready');
  const html = await (await request('/')).text();
  assert(!html.includes('/@vite/client'), 'Development HTML served in production');
  const assetPath = html.match(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/);
  assert(assetPath, 'Production HTML has no built asset');
  await request(assetPath[1]);
  const { photos } = await (await request('/api/demo')).json();
  assert.equal(photos.length, 1);
  assert.equal(photos[0].width, 1600);
  assert.equal(photos[0].height, 2400);
  await request(photos[0].src);
  await request(photos[0].backgroundSrc);
  smoke = run(['--import', 'tsx', 'scripts/verify-render.ts'], {
    env: { ...env, RENDER_BASE_URL: base, RENDER_PNG_ONLY: '1' },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PNG render smoke timed out')), 300_000);
    smoke.once('error', (error) => { clearTimeout(timer); reject(error); });
    smoke.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`PNG render smoke failed: ${code ?? signal}`));
    });
  });
  const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
  const result = report.pngVerified;
  assert(result && typeof result.id === 'string');
  assert.equal(result.width, 720);
  assert.equal(result.height, 720);
  assert.equal(result.fps, 24);
  assert.equal(result.frameCount, 24);
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.colorRange, 'tv');
  assert.equal(result.colorSpace, 'bt709');
  assert.equal(result.keyframes.length, 4);
  for (const file of [`${result.id}.mp4`, ...result.keyframes.map((_, i) => `${result.id}-frame-${i}.png`)]) {
    assert((await stat(join(artifacts, file))).size > 0, `Empty artifact: ${file}`);
  }
  console.log('PASS: production server, demo assets and PNG render');
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { interrupted = true; void stopTree(smoke); void stopTree(server); process.exitCode = 1; });
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopTree(smoke);
  await stopTree(server);
  if (log) await new Promise((resolve) => log.end(resolve));
  if (server) {
    try { await checkPortFree(); } catch { console.error(`Port ${port} remains in use`); process.exitCode = 1; }
  }
}

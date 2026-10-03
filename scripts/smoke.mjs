// Smoke test: serves dist/, opens the game standalone in headless Chrome with the autopilot (?test=auto), lets it
// play for a while, and reports console errors, uncaught exceptions and two screenshots.
//   npm run build && node scripts/smoke.mjs [seconds] [out-dir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const seconds = Number(process.argv[2] ?? 40);
const out = process.argv[3] ?? '/tmp/perigee-smoke';
mkdirSync(out, { recursive: true });
const { server, port } = await serve('dist');
const errors = [];
const logs = [];
async function session(width, height, mobile, name, secs) {
  const b = await launch({ width, height, gpu: true });
  b.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(`[${name}] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${name}] ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(`[${name}] log: ${m.params.entry.text}`);
  });
  if (mobile) await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=auto${mobile ? '&touch=1' : ''}` });
  const t0 = Date.now();
  let last = '';
  let lostTried = false;
  while (Date.now() - t0 < secs * 1000) {
    await sleep(2000);
    if (!lostTried && Date.now() - t0 > 12000) {
      // Lose and restore the WebGL context mid-play: the game must carry on without an exception.
      lostTried = true;
      await b.evaluate(`(() => { const gl = window.__perigee?.gfx?.renderer?.getContext(); const ext = gl?.getExtension('WEBGL_lose_context'); if (ext) { ext.loseContext(); setTimeout(() => ext.restoreContext(), 800); return 'lost'; } return 'no ext'; })()`).then((r) => console.log(`[${name}] context loss: ${r}`));
    }
    const st = await b.evaluate(`(() => { const a = window.__perigee; if (!a) return 'boot'; const g = a.round?.g?.(); return [a.mode, g?.phase, g?.h, a.session?.state?.(), g?.cur?.[a.room?.me?.id]?.n, Math.round(a.gfx.frameMs)].join(' ') })()`);
    if (st !== last) {
      console.log(`[${name}] ${Math.round((Date.now() - t0) / 1000)}s ${st}`);
      last = st;
    }
  }
  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
  const info = await b.evaluate(`(() => { const r = window.__perigee?.gfx?.renderer?.info; return r ? JSON.stringify({ calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, tex: r.memory.textures }) : 'n/a' })()`);
  console.log(`[${name}] renderer ${info}`);
  b.close();
}
await session(1100, 760, false, 'desktop', seconds);
// Determinism between Node and the browser build: the same reference shots end in the same place.
{
  const { prepareHole } = await import('../src/sim/hole.js');
  const { makeBall, launchAt, runToRest, ballPos } = await import('../src/sim/ball.js');
  const lib = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
  const b = await launch({ width: 400, height: 300 });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=1` });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if ((await b.evaluate('typeof window.__perigee?.hash')) === 'function') break;
  }
  let same = 0;
  const ids = lib.holes.filter((h, i) => i % 6 === 0).map((h) => h.id);
  for (const id of ids) {
    const data = lib.holes.find((h) => h.id === id);
    const h = prepareHole(data);
    const ball = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
    ball.quiet = true;
    launchAt(h, ball, data.ref.t0, data.ref.p[0], data.ref.p[1], data.ref.p[2], data.ref.v[0], data.ref.v[1], data.ref.v[2], null);
    const mode = runToRest(h, ball, 120 * 40);
    const node = { mode, step: ball.step, p: ballPos(h, ball, [0, 0, 0]) };
    const web = await b.evaluate(`JSON.stringify(window.__perigee.hash(${JSON.stringify(id)}))`);
    const w = JSON.parse(web);
    const ok = w.mode === node.mode && w.step === node.step && w.p.every((v, k) => v === node.p[k]);
    if (ok) same++;
    else console.log(`  determinism MISMATCH ${id}: node ${JSON.stringify(node)} web ${web}`);
  }
  console.log(`determinism node vs browser: ${same}/${ids.length} identical`);
  if (same !== ids.length) errors.push('determinism mismatch');
  b.close();
}
await session(390, 844, true, 'phone', Math.min(seconds, 25));
server.close();
console.log(`errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e.split('\n')[0]);
console.log(`warnings/errors logged: ${logs.length}`);
for (const l of logs.slice(0, 20)) console.log('  ' + l.slice(0, 300));
process.exit(errors.length ? 1 : 0);

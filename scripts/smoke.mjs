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
  const b = await launch({ width, height });
  b.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(`[${name}] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${name}] ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(`[${name}] log: ${m.params.entry.text}`);
  });
  if (mobile) await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=auto${mobile ? '&touch=1' : ''}` });
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < secs * 1000) {
    await sleep(2000);
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
await session(390, 844, true, 'phone', Math.min(seconds, 25));
server.close();
console.log(`errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e.split('\n')[0]);
console.log(`warnings/errors logged: ${logs.length}`);
for (const l of logs.slice(0, 20)) console.log('  ' + l.slice(0, 300));
process.exit(errors.length ? 1 : 0);

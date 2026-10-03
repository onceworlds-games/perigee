// Renders the store art with the game's own scenes (?poster=...) in headless Chrome (WebGL through SwiftShader)
// and saves it into store/.
//   npm run build && npm run store [only]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const BADGES = ['first-cup', 'slingshot', 'perigee', 'aerobrake', 'lost-in-space', 'photo-finish', 'under-par', 'daily-streak-7', 'wild-card', 'full-course', 'level-10'];
const SHOTS = [
  ['thumb1', 1280, 720, 'store/thumb-1.png'],
  ['thumb2', 1280, 720, 'store/thumb-2.png'],
  ['thumb3', 1280, 720, 'store/thumb-3.png'],
  ['thumb4', 1280, 720, 'store/thumb-4.png'],
  ['icon', 512, 512, 'store/icon.png'],
  ...BADGES.map((id) => [`badge-${id}`, 256, 256, `store/badges/${id}.png`]),
];

const only = process.argv[2];
mkdirSync('store/badges', { recursive: true });
const { server, port } = await serve('dist');
const b = await launch({ width: 1280, height: 720 });
for (const [kind, w, h, out] of SHOTS) {
  if (only && !kind.includes(only) && !out.includes(only)) continue;
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: kind.startsWith('badge') ? 0 : 1 } });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?poster=${kind}` });
  let ok = false;
  for (let i = 0; i < 300 && !ok; i++) {
    await sleep(100);
    ok = (await b.evaluate('window.__posterReady === true')) === true;
  }
  await sleep(kind.startsWith('badge') ? 300 : 1200);
  const r = await b.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log(ok ? 'saved' : 'TIMEOUT', out);
}
b.close();
server.close();

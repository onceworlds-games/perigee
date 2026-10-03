// Screenshots of every screen (standalone build, headless Chrome) for a visual check:
// title, clubhouse, locker, practice, aiming with the preview, the between-hole card, the final card.
//   npm run build && node scripts/shots.mjs [out-dir] [width] [height]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const out = process.argv[2] ?? '/tmp/perigee-shots';
const width = Number(process.argv[3] ?? 1100);
const height = Number(process.argv[4] ?? 760);
mkdirSync(out, { recursive: true });
const { server, port } = await serve('dist');
const b = await launch({ width, height });
const errors = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const shot = async (name) => {
  await sleep(300);
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
};
const ev = (expr) => b.evaluate(expr);
const until = async (expr, secs = 30) => {
  for (let i = 0; i < secs * 5; i++) {
    if (await ev(expr)) return true;
    await sleep(200);
  }
  return false;
};
await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=1` });
await until('!!window.__perigee && window.__perigee.mode === "title"');
await sleep(1500);
await shot('title');
await ev("document.querySelector('.btn.big').click()");
await sleep(1200);
await shot('club');
await ev("[...document.querySelectorAll('.btn')].find((x) => x.textContent.startsWith('Locker'))?.click()");
await sleep(500);
await shot('locker');
await ev("[...document.querySelectorAll('.btn')].find((x) => x.textContent.startsWith('Back'))?.click()");
await sleep(400);
await ev("[...document.querySelectorAll('.btn')].find((x) => x.textContent.startsWith('Practice'))?.click()");
await sleep(500);
await shot('practice');
await ev("[...document.querySelectorAll('.btn')].find((x) => x.textContent.startsWith('Back'))?.click()");
await sleep(400);
// A one-hole match with cards, bots to 4: aim, between (there is none with one hole), final.
await ev("window.__perigee.room.settings = { holes: 2, fill: '4', cards: 'on', preview: 'long' }; window.__perigee.room.setReady(true)");
await until('window.__perigee.session && window.__perigee.session.state() === "aim"', 20);
await sleep(600);
await ev("window.__perigee.camera.nudge(0.6, 0.1)");
await sleep(400);
await shot('aim');
await ev("window.__perigee.session.startCharge(); window.__perigee.session.charge = 0.62; window.__perigee.session.charging = true; window.__perigee.session.chargeDir = 0");
await sleep(300);
await shot('charge');
await ev('window.__perigee.session.cancelCharge(); window.__perigee.auto = true');
await until('window.__perigee.session && window.__perigee.session.state() === "flying"', 10);
await sleep(1200);
await shot('flight');
await until('window.__perigee.round.g()?.phase === "between"', 150);
await sleep(700);
await shot('between');
await ev("document.querySelector('.cardbtn')?.click()");
await sleep(400);
await shot('between-picked');
await until('window.__perigee.round.g()?.phase === "final"', 240);
await sleep(700);
await shot('final');
await ev("document.querySelector('.btn.teal')?.click()");
await until('window.__perigee.mode === "club"', 40);
await sleep(600);
await shot('club-after');
b.close();
server.close();
console.log(`errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e.split('\n')[0]);
process.exit(errors.length ? 1 : 0);

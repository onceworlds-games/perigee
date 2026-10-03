// A phone-sized touch session on the local platform: opens the game at 390x844 with touch, readies, waits for the
// first aim and takes screenshots (aiming, charging) so the HUD can be checked around the on-screen controls.
//   node scripts/phone.mjs [out-dir] [base]
import { launch } from '/Users/gowravthota/Desktop/commit/onceworlds-games/_tools/mp-lib.mjs';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? '/tmp/perigee-phone';
const base = process.argv[3] ?? 'http://localhost:8787';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await launch({ players: 1, base, width: 390, height: 844, touch: true });
const p = mp.players[0];
let failed = 0;
try {
  await p.open('/play/perigee');
  await sleep(2500);
  await p.shot(`${out}/title.png`);
  // A tap inside the game (the Play button) so touch controls switch on.
  const r = await p.frame("(() => { const b = document.querySelector('.btn.big'); const r = b.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]) })()");
  const [x, y] = JSON.parse(r);
  const off = await p.top("(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect(); return JSON.stringify([r.x, r.y]) })()");
  const [ox, oy] = JSON.parse(off);
  await p.tap(ox + x, oy + y);
  await sleep(1200);
  await p.shot(`${out}/club.png`);
  await p.top("document.querySelector('.ow-lobby-card .ow-lobby-action')?.click()");
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const st = await p.frame('window.__perigee?.session?.state?.()');
    if (st === 'aim') break;
  }
  await sleep(500);
  await p.shot(`${out}/aim.png`);
  const touch = await p.frame('onceworlds.controls.touch');
  console.log('touch controls on:', touch);
  await p.frame('window.__perigee.session.startCharge(); window.__perigee.session.charge = 0.7; window.__perigee.session.chargeDir = 0');
  await sleep(300);
  await p.shot(`${out}/charge.png`);
  await p.frame('window.__perigee.session.cancelCharge(); window.__perigee.auto = true');
  await sleep(6000);
  await p.shot(`${out}/flight.png`);
  console.log('errors', p.errors.length, p.errors.slice(0, 2));
  failed = p.errors.length;
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await mp.close();
}
process.exit(failed ? 1 : 0);

// Three guests on the local platform: lobby, start, autopilot play, a reload of each role, a dropped connection, a
// host change, and the checks that matter (everyone sees the same round record, nothing threw, no budget warnings).
//   npm run build && (deploy) && node scripts/mp.mjs [seconds] [base]
import { launch } from '/Users/gowravthota/Desktop/commit/onceworlds-games/_tools/mp-lib.mjs';

const seconds = Number(process.argv[2] ?? 70);
const base = process.argv[3] ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await launch({ players: 3, base });
const P = mp.players;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const state = (p) => p.frame(`(() => { const a = window.__perigee; const g = a?.round?.g?.(); const r = onceworlds.rooms.current; return JSON.stringify({ mode: a?.mode, phase: g?.phase, h: g?.h, mid: g?.mid, by: g?.by, players: g?.players?.length, st: a?.session?.state?.(), host: r?.host, me: r?.me?.id, isHost: r?.isHost, match: r?.match?.phase, n: g?.cur?.[r?.me?.id]?.n }) })()`).then((s) => JSON.parse(s ?? '{}'));
try {
  await Promise.all(P.map((p) => p.open('/play/perigee')));
  await sleep(2500);
  for (const p of P) await p.frame("document.querySelector('.btn.big')?.click()");
  await sleep(1500);
  const states = await Promise.all(P.map(state));
  check(states.every((s) => s.mode === 'club'), `everyone in the clubhouse: ${states.map((s) => s.mode).join(',')}`);
  const hostIdx = states.findIndex((s) => s.isHost);
  check(hostIdx >= 0, `one host (${hostIdx})`);
  // Everyone but the host readies, then the host starts (the platform's card).
  for (let i = 0; i < P.length; i++) if (i !== hostIdx) await P[i].top("document.querySelector('.ow-lobby-card .ow-lobby-action')?.click()");
  await sleep(1200);
  await P[hostIdx].top("document.querySelector('.ow-lobby-card .ow-lobby-action')?.click()");
  let started = false;
  for (let i = 0; i < 20 && !started; i++) {
    await sleep(1000);
    const s = await Promise.all(P.map(state));
    started = s.every((x) => x.match === 'playing' && x.mode === 'match');
  }
  check(started, 'match started for everyone');
  for (const p of P) await p.frame('window.__perigee.auto = true');
  const t0 = Date.now();
  let did = { reloadGuest: false, reloadHost: false, drop: false };
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(4000);
    const s = await Promise.all(P.map(state));
    console.log(`${Math.round((Date.now() - t0) / 1000)}s ` + s.map((x) => `${x.phase ?? '-'}:${x.h ?? '-'}:${x.st ?? '-'}:${x.n ?? '-'}${x.isHost ? '*' : ''}`).join('  '));
    const el = Date.now() - t0;
    if (!did.reloadGuest && el > 14000) {
      did.reloadGuest = true;
      const g = (hostIdx + 1) % 3;
      console.log(`-- reload guest ${g}`);
      await P[g].reload();
      await sleep(2500);
      await P[g].frame("document.querySelector('.btn.big')?.click()");
      await sleep(800);
      await P[g].frame('window.__perigee.auto = true');
    } else if (!did.drop && el > 30000) {
      did.drop = true;
      const g = (hostIdx + 2) % 3;
      console.log(`-- drop socket of guest ${g}`);
      await P[g].dropSocket();
    } else if (!did.reloadHost && el > 44000) {
      did.reloadHost = true;
      console.log(`-- reload host ${hostIdx}`);
      await P[hostIdx].reload();
      await sleep(2500);
      await P[hostIdx].frame("document.querySelector('.btn.big')?.click()");
      await sleep(800);
      await P[hostIdx].frame('window.__perigee.auto = true');
    }
  }
  const s = await Promise.all(P.map(state));
  check(new Set(s.map((x) => x.mid)).size === 1, `one round record for everyone (${s.map((x) => x.mid).join(',')})`);
  check(new Set(s.map((x) => x.host)).size === 1, `everyone agrees on the host`);
  check(s.filter((x) => x.isHost).length === 1, `exactly one host`);
  check(s.every((x) => x.mode === 'match' || x.mode === 'club'), `modes sane: ${s.map((x) => x.mode).join(',')}`);
  const hostNow = s.findIndex((x) => x.isHost);
  check(hostNow !== hostIdx, `the host role moved after the host reloaded (${hostIdx} -> ${hostNow})`);
  check(s.every((x) => x.by === s[hostNow].me), `the round record is run by the current host`);
  for (let i = 0; i < P.length; i++) {
    const errs = P[i].errors;
    check(errs.length === 0, `player ${i} uncaught errors: ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 200) : ''}`);
    const warn = P[i].logs.filter((l) => /waiting|dropped/.test(l));
    check(warn.length === 0, `player ${i} budget warnings: ${warn.length}${warn.length ? ' ' + warn[0].slice(0, 160) : ''}`);
  }
  await P[0].shot('/tmp/perigee-mp-0.png');
  await P[hostNow].shot('/tmp/perigee-mp-host.png');
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await mp.close();
}
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);

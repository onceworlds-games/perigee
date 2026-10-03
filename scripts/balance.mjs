// Headless balance harness: the four bot tiers play every verified hole in data/holes.json and the numbers are
// printed against the targets (par distribution, strokes over par by tier, ace rates, hole duration, how the
// grading fraction tracks bot failure, and what each card is worth).
//   node scripts/balance.mjs [--reps 2] [--tiers rookie,club,pro,legend] [--cards] [--world comet]
import { readFileSync } from 'node:fs';
import { prepareHole } from '../src/sim/hole.js';
import { playHole } from '../src/sim/play.js';
import { CARD_IDS } from '../src/sim/cards.js';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const reps = Number(flag('reps', 2));
const tiers = flag('tiers', 'rookie,club,pro,legend').split(',');
const worldOnly = flag('world', '');
const doCards = args.includes('--cards');

const lib = JSON.parse(readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
const holes = lib.holes.filter((h) => !worldOnly || h.world === worldOnly).map((h) => ({ data: h, hole: prepareHole(h) }));
const pad = (s, n) => String(s).padEnd(n);
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

console.log(`${holes.length} holes`);
const parCount = [2, 3, 4].map((p) => holes.filter((h) => h.data.par === p).length);
console.log(`par distribution  2: ${num((100 * parCount[0]) / holes.length, 0)}%  3: ${num((100 * parCount[1]) / holes.length, 0)}%  4: ${num((100 * parCount[2]) / holes.length, 0)}%   (target 30 / 45 / 25)`);

const perTier = {};
const perHole = holes.map(() => ({ strokes: 0, n: 0, slowest: 0 }));
const t0 = Date.now();
for (const tier of tiers) {
  const r = { over: 0, aces: 0, pickups: 0, n: 0, seconds: 0 };
  holes.forEach((h, i) => {
    for (let k = 0; k < reps; k++) {
      const res = playHole(h.hole, tier, 1000 + k);
      r.over += res.strokes - h.data.par;
      r.aces += res.ace ? 1 : 0;
      r.pickups += res.pickedUp ? 1 : 0;
      r.seconds += res.seconds;
      r.n++;
      if (tier === 'club') {
        perHole[i].n++;
        perHole[i].strokes += res.strokes;
        perHole[i].slowest = Math.max(perHole[i].slowest, res.seconds);
      }
    }
  });
  perTier[tier] = r;
}
console.log(`\n${pad('tier', 8)} ${pad('avg vs par', 12)} ${pad('ace %', 8)} ${pad('pickup %', 10)} ${pad('hole s', 8)} target`);
const TARGET = { rookie: '+2.0, ace < 2%', club: '+1.0, 45-90 s', pro: '+0.4', legend: '-0.2..+0.2, ace < 12%' };
for (const tier of tiers) {
  const r = perTier[tier];
  console.log(`${pad(tier, 8)} ${pad((r.over / r.n >= 0 ? '+' : '') + num(r.over / r.n), 12)} ${pad(num((100 * r.aces) / r.n, 1), 8)} ${pad(num((100 * r.pickups) / r.n, 1), 10)} ${pad(num(r.seconds / r.n, 0), 8)} ${TARGET[tier] ?? ''}`);
}

// Sensitivity: does a lower grading fraction mean more strokes? Pearson correlation of (1 - frac) with the Club
// bots' average strokes per hole (absolute, since par itself follows the grade).
if (tiers.includes('club')) {
  const xs = holes.map((h) => 1 - h.data.grade.frac);
  const ys = perHole.map((p) => (p.n ? p.strokes / p.n : 0));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  console.log(`\ngrade sensitivity vs Club strokes: r = ${num(sxy / Math.sqrt(sxx * syy || 1))}  (positive: harder-graded holes take more strokes)`);
  const slow = perHole.reduce((a, p) => a + p.slowest, 0) / perHole.length;
  console.log(`hole duration with the slowest of ${reps} Club bots: ${num(slow, 0)} s (target 45-90 with a group)`);
  const byWorld = {};
  holes.forEach((h, i) => {
    const w = (byWorld[h.data.world] ??= { strokes: 0, par: 0, n: 0 });
    w.strokes += perHole[i].strokes / Math.max(1, perHole[i].n);
    w.par += h.data.par;
    w.n++;
  });
  console.log('Club strokes vs par by world: ' + Object.entries(byWorld).map(([w, v]) => `${w} ${(v.strokes - v.par >= 0 ? '+' : '') + num((v.strokes - v.par) / v.n, 1)}`).join('  '));
}

if (doCards) {
  console.log(`\ncards (Legend, every hole, delta of strokes vs no card; target: none beyond 0.6, Mulligan and Magnet strongest, Sticky weakest)`);
  const base = holes.map((h) => playHole(h.hole, 'legend', 7).strokes);
  const rows = [];
  for (const card of CARD_IDS) {
    let d = 0;
    holes.forEach((h, i) => {
      d += playHole(h.hole, 'legend', 7, { card }).strokes - base[i];
    });
    rows.push([card, d / holes.length]);
  }
  rows.sort((a, b) => a[1] - b[1]);
  for (const [card, d] of rows) console.log(`${pad(card, 10)} ${(d >= 0 ? '+' : '') + num(d)}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);

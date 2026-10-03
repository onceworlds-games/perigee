// The generator, the grader, the bots, scoring and cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateHole, gradeHole, teeShot, parFor } from '../src/sim/gen.js';
import { prepareHole } from '../src/sim/hole.js';
import { makeBall, runToRest, HOLED, REST } from '../src/sim/ball.js';
import { WORLDS, autoWorld } from '../src/sim/worlds.js';
import { planShot, botIdentity, TIERS } from '../src/sim/bots.js';
import { playHole } from '../src/sim/play.js';
import { pointsFor, resultWord, standings, totalFor, strokeCap } from '../src/sim/score.js';
import { draftFor, modsFor, cleanMods, CARD_IDS } from '../src/sim/cards.js';
import { seedOf } from '../src/sim/rng.js';

function sinks(data) {
  const hole = prepareHole(data);
  const b = makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
  b.quiet = true;
  teeShot(hole, b, data.ref.t0, data.ref.dir, data.ref.speed);
  return runToRest(hole, b, 120 * 40) === HOLED;
}

test('every world generates holes whose reference shot sinks (runtime budget)', () => {
  for (const w of WORLDS) {
    for (let s = 1; s <= 3; s++) {
      const h = generateHole(w.id, seedOf('test', w.id, s), { candidates: 900, attempts: 4 });
      assert.ok(h, `${w.id} seed ${s} made a hole`);
      assert.ok(h.par >= 2 && h.par <= 4);
      assert.ok(h.grade.frac >= 0.03);
      assert.ok(sinks(h), `${w.id} seed ${s}: the reference shot sinks`);
      assert.ok(h.planets.length >= 3 && h.planets.length <= 12);
      assert.ok(typeof h.name === 'string' && h.name.length > 2);
    }
  }
});

test('generation is deterministic for a seed', () => {
  const a = generateHole('lava', 12345, { candidates: 600, attempts: 3 });
  const b = generateHole('lava', 12345, { candidates: 600, attempts: 3 });
  assert.deepEqual(a, b);
});

test('the shipped library: 72 holes, 9 per world, all verified, pars in range', () => {
  const lib = JSON.parse(readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
  assert.equal(lib.holes.length, 72);
  for (const w of WORLDS) assert.equal(lib.holes.filter((h) => h.world === w.id).length, 9, w.id);
  const ids = new Set(lib.holes.map((h) => h.id));
  assert.equal(ids.size, 72);
  for (const h of lib.holes) {
    assert.ok(h.par >= 2 && h.par <= 4, h.id);
    assert.ok(sinks(h), `${h.id} reference shot sinks`);
    assert.equal(parFor(h.grade.frac) >= 2, true);
    assert.ok(h.grade.flight <= 32);
  }
  const share = (p) => lib.holes.filter((h) => h.par === p).length / 72;
  assert.ok(share(2) > 0.2 && share(2) < 0.45, `par 2 share ${share(2)}`);
  assert.ok(share(3) > 0.3 && share(3) < 0.6, `par 3 share ${share(3)}`);
  assert.ok(share(4) > 0.12 && share(4) < 0.35, `par 4 share ${share(4)}`);
});

test('grading is deterministic and bounded', () => {
  const lib = JSON.parse(readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
  const h = lib.holes[5];
  const hole = prepareHole(h);
  const g1 = gradeHole(hole, h.ref, 7);
  const g2 = gradeHole(hole, h.ref, 7);
  assert.deepEqual(g1, g2);
  assert.ok(g1.frac >= 0 && g1.frac <= 1);
});

test('bots plan a sane shot on every tier and the headless hole ends', () => {
  const lib = JSON.parse(readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
  const hole = prepareHole(lib.holes[0]);
  for (const tier of Object.keys(TIERS)) {
    const b = makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
    const plan = planShot(hole, b, 0, tier, 5);
    assert.ok(plan.speed > 1 && plan.speed <= 38);
    assert.ok(Math.abs(Math.hypot(...plan.dir) - 1) < 1e-9);
    for (const v of [...plan.p, ...plan.v]) assert.ok(Number.isFinite(v));
    const res = playHole(hole, tier, 3);
    assert.ok(res.strokes >= 1 && res.strokes <= strokeCap(hole.par));
    assert.ok(res.seconds > 0 && res.seconds < 600);
  }
  const a = planShot(hole, makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]), 0, 'pro', 9);
  const b = planShot(hole, makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]), 0, 'pro', 9);
  assert.deepEqual(a, b, 'planning is deterministic for a seed');
  const id = botIdentity(123, 2);
  assert.ok(id.name.length > 1 && TIERS[id.tier]);
});

test('scoring: points, words, standings with ties, speed bonus', () => {
  assert.equal(pointsFor(1, 3), 5);
  assert.equal(pointsFor(2, 3), 4);
  assert.equal(pointsFor(3, 3), 3);
  assert.equal(pointsFor(4, 3), 2);
  assert.equal(pointsFor(5, 3), 1);
  assert.equal(pointsFor(9, 3), 0);
  assert.equal(resultWord(1, 3), 'Perigee!');
  assert.equal(resultWord(2, 3), 'Birdie!');
  assert.equal(resultWord(3, 3), 'Par');
  assert.equal(resultWord(7, 3, true), 'Picked up');
  const scores = { a: [{ strokes: 3, par: 3 }, { strokes: 2, par: 3, first: true }], b: [{ strokes: 2, par: 3, first: true }, { strokes: 3, par: 3 }], c: [{ strokes: 6, par: 3 }, null] };
  const st = standings('strokes', scores, ['a', 'b', 'c']);
  assert.deepEqual(st.map((r) => [r.id, r.place]), [['a', 1], ['b', 1], ['c', 3]]);
  const pts = standings('points', scores, ['a', 'b', 'c']);
  assert.equal(pts[0].total, 7);
  assert.equal(totalFor('speed', scores.a).total, 4);
  assert.equal(strokeCap(2), 6);
});

test('cards: drafts are deterministic and distinct, mods are validated', () => {
  const d1 = draftFor(77, 2, 'p1');
  const d2 = draftFor(77, 2, 'p1');
  assert.deepEqual(d1, d2);
  assert.equal(new Set(d1).size, 3);
  assert.notDeepEqual(draftFor(77, 2, 'p1'), draftFor(77, 3, 'p1'));
  for (const id of CARD_IDS) {
    const m = modsFor(id, 1);
    if (m) assert.deepEqual(cleanMods(m, 4), m);
  }
  assert.equal(cleanMods({ magnet: 'yes', gplanet: 99, gfactor: 1.4 }, 4), null);
  assert.equal(cleanMods({ thrust: 5 }, 4), null, 'a thrust needs the thruster');
  assert.deepEqual(cleanMods({ thruster: true, thrust: 5.5 }, 4), { thruster: true });
  assert.deepEqual(cleanMods({ braker: true, brake: { from: 10, to: 20 } }, 4), { braker: true, brake: { from: 10, to: 20 } });
  assert.deepEqual(cleanMods({ braker: true, brake: { from: 10, to: 9999 } }, 4), { braker: true });
  assert.equal(cleanMods(null, 4), null);
  assert.equal(cleanMods('x', 4), null);
  assert.equal(autoWorld(1, 0, 9), 'pebble');
  assert.ok(WORLDS.some((w) => w.id === autoWorld(5, 8, 9)));
});

// The pure simulation: determinism, bounds, fuzzing, rails, surfaces, cups and hazards. `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedOf } from '../src/sim/rng.js';
import { prepareRail, railPos } from '../src/sim/rails.js';
import { heightAt, surfaceF, surfaceNormal, gravityScalar, radiusAt } from '../src/sim/planet.js';
import { prepareHole, teePos, cupPos, q, num, basisFor } from '../src/sim/hole.js';
import { makeBall, launchAt, stepBall, simulate, runToRest, ballPos, distToCup, planetVel, placeBall, REST, FLY, ROLL, LOST, HOLED, DT, OOB } from '../src/sim/ball.js';

export const TEST_HOLE = {
  world: 'test',
  seed: 1,
  par: 3,
  planets: [
    { k: 'meadow', c: [0, 0, 0], R: 8, g: 12, lobes: [[0, 1, 0, 0.08, 4], [1, 0, 0, -0.06, 6], [0.3, -0.5, 0.8, 0.12, 3]], patches: [{ u: [0, -1, 0], cos: 0.95, t: 'ice' }] },
    { k: 'dust', c: [30, 6, 0], R: 6, g: 11, lobes: [[0, 0, 1, 0.1, 4]], rail: { type: 'circle', center: [30, 6, 0], radius: 10, u: [1, 0, 0], v: [0, 0, 1], period: 40 } },
    { k: 'gas', c: [0, 0, -45], R: 12, g: 13, lobes: [] },
    { k: 'metal', c: [-34, -4, 10], R: 5, g: 10, lobes: [], patches: [{ u: [0, 1, 0], cos: 0.9, t: 'pad' }, { u: [1, 0, 0], cos: 0.93, t: 'lava' }, { u: [0, 0, 1], cos: 0.93, t: 'tar' }], rail: { type: 'line', a: [-34, -4, 10], b: [-34, -4, 26], period: 20 } },
    { k: 'hole', c: [20, 0, 40], R: 2, g: 40, lobes: [] },
    { k: 'comet', c: [0, 30, 0], R: 2, g: 4, lobes: [], rail: { type: 'sweep', a: [-120, 30, 0], b: [120, 30, 0], period: 30 } },
  ],
  rings: [{ c: [15, 4, 0], axis: [1, 0, 0], r: 2, k: 8 }],
  worms: [{ a: { c: [0, 14, 0], axis: [1, 0, 0] }, b: { c: [30, 20, 0], axis: [0, 0, 1] }, r: 1.6 }],
  tee: { p: 0, d: [0, 0, 1] },
  cup: { p: 1, d: [0, 1, 0], r: 0.55 },
};

const hole = prepareHole(TEST_HOLE);

function shoot(dir, speed, t0 = 0, mods = null, h = hole) {
  const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
  const p = teePos(h, t0);
  const l = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  launchAt(h, b, t0, q(p[0]), q(p[1]), q(p[2]), q((dir[0] / l) * speed), q((dir[1] / l) * speed), q((dir[2] / l) * speed), mods);
  return b;
}

test('rng is deterministic and well spread', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const xs = Array.from({ length: 1000 }, () => a.next());
  assert.deepEqual(xs, Array.from({ length: 1000 }, () => b.next()));
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  assert.ok(mean > 0.45 && mean < 0.55);
  assert.equal(seedOf('a', 1), seedOf('a', 1));
  assert.notEqual(seedOf('a', 1), seedOf('a', 2));
  for (let i = 0; i < 100; i++) {
    const u = a.unit();
    assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-12);
  }
});

test('circle rails stay on the circle and repeat with the period', () => {
  const rail = prepareRail({ type: 'circle', center: [1, 2, 3], radius: 5, u: [1, 0, 0], v: [0, 0, 1], period: 10 });
  const out = [0, 0, 0];
  for (let t = 0; t < 30; t += 0.37) {
    railPos(rail, t, out);
    const r = Math.hypot(out[0] - 1, out[1] - 2, out[2] - 3);
    assert.ok(Math.abs(r - 5) < 0.15, `radius ${r} at ${t}`);
    assert.ok(Math.abs(out[1] - 2) < 1e-9);
  }
  const a = railPos(rail, 2.5, [0, 0, 0]);
  const b = railPos(rail, 12.5, [0, 0, 0]);
  assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-9);
  // Speed is roughly uniform: the distance moved per step never varies by more than a third.
  const ds = [];
  let prev = railPos(rail, 0, [0, 0, 0]).slice();
  for (let t = 0.1; t <= 10; t += 0.1) {
    const p = railPos(rail, t, [0, 0, 0]);
    ds.push(Math.hypot(p[0] - prev[0], p[2] - prev[2]));
    prev = p.slice();
  }
  assert.ok(Math.max(...ds) / Math.min(...ds) < 1.35);
  const line = prepareRail({ type: 'line', a: [0, 0, 0], b: [10, 0, 0], period: 4 });
  assert.deepEqual(railPos(line, 0, [0, 0, 0]), [0, 0, 0]);
  assert.ok(Math.abs(railPos(line, 2, [0, 0, 0])[0] - 10) < 1e-9);
  assert.deepEqual(railPos(line, 4, [0, 0, 0]), [0, 0, 0]);
});

test('surface height, normal and gravity are sane', () => {
  const pl = hole.planets[0];
  assert.ok(heightAt(pl, 0, 1, 0) > 0.07); // the hill
  assert.ok(heightAt(pl, 1, 0, 0) < -0.05); // the crater
  assert.ok(Math.abs(surfaceF(pl, 0, radiusAt(pl, 0, 1, 0), 0, 0, 0, 0)) < 1e-9);
  const n = surfaceNormal(pl, 0, 9, 0, 0, 0, 0, [0, 0, 0]);
  assert.ok(n[1] > 0.99, 'normal points up on the hilltop');
  // Gravity: full inside 2R, zero beyond 3.2R, continuous between.
  assert.ok(Math.abs(gravityScalar(pl, 8) - 12) < 1e-9);
  assert.ok(Math.abs(gravityScalar(pl, 16) - 3) < 1e-9);
  assert.equal(gravityScalar(pl, 30), 0);
  let prev = gravityScalar(pl, 15);
  for (let d = 15.01; d < 27; d += 0.01) {
    const g = gravityScalar(pl, d);
    assert.ok(g <= prev + 1e-9 && g >= 0, `monotone at ${d}`);
    prev = g;
  }
  assert.ok(gravityScalar(pl, 1) > 0 && gravityScalar(pl, 1) < 12); // inside: linear, finite
  const { u, v } = basisFor([0, 1, 0]);
  assert.ok(Math.abs(u[1]) < 1e-9 && Math.abs(v[1]) < 1e-9);
  assert.ok(Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) < 1e-9);
});

test('the same shot gives the same ball on every replay', () => {
  const ref = shoot([0.6, 0.5, 0.62], 22);
  simulate(hole, ref, 120 * 60);
  const refPos = ballPos(hole, ref);
  for (let i = 0; i < 1000; i++) {
    const b = shoot([0.6, 0.5, 0.62], 22);
    simulate(hole, b, 120 * 60);
    assert.deepEqual(ballPos(hole, b), refPos);
    assert.equal(b.step, ref.step);
  }
});

test('a lobbed shot lands, rolls and rests; a hard shot is lost and comes back', () => {
  const soft = shoot([-0.2, 0.2, 0.95], 6);
  simulate(hole, soft, 120 * 30);
  assert.equal(soft.mode, REST);
  assert.equal(soft.penalties, 0);
  assert.ok(soft.events.some((e) => e.k === 'land' || e.k === 'bounce'));
  const hard = shoot([0, 0, 1], 38);
  simulate(hole, hard, 120 * 60);
  assert.equal(hard.mode, REST);
  assert.equal(hard.penalties, 1);
  assert.ok(hard.events.some((e) => e.k === 'lost' && e.a === 'space'));
  assert.ok(hard.events.some((e) => e.k === 'return'));
  const p = ballPos(hole, hard);
  const tee = teePos(hole, hard.t0 + hard.step * DT);
  assert.ok(Math.hypot(p[0] - tee[0], p[1] - tee[1], p[2] - tee[2]) < 1e-6, 'back on the tee');
});

test('a gas giant swallows, a black hole kills, lava burns, tar sticks, a pad kicks', () => {
  const gas = makeBall(hole, 0, [0, 0, 1]);
  launchAt(hole, gas, 0, 0, 0, -20, 0, 0, -30);
  simulate(hole, gas, 120 * 40);
  assert.ok(gas.events.some((e) => e.k === 'lost' && e.a === 'gas'));
  assert.equal(gas.mode, REST, 'came back to the tee');
  const bh = makeBall(hole, 0, [0, 0, 1]);
  launchAt(hole, bh, 0, 20, 0, 36, 0, 0, 1.5);
  simulate(hole, bh, 120 * 10);
  assert.ok(bh.events.some((e) => e.k === 'lost' && e.a === 'hole'));
  // Drop a ball straight onto the metal planet's pad, then onto its lava and tar.
  const drop = (dir, speed = -3) => {
    const b = makeBall(hole, 0, [0, 0, 1]);
    const c = [-34, -4, 10];
    b.rest.g = 3;
    launchAt(hole, b, 0, c[0] + dir[0] * 7, c[1] + dir[1] * 7, c[2] + dir[2] * 7, dir[0] * speed, dir[1] * speed, dir[2] * speed);
    simulate(hole, b, 120 * 8);
    return b;
  };
  const pad = drop([0, 1, 0], -6);
  assert.ok(pad.events.some((e) => e.k === 'bounce' && e.c === 'pad'));
  const lava = drop([1, 0, 0]);
  assert.ok(lava.events.some((e) => e.k === 'lost' && e.a === 'lava'));
  const tar = drop([0, 0, 1]);
  assert.ok(tar.events.some((e) => e.k === 'land' && e.c === 'tar'));
});

test('the cup takes a slow ball and lips out a fast one', () => {
  // A ball placed on the cup planet, rolling toward the cup from 2 m away.
  const roll = (speed) => {
    const b = makeBall(hole, 1, [0.3, 0.95, 0]);
    const t0 = 0;
    const p = ballPos(hole, b);
    const cup = cupPos(hole, t0);
    const d = [cup[0] - p[0], cup[1] - p[1], cup[2] - p[2]];
    const l = Math.hypot(...d);
    const vp = planetVel(hole, 1, t0);
    launchAt(hole, b, t0, p[0], p[1], p[2], (d[0] / l) * speed + vp[0], (d[1] / l) * speed + vp[1], (d[2] / l) * speed + vp[2]);
    simulate(hole, b, 120 * 20);
    return b;
  };
  const slow = roll(3);
  assert.equal(slow.mode, HOLED, 'a gentle roll drops in');
  const fast = roll(12);
  assert.notEqual(fast.mode, HOLED);
  assert.ok(fast.events.some((e) => e.k === 'lip') || fast.mode === REST);
});

test('rings boost and wormholes carry speed over', () => {
  const b = makeBall(hole, 0, [0, 0, 1]);
  launchAt(hole, b, 0, 13.5, 4, 0, 12, 0, 0);
  simulate(hole, b, 120 * 2);
  assert.equal(b.boosts, 1);
  assert.ok(b.events.some((e) => e.k === 'ring'));
  const w = makeBall(hole, 0, [0, 0, 1]);
  launchAt(hole, w, 0, -4, 14, 0, 9, 0, 0);
  for (let i = 0; i < 120 && w.warps === 0; i++) stepBall(hole, w);
  assert.equal(w.warps, 1);
  const speed = Math.hypot(w.vx, w.vy, w.vz);
  assert.ok(Math.abs(speed - 9) < 1.5, `speed carried over: ${speed}`);
  assert.ok(Math.hypot(w.x - 30, w.y - 20, w.z) < 4, 'came out at the other end');
});

test('a ball on a moving world rides with it; its shot includes the world speed', () => {
  const b = makeBall(hole, 1, [0, 1, 0]);
  const p0 = ballPos(hole, b).slice();
  b.t0 = 10;
  const p1 = ballPos(hole, b);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 1, 'moved with the rail');
  const v = planetVel(hole, 1, 3);
  assert.ok(Math.hypot(...v) > 0.5 && Math.hypot(...v) < 3);
  assert.deepEqual(planetVel(hole, 0, 3), [0, 0, 0]);
});

test('fuzz: thousands of random shots never produce NaN, never escape the bounds for long, always end', () => {
  const rng = makeRng(99);
  let rests = 0;
  let holed = 0;
  for (let i = 0; i < 1500; i++) {
    const dir = rng.unit();
    const speed = rng.range(0.1, 38);
    const t0 = rng.range(0, 60);
    const mods = rng.next() < 0.3 ? { ghost: rng.next() < 0.5, bouncy: rng.next() < 0.5, magnet: rng.next() < 0.5, luck: true, thrust: rng.int(300), brake: { from: 10, to: 100 } } : null;
    const b = shoot(dir, speed, t0, mods);
    let steps = 0;
    while (steps < 120 * 90) {
      const mode = stepBall(hole, b);
      steps++;
      const p = ballPos(hole, b);
      for (const v of [...p, b.vx, b.vy, b.vz]) assert.ok(Number.isFinite(v), `finite at shot ${i} step ${steps}`);
      assert.ok(Math.hypot(...p) < OOB + 40, `inside bounds (${Math.hypot(...p)}) at shot ${i}`);
      assert.ok(Math.hypot(b.vx, b.vy, b.vz) < 400, 'speed stays sane');
      if (mode === REST || mode === HOLED) break;
    }
    if (b.mode === REST) rests++;
    if (b.mode === HOLED) holed++;
      assert.ok(b.mode === REST || b.mode === HOLED, `shot ${i} ended (mode ${b.mode} after ${steps} steps)`);
    assert.ok(b.penalties <= 12);
  }
  assert.ok(rests + holed === 1500);
});

test('placeBall, num and q guard bad input', () => {
  const b = makeBall(hole, 0, [0, 0, 1]);
  placeBall(hole, b, 0, 0, 0, 0); // zero direction: still finite
  assert.ok(Number.isFinite(b.rx + b.ry + b.rz));
  assert.equal(num(NaN, 0, 1, 5), 5);
  assert.equal(num(Infinity, 0, 1, 5), 5);
  assert.equal(num('3', 0, 10, 5), 5);
  assert.equal(num(0.5, 0, 1, 5), 0.5);
  assert.equal(q(1 / 3) * 1024, Math.round(1024 / 3));
});

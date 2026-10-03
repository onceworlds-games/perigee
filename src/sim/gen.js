// Holes by construction: build a system, tee off thousands of times with the real physics, keep the flights that
// are interesting, put the cup where such a ball came to rest, then grade the hole by how many slightly-off
// copies of that shot still sink or finish near. No hole ships (or appears at runtime) without a real solution.
// Portals and boost rings are placed ON a real flight path found in a first pass, so they are part of a solution too.
//
// `generateHoleSteps` is a generator function so a page can spread the work over frames; `generateHole` runs it
// through in one go (scripts, tests).
import { makeRng } from './rng.js';
import { prepareHole, teePos, basisFor, q } from './hole.js';
import { makeBall, launchAt, runToRest, planetVel, ballPos, distToCup, REST, HOLED, DT } from './ball.js';
import { playHole } from './play.js';
import { buildSystem } from './system.js';
import { worldById } from './worlds.js';
import { patchAt, heightAt } from './planet.js';

export const PERTURB = 48;
const TAN_1_5 = 0.02619; // tan(1.5 degrees)
const MAX_STEPS = 120 * 40;
const FEATURES = { warp: 'Shortcut', aero: 'Dive', sling: 'Slingshot', boost: 'Boost', roll: 'Long Roll', bank: 'Bank', cross: 'Crossing', putt: 'Putt' };

function unit(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Launches the ball from the tee with a unit direction and a speed at hole time t0 (quantized like a real shot). */
export function teeShot(hole, b, t0, dir, speed, mods = null) {
  const p = teePos(hole, t0);
  const vp = planetVel(hole, hole.tee.p, t0);
  const v = [q(dir[0] * speed + vp[0]), q(dir[1] * speed + vp[1]), q(dir[2] * speed + vp[2])];
  const pq = [q(p[0]), q(p[1]), q(p[2])];
  launchAt(hole, b, t0, pq[0], pq[1], pq[2], v[0], v[1], v[2], mods);
  return { p: pq, v };
}

const P = [0, 0, 0];
const samples = new Float64Array(3 * 400);

/** Simulates a shot with early outs (lost for good = -1); samples the flight every 16 steps when `path`. */
export function runShot(hole, b, path) {
  let k = 0;
  return runToRest(hole, b, MAX_STEPS, path ? (bb) => {
    if (k < 400) {
      samples[k * 3] = bb.x;
      samples[k * 3 + 1] = bb.y;
      samples[k * 3 + 2] = bb.z;
      k++;
    }
  } : null);
}

function pathDeviation(k, a, bpos) {
  const dx = bpos[0] - a[0];
  const dy = bpos[1] - a[1];
  const dz = bpos[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  let worst = 0;
  for (let i = 0; i < k; i++) {
    const px = samples[i * 3] - a[0];
    const py = samples[i * 3 + 1] - a[1];
    const pz = samples[i * 3 + 2] - a[2];
    const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / l2));
    const ex = px - dx * t;
    const ey = py - dy * t;
    const ez = pz - dz * t;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d > worst) worst = d;
  }
  return worst;
}

function clearance(hole, p) {
  let best = 1e9;
  for (let i = 0; i < hole.n; i++) {
    const dx = hole.cs[i * 3] - p[0];
    const dy = hole.cs[i * 3 + 1] - p[1];
    const dz = hole.cs[i * 3 + 2] - p[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - hole.planets[i].R * (1 + hole.planets[i].hmax);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Grades a hole against its reference shot: the fraction of PERTURB copies (direction within 1.5 degrees, power
 * within 3%) that sink or rest within 2 m of the cup. Deterministic for a given hole and seed.
 */
export function gradeHole(hole, ref, seed = 7) {
  const rng = makeRng(seed);
  let sinks = 0;
  let near = 0;
  const b = makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
  b.quiet = true;
  for (let i = 0; i < PERTURB; i++) {
    const perp = unit(cross(ref.dir, rng.unit()));
    const a = TAN_1_5 * (rng.next() * 2 - 1);
    const dir = unit([ref.dir[0] + perp[0] * a, ref.dir[1] + perp[1] * a, ref.dir[2] + perp[2] * a]);
    const speed = ref.speed * (1 + 0.03 * (rng.next() * 2 - 1));
    b.mode = REST;
    teeShot(hole, b, ref.t0, dir, speed);
    const mode = runShot(hole, b, false);
    if (mode === HOLED) sinks++;
    else if (mode === REST && b.penalties === 0 && distToCup(hole, b) < 2) near++;
    b.penalties = 0;
  }
  return { frac: (sinks + near) / PERTURB, sinks: sinks / PERTURB, near: near / PERTURB };
}

export function parFor(frac) {
  return frac >= 0.35 ? 2 : frac >= 0.1 ? 3 : 4;
}

/** A random launch direction from the tee (upward hemisphere, by elevation) and a speed. */
function sampleAim(rng, teeDir, tu, tv) {
  const e = rng.range(0.08, 0.92);
  let a = rng.next() * 2 - 1;
  let c = rng.next() * 2 - 1;
  const l = Math.sqrt(a * a + c * c) || 1;
  a /= l;
  c /= l;
  const h = Math.sqrt(1 - e * e);
  const dir = unit([teeDir[0] * e + (tu[0] * a + tv[0] * c) * h, teeDir[1] * e + (tu[1] * a + tv[1] * c) * h, teeDir[2] * e + (tu[2] * a + tv[2] * c) * h]);
  const r = rng.next();
  return { dir, speed: 6 + 32 * (0.45 * r + 0.55 * r * r) };
}

/** A small variation of an earlier aim (to re-fly a path a portal or ring now sits on). */
function nearAim(rng, base, angle, power) {
  const perp = unit(cross(base.dir, rng.unit()));
  const a = angle * (rng.next() * 2 - 1);
  return { dir: unit([base.dir[0] + perp[0] * a, base.dir[1] + perp[1] * a, base.dir[2] + perp[2] * a]), speed: base.speed * (1 + power * (rng.next() * 2 - 1)) };
}

/**
 * Yields progress ({ done, total }) while working; returns the hole data (plain JSON) or null.
 * opts: candidates (default 2400), par (a preferred par, 2-4), attempts (systems to try, default 6).
 */
export function* generateHoleSteps(worldId, seed, opts = {}) {
  const world = worldById(worldId);
  const rng = makeRng(seed);
  const candidates = opts.candidates ?? 2400;
  const attempts = opts.attempts ?? 6;
  const want = opts.par ?? 0;
  const total = attempts * candidates;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sys = buildSystem(world, rng);
    const solidIdx = sys.planets.map((p, i) => i).filter((i) => !['gas', 'hole', 'comet'].includes(sys.planets[i].k));
    if (solidIdx.length < 2) continue;
    const teeP = rng.pick(solidIdx);
    const data0 = { world: world.id, seed, planets: sys.planets, rings: [], worms: [], tee: { p: teeP, d: [0, 1, 0] }, cup: null };
    let hole = prepareHole(data0);
    const tpl = hole.planets[teeP];
    let teeDir = null;
    for (let i = 0; i < 60 && !teeDir; i++) {
      const d = rng.unit();
      if (heightAt(tpl, d[0], d[1], d[2]) < -0.01) continue;
      if (tpl.patches.length && patchAt(tpl, d[0], d[1], d[2])) continue;
      teeDir = d;
    }
    if (!teeDir) continue;
    data0.tee = { p: teeP, d: teeDir };
    hole = prepareHole(data0);
    const { u: tu, v: tv } = basisFor(teeDir);
    const tee0 = teePos(hole, 0);
    let b = makeBall(hole, teeP, teeDir);
    b.quiet = true;
    const best = [];
    const flights = []; // aims whose flights lasted a while (paths to hang a portal or ring on)
    const gasTargets = hole.planets.filter((p) => p.gas);
    const dressed = !(world.worms || world.rings);
    const firstPass = dressed ? candidates : Math.floor(candidates * 0.3);
    let placed = false;
    for (let k = 0; k < candidates; k++) {
      if ((k & 63) === 0) yield { done: attempt * candidates + k, total };
      if (!dressed && !placed && k >= firstPass) {
        // Hang the world's gadget on a real flight path, then re-fly near those aims.
        placed = true;
        if (flights.length) {
          const f = rng.pick(flights);
          if (world.worms) {
            const others = solidIdx.filter((i) => i !== teeP);
            const bp = hole.planets[rng.pick(others.length ? others : solidIdx)];
            const up = rng.unit();
            const h = bp.R + rng.range(7, 11);
            const exitAxis = basisFor(up).u;
            data0.worms = [{ a: { c: f.at, axis: f.dirAt }, b: { c: [bp.c[0] + up[0] * h, bp.c[1] + up[1] * h, bp.c[2] + up[2] * h], axis: exitAxis }, r: 2.4 }];
          }
          if (world.rings) {
            data0.rings = [{ c: f.at, axis: f.dirAt, r: 2.4, k: 7 }];
            if (flights.length > 1) {
              const f2 = rng.pick(flights);
              if (f2 !== f) data0.rings.push({ c: f2.at, axis: f2.dirAt, r: 2.4, k: 7 });
            }
          }
          hole = prepareHole(data0);
          b = makeBall(hole, teeP, teeDir);
          b.quiet = true;
        }
      }
      const t0 = hole.moving ? Math.floor(rng.range(0, 30) * 4) / 4 : 0;
      let aim;
      if (placed && flights.length && rng.next() < 0.6) aim = nearAim(rng, rng.pick(flights), 0.06, 0.08);
      else if (gasTargets.length && rng.next() < 0.3) {
        // Toward a gas giant's limb: the way to aerobrake without being swallowed.
        const gp = rng.pick(gasTargets);
        const from = teePos(hole, t0);
        const to = unit([gp.c[0] - from[0], gp.c[1] - from[1], gp.c[2] - from[2]]);
        const side = unit(cross(to, rng.unit()));
        const off = gp.R * rng.range(1.05, 1.3);
        aim = { dir: unit([gp.c[0] + side[0] * off - from[0], gp.c[1] + side[1] * off - from[1], gp.c[2] + side[2] * off - from[2]]), speed: rng.range(14, 38) };
        const upness = aim.dir[0] * teeDir[0] + aim.dir[1] * teeDir[1] + aim.dir[2] * teeDir[2];
        if (upness < 0.05) aim.dir = unit([aim.dir[0] + teeDir[0] * (0.05 - upness), aim.dir[1] + teeDir[1] * (0.05 - upness), aim.dir[2] + teeDir[2] * (0.05 - upness)]);
      } else aim = sampleAim(rng, teeDir, tu, tv);
      b.mode = REST;
      b.penalties = 0;
      teeShot(hole, b, t0, aim.dir, aim.speed);
      const mode = runShot(hole, b, true);
      const k2 = Math.min(400, Math.floor(b.flightSteps / 16));
      if (!placed && !dressed && mode !== -1 && b.penalties === 0 && b.flightSteps >= 16 * 24 && flights.length < 24) {
        // A point two seconds into a flight that ended well, with room around it.
        const i = 12 + rng.int(Math.min(10, k2 - 14));
        if (i > 0 && i + 1 < k2) {
          const at = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
          const dirAt = unit([samples[(i + 1) * 3] - samples[(i - 1) * 3], samples[(i + 1) * 3 + 1] - samples[(i - 1) * 3 + 1], samples[(i + 1) * 3 + 2] - samples[(i - 1) * 3 + 2]]);
          if (clearance(hole, at) > 3.5) flights.push({ dir: aim.dir, speed: aim.speed, t0, at, dirAt });
        }
      }
      if (mode !== REST || b.penalties > 0) continue;
      const g = b.g;
      const pl = hole.planets[g];
      if (pl.kind === 'comet' || !pl.solid) continue;
      const rd = [b.rest.dx, b.rest.dy, b.rest.dz];
      if (pl.patches.length && patchAt(pl, rd[0], rd[1], rd[2])) continue;
      if (heightAt(pl, rd[0], rd[1], rd[2]) < -0.015) continue; // not in a crater
      const pos = ballPos(hole, b, P);
      const far = Math.sqrt((pos[0] - tee0[0]) ** 2 + (pos[1] - tee0[1]) ** 2 + (pos[2] - tee0[2]) ** 2);
      if (far < 7) continue;
      const other = g !== teeP;
      let sling = false;
      let pass = false;
      for (let i = 0; i < hole.n; i++) {
        if (i === teeP || i === g || hole.planets[i].kind === 'comet') continue;
        if (b.passes[i] < 6) sling = true;
        else if (b.passes[i] < 20) pass = true;
      }
      const aero = b.aero > 20;
      const rolled = b.rolled;
      const dev = pathDeviation(k2, tee0, pos);
      const flight = b.step * DT;
      let score = (other ? 3 : 0) + (sling ? 2.5 : pass ? 1 : 0) + (rolled > 15 ? 1.5 : 0) + (aero ? 2 : 0) + b.warps * 3 + b.boosts * 1.5 + (b.bounces > 0 ? 0.5 : 0) + (dev > 4 ? 1 : 0);
      if (world.comets) score += aero ? 3 : 0;
      if (world.worms) score += b.warps ? 5 : -1;
      if (world.rings) score += b.boosts ? 3 : 0;
      if (flight > 25) score -= 2;
      if (flight > 32) continue; // nobody wants to watch a ball for half a minute
      if (!other && !sling && !pass && !aero && rolled < 8 && !b.warps) continue;
      if (dev < 1.5 && !b.warps && rolled < 10) continue; // a straight line is not a hole
      score += rng.next() * 0.5;
      const feat = b.warps ? 'warp' : aero ? 'aero' : sling ? 'sling' : b.boosts ? 'boost' : rolled > 15 ? 'roll' : b.bounces > 1 ? 'bank' : other ? 'cross' : 'putt';
      best.push({ score, dir: aim.dir, speed: aim.speed, t0, g, rd, flight, feat });
      best.sort((x, y) => y.score - x.score);
      if (best.length > 10) best.pop();
    }
    const verified = [];
    for (const cand of best) {
      const data = { ...data0, cup: { p: cand.g, d: cand.rd, r: world.cupR } };
      const h2 = prepareHole(data);
      const vb = makeBall(h2, teeP, teeDir);
      vb.quiet = true;
      // The reference is stored quantized, so verify and grade exactly what will be stored.
      cand.dir = cand.dir.map(q);
      cand.speed = q(cand.speed);
      const shot = teeShot(h2, vb, cand.t0, cand.dir, cand.speed);
      if (runShot(h2, vb, false) !== HOLED) continue;
      const ref = { t0: cand.t0, dir: cand.dir, speed: cand.speed, p: shot.p, v: shot.v };
      const grade = gradeHole(h2, ref, seed ^ 0x5bd1e995);
      if (grade.frac < 0.03) continue; // a needle shot
      // Par from the sensitivity grade, checked against two Pro bot rounds: a hole the bots find much easier or
      // harder than its grade says moves a stroke.
      let par = parFor(grade.frac);
      const bot = (playHole(h2, 'pro', 11).strokes + playHole(h2, 'pro', 12).strokes) / 2;
      if (bot >= par + 1.5) par = Math.min(4, par + 1);
      else if (bot <= par - 0.9) par = Math.max(2, par - 1);
      grade.bot = bot;
      verified.push({ data, ref, grade, par, cand });
      if (verified.length >= 4) break;
      yield { done: (attempt + 1) * candidates, total };
    }
    if (verified.length === 0) continue;
    verified.sort((x, y) => (want ? Math.abs(x.par - want) - Math.abs(y.par - want) : 0) || y.cand.score - x.cand.score);
    const pick = verified[0];
    return {
      ...pick.data,
      par: pick.par,
      name: `${rng.pick(world.words)} ${FEATURES[pick.cand.feat]}`,
      feat: pick.cand.feat,
      ref: pick.ref,
      grade: { frac: pick.grade.frac, sinks: pick.grade.sinks, near: pick.grade.near, bot: pick.grade.bot, flight: Math.round(pick.cand.flight * 10) / 10 },
    };
  }
  return null;
}

export function generateHole(worldId, seed, opts) {
  const it = generateHoleSteps(worldId, seed, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

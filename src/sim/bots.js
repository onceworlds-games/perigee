// Bots: a golfer that plans a shot by trying candidates with the real physics (a cone around the cup plus some
// exploration), scores each by where it ends, then adds skill-scaled noise. Planning is a generator function so
// the host's page can spread it over frames (8 candidates a frame) without a hitch.
import { makeRng } from './rng.js';
import { makeBall, launchAt, stepBall, runToRest, planetVel, ballPos, distToCup, REST, HOLED, LOST, DT } from './ball.js';
import { centersAt, q, MAX_PLANETS } from './hole.js';

// n: candidates; ang/pow: aim and power noise (tan of the angle, fraction); horizon: how far ahead a candidate is
// judged (seconds); check: how many of the best candidates are flown to the end before choosing.
export const TIERS = {
  rookie: { name: 'Rookie', n: 50, ang: 0.08, pow: 0.09, think: [3, 6], explore: 0.5, horizon: 2.5, check: 0 },
  club: { name: 'Club', n: 100, ang: 0.06, pow: 0.07, think: [2.5, 5.5], explore: 0.4, horizon: 4, check: 1 },
  pro: { name: 'Pro', n: 220, ang: 0.06, pow: 0.07, think: [2, 4], explore: 0.35, horizon: 6, check: 3 },
  legend: { name: 'Legend', n: 300, ang: 0.045, pow: 0.055, think: [1.5, 3], explore: 0.3, horizon: 6, check: 5 },
};
export const TIER_IDS = ['rookie', 'club', 'pro', 'legend'];
export const BOT_NAMES = ['Dot', 'Pip', 'Juniper', 'Bramble', 'Tansy', 'Fig', 'Quill', 'Sorrel', 'Ziggy', 'Marlow', 'Nettle', 'Clove'];

const FULL_STEPS = 120 * 40;
const C = new Float64Array(MAX_PLANETS * 3);
const P = [0, 0, 0];

function unit(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The bot's name for seat k of a match (names cycle, tiers mix). */
export function botIdentity(seed, k) {
  const rng = makeRng(seed ^ 0x2545f491);
  const names = rng.shuffle(BOT_NAMES.slice());
  const tiers = rng.shuffle(TIER_IDS.slice());
  return { name: names[k % names.length], tier: tiers[k % tiers.length] };
}

/**
 * Plans a shot for a resting ball. Yields after every 8 candidates; returns { dir, speed, score, v, p }.
 * `t0` is the hole time the shot would be taken at; `mods` the card mods the bot will ride.
 */
export function* planShotSteps(hole, ball, t0, tier, seed, mods = null) {
  const T = TIERS[tier] ?? TIERS.club;
  const rng = makeRng(seed);
  const b = makeBall(hole, ball.rest.g, [ball.rest.dx, ball.rest.dy, ball.rest.dz]);
  b.quiet = true;
  const from = ballPos(hole, b, [0, 0, 0]);
  const c = centersAt(hole, t0, C);
  const cup = hole.cup;
  const cupAt = [c[cup.p * 3] + cup.dx * cup.radial, c[cup.p * 3 + 1] + cup.dy * cup.radial, c[cup.p * 3 + 2] + cup.dz * cup.radial];
  const up = [ball.rest.dx, ball.rest.dy, ball.rest.dz];
  const toCup = unit([cupAt[0] - from[0], cupAt[1] - from[1], cupAt[2] - from[2]]);
  const dCup = Math.sqrt((cupAt[0] - from[0]) ** 2 + (cupAt[1] - from[1]) ** 2 + (cupAt[2] - from[2]) ** 2);
  const sameWorld = ball.rest.g === cup.p;
  const vp = planetVel(hole, ball.rest.g, t0);
  const planSteps = Math.floor(T.horizon * 120);
  const top = []; // the best few, kept sorted best first
  for (let k = 0; k < T.n; k++) {
    if (k > 0 && (k & 7) === 0) yield k / T.n;
    let dir;
    let speed;
    const r = rng.next();
    if (r < T.explore) {
      const n = rng.unit();
      dir = unit([up[0] * 0.3 + n[0], up[1] * 0.3 + n[1], up[2] * 0.3 + n[2]]);
      speed = 4 + 34 * rng.next();
    } else {
      // A cone around the line to the cup, lifted off the ground; putting speeds when it is close on the same world.
      const n = rng.unit();
      const s = rng.range(0, 1.0);
      dir = unit([toCup[0] + n[0] * s, toCup[1] + n[1] * s, toCup[2] + n[2] * s]);
      speed = sameWorld && dCup < 14 && rng.next() < 0.6 ? 2.5 + dCup * rng.range(0.4, 1.1) : 5 + 33 * rng.next();
    }
    const upness = dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2];
    if (upness < 0.06) dir = unit([dir[0] + up[0] * (0.06 - upness), dir[1] + up[1] * (0.06 - upness), dir[2] + up[2] * (0.06 - upness)]);
    b.mode = REST;
    b.penalties = 0;
    launchAt(hole, b, t0, from[0], from[1], from[2], dir[0] * speed + vp[0], dir[1] * speed + vp[1], dir[2] * speed + vp[2], mods);
    let closest = 1e9;
    let mode = REST;
    for (let s = 0; s < planSteps; s++) {
      mode = stepBall(hole, b);
      if (mode === REST || mode === HOLED || mode === LOST) break;
      if ((s & 7) === 0) {
        ballPos(hole, b, P);
        const cc = centersAt(hole, t0 + b.step * DT, C);
        const dx = cc[cup.p * 3] + cup.dx * cup.radial - P[0];
        const dy = cc[cup.p * 3 + 1] + cup.dy * cup.radial - P[1];
        const dz = cc[cup.p * 3 + 2] + cup.dz * cup.radial - P[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < closest) closest = d;
      }
    }
    let score;
    if (mode === HOLED) score = 1000;
    else if (mode === LOST || b.penalties > 0) score = -100 - closest;
    else {
      ballPos(hole, b, P);
      const cc = centersAt(hole, t0 + b.step * DT, C);
      const dx = cc[cup.p * 3] + cup.dx * cup.radial - P[0];
      const dy = cc[cup.p * 3 + 1] + cup.dy * cup.radial - P[1];
      const dz = cc[cup.p * 3 + 2] + cup.dz * cup.radial - P[2];
      const end = Math.sqrt(dx * dx + dy * dy + dz * dz);
      score = -end;
      if (mode !== REST) score -= 6 + Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) * 0.5; // still moving at six seconds
      else if (b.g !== cup.p) score -= 4; // on the wrong world
      if (b.g === cup.p && end < 3) score += 2;
    }
    const keep = Math.max(1, T.check);
    if (top.length < keep || score > top[top.length - 1].score) {
      top.push({ dir, speed, score });
      top.sort((x, y) => y.score - x.score);
      if (top.length > keep) top.pop();
    }
  }
  // The careful tiers fly their best few candidates to the very end before choosing (a shot that only goes
  // wrong after the horizon is caught here).
  let best = top[0];
  let bestScore = best.score;
  if (T.check > 0) {
    let bestFull = -1e9;
    for (const cand of top) {
      b.mode = REST;
      b.penalties = 0;
      launchAt(hole, b, t0, from[0], from[1], from[2], cand.dir[0] * cand.speed + vp[0], cand.dir[1] * cand.speed + vp[1], cand.dir[2] * cand.speed + vp[2], mods);
      const mode = runToRest(hole, b, FULL_STEPS);
      let score;
      if (mode === HOLED) score = 1000;
      else if (mode !== REST || b.penalties > 0) score = -200;
      else {
        const end = distToCup(hole, b);
        score = -end - (b.g !== cup.p ? 4 : 0) + (b.g === cup.p && end < 3 ? 2 : 0) - b.step * DT * 0.05;
      }
      if (score > bestFull) {
        bestFull = score;
        best = cand;
        bestScore = score;
      }
      yield 1;
    }
  }
  // Skill noise: a small wobble of the aim and the power.
  const perp = unit(cross(best.dir, rng.unit()));
  const a = T.ang * (rng.next() * 2 - 1);
  const dir = unit([best.dir[0] + perp[0] * a, best.dir[1] + perp[1] * a, best.dir[2] + perp[2] * a]);
  const speed = Math.max(1.5, Math.min(38, best.speed * (1 + T.pow * (rng.next() * 2 - 1))));
  const v = [q(dir[0] * speed + vp[0]), q(dir[1] * speed + vp[1]), q(dir[2] * speed + vp[2])];
  return { dir, speed, score: bestScore, p: [q(from[0]), q(from[1]), q(from[2])], v };
}

export function planShot(hole, ball, t0, tier, seed, mods) {
  const it = planShotSteps(hole, ball, t0, tier, seed, mods);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** How long a bot pretends to think before this shot, in seconds. */
export function thinkTime(tier, rng) {
  const T = TIERS[tier] ?? TIERS.club;
  return T.think[0] + (T.think[1] - T.think[0]) * rng.next();
}

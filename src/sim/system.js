// Builds a small solar system for a world: planetoids placed with room between them but inside each other's
// reach, lobes for hills and craters, patches, rails, rings, wormholes, comets. Plain data for prepareHole.
import { basisFor } from './hole.js';

const EXTENT = 50; // planets sit within this of the origin (out of bounds is 150)
const FLAT = 14; // and within this much height, so the system reads as a disc

function dist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function unit(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function lobesFor(kind, rng) {
  if (kind === 'gas' || kind === 'hole') return [];
  const n = kind === 'comet' ? 2 : kind === 'ice' ? 2 + rng.int(2) : 3 + rng.int(3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = rng.unit();
    const crater = rng.next() < 0.3;
    let a = crater ? -rng.range(0.04, 0.1) : rng.range(0.05, 0.16);
    let m = rng.pick([3, 4, 6, 8]);
    if (kind === 'ice') a *= 0.5;
    if (kind === 'metal') {
      a *= 0.6;
      m = 2 + rng.int(2);
    }
    out.push([u[0], u[1], u[2], a, m]);
  }
  return out;
}

/** The positions a planet (with its rail) visits, for clearance checks. */
function samples(p) {
  if (!p.rail) return [p.c];
  const out = [];
  if (p.rail.type === 'circle') {
    const r = p.rail;
    for (let i = 0; i < 12; i++) {
      // twelve points around the circle from the rational parametrization
      const s = -1 + i / 6; // [-1, 1)
      const d = 1 + s * s;
      const cs = (1 - s * s) / d;
      const sn = (2 * s) / d;
      out.push([r.center[0] + r.radius * (cs * r.u[0] + sn * r.v[0]), r.center[1] + r.radius * (cs * r.u[1] + sn * r.v[1]), r.center[2] + r.radius * (cs * r.u[2] + sn * r.v[2])]);
      out.push([r.center[0] + r.radius * (-cs * r.u[0] - sn * r.v[0]), r.center[1] + r.radius * (-cs * r.u[1] - sn * r.v[1]), r.center[2] + r.radius * (-cs * r.u[2] - sn * r.v[2])]);
    }
  } else {
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      out.push([p.rail.a[0] + (p.rail.b[0] - p.rail.a[0]) * s, p.rail.a[1] + (p.rail.b[1] - p.rail.a[1]) * s, p.rail.a[2] + (p.rail.b[2] - p.rail.a[2]) * s]);
    }
  }
  return out;
}

function clear(planets, cand, minGap) {
  const cs = samples(cand);
  for (const p of planets) {
    const ps = samples(p);
    for (const a of cs) for (const b of ps) if (dist(a, b) < p.R + cand.R + minGap) return false;
  }
  return true;
}

function nearSome(planets, cand) {
  if (planets.length === 0) return true;
  for (const p of planets) if (dist(p.c, cand.c) <= (p.R + cand.R) * 2.4 + 8) return true;
  return false;
}

function randomSpot(rng) {
  return [rng.range(-EXTENT, EXTENT), rng.range(-FLAT, FLAT), rng.range(-EXTENT, EXTENT)];
}

export function buildSystem(world, rng) {
  const planets = [];
  const count = world.count[0] + rng.int(world.count[1] - world.count[0] + 1);
  if (world.blackhole) planets.push({ k: 'hole', c: [0, 0, 0], R: 2.4, g: 42, lobes: [] });
  if (world.gas) {
    const R = rng.range(11, 14);
    for (let tries = 0; tries < 100; tries++) {
      const cand = { k: 'gas', c: randomSpot(rng), R, g: rng.range(12, 14), lobes: [] };
      if (clear(planets, cand, 10)) {
        planets.push(cand);
        break;
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const kind = rng.pick(world.kinds);
    const R = rng.range(world.R[0], world.R[1]);
    const g = rng.range(world.g[0], world.g[1]);
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const cand = { k: kind, c: randomSpot(rng), R, g, lobes: [] };
      const gap = rng.range(world.gap[0], world.gap[1]);
      if (!clear(planets, cand, gap) || !nearSome(planets, cand)) continue;
      cand.lobes = lobesFor(kind, rng);
      planets.push(cand);
      placed = true;
    }
  }
  // Binary: the first two solid planets dance around their midpoint.
  if (world.binary) {
    const solid = planets.filter((p) => p.k !== 'hole' && p.k !== 'gas');
    if (solid.length >= 2) {
      const a = solid[0];
      const b = solid[1];
      const mid = [(a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.c[2] + b.c[2]) / 2];
      const radius = dist(a.c, b.c) / 2;
      const u = unit([a.c[0] - mid[0], a.c[1] - mid[1], a.c[2] - mid[2]]);
      let v = unit(cross([0, 1, 0], u));
      if (Math.abs(u[1]) > 0.9) v = unit(cross([1, 0, 0], u));
      const period = rng.range(28, 44);
      const others = planets.filter((p) => p !== a && p !== b);
      const ra = { type: 'circle', center: mid, radius, u, v, period, phase: 0 };
      const rb = { type: 'circle', center: mid, radius, u, v, period, phase: 0.5 };
      if (clear(others, { ...a, rail: ra }, 6) && clear(others, { ...b, rail: rb }, 6)) {
        a.rail = ra;
        b.rail = rb;
      }
    }
  }
  // Clockwork: one or two planets slide back and forth.
  if (world.lines) {
    const solid = planets.filter((p) => p.k !== 'hole' && p.k !== 'gas');
    const n = Math.min(solid.length - 1, 1 + rng.int(2));
    for (let k = 0; k < n; k++) {
      const p = solid[k + 1];
      const d = rng.unit();
      const len = rng.range(8, 16);
      const rail = { type: 'line', a: [p.c[0] - d[0] * len, p.c[1] - d[1] * len, p.c[2] - d[2] * len], b: [p.c[0] + d[0] * len, p.c[1] + d[1] * len, p.c[2] + d[2] * len], period: rng.range(16, 26), phase: rng.next() };
      if (clear(planets.filter((q) => q !== p), { ...p, rail }, 5)) p.rail = rail;
    }
  }
  // Comets: small bouncy bodies sweeping through from far outside.
  if (world.comets) {
    const n = 1 + rng.int(2);
    for (let k = 0; k < n; k++) {
      const through = [rng.range(-20, 20), rng.range(-6, 6), rng.range(-20, 20)];
      const d = rng.unit();
      const a = [through[0] - d[0] * 130, through[1] - d[1] * 130, through[2] - d[2] * 130];
      const b = [through[0] + d[0] * 130, through[1] + d[1] * 130, through[2] + d[2] * 130];
      const comet = { k: 'comet', c: through.slice(), R: rng.range(1.6, 2.4), g: 4, lobes: lobesFor('comet', rng), rail: { type: 'sweep', a, b, period: rng.range(24, 36), phase: rng.next() } };
      if (clear(planets, comet, 4)) planets.push(comet);
    }
  }
  // Patches: hazard regions on some planets.
  if (world.patches) {
    for (const p of planets) {
      if (p.k === 'hole' || p.k === 'gas' || p.k === 'comet' || rng.next() > 0.65) continue;
      const n = 1 + rng.int(2);
      p.patches = [];
      for (let k = 0; k < n; k++) p.patches.push({ u: rng.unit(), cos: rng.range(0.9, 0.97), t: rng.pick(world.patches) });
    }
  }
  // Rings: a boost between two planets, off their line a little.
  const rings = [];
  if (world.rings && planets.length >= 2) {
    const n = 1 + rng.int(2);
    for (let k = 0; k < n; k++) {
      const a = rng.pick(planets);
      const b = rng.pick(planets);
      if (a === b) continue;
      const mid = [(a.c[0] + b.c[0]) / 2 + rng.range(-5, 5), (a.c[1] + b.c[1]) / 2 + rng.range(-3, 3), (a.c[2] + b.c[2]) / 2 + rng.range(-5, 5)];
      if (planets.some((p) => dist(p.c, mid) < p.R + 4)) continue;
      rings.push({ c: mid, axis: unit([b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]]), r: 2.2, k: 11 });
    }
  }
  // Wormholes: a pair of portals floating over two different planets, exits tangential so the ball falls to the world below.
  const worms = [];
  if (world.worms) {
    const solid = planets.filter((p) => p.k !== 'hole' && p.k !== 'gas' && p.k !== 'comet');
    if (solid.length >= 2) {
      const [a, b] = rng.shuffle(solid.slice()).slice(0, 2);
      const end = (p) => {
        const up = rng.unit();
        const h = p.R + rng.range(7, 12);
        const c = [p.c[0] + up[0] * h, p.c[1] + up[1] * h, p.c[2] + up[2] * h];
        const { u } = basisFor(up);
        return { c, axis: u };
      };
      worms.push({ a: end(a), b: end(b), r: 2.4 });
    }
  }
  return { planets, rings, worms };
}

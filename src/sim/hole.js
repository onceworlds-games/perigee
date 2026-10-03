// A hole is a small solar system: planetoids (some on rails), boost rings, wormhole pairs, a tee and a cup.
// `prepareHole` turns the plain JSON shape (data/holes.json, or the generator's output) into the numeric form the
// simulation steps; `centersAt` is the only time-dependent part.
import { prepareRail, railPos } from './rails.js';
import { SURFACES, maxHeight, radiusAt } from './planet.js';

export const BALL_R = 0.35;
export const CUP_R = 0.55;
export const MAX_PLANETS = 12;

function unit(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Two unit vectors at right angles to `a` (and each other), built without trigonometry. */
export function basisFor(a) {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const t = ax < 0.9 ? [1, 0, 0] : ay < 0.9 ? [0, 1, 0] : [0, 0, 1];
  // u = normalize(t x a), v = a x u
  const u = unit([t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]]);
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  return { u, v };
}

export function prepareHole(data) {
  const planets = (data.planets || []).slice(0, MAX_PLANETS).map((p, i) => {
    const src = p.lobes || [];
    const lobes = new Float64Array(src.length * 5);
    for (let k = 0; k < src.length; k++) {
      const u = unit(src[k].slice(0, 3));
      lobes[k * 5] = u[0];
      lobes[k * 5 + 1] = u[1];
      lobes[k * 5 + 2] = u[2];
      lobes[k * 5 + 3] = src[k][3];
      lobes[k * 5 + 4] = Math.max(2, Math.min(12, Math.floor(src[k][4])));
    }
    const kind = SURFACES[p.k] ? p.k : 'dust';
    const gas = kind === 'gas';
    const black = kind === 'hole';
    const R = p.R;
    const hmax = maxHeight(lobes);
    const patches = (p.patches || []).map((q) => {
      const u = unit(q.u);
      return { ux: u[0], uy: u[1], uz: u[2], cos: q.cos, type: q.t };
    });
    return {
      i,
      kind,
      R,
      g0: p.g,
      c: p.c.slice(),
      rail: prepareRail(p.rail),
      lobes,
      hmax,
      surf: SURFACES[kind],
      gas,
      black,
      killR: black ? R : 0,
      atmo: gas || !!p.atmo,
      drag: p.drag ?? (gas ? 0.012 : p.atmo ? 0.008 : 0),
      full: black ? R * 4 : 2 * R,
      inf: black ? R * 9 : 3.2 * R,
      patches,
      bound: R * (1 + hmax) + BALL_R + 0.3,
      solid: !gas && !black,
    };
  });
  const n = planets.length;
  const cs = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    cs[i * 3] = planets[i].c[0];
    cs[i * 3 + 1] = planets[i].c[1];
    cs[i * 3 + 2] = planets[i].c[2];
  }
  const rings = (data.rings || []).map((r) => {
    const a = unit(r.axis);
    return { x: r.c[0], y: r.c[1], z: r.c[2], ax: a[0], ay: a[1], az: a[2], r: r.r ?? 1.8, k: r.k ?? 10 };
  });
  const worms = (data.worms || []).map((w) => {
    const end = (e) => {
      const axis = unit(e.axis);
      const { u, v } = basisFor(axis);
      return { x: e.c[0], y: e.c[1], z: e.c[2], ax: axis[0], ay: axis[1], az: axis[2], ux: u[0], uy: u[1], uz: u[2], vx: v[0], vy: v[1], vz: v[2] };
    };
    return { a: end(w.a), b: end(w.b), r: w.r ?? 1.6 };
  });
  const teeDir = unit(data.tee.d);
  const cupData = data.cup ?? { p: -1, d: [0, 1, 0], r: 0 };
  const cupDir = unit(cupData.d);
  const cupPl = planets[cupData.p] ?? { R: 1, lobes: new Float64Array(0) };
  const hole = {
    id: data.id ?? `${data.world}-${data.seed}`,
    world: data.world,
    seed: data.seed,
    name: data.name ?? '',
    par: data.par ?? 3,
    planets,
    n,
    cs,
    moving: planets.some((p) => p.rail),
    rings,
    worms,
    tee: { p: data.tee.p, dx: teeDir[0], dy: teeDir[1], dz: teeDir[2], radial: radiusAt(planets[data.tee.p], teeDir[0], teeDir[1], teeDir[2]) + BALL_R },
    cup: { p: cupData.p, dx: cupDir[0], dy: cupDir[1], dz: cupDir[2], r: cupData.r ?? CUP_R, radial: radiusAt(cupPl, cupDir[0], cupDir[1], cupDir[2]) },
    ref: data.ref ?? null,
    grade: data.grade ?? null,
    data,
  };
  return hole;
}

/** Planet centres at time t (seconds of the hole clock) into `out` (Float64Array of 3n). Static holes return their table. */
export function centersAt(hole, t, out) {
  if (!hole.moving) return hole.cs;
  const P = hole.planets;
  for (let i = 0; i < P.length; i++) {
    if (P[i].rail) railPos(P[i].rail, t, out, i * 3);
    else {
      out[i * 3] = hole.cs[i * 3];
      out[i * 3 + 1] = hole.cs[i * 3 + 1];
      out[i * 3 + 2] = hole.cs[i * 3 + 2];
    }
  }
  return out;
}

/** The tee's resting position at time t. */
export function teePos(hole, t, out = [0, 0, 0]) {
  const c = centersAt(hole, t, scratch);
  const T = hole.tee;
  out[0] = c[T.p * 3] + T.dx * T.radial;
  out[1] = c[T.p * 3 + 1] + T.dy * T.radial;
  out[2] = c[T.p * 3 + 2] + T.dz * T.radial;
  return out;
}

/** The cup's centre (on the surface) at time t. */
export function cupPos(hole, t, out = [0, 0, 0]) {
  const c = centersAt(hole, t, scratch);
  const C = hole.cup;
  out[0] = c[C.p * 3] + C.dx * C.radial;
  out[1] = c[C.p * 3 + 1] + C.dy * C.radial;
  out[2] = c[C.p * 3 + 2] + C.dz * C.radial;
  return out;
}

const scratch = new Float64Array(MAX_PLANETS * 3);

/** Quantize to a multiple of 1/1024 (shots are sent like this so every page starts from the same numbers). */
export function q(x) {
  return Math.round(x * 1024) / 1024;
}

export function quantize3(v) {
  return [q(v[0]), q(v[1]), q(v[2])];
}

/** A finite, sane number or the fallback (messages and state from other pages are never trusted). */
export function num(x, lo, hi, fallback = 0) {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : fallback;
}

// The ball: one fixed step of flight, bouncing, rolling and resting in an n-body sky. Pure arithmetic, no
// allocation in the hot path, deterministic: the same hole, shot and step count give the same ball everywhere.
//
// Modes: REST and ROLL keep the ball relative to its planet (r = offset from the centre, v relative to it), so a
// moving world carries it; FLY and LOST are absolute. A shot is `launchAt`, then `stepBall` until the ball rests,
// drops in the cup or is lost (then it comes back to its last rest by itself).
import { surfaceF, surfaceNormal, gravityScalar, patchAt, radiusAt } from './planet.js';
import { centersAt, BALL_R, MAX_PLANETS } from './hole.js';

export const DT = 1 / 120;
export const MAX_SPEED = 38;
export const ROLL_VN = 2.5; // below this normal speed a landing rolls instead of bouncing
export const REST_SPEED = 0.12;
export const REST_STEPS = 72; // 0.6 s
export const OOB = 150;
export const LOST_STEPS = 240; // 2 s
export const STALL_STEPS = 180; // 1.5 s
export const FREE_STEPS = 720; // 6 s with no gravity at all (between worlds, going nowhere): lost
export const CUP_SPEED = 5.5;
export const ORBIT_DECAY_AFTER = 40 * 120; // a flight longer than 40 s loses 0.3% speed a step: no endless orbit
export const BRAKE = 0.99;
export const THRUST = 9;
export const MAGNET_RANGE = 12;

export const REST = 0;
export const FLY = 1;
export const ROLL = 2;
export const LOST = 3;
export const HOLED = 4;

const C0 = new Float64Array(MAX_PLANETS * 3);
const C1 = new Float64Array(MAX_PLANETS * 3);
const N = new Float64Array(3);

/** A ball resting on planet `g` in unit direction `dir`. */
export function makeBall(hole, g, dir) {
  const b = {
    mode: REST,
    g,
    rx: 0,
    ry: 0,
    rz: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    t0: 0,
    step: 0,
    rest: { g, dx: dir[0], dy: dir[1], dz: dir[2] },
    shotPlanet: g,
    restSteps: 0,
    lostSteps: 0,
    stallSteps: 0,
    freeSteps: 0,
    flightSteps: 0,
    lipCool: 0,
    ringCool: 0,
    wormCool: 0,
    ghostIn: -1,
    ghostUsed: false,
    stickyUsed: false,
    mods: null,
    penalties: 0,
    bounces: 0,
    rolled: 0,
    aero: 0,
    minPass: 1e9,
    peakAlt: 0,
    warps: 0,
    boosts: 0,
    passes: new Float64Array(MAX_PLANETS).fill(1e9),
    events: [],
    quiet: false,
  };
  settle(hole, b, g, dir[0], dir[1], dir[2]);
  return b;
}

function settle(hole, b, g, dx, dy, dz) {
  const pl = hole.planets[g];
  const rad = radiusAt(pl, dx, dy, dz) + BALL_R;
  b.mode = REST;
  b.g = g;
  b.rx = dx * rad;
  b.ry = dy * rad;
  b.rz = dz * rad;
  b.vx = b.vy = b.vz = 0;
  b.rest.g = g;
  b.rest.dx = dx;
  b.rest.dy = dy;
  b.rest.dz = dz;
  b.restSteps = 0;
}

/** Puts a ball at rest on planet g in direction dir (a canonical rest from the room, or the tee). */
export function placeBall(hole, b, g, dx, dy, dz) {
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  settle(hole, b, g, dx / l, dy / l, dz / l);
}

function ev(b, k, a, c) {
  if (!b.quiet) b.events.push({ k, a, c, step: b.step });
}

/** The ball's absolute position at its current step, into out. */
export function ballPos(hole, b, out = [0, 0, 0]) {
  if (b.mode === REST || b.mode === ROLL) {
    const c = centersAt(hole, b.t0 + b.step * DT, C0);
    out[0] = c[b.g * 3] + b.rx;
    out[1] = c[b.g * 3 + 1] + b.ry;
    out[2] = c[b.g * 3 + 2] + b.rz;
  } else {
    out[0] = b.x;
    out[1] = b.y;
    out[2] = b.z;
  }
  return out;
}

/** The velocity of planet i at time t (finite difference of its rail). */
export function planetVel(hole, i, t, out = [0, 0, 0]) {
  const pl = hole.planets[i];
  if (!pl.rail) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const a = centersAt(hole, t, C0);
  const ax = a[i * 3];
  const ay = a[i * 3 + 1];
  const az = a[i * 3 + 2];
  const c = centersAt(hole, t + DT, C1);
  out[0] = (c[i * 3] - ax) / DT;
  out[1] = (c[i * 3 + 1] - ay) / DT;
  out[2] = (c[i * 3 + 2] - az) / DT;
  return out;
}

/** Launches a resting ball from an absolute position with an absolute velocity at hole time t0 (seconds). */
export function launchAt(hole, b, t0, px, py, pz, vx, vy, vz, mods) {
  b.mode = FLY;
  b.x = px;
  b.y = py;
  b.z = pz;
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  b.t0 = t0;
  b.step = 0;
  b.shotPlanet = b.g;
  b.mods = mods || null;
  b.flightSteps = 0;
  b.stallSteps = 0;
  b.freeSteps = 0;
  b.restSteps = 0;
  b.lipCool = 0;
  b.ringCool = 0;
  b.wormCool = 0;
  b.ghostIn = -1;
  b.ghostUsed = false;
  b.stickyUsed = false;
  b.bounces = 0;
  b.rolled = 0;
  b.aero = 0;
  b.minPass = 1e9;
  b.peakAlt = 0;
  b.warps = 0;
  b.boosts = 0;
  b.passes.fill(1e9);
  ev(b, 'shot', Math.sqrt(vx * vx + vy * vy + vz * vz));
}

function lose(hole, b, why) {
  // The ball keeps drifting for a moment (the renderer fades it), then returns to its last rest.
  if (b.mode === ROLL) {
    const c = centersAt(hole, b.t0 + b.step * DT, C0);
    b.x = c[b.g * 3] + b.rx;
    b.y = c[b.g * 3 + 1] + b.ry;
    b.z = c[b.g * 3 + 2] + b.rz;
  }
  b.mode = LOST;
  b.lostSteps = 0;
  b.penalties++;
  b.vx *= 0.3;
  b.vy *= 0.3;
  b.vz *= 0.3;
  ev(b, 'lost', why);
}

/**
 * Gravity (and the magnet) at absolute point p into N-free scalars: returns via the module accumulator
 * acc = [ax, ay, az, nearestSurface, nearestIndex]. Skips the planet the ball is ghosting through.
 */
const acc = new Float64Array(5);
function field(hole, b, px, py, pz, c) {
  let ax = 0;
  let ay = 0;
  let az = 0;
  let near = 1e9;
  let nearI = -1;
  const P = hole.planets;
  const m = b.mods;
  for (let i = 0; i < P.length; i++) {
    const pl = P[i];
    const dx = c[i * 3] - px;
    const dy = c[i * 3 + 1] - py;
    const dz = c[i * 3 + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= pl.inf * pl.inf) continue;
    const d = Math.sqrt(d2);
    const sd = d - pl.R * (1 + pl.hmax);
    if (sd < near) {
      near = sd;
      nearI = i;
    }
    if (sd < b.passes[i]) b.passes[i] = sd;
    if (b.ghostIn === i) continue;
    let g = gravityScalar(pl, d);
    if (m && m.gplanet === i) g *= m.gfactor;
    if (d > 1e-6) {
      const f = g / d;
      ax += dx * f;
      ay += dy * f;
      az += dz * f;
    }
  }
  if (m && m.magnet) {
    const cp = hole.cup;
    const cx = c[cp.p * 3] + cp.dx * cp.radial - px;
    const cy = c[cp.p * 3 + 1] + cp.dy * cp.radial - py;
    const cz = c[cp.p * 3 + 2] + cp.dz * cp.radial - pz;
    const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (d < MAGNET_RANGE && d > 0.01) {
      const f = (3.6 * (1 - d / MAGNET_RANGE)) / d;
      ax += cx * f;
      ay += cy * f;
      az += cz * f;
    }
  }
  acc[0] = ax;
  acc[1] = ay;
  acc[2] = az;
  acc[3] = near;
  acc[4] = nearI;
  return acc;
}

/** Cup test for a ball on the cup's planet, at relative offset r with relative speed. Returns true if the ball's turn is over. */
function cupTest(hole, b, rx, ry, rz, vx, vy, vz, inContact) {
  const C = hole.cup;
  if (b.g !== C.p) return false;
  const qx = rx - C.dx * C.radial;
  const qy = ry - C.dy * C.radial;
  const qz = rz - C.dz * C.radial;
  const along = qx * C.dx + qy * C.dy + qz * C.dz;
  const tang2 = qx * qx + qy * qy + qz * qz - along * along;
  const r = C.r * (b.mods && b.mods.luck ? 1.5 : 1);
  if (tang2 >= r * r || along > BALL_R + 0.3 || along < -1) return false;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (speed < CUP_SPEED && inContact) {
    b.mode = HOLED;
    b.vx = b.vy = b.vz = 0;
    ev(b, 'holed', speed);
    return true;
  }
  if (b.lipCool === 0 && inContact) {
    // Too fast: the rim throws it out sideways and takes some pace.
    const tx = qx - C.dx * along;
    const ty = qy - C.dy * along;
    const tz = qz - C.dz * along;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    b.vx = (vx + (tx / tl) * 2.5) * 0.8;
    b.vy = (vy + (ty / tl) * 2.5) * 0.8;
    b.vz = (vz + (tz / tl) * 2.5) * 0.8;
    b.lipCool = 36;
    ev(b, 'lip', speed);
  }
  return false;
}

/** One fixed step. Returns the ball's mode afterwards. */
export function stepBall(hole, b) {
  if (b.mode === REST || b.mode === HOLED) return b.mode;
  const t = b.t0 + b.step * DT;
  const c0 = centersAt(hole, t, C0);
  const c1 = hole.moving ? centersAt(hole, t + DT, C1) : c0;
  if (b.lipCool > 0) b.lipCool--;
  if (b.ringCool > 0) b.ringCool--;
  if (b.wormCool > 0) b.wormCool--;
  const m = b.mods;

  if (b.mode === LOST) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.z += b.vz * DT;
    if (++b.lostSteps >= LOST_STEPS) {
      settle(hole, b, b.rest.g, b.rest.dx, b.rest.dy, b.rest.dz);
      ev(b, 'return');
    }
    b.step++;
    return b.mode;
  }

  if (b.mode === ROLL) {
    const pl = hole.planets[b.g];
    const px = c0[b.g * 3] + b.rx;
    const py = c0[b.g * 3 + 1] + b.ry;
    const pz = c0[b.g * 3 + 2] + b.rz;
    const a = field(hole, b, px, py, pz, c0);
    surfaceNormal(pl, px, py, pz, c0[b.g * 3], c0[b.g * 3 + 1], c0[b.g * 3 + 2], N);
    const nx = N[0];
    const ny = N[1];
    const nz = N[2];
    const gN = -(a[0] * nx + a[1] * ny + a[2] * nz);
    let vx = b.vx;
    let vy = b.vy;
    let vz = b.vz;
    const speed2 = vx * vx + vy * vy + vz * vz;
    const d = Math.sqrt(b.rx * b.rx + b.ry * b.ry + b.rz * b.rz) || pl.R;
    if (speed2 / d > gN + 0.05 && gN < 60) {
      // Too fast for the ground to hold it: it leaves (a hill crest, a bump, a world too small for the pace).
      b.mode = FLY;
      b.x = px;
      b.y = py;
      b.z = pz;
      const vpx = (c1[b.g * 3] - c0[b.g * 3]) / DT;
      const vpy = (c1[b.g * 3 + 1] - c0[b.g * 3 + 1]) / DT;
      const vpz = (c1[b.g * 3 + 2] - c0[b.g * 3 + 2]) / DT;
      // A hop costs a little pace, so a ball skimming a world at orbital speed settles instead of hovering forever.
      b.vx = vx * 0.97 + (pl.rail ? vpx : 0);
      b.vy = vy * 0.97 + (pl.rail ? vpy : 0);
      b.vz = vz * 0.97 + (pl.rail ? vpz : 0);
      b.restSteps = 0;
      ev(b, 'leave', Math.sqrt(speed2));
      b.step++;
      return b.mode;
    }
    // Tangential gravity accelerates it; rolling resistance slows it; static friction holds it on gentle slopes.
    const an = a[0] * nx + a[1] * ny + a[2] * nz;
    const tx = a[0] - nx * an;
    const ty = a[1] - ny * an;
    const tz = a[2] - nz * an;
    const dirx = b.rx / d;
    const diry = b.ry / d;
    const dirz = b.rz / d;
    const patch = pl.patches.length ? patchAt(pl, dirx, diry, dirz) : null;
    if (patch && patch.type === 'lava') {
      lose(hole, b, 'lava');
      b.step++;
      return b.mode;
    }
    let decel = pl.surf.roll * Math.max(gN, 1);
    if (patch) {
      if (patch.type === 'ice') decel *= 0.1;
      else if (patch.type === 'tar') decel *= 4;
    }
    vx += tx * DT;
    vy += ty * DT;
    vz += tz * DT;
    let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const tmag = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (sp < REST_SPEED && tmag < decel) {
      vx = vy = vz = 0;
      sp = 0;
    } else if (sp > 0) {
      const cut = Math.min(sp, decel * DT);
      const f = (sp - cut) / sp;
      vx *= f;
      vy *= f;
      vz *= f;
      sp -= cut;
    }
    if (m && m.brake && b.step >= m.brake.from && b.step < m.brake.to) {
      vx *= BRAKE;
      vy *= BRAKE;
      vz *= BRAKE;
      sp *= BRAKE;
    }
    if (b.step > ORBIT_DECAY_AFTER) {
      vx *= 0.997;
      vy *= 0.997;
      vz *= 0.997;
      sp *= 0.997;
    }
    b.rolled += sp * DT;
    let rx = b.rx + vx * DT;
    let ry = b.ry + vy * DT;
    let rz = b.rz + vz * DT;
    const cx = c1[b.g * 3];
    const cy = c1[b.g * 3 + 1];
    const cz = c1[b.g * 3 + 2];
    const F = surfaceF(pl, cx + rx, cy + ry, cz + rz, cx, cy, cz);
    surfaceNormal(pl, cx + rx, cy + ry, cz + rz, cx, cy, cz, N);
    const push = BALL_R - F;
    rx += N[0] * push;
    ry += N[1] * push;
    rz += N[2] * push;
    const vn = vx * N[0] + vy * N[1] + vz * N[2];
    vx -= N[0] * vn;
    vy -= N[1] * vn;
    vz -= N[2] * vn;
    b.rx = rx;
    b.ry = ry;
    b.rz = rz;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    if (cupTest(hole, b, rx, ry, rz, vx, vy, vz, true)) {
      b.step++;
      return b.mode;
    }
    const s2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (s2 < REST_SPEED * REST_SPEED) {
      if (++b.restSteps >= REST_STEPS) {
        const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        settle(hole, b, b.g, rx / l, ry / l, rz / l);
        ev(b, 'rest');
      }
    } else b.restSteps = 0;
    b.step++;
    return b.mode;
  }

  // FLY
  const a = field(hole, b, b.x, b.y, b.z, c0);
  let ax = a[0];
  let ay = a[1];
  let az = a[2];
  const near = a[3];
  if (near < b.minPass && a[4] !== b.shotPlanet) b.minPass = near;
  if (near > b.peakAlt) b.peakAlt = near;
  // Atmospheres, gas giants and black holes act on the point the ball is at.
  const P = hole.planets;
  const sp0 = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
  for (let i = 0; i < P.length; i++) {
    const pl = P[i];
    if (!pl.atmo && !pl.gas && !pl.black) continue;
    const dx = b.x - c0[i * 3];
    const dy = b.y - c0[i * 3 + 1];
    const dz = b.z - c0[i * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (pl.gas && d < pl.R) {
      lose(hole, b, 'gas');
      b.step++;
      return b.mode;
    }
    if (pl.black && d < pl.killR) {
      lose(hole, b, 'hole');
      b.step++;
      return b.mode;
    }
    if (pl.atmo && d < pl.R * 1.35 && sp0 > 0) {
      const k = pl.drag * sp0;
      ax -= b.vx * k;
      ay -= b.vy * k;
      az -= b.vz * k;
      b.aero++;
    }
  }
  b.vx += ax * DT;
  b.vy += ay * DT;
  b.vz += az * DT;
  if (m) {
    if (m.brake && b.step >= m.brake.from && b.step < m.brake.to) {
      b.vx *= BRAKE;
      b.vy *= BRAKE;
      b.vz *= BRAKE;
    }
    if (m.thrust !== undefined && m.thrust === b.step) {
      const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
      if (s > 0.01) {
        const f = (s + THRUST) / s;
        b.vx *= f;
        b.vy *= f;
        b.vz *= f;
      } else b.vy += THRUST;
      ev(b, 'thrust');
    }
  }
  if (b.step > ORBIT_DECAY_AFTER) {
    b.vx *= 0.997;
    b.vy *= 0.997;
    b.vz *= 0.997;
  }
  const ox = b.x;
  const oy = b.y;
  const oz = b.z;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
  b.flightSteps++;

  // Out of bounds, or adrift where no world pulls at all.
  if (b.x * b.x + b.y * b.y + b.z * b.z > OOB * OOB) {
    lose(hole, b, 'space');
    b.step++;
    return b.mode;
  }
  if (ax * ax + ay * ay + az * az < 1e-8) {
    if (++b.freeSteps >= FREE_STEPS) {
      lose(hole, b, 'space');
      b.step++;
      return b.mode;
    }
  } else b.freeSteps = 0;
  // Stalled in free space (gravity cancelled): nudge it toward the nearest world so it never hangs there.
  const s2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
  if (s2 < 0.36 && ax * ax + ay * ay + az * az < 0.64) {
    if (++b.stallSteps >= STALL_STEPS) {
      b.stallSteps = 0;
      const i = a[4] >= 0 ? a[4] : 0;
      const dx = c1[i * 3] - b.x;
      const dy = c1[i * 3 + 1] - b.y;
      const dz = c1[i * 3 + 2] - b.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      b.vx += (dx / d) * 2.5;
      b.vy += (dy / d) * 2.5;
      b.vz += (dz / d) * 2.5;
      ev(b, 'nudge');
    }
  } else b.stallSteps = 0;

  // Boost rings: crossing the ring's disc adds speed along its axis, the way the ball is going.
  if (hole.rings.length && b.ringCool === 0) {
    for (let i = 0; i < hole.rings.length; i++) {
      const r = hole.rings[i];
      const s0 = (ox - r.x) * r.ax + (oy - r.y) * r.ay + (oz - r.z) * r.az;
      const s1 = (b.x - r.x) * r.ax + (b.y - r.y) * r.ay + (b.z - r.z) * r.az;
      if (s0 === s1 || s0 * s1 > 0) continue;
      const f = s0 / (s0 - s1);
      const hx = ox + (b.x - ox) * f - r.x;
      const hy = oy + (b.y - oy) * f - r.y;
      const hz = oz + (b.z - oz) * f - r.z;
      if (hx * hx + hy * hy + hz * hz > r.r * r.r) continue;
      const sg = s1 > s0 ? 1 : -1;
      b.vx += r.ax * r.k * sg;
      b.vy += r.ay * r.k * sg;
      b.vz += r.az * r.k * sg;
      b.ringCool = 30;
      b.boosts++;
      ev(b, 'ring');
      break;
    }
  }
  // Wormholes: enter one end, leave the other with the velocity carried over in the portal's frame.
  if (hole.worms.length && b.wormCool === 0) {
    for (let i = 0; i < hole.worms.length; i++) {
      const w = hole.worms[i];
      for (let e = 0; e < 2; e++) {
        const A = e === 0 ? w.a : w.b;
        const dx = b.x - A.x;
        const dy = b.y - A.y;
        const dz = b.z - A.z;
        if (dx * dx + dy * dy + dz * dz > w.r * w.r) continue;
        const B = e === 0 ? w.b : w.a;
        const s = Math.abs(b.vx * A.ax + b.vy * A.ay + b.vz * A.az);
        const u = b.vx * A.ux + b.vy * A.uy + b.vz * A.uz;
        const v = b.vx * A.vx + b.vy * A.vy + b.vz * A.vz;
        b.vx = B.ax * s + B.ux * u + B.vx * v;
        b.vy = B.ay * s + B.uy * u + B.vy * v;
        b.vz = B.az * s + B.uz * u + B.vz * v;
        const out = w.r + 0.4;
        b.x = B.x + B.ax * out;
        b.y = B.y + B.ay * out;
        b.z = B.z + B.az * out;
        b.wormCool = 90;
        b.warps++;
        ev(b, 'warp', e);
        break;
      }
    }
  }

  // Contact with solid worlds (after the move, against their new centres).
  if (b.ghostIn >= 0) {
    const pl = P[b.ghostIn];
    const F = surfaceF(pl, b.x, b.y, b.z, c1[b.ghostIn * 3], c1[b.ghostIn * 3 + 1], c1[b.ghostIn * 3 + 2]);
    if (F > BALL_R + 0.6) {
      b.ghostIn = -1;
      ev(b, 'ghostout');
    }
  }
  for (let i = 0; i < P.length; i++) {
    const pl = P[i];
    if (!pl.solid || b.ghostIn === i) continue;
    const cx = c1[i * 3];
    const cy = c1[i * 3 + 1];
    const cz = c1[i * 3 + 2];
    const dx = b.x - cx;
    const dy = b.y - cy;
    const dz = b.z - cz;
    if (dx * dx + dy * dy + dz * dz > pl.bound * pl.bound) continue;
    const F = surfaceF(pl, b.x, b.y, b.z, cx, cy, cz);
    if (F >= BALL_R) continue;
    // Ghost: the first world in the way is passed through, never the cup's own (that's where the ball wants to land).
    if (m && m.ghost && !b.ghostUsed && i !== hole.cup.p) {
      b.ghostUsed = true;
      b.ghostIn = i;
      ev(b, 'ghostin');
      continue;
    }
    surfaceNormal(pl, b.x, b.y, b.z, cx, cy, cz, N);
    const nx = N[0];
    const ny = N[1];
    const nz = N[2];
    const push = BALL_R - F;
    b.x += nx * push;
    b.y += ny * push;
    b.z += nz * push;
    let vpx = 0;
    let vpy = 0;
    let vpz = 0;
    if (pl.rail) {
      vpx = (c1[i * 3] - c0[i * 3]) / DT;
      vpy = (c1[i * 3 + 1] - c0[i * 3 + 1]) / DT;
      vpz = (c1[i * 3 + 2] - c0[i * 3 + 2]) / DT;
    }
    let vx = b.vx - vpx;
    let vy = b.vy - vpy;
    let vz = b.vz - vpz;
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn >= 0) continue; // already separating (a fresh launch, a graze)
    const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const patch = pl.patches.length ? patchAt(pl, dx / dd, dy / dd, dz / dd) : null;
    let e = pl.surf.rest;
    let mu = pl.surf.fric;
    let kick = 0;
    let sticky = false;
    if (patch) {
      if (patch.type === 'lava') {
        lose(hole, b, 'lava');
        b.step++;
        return b.mode;
      }
      if (patch.type === 'ice') {
        mu *= 0.1;
        e = 0.5;
      } else if (patch.type === 'pad') {
        e = 1.3;
        kick = 6;
      } else if (patch.type === 'tar') {
        e = 0;
        mu *= 4;
        sticky = true;
      }
    }
    if (m) {
      if (m.bouncy) e += 0.3;
      if (m.sticky && !b.stickyUsed) {
        b.stickyUsed = true;
        e = 0;
        sticky = true;
      }
    }
    const tx = vx - nx * vn;
    const ty = vy - ny * vn;
    const tz = vz - nz * vn;
    const lt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (-vn > ROLL_VN && e > 0.001) {
      const vn2 = -e * vn + kick;
      let f = 1;
      if (lt > 1e-9) {
        const jt = Math.min(lt, mu * (1 + e) * -vn);
        f = (lt - jt) / lt;
      }
      vx = tx * f + nx * vn2;
      vy = ty * f + ny * vn2;
      vz = tz * f + nz * vn2;
      b.vx = vx + vpx;
      b.vy = vy + vpy;
      b.vz = vz + vpz;
      b.bounces++;
      ev(b, 'bounce', -vn, patch ? patch.type : pl.kind);
    } else {
      // Lands and rolls (relative to the world from here on); the touch costs the same friction a bounce would.
      // Tar grips hard; the Sticky card only takes the bounce away.
      let f = sticky ? (patch && patch.type === 'tar' ? 0.25 : 0.85) : 1;
      if (kick > 0) f = 1;
      if (lt > 1e-9 && !sticky) f *= (lt - Math.min(lt, mu * (1 + e) * -vn)) / lt;
      b.mode = ROLL;
      b.g = i;
      b.rx = b.x - cx;
      b.ry = b.y - cy;
      b.rz = b.z - cz;
      b.vx = tx * f;
      b.vy = ty * f;
      b.vz = tz * f;
      b.restSteps = 0;
      ev(b, 'land', -vn, patch ? patch.type : pl.kind);
      cupTest(hole, b, b.rx, b.ry, b.rz, b.vx, b.vy, b.vz, true);
    }
    break;
  }
  b.step++;
  return b.mode;
}

/** Steps until the ball rests, drops in or `maxSteps` pass. Returns the number of steps taken. */
export function simulate(hole, b, maxSteps) {
  let n = 0;
  while (n < maxSteps) {
    const mode = stepBall(hole, b);
    n++;
    if (mode === REST || mode === HOLED) break;
  }
  return n;
}

/**
 * Steps until the ball rests or drops in, with an early out for a ball heading away with no world ahead
 * (returns -1: lost for good). Used by the generator, the grader and the bots' final check.
 */
export function runToRest(hole, b, maxSteps, onSample) {
  let steps = 0;
  while (steps < maxSteps) {
    const mode = stepBall(hole, b);
    steps++;
    if (mode === REST || mode === HOLED) return mode;
    if (mode === FLY && (steps & 15) === 0) {
      if (onSample) onSample(b);
      if (b.x * b.x + b.y * b.y + b.z * b.z > 70 * 70 && b.x * b.vx + b.y * b.vy + b.z * b.vz > 0) {
        let anyNear = false;
        const c = hole.cs;
        for (let i = 0; i < hole.n && !anyNear; i++) {
          const dx = c[i * 3] - b.x;
          const dy = c[i * 3 + 1] - b.y;
          const dz = c[i * 3 + 2] - b.z;
          if (dx * dx + dy * dy + dz * dz < hole.planets[i].inf * hole.planets[i].inf) anyNear = true;
        }
        if (!anyNear) return -1;
      }
    }
  }
  return -1;
}

/** Distance from the ball to the cup's centre (absolute), at its current step. */
const P3 = [0, 0, 0];
export function distToCup(hole, b) {
  ballPos(hole, b, P3);
  const c = centersAt(hole, b.t0 + b.step * DT, C0);
  const C = hole.cup;
  const dx = c[C.p * 3] + C.dx * C.radial - P3[0];
  const dy = c[C.p * 3 + 1] + C.dy * C.radial - P3[1];
  const dz = c[C.p * 3 + 2] + C.dz * C.radial - P3[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

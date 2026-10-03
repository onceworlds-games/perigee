// Every page's view of the round: it reads the table (`g` and the `s.<pid>` shot records), simulates every ball
// locally from its shot record and the shared clock, snaps to the authority's canonical rests, and handles the
// local player's aiming, shooting, card acts and claims. Pure data in, events out; the views are optional so the
// same code runs in tests.
import { centersAt, q, num, BALL_R, MAX_PLANETS } from '../sim/hole.js';
import { makeBall, launchAt, stepBall, planetVel, ballPos, placeBall, distToCup, REST, FLY, ROLL, LOST, HOLED, DT, MAX_SPEED } from '../sim/ball.js';
import { modsFor } from '../sim/cards.js';
import { G_KEY, shotKey } from './table.js';
import { INTRO_MS } from './round.js';

const MAX_CATCHUP = 2400;
const SNAP_GRACE_MS = 1500;
const CS = new Float64Array(MAX_PLANETS * 3);
const P = [0, 0, 0];

export class Session {
  /** ctx: { table, me, clock(), isParticipant(id), onEvent(pid, ev, pos, ball) } */
  constructor(ctx) {
    this.ctx = ctx;
    this.table = ctx.table;
    this.balls = new Map(); // pid -> { b, key, done, rec, settledAt, claimed }
    this.hole = null;
    this.holeIndex = -1;
    this.g = null;
    this.charge = 0; // 0..1 while charging
    this.charging = false;
    this.chargeDir = 1;
    this.card = null; // the card chosen for the next shot
    this.braking = false;
    this.previewPts = new Float32Array(3 * 400);
    this.previewN = 0;
    this.previewLanding = null;
    this.replay = null;
    this.lastShotRec = null;
  }

  /** Called every frame with the current g (or null) and the prepared hole for g.h (or null while it builds). */
  update(g, hole, now, dtMs) {
    this.g = g;
    if (!g || !hole) {
      if (this.balls.size) this.clearBalls();
      this.hole = null;
      this.holeIndex = -1;
      return;
    }
    if (hole !== this.hole || g.h !== this.holeIndex) {
      this.clearBalls();
      this.hole = hole;
      this.holeIndex = g.h;
      this.charging = false;
      this.charge = 0;
      this.replay = null;
    }
    for (const pid of g.players) this.syncBall(pid, g, hole, now);
    for (const pid of [...this.balls.keys()]) if (!g.players.includes(pid)) this.balls.delete(pid);
    if (this.charging) {
      this.charge += (dtMs / 1200) * this.chargeDir;
      if (this.charge >= 1) {
        this.charge = 1;
        this.chargeDir = -1;
      } else if (this.charge <= 0) {
        this.charge = 0;
        this.chargeDir = 1;
      }
    }
    if (this.replay) this.stepReplay(now);
  }

  clearBalls() {
    this.balls.clear();
  }

  entry(pid) {
    return this.balls.get(pid) ?? null;
  }

  /** Restores or advances one player's ball from the table. */
  syncBall(pid, g, hole, now) {
    const cur = g.cur[pid];
    if (!cur) return;
    const s = this.table.get(shotKey(pid));
    let e = this.balls.get(pid);
    const restKey = `rest.${cur.n}.${cur.rest ? cur.rest.g + ':' + cur.rest.d.join(',') : 'tee'}.${cur.holed ? 'h' : ''}${cur.up ? 'u' : ''}`;
    const live = s && s.h === g.h && s.n === cur.n + 1 && !cur.holed && !cur.up && this.validRec(s, g, hole);
    if (live) {
      const key = `shot.${s.n}.${JSON.stringify(s.acts ?? null)}.${s.at}`;
      if (!e || e.key !== key) {
        const b = e?.b ?? makeBall(hole, cur.rest ? cur.rest.g : hole.tee.p, cur.rest ? cur.rest.d : [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
        if (b.mode !== REST) placeBall(hole, b, cur.rest ? cur.rest.g : hole.tee.p, ...(cur.rest ? cur.rest.d : [hole.tee.dx, hole.tee.dy, hole.tee.dz]));
        b.events.length = 0;
        const mods = s.mods ? { ...s.mods } : null;
        if (mods && s.acts) {
          if (Number.isInteger(s.acts.thrust)) mods.thrust = s.acts.thrust;
          if (s.acts.brake && Number.isInteger(s.acts.brake.from) && Number.isInteger(s.acts.brake.to)) mods.brake = { from: s.acts.brake.from, to: s.acts.brake.to };
        }
        const relaunch = !!(e && e.rec && e.rec.n === s.n);
        launchAt(hole, b, (s.at - g.t0) / 1000, s.p[0], s.p[1], s.p[2], s.v[0], s.v[1], s.v[2], mods);
        if (relaunch) b.events.length = 0; // an act arrived: the flight is rebuilt, its sounds were already played
        e = { b, key, done: false, rec: s, settledAt: 0, claimed: false, relaunch, up: false };
        this.balls.set(pid, e);
        if (pid === this.ctx.me) this.lastShotRec = s;
      }
      const b = e.b;
      if (!e.done) {
        const target = Math.floor((now - s.at) / 1000 / DT);
        let k = 0;
        while (b.step < target && k < MAX_CATCHUP && b.mode !== REST && b.mode !== HOLED) {
          stepBall(hole, b);
          k++;
        }
        if (b.mode === REST || b.mode === HOLED) {
          e.done = true;
          e.settledAt = now;
          if (pid === this.ctx.me && !e.claimed) this.claim(s, b);
        }
      }
      this.flushEvents(pid, e);
      e.relaunch = false;
      return;
    }
    // No live shot: the ball sits at its canonical rest (snapping if the local sim ended elsewhere).
    if (!e || e.key !== restKey) {
      const stale = e && e.rec && !e.done && now - (e.rec.at ?? 0) < SNAP_GRACE_MS && e.rec.n === cur.n;
      if (stale) return; // the authority settled it before this page finished: give the flight a moment
      const b = e?.b ?? makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
      if (cur.holed) {
        b.mode = HOLED;
      } else {
        const r = cur.rest ?? { g: hole.tee.p, d: [hole.tee.dx, hole.tee.dy, hole.tee.dz] };
        const was = b.mode;
        placeBall(hole, b, r.g, r.d[0], r.d[1], r.d[2]);
        if (was !== REST && e) e.snapped = true;
      }
      b.t0 = (now - g.t0) / 1000;
      b.step = 0;
      this.balls.set(pid, { b, key: restKey, done: true, rec: null, settledAt: now, claimed: false, up: !!cur.up });
    } else {
      // Keep a resting ball's clock current (moving worlds carry it).
      e.b.t0 = (now - g.t0) / 1000;
      e.b.step = 0;
      e.up = !!cur.up;
    }
  }

  validRec(s, g, hole) {
    if (!s || !Array.isArray(s.p) || !Array.isArray(s.v) || s.p.length !== 3 || s.v.length !== 3) return false;
    for (const v of s.p) if (!Number.isFinite(v) || Math.abs(v) > 200) return false;
    for (const v of s.v) if (!Number.isFinite(v) || Math.abs(v) > 60) return false;
    if (!Number.isFinite(s.at)) return false;
    return true;
  }

  flushEvents(pid, e) {
    const b = e.b;
    if (!b.events.length) return;
    const pos = ballPos(this.hole, b, P);
    for (const ev of b.events) this.ctx.onEvent?.(pid, ev, pos, b, e);
    b.events.length = 0;
  }

  /** The local ball finished: tell the authority where (it checks against its own simulation). */
  claim(s, b) {
    const e = this.balls.get(this.ctx.me);
    if (e) e.claimed = true;
    const rec = { ...s };
    if (b.mode === HOLED) rec.holed = true;
    else rec.rest = { g: b.rest.g, d: [b.rest.dx, b.rest.dy, b.rest.dz] };
    rec.pen = b.penalties;
    this.table.set(shotKey(this.ctx.me), rec);
  }

  // ---------------------------------------------------------------- the local player

  myCur() {
    return this.g?.cur?.[this.ctx.me] ?? null;
  }

  myBall() {
    return this.balls.get(this.ctx.me)?.b ?? null;
  }

  /** What the local player can do right now. */
  state() {
    const g = this.g;
    if (!g || !this.hole) return 'wait';
    if (!this.ctx.isParticipant(this.ctx.me) || !g.players.includes(this.ctx.me)) return 'watch';
    if (g.phase !== 'play') return g.phase === 'intro' ? 'intro' : 'wait';
    const cur = this.myCur();
    if (!cur) return 'watch';
    if (cur.holed) return 'holed';
    if (cur.up) return 'up';
    const e = this.balls.get(this.ctx.me);
    if (!e) return 'wait';
    if (e.rec && !e.done) return 'flying';
    if (e.rec && e.done) return 'settling';
    return 'aim';
  }

  startCharge() {
    if (this.state() !== 'aim') return false;
    this.charging = true;
    this.charge = 0;
    this.chargeDir = 1;
    return true;
  }

  cancelCharge() {
    this.charging = false;
    this.charge = 0;
  }

  /** Releases the charge: creates the shot record (and launches the local ball at once). */
  release(aimDir) {
    if (!this.charging) return null;
    const power = Math.max(0.04, this.charge);
    this.charging = false;
    this.charge = 0;
    return this.shoot(aimDir, power);
  }

  shoot(aimDir, power, now = this.ctx.clock()) {
    const g = this.g;
    const hole = this.hole;
    if (!g || !hole || this.state() !== 'aim') return null;
    const cur = this.myCur();
    const e = this.balls.get(this.ctx.me);
    const b = e.b;
    const t = (now - g.t0) / 1000;
    b.t0 = t;
    b.step = 0;
    const p = ballPos(hole, b, [0, 0, 0]);
    const vp = planetVel(hole, b.g, t);
    const speed = MAX_SPEED * power;
    const v = [q(aimDir[0] * speed + vp[0]), q(aimDir[1] * speed + vp[1]), q(aimDir[2] * speed + vp[2])];
    const pq = [q(p[0]), q(p[1]), q(p[2])];
    const card = this.card;
    const mods = card ? modsFor(card, b.g) : null;
    const rec = { h: g.h, n: cur.n + 1, p: pq, v, at: now, mods, card: card || undefined, acts: null };
    this.card = null;
    this.table.set(shotKey(this.ctx.me), rec);
    this.lastShotRec = rec;
    this.syncBall(this.ctx.me, g, hole, now); // launches locally from the same record
    return rec;
  }

  /** A card act mid-flight: thruster tap, or the brake's start/end. */
  act(kind, now = this.ctx.clock()) {
    const e = this.balls.get(this.ctx.me);
    if (!e || !e.rec || e.done) return false;
    const s = this.table.get(shotKey(this.ctx.me));
    if (!s || s !== e.rec && s.n !== e.rec.n) return false;
    const step = Math.max(0, Math.floor((now - s.at) / 1000 / DT));
    const acts = { ...(s.acts ?? {}) };
    if (kind === 'thrust') {
      if (!s.mods?.thruster || acts.thrust !== undefined) return false;
      acts.thrust = step + 1;
    } else if (kind === 'brake') {
      if (!s.mods?.braker || acts.brake) return false;
      acts.brake = { from: step + 1, to: step + 1 + 120 * 2 };
      this.braking = true;
    } else if (kind === 'brakeEnd') {
      if (!acts.brake || !this.braking) return false;
      this.braking = false;
      acts.brake = { from: acts.brake.from, to: Math.max(acts.brake.from + 1, Math.min(step + 1, acts.brake.to)) };
    } else return false;
    this.table.set(shotKey(this.ctx.me), { ...s, acts });
    return true;
  }

  /** Computes the preview: `seconds` of the real path from the current aim and charge (or a default power). */
  preview(aimDir, seconds, power = null) {
    const g = this.g;
    const hole = this.hole;
    const e = this.balls.get(this.ctx.me);
    if (!g || !hole || !e || this.state() !== 'aim') {
      this.previewN = 0;
      this.previewLanding = null;
      return;
    }
    const b = e.b;
    const now = this.ctx.clock();
    const t = (now - g.t0) / 1000;
    const sim = PREVIEW_BALL;
    placeBall(hole, sim, b.g, b.rest.dx, b.rest.dy, b.rest.dz);
    sim.quiet = true;
    sim.t0 = t;
    const p = ballPos(hole, sim, [0, 0, 0]);
    const vp = planetVel(hole, b.g, t);
    const pw = power ?? (this.charging ? Math.max(0.04, this.charge) : 0.45);
    const speed = MAX_SPEED * pw;
    const mods = this.card ? modsFor(this.card, b.g) : null;
    launchAt(hole, sim, t, p[0], p[1], p[2], aimDir[0] * speed + vp[0], aimDir[1] * speed + vp[1], aimDir[2] * speed + vp[2], mods);
    const steps = Math.min(400 * 3, Math.floor(seconds * 120));
    let n = 0;
    let landing = null;
    const pts = this.previewPts;
    for (let i = 0; i < steps; i++) {
      const mode = stepBall(hole, sim);
      if (i % 3 === 0 && n < 400) {
        ballPos(hole, sim, P);
        pts[n * 3] = P[0];
        pts[n * 3 + 1] = P[1];
        pts[n * 3 + 2] = P[2];
        n++;
      }
      if (!landing && (mode === ROLL || sim.bounces > 0)) {
        ballPos(hole, sim, P);
        const c = centersAt(hole, sim.t0 + sim.step * DT, CS);
        const g0 = sim.mode === ROLL ? sim.g : nearestPlanet(hole, c, P);
        const dx = P[0] - c[g0 * 3];
        const dy = P[1] - c[g0 * 3 + 1];
        const dz = P[2] - c[g0 * 3 + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        landing = [P[0] - (dx / l) * BALL_R * 0.9, P[1] - (dy / l) * BALL_R * 0.9, P[2] - (dz / l) * BALL_R * 0.9, dx / l, dy / l, dz / l];
      }
      if (mode === REST || mode === HOLED || mode === LOST) break;
    }
    this.previewN = n;
    this.previewLanding = landing;
  }

  /** Starts a replay of the local player's last shot (a free ball that flies it again from the start). */
  startReplay() {
    const rec = this.lastShotRec;
    const hole = this.hole;
    const g = this.g;
    if (!rec || !hole || !g || rec.h !== g.h) return false;
    const cur = this.myCur();
    const b = makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
    const prev = cur?.prev?.rest;
    if (prev) placeBall(hole, b, prev.g, prev.d[0], prev.d[1], prev.d[2]);
    const mods = rec.mods ? { ...rec.mods } : null;
    if (mods && rec.acts) {
      if (Number.isInteger(rec.acts.thrust)) mods.thrust = rec.acts.thrust;
      if (rec.acts.brake) mods.brake = rec.acts.brake;
    }
    launchAt(hole, b, (rec.at - g.t0) / 1000, rec.p[0], rec.p[1], rec.p[2], rec.v[0], rec.v[1], rec.v[2], mods);
    b.quiet = true;
    this.replay = { b, started: this.ctx.clock(), at: rec.at };
    return true;
  }

  stepReplay(now) {
    const r = this.replay;
    const target = Math.floor((now - r.started) / 1000 / DT);
    let k = 0;
    while (r.b.step < target && k < MAX_CATCHUP && r.b.mode !== REST && r.b.mode !== HOLED) {
      stepBall(this.hole, r.b);
      k++;
    }
    if (r.b.mode === REST || r.b.mode === HOLED || now - r.started > 45000) this.replay = null;
  }

  stopReplay() {
    this.replay = null;
  }

  /** Distance from the local ball to the cup (m). */
  distance() {
    const b = this.myBall();
    return b && this.hole ? distToCup(this.hole, b) : 0;
  }
}

const PREVIEW_BALL = makeBall({ planets: [{ R: 1, lobes: new Float64Array(0), g0: 1 }], cs: new Float64Array(3), moving: false, n: 1, tee: { p: 0 }, cup: { p: -1 } }, 0, [0, 1, 0]);

function nearestPlanet(hole, c, p) {
  let best = 0;
  let bd = 1e18;
  for (let i = 0; i < hole.n; i++) {
    const dx = p[0] - c[i * 3];
    const dy = p[1] - c[i * 3 + 1];
    const dz = p[2] - c[i * 3 + 2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export { INTRO_MS, num };

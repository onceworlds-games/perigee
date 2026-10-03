// The title and clubhouse scene: a whole small solar system turning slowly while a ball flies a real hole's
// reference shot round a ringed giant and drops into the cup, drawing its orbit as a long fading ribbon. It loops.
import * as THREE from 'three';
import { prepareHole, MAX_PLANETS } from '../sim/hole.js';
import { makeBall, launchAt, stepBall, ballPos, DT, HOLED, REST, LOST, FLY, ROLL } from '../sim/ball.js';
import { BallView } from './ball.js';
import { PALETTE } from './gfx.js';

const P = [0, 0, 0];
const SPEED = 1.35; // the loop runs a little faster than life

export class Showcase {
  constructor(gfx, world, data) {
    this.gfx = gfx;
    this.world = world;
    this.data = data;
    this.hole = prepareHole(data);
    this.t = 0;
    this.yaw = 0.9;
    this.pitch = 0.4;
    this.phase = 'tee';
    this.wait = 1.2;
    this.acc = 0;
    this.ball = null;
    this.view = null;
    this.look = null;
    this.frame = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.radius = 40;
    this.shiftX = 0; // where the system sits on screen (-1..1 of half the width): the clubhouse moves it off its panels
    this.shiftNow = 0;
    this.bounds();
  }

  /** The flight's extent (simulated once), so the camera frames the whole shot and its worlds. */
  bounds() {
    const h = this.hole;
    const ref = this.data.ref;
    const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
    b.quiet = true;
    launchAt(h, b, ref.t0, ref.p[0], ref.p[1], ref.p[2], ref.v[0], ref.v[1], ref.v[2], null);
    const pts = [];
    for (let i = 0; i < 120 * 40 && b.mode !== REST && b.mode !== HOLED && b.mode !== LOST; i++) {
      stepBall(h, b);
      if (i % 12 === 0) pts.push(ballPos(h, b, [0, 0, 0]));
    }
    const lo = [1e9, 1e9, 1e9];
    const hi = [-1e9, -1e9, -1e9];
    const grow = (p, r) => {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k] - r);
        hi[k] = Math.max(hi[k], p[k] + r);
      }
    };
    for (const p of pts) grow(p, 2);
    // The worlds the ball touches or passes close to are part of the picture.
    for (let i = 0; i < h.n; i++) {
      const pl = h.planets[i];
      const c = [h.cs[i * 3], h.cs[i * 3 + 1], h.cs[i * 3 + 2]];
      const near = pts.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < pl.R * 2.6);
      if (near || i === h.tee.p || i === h.cup.p) grow(c, pl.R * (pl.gas ? 1.6 : 1.1));
    }
    this.focus.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    this.radius = Math.max(20, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  }

  /** Shows the scene (the world's hole becomes the showcase's). */
  enter(look) {
    this.look = look;
    if (this.world.hole !== this.hole) {
      this.world.setHole(this.hole, 41);
      this.view = null;
    }
    if (!this.view) {
      this.view = new BallView(this.gfx, { ...look }, false, { trail: 300, width: 4.2, step: 0.4, scale: 2.6, cues: false });
    } else this.view.setLook(look);
    this.reset();
  }

  leave() {
    this.view?.dispose();
    this.view = null;
  }

  setLook(look) {
    this.look = look;
    this.view?.setLook(look);
  }

  reset() {
    const h = this.hole;
    this.ball = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
    this.ball.quiet = false;
    this.phase = 'tee';
    this.wait = 1.0;
    this.acc = 0;
    this.view?.clearTrail();
  }

  update(dt, reduced) {
    const h = this.hole;
    this.t += dt;
    this.world.holeView?.update(this.t, dt, reduced);
    const b = this.ball;
    if (this.phase === 'tee') {
      this.wait -= dt;
      if (this.wait <= 0) {
        const r = this.data.ref;
        launchAt(h, b, r.t0, r.p[0], r.p[1], r.p[2], r.v[0], r.v[1], r.v[2], null);
        b.events.length = 0;
        this.phase = 'fly';
      }
    } else if (this.phase === 'fly') {
      this.acc += Math.min(0.1, dt) * SPEED;
      let n = 0;
      while (this.acc >= DT && n < 40) {
        stepBall(h, b);
        this.acc -= DT;
        n++;
        if (b.mode === HOLED || b.mode === REST || b.mode === LOST) break;
      }
      for (const e of b.events) {
        if (e.k === 'holed') {
          ballPos(h, b, P);
          const up = [h.cup.dx, h.cup.dy, h.cup.dz];
          this.world.fx.burst(P, up, 40, { colours: [0xf3e5c3, 0xf06a5c, 0xbfe3ea], speed: 6, size: 2.6, decay: 0.9, spread: 2 });
        }
      }
      b.events.length = 0;
      if (b.mode === HOLED || b.mode === REST || b.mode === LOST || b.step > 120 * 45) {
        this.phase = 'done';
        this.wait = 2.6;
      }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) this.reset();
    }
    // The ball (hidden once it drops in; its ribbon stays a moment longer).
    if (this.view) {
      ballPos(h, b, P);
      const flying = b.mode === FLY || b.mode === ROLL;
      this.view.setVisible(b.mode !== HOLED);
      if (b.mode === HOLED) this.view.trail.visible = this.view.histN > 1 && this.wait > 0.6;
      else this.view.update(h, this.t, P[0], P[1], P[2], b.vx, b.vy, b.vz, dt, flying || this.phase === 'done', 1, reduced);
    }
    this.world.fx.update(dt);
    // The camera turns round the system, framing all of it, the focus shifted off the screen's panels.
    if (!reduced) this.yaw += dt * 0.035;
    const cam = this.gfx.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const fit = Math.min(vfov, hfov) / 2;
    const dist = (this.radius / Math.sin(fit)) * (cam.aspect < 0.8 ? 0.62 : 0.78);
    this.shiftNow += (this.shiftX - this.shiftNow) * Math.min(1, dt * 2.5);
    const cp = Math.cos(this.pitch);
    const off = this.frame.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    cam.position.copy(this.focus).addScaledVector(off, dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.focus);
    // Slide the frame sideways: the system sits beside the clubhouse's panels instead of under them.
    if (this.shiftNow) {
      const right = SIDE.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const shift = -this.shiftNow * Math.tan(hfov / 2) * dist;
      cam.position.addScaledVector(right, shift);
    }
  }
}

const SIDE = new THREE.Vector3();
export { PALETTE, MAX_PLANETS };

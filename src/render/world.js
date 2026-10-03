// The scene for one hole: the hole view, a ball view per player (ghosts for the others), the preview dots, the
// particles, the replay ball. Reads ball positions from the session's simulation; never simulates itself.
import * as THREE from 'three';
import { HoleView } from './planets.js';
import { BallView, PreviewDots } from './ball.js';
import { Fx } from './fx.js';
import { ballPos, HOLED, LOST, FLY, ROLL, DT } from '../sim/ball.js';
import { PALETTE } from './gfx.js';

const TINTS = [0x2a8f8a, 0xd86a2a, 0xd97a8a, 0xbfe3ea, 0x6fae4e, 0xe8c15a, 0x9fb8a8, 0xf06a5c];
const P = [0, 0, 0];

export class World {
  constructor(gfx) {
    this.gfx = gfx;
    this.holeView = null;
    this.hole = null;
    this.balls = new Map(); // pid -> { view, sinkT }
    this.preview = new PreviewDots(gfx);
    this.fx = new Fx(gfx);
    this.replayView = null;
    this.myLook = { body: PALETTE.cream, stripe: PALETTE.coral, trail: PALETTE.coral, flag: PALETTE.coral };
    this.seed = 1;
    gfx.onEvent((what) => {
      if (what === 'quality' && this.hole) this.setHole(this.hole, this.seed, true);
    });
  }

  setHole(hole, seed = 1, force = false) {
    if (hole === this.hole && !force) return;
    this.holeView?.dispose();
    for (const b of this.balls.values()) b.view.dispose();
    this.balls.clear();
    this.replayView?.dispose();
    this.replayView = null;
    this.fx.clear();
    this.preview.hide();
    this.hole = hole;
    this.seed = seed;
    this.holeView = hole ? new HoleView(this.gfx, hole, seed) : null;
    if (this.holeView) this.holeView.setFlagColour(this.myLook.flag);
  }

  setLook(look) {
    this.myLook = look;
    const me = this.balls.get(this.meId);
    if (me) me.view.setLook(look);
    this.holeView?.setFlagColour(look.flag);
  }

  ballView(pid, me, index) {
    let e = this.balls.get(pid);
    if (!e) {
      const look = me ? this.myLook : { body: PALETTE.cream, stripe: TINTS[index % TINTS.length], trail: TINTS[index % TINTS.length], tint: TINTS[index % TINTS.length] };
      e = { view: new BallView(this.gfx, look, !me), sinkT: 0 };
      this.balls.set(pid, e);
    }
    return e;
  }

  /** Draws every ball from the session; t is hole time (s). */
  update(session, meId, t, dt, reduced) {
    this.meId = meId;
    if (!this.hole || !session.hole) return;
    this.holeView.update(t, dt, reduced);
    let index = 0;
    const seen = new Set();
    for (const [pid, e] of session.balls) {
      const b = e.b;
      const v = this.ballView(pid, pid === meId, index++);
      seen.add(pid);
      ballPos(this.hole, b, P);
      const flying = b.mode === FLY || b.mode === ROLL;
      let fade = 1;
      if (b.mode === LOST) fade = Math.max(0, 1 - b.lostSteps / 180);
      if (b.mode === HOLED) {
        v.sinkT = Math.min(1, v.sinkT + dt * 2.5);
        const s = 1 - v.sinkT;
        v.view.group.scale.setScalar(Math.max(0.001, s));
        v.view.setVisible(s > 0.01);
        if (s <= 0.01) continue;
      } else {
        v.sinkT = 0;
        v.view.group.scale.setScalar(1);
        v.view.setVisible(true);
      }
      v.view.update(this.hole, t, P[0], P[1], P[2], b.vx, b.vy, b.vz, dt, flying, fade);
      if (!flying && b.step === 0) v.view.history.length = Math.max(0, v.view.history.length - 3);
    }
    for (const [pid, v] of this.balls) {
      if (!seen.has(pid)) {
        v.view.dispose();
        this.balls.delete(pid);
      }
    }
    // The replay ball.
    if (session.replay) {
      if (!this.replayView) this.replayView = new BallView(this.gfx, { ...this.myLook, body: PALETTE.ice }, false);
      const b = session.replay.b;
      ballPos(this.hole, b, P);
      this.replayView.setVisible(true);
      this.replayView.update(this.hole, t, P[0], P[1], P[2], b.vx, b.vy, b.vz, dt, b.mode === FLY || b.mode === ROLL, 0.9);
    } else if (this.replayView) {
      this.replayView.dispose();
      this.replayView = null;
    }
    this.fx.update(dt);
  }

  showPreview(session) {
    if (session.previewN > 0) this.preview.set(session.previewPts, session.previewN, session.previewLanding);
    else this.preview.hide();
  }

  hidePreview() {
    this.preview.hide();
  }

  /** Screen position of a world point, or null when behind the camera. */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.gfx.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.gfx.width, y: ((1 - v.y) / 2) * this.gfx.height };
  }
}

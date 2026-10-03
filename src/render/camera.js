// The chase camera: orbits the ball in a frame whose "up" is away from the nearest world, aims through its
// forward vector, follows a flying ball with easing, re-levels with a slerp (no gimbal flips), never enters a
// planet, and flies the hole intro from the cup back to the tee.
import * as THREE from 'three';
import { centersAt, MAX_PLANETS, BALL_R } from '../sim/hole.js';

const C = new Float64Array(MAX_PLANETS * 3);
const Y = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
// The shot leaves along the camera's heading, lifted by LOFT less the camera's pitch: looking along the ground
// (the default view) gives a friendly lofted shot, tilting the camera up lofts more, looking down flattens it
// into a putt.
export const LOFT = 0.62;
export const LOFT_MIN = -0.05;
export const LOFT_MAX = 1.15;
const SHOULDER = 1.5; // while aiming the camera stands a little to the right, so the preview's arc shows its height

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.frame = new THREE.Quaternion(); // rotates world Y to `up`
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 11;
    this.wantDist = 11;
    this.pos = new THREE.Vector3(0, 6, 12);
    this.shake = 0;
    this.shakeT = 0;
    this.mode = 'orbit'; // orbit | follow | intro | spectate
    this.intro = null;
    this.look = new THREE.Vector3();
    this.reduced = false;
    this.aim = new THREE.Vector3(0, 0, -1);
    this.aiming = false;
    this.shoulder = 0;
    this.right = new THREE.Vector3(1, 0, 0);
    this.loft = LOFT - this.pitch;
  }

  /** Sets the frame's up vector with a smooth re-level. */
  setUp(ux, uy, uz, instant = false) {
    v1.set(ux, uy, uz).normalize();
    if (v1.lengthSq() < 0.5) return;
    if (instant) {
      this.up.copy(v1);
      this.frame.setFromUnitVectors(Y, this.up);
      return;
    }
    this.wantUp = this.wantUp || new THREE.Vector3();
    this.wantUp.copy(v1);
  }

  /** The direction the next shot leaves in: the camera's forward, which the player tilts to loft. */
  aimDir() {
    return this.aim;
  }

  nudge(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + dpitch));
  }

  zoom(d) {
    this.wantDist = Math.max(7, Math.min(16, this.wantDist + d));
  }

  /** Point the camera from behind the ball toward a world point (R: look at the cup). */
  faceToward(tx, ty, tz) {
    v1.set(tx, ty, tz).sub(this.target);
    // Express in the frame: remove the up component, take the yaw.
    q1.copy(this.frame).invert();
    v1.applyQuaternion(q1);
    if (v1.x * v1.x + v1.z * v1.z > 1e-6) this.yaw = Math.atan2(v1.x, v1.z) + Math.PI;
    this.pitch = 0.3;
  }

  startIntro(from, to, up, cupUp = up) {
    this.mode = 'intro';
    this.intro = { from: new THREE.Vector3().fromArray(from), to: new THREE.Vector3().fromArray(to), up: new THREE.Vector3().fromArray(up), cupUp: new THREE.Vector3().fromArray(cupUp), t: 0, len: this.reduced ? 0.01 : 4.2 };
  }

  /** Pushes a point out of every world it is inside (the camera is never in a planet). */
  keepOut(hole, t, p) {
    const c = centersAt(hole, t, C);
    for (let i = 0; i < hole.n; i++) {
      const pl = hole.planets[i];
      const rr = pl.R * (1 + pl.hmax) + 0.8;
      const dx = p.x - c[i * 3];
      const dy = p.y - c[i * 3 + 1];
      const dz = p.z - c[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      p.set(c[i * 3] + (dx / d) * rr, c[i * 3 + 1] + (dy / d) * rr, c[i * 3 + 2] + (dz / d) * rr);
    }
  }

  endIntro() {
    if (this.mode === 'intro') this.mode = 'orbit';
    this.intro = null;
  }

  /**
   * One frame. target: the ball's position; vel: its velocity (follow mode uses it); hole/t: to keep out of planets.
   */
  update(dt, hole, t, tx, ty, tz, vx, vy, vz, flying) {
    this.target.set(tx, ty, tz);
    if (this.wantUp) {
      const k = 1 - Math.pow(0.001, dt / 0.9);
      this.up.lerp(this.wantUp, k).normalize();
      this.frame.setFromUnitVectors(Y, this.up);
    }
    this.dist += (this.wantDist - this.dist) * (1 - Math.pow(0.001, dt));
    if (this.mode === 'intro' && this.intro) {
      const it = this.intro;
      it.t += dt;
      const s = Math.min(1, it.t / it.len);
      const e = s * s * (3 - 2 * s);
      // Fly a high arc from above the cup to behind the tee, looking ahead along the way; never through a world.
      v1.copy(it.from).addScaledVector(it.cupUp, 7);
      v2.copy(it.to).addScaledVector(it.up, 5).addScaledVector(this.aim, -8);
      this.pos.lerpVectors(v1, v2, e);
      const lift = Math.sin(s * Math.PI);
      this.pos.addScaledVector(it.up, lift * 14).addScaledVector(it.cupUp, lift * 10);
      this.keepOut(hole, t, this.pos);
      this.look.lerpVectors(it.from, it.to, Math.min(1, e * 1.2));
      this.camera.position.copy(this.pos);
      this.camera.up.copy(it.up);
      this.camera.lookAt(this.look);
      if (s >= 1) this.endIntro();
      return;
    }
    let wantYaw = this.yaw;
    let wantPitch = this.pitch;
    if (flying && this.mode === 'follow') {
      // Follow the velocity: yaw toward where the ball goes, a touch above it.
      v1.set(vx, vy, vz);
      if (v1.lengthSq() > 1) {
        q1.copy(this.frame).invert();
        v1.applyQuaternion(q1);
        const y = Math.atan2(v1.x, v1.z) + Math.PI;
        let d = y - this.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.yaw += d * (1 - Math.pow(0.001, dt / 1.2));
        wantYaw = this.yaw;
        wantPitch = 0.28;
        this.pitch += (wantPitch - this.pitch) * (1 - Math.pow(0.001, dt / 1.5));
      }
    }
    // Orbit position in the frame.
    const cp = Math.cos(wantPitch);
    v1.set(Math.sin(wantYaw) * cp, Math.sin(wantPitch), Math.cos(wantYaw) * cp).applyQuaternion(this.frame);
    // The aim: the heading along the ground, lifted by the loft.
    this.loft = Math.max(LOFT_MIN, Math.min(LOFT_MAX, LOFT - wantPitch));
    const ce = Math.cos(this.loft);
    const se = Math.sin(this.loft);
    this.aim.set(-Math.sin(wantYaw) * ce, se, -Math.cos(wantYaw) * ce).applyQuaternion(this.frame).normalize();
    this.right.set(Math.cos(wantYaw), 0, -Math.sin(wantYaw)).applyQuaternion(this.frame);
    this.shoulder += ((this.aiming ? SHOULDER : 0) - this.shoulder) * (1 - Math.pow(0.001, dt / 0.6));
    const want = v2.copy(this.target).addScaledVector(v1, this.dist);
    // Keep out of worlds: shorten the boom if a planet is in the way or the camera is inside one.
    let dist = this.dist;
    const c = centersAt(hole, t, C);
    for (let i = 0; i < hole.n; i++) {
      const pl = hole.planets[i];
      const rr = pl.R * (1 + pl.hmax) + 0.6;
      // Ray from target toward want, sphere at c with radius rr.
      const ox = this.target.x - c[i * 3];
      const oy = this.target.y - c[i * 3 + 1];
      const oz = this.target.z - c[i * 3 + 2];
      const b = ox * v1.x + oy * v1.y + oz * v1.z;
      const cc = ox * ox + oy * oy + oz * oz - rr * rr;
      const disc = b * b - cc;
      if (disc <= 0) continue;
      const s = -b - Math.sqrt(disc);
      if (s > 0 && s < dist) dist = Math.max(1.2, s - 0.4);
      else if (cc < 0) {
        // The ball itself is inside the sphere's bound (a crater, a hill): push the camera along the normal instead.
        const s2 = -b + Math.sqrt(disc);
        if (s2 > 0 && s2 < dist) dist = Math.min(dist, Math.max(1.2, s2 + 0.2));
      }
    }
    want.copy(this.target).addScaledVector(v1, dist).addScaledVector(this.right, this.shoulder * Math.min(1, dist / 6));
    const k = flying ? 1 - Math.pow(0.001, dt / 0.35) : 1 - Math.pow(0.001, dt / 0.12);
    this.pos.lerp(want, k);
    this.keepOut(hole, t, this.pos);
    // Shake (never with reduced motion).
    let sx = 0;
    let sy = 0;
    if (this.shake > 0 && !this.reduced) {
      this.shakeT += dt * 40;
      sx = Math.sin(this.shakeT * 1.3) * this.shake;
      sy = Math.cos(this.shakeT * 1.7) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    this.camera.position.copy(this.pos);
    this.camera.up.copy(this.up);
    v1.copy(this.target).addScaledVector(this.up, 0.6 + sy * 0.3).addScaledVector(this.right, this.shoulder * Math.min(1, dist / 6));
    this.camera.lookAt(v1);
    if (sx || sy) this.camera.rotateZ(sx * 0.05);
    // Re-normalize: long sessions must not drift.
    this.frame.normalize();
    this.camera.quaternion.normalize();
  }

  kick(amount) {
    if (this.reduced) return;
    this.shake = Math.min(0.6, this.shake + amount);
  }
}

export { BALL_R };

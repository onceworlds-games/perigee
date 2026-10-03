// Ball views: the striped ball, its ribbon trail, the soft shadow projected onto the world below along gravity,
// the dotted drop line with a landing ring (how high, and where it comes down) and speed lines on a fast flight;
// ghost balls are translucent and tinted. The preview dots live here too. No allocation per frame.
import * as THREE from 'three';
import { BALL_R, centersAt, MAX_PLANETS } from '../sim/hole.js';
import { surfaceF, surfaceNormal } from '../sim/planet.js';
import { BALL_VERT, BALL_FRAG, DOT_VERT, DOT_FRAG, TRAIL_VERT, TRAIL_FRAG, SHADOW_VERT, SHADOW_FRAG } from './shaders.js';
import { outlineMaterial } from './planets.js';
import { PALETTE } from './gfx.js';

const C = new Float64Array(MAX_PLANETS * 3);
const N = new Float64Array(3);
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const axis = new THREE.Vector3();
const qtmp = new THREE.Quaternion();
const geo = new THREE.SphereGeometry(BALL_R, 32, 20);
{
  // The stripe is read from the vertex "height" (the ball's own y), so it stays put as the ball rolls visually.
  const pos = geo.attributes.position;
  const h = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) h[i] = pos.getY(i) / BALL_R;
  geo.setAttribute('height', new THREE.BufferAttribute(h, 1));
}
const shadowGeo = new THREE.PlaneGeometry(2, 2);
const MIN_STEP = 0.18; // trail samples at least this far apart (m)

export class BallView {
  /** opts: { trail (samples), width (trail width factor), step (m between samples), scale (ball size), cues } */
  constructor(gfx, look, ghost = false, opts = {}) {
    this.gfx = gfx;
    this.ghost = ghost;
    this.cues = opts.cues !== false;
    this.widthK = opts.width ?? 1;
    this.minStep = opts.step ?? MIN_STEP;
    this.group = new THREE.Group();
    this.group.scale.setScalar(opts.scale ?? 1);
    this.scaleK = opts.scale ?? 1;
    this.material = new THREE.ShaderMaterial({
      vertexShader: BALL_VERT,
      fragmentShader: BALL_FRAG,
      transparent: ghost,
      depthWrite: !ghost,
      uniforms: {
        uSun: gfx.shared.uSun,
        uBody: { value: new THREE.Color(PALETTE.cream) },
        uRim: { value: new THREE.Color(PALETTE.cream) },
        uStripe: { value: new THREE.Color(PALETTE.coral) },
        uAlpha: { value: ghost ? 0.5 : 1 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.userData.sharedGeometry = true;
    this.group.add(this.mesh);
    if (!ghost) {
      this.outline = new THREE.Mesh(geo, outlineMaterial(gfx, 1.6));
      this.outline.userData.sharedGeometry = true;
      this.group.add(this.outline);
    }
    this.spin = new THREE.Quaternion();
    // The shadow: a soft disc on the ground below along gravity.
    this.shadowMat = new THREE.ShaderMaterial({ vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, uniforms: { uColor: { value: new THREE.Color(0x061210) }, uAlpha: { value: 0.6 }, uSoft: { value: 0.2 } } });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadow.userData.sharedGeometry = true;
    this.shadow.renderOrder = 2;
    // The drop line (dotted) and the landing ring: how high the ball is and where it would come straight down.
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: PALETTE.cream, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: ghost ? 0.15 : 0.5, depthWrite: false }));
    this.line.frustumCulled = false;
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), new THREE.MeshBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.mark.renderOrder = 3;
    // Trail ribbon: two vertices per sample (side -1 / +1), faded by age.
    this.trailN = opts.trail ?? gfx.tier.trail;
    this.trailPos = new Float32Array(this.trailN * 2 * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.trailGeo.setIndex(idx);
    const fade = new Float32Array(this.trailN * 2);
    const side = new Float32Array(this.trailN * 2);
    for (let i = 0; i < this.trailN; i++) {
      fade[i * 2] = fade[i * 2 + 1] = i / (this.trailN - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    this.trailGeo.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    this.trailGeo.setAttribute('side', new THREE.BufferAttribute(side, 1));
    this.trailMat = new THREE.ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(PALETTE.coral) }, uAlpha: { value: ghost ? 0.35 : 0.9 } } });
    this.trail = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 4;
    this.hist = new Float32Array(this.trailN * 3); // a ring buffer of samples
    this.histN = 0;
    this.histHead = 0;
    this.trailOn = false;
    // Speed lines: short streaks round a fast ball, re-scattered every few frames.
    this.speedN = ghost ? 0 : gfx.tier.speedLines;
    if (this.speedN) {
      this.speedPos = new Float32Array(this.speedN * 2 * 3);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(this.speedPos, 3));
      this.speed = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.speed.frustumCulled = false;
      this.speed.renderOrder = 5;
      this.speedSeed = 1;
      this.speedTick = 0;
    }
    this.visible = true;
    gfx.scene.add(this.group, this.shadow, this.line, this.mark, this.trail);
    if (this.speed) gfx.scene.add(this.speed);
    this.fade = 1;
    this.alt = 0;
    this.setLook(look);
  }

  setLook(look) {
    const body = new THREE.Color(look.body ?? PALETTE.cream);
    if (this.ghost) body.lerp(new THREE.Color(look.tint ?? PALETTE.teal), 0.45);
    this.material.uniforms.uBody.value.copy(body);
    this.material.uniforms.uRim.value.set(look.body ?? PALETTE.cream);
    this.material.uniforms.uStripe.value.set(look.stripe ?? PALETTE.coral);
    this.trailMat.uniforms.uColor.value.set(look.trail ?? PALETTE.coral);
  }

  /** Places the ball; `vel` spins it; `hole`/`t` project the shadow. */
  update(hole, t, x, y, z, vx, vy, vz, dt, flying, fade = 1, reduced = false) {
    this.group.position.set(x, y, z);
    this.fade = fade;
    this.material.uniforms.uAlpha.value = (this.ghost ? 0.5 : 1) * fade;
    this.material.transparent = this.ghost || fade < 1;
    if (this.outline) this.outline.visible = fade >= 0.99;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed > 0.05 && dt > 0) {
      // Roll the ball about the axis perpendicular to its motion (visual only).
      tmp.set(vx / speed, vy / speed, vz / speed);
      axis.crossVectors(UP, tmp);
      if (axis.lengthSq() > 0.01) {
        axis.normalize();
        qtmp.setFromAxisAngle(axis, Math.min(1, (speed * dt) / BALL_R));
        this.spin.premultiply(qtmp).normalize();
      }
      this.group.quaternion.copy(this.spin);
    }
    // Shadow: along the pull of the nearest world, onto its surface.
    const c = centersAt(hole, t, C);
    let best = -1;
    let bestD = 1e9;
    for (let i = 0; i < hole.n; i++) {
      const pl = hole.planets[i];
      if (!pl.solid) continue;
      const dx = x - c[i * 3];
      const dy = y - c[i * 3 + 1];
      const dz = z - c[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - pl.R;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD < 60 && this.cues) {
      const pl = hole.planets[best];
      const cx = c[best * 3];
      const cy = c[best * 3 + 1];
      const cz = c[best * 3 + 2];
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      // March the radial line to the surface: F(p) = 0.
      let r = d;
      for (let k = 0; k < 4; k++) r -= surfaceF(pl, cx + (dx / d) * r, cy + (dy / d) * r, cz + (dz / d) * r, cx, cy, cz);
      const sx = cx + (dx / d) * r;
      const sy = cy + (dy / d) * r;
      const sz = cz + (dz / d) * r;
      surfaceNormal(pl, sx, sy, sz, cx, cy, cz, N);
      const alt = Math.max(0, d - r - BALL_R);
      tmp3.set(N[0], N[1], N[2]);
      this.shadow.position.set(sx + N[0] * 0.035, sy + N[1] * 0.035, sz + N[2] * 0.035);
      this.shadow.quaternion.setFromUnitVectors(Z, tmp3);
      // Close to the ground the shadow is small and dark; higher up it spreads, softens and pales.
      const s = BALL_R * (1.05 + Math.min(alt, 30) * 0.05);
      this.shadow.scale.set(s, s, 1);
      this.shadowMat.uniforms.uAlpha.value = (this.ghost ? 0.25 : 0.7) * Math.max(0.18, 1 - alt / 35) * fade;
      this.shadowMat.uniforms.uSoft.value = Math.min(0.75, 0.15 + alt * 0.03);
      this.shadow.visible = this.visible;
      const lp = this.line.geometry.attributes.position;
      lp.setXYZ(0, x, y, z);
      lp.setXYZ(1, sx, sy, sz);
      lp.needsUpdate = true;
      const high = this.visible && alt > 1.2;
      this.line.visible = high;
      if (high) this.line.computeLineDistances();
      this.line.material.opacity = (this.ghost ? 0.15 : 0.5) * fade * Math.min(1, (alt - 1.2) / 2);
      this.mark.visible = high && !this.ghost;
      if (this.mark.visible) {
        this.mark.position.set(sx + N[0] * 0.05, sy + N[1] * 0.05, sz + N[2] * 0.05);
        this.mark.quaternion.setFromUnitVectors(Z, tmp3);
        const ms = 1 + Math.min(alt, 25) * 0.04;
        this.mark.scale.set(ms, ms, 1);
        this.mark.material.opacity = 0.65 * fade * Math.min(1, (alt - 1.2) / 2);
      }
      this.alt = alt;
    } else {
      this.shadow.visible = false;
      this.line.visible = false;
      this.mark.visible = false;
      this.alt = 0;
    }
    this.updateTrail(x, y, z, flying);
    this.updateSpeed(x, y, z, vx, vy, vz, speed, flying, reduced);
  }

  updateTrail(x, y, z, flying) {
    const N3 = this.trailN;
    if (flying) {
      // Sample by distance so the ribbon is even at any speed.
      const last = (this.histHead - 1 + N3) % N3;
      const lx = this.hist[last * 3];
      const ly = this.hist[last * 3 + 1];
      const lz = this.hist[last * 3 + 2];
      const far = this.histN === 0 || (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2 > this.minStep * this.minStep;
      if (far) {
        this.hist[this.histHead * 3] = x;
        this.hist[this.histHead * 3 + 1] = y;
        this.hist[this.histHead * 3 + 2] = z;
        this.histHead = (this.histHead + 1) % N3;
        this.histN = Math.min(N3, this.histN + 1);
      }
    } else if (this.histN > 0) {
      this.histN = Math.max(0, this.histN - 2); // fades away behind a resting ball
    }
    const n = this.histN;
    if (n < 2 || !this.visible) {
      this.trail.visible = false;
      return;
    }
    // Ribbon facing the camera: oldest sample first, the newest (plus the ball itself) last.
    const cam = this.gfx.camera.position;
    for (let i = 0; i < N3; i++) {
      // Map ribbon vertex i onto the n samples (the head end gets the newest); i = N3 - 1 is the ball.
      const j = Math.max(0, Math.min(n - 1, i - (N3 - n)));
      const k = (this.histHead - n + j + N3) % N3;
      let px = this.hist[k * 3];
      let py = this.hist[k * 3 + 1];
      let pz = this.hist[k * 3 + 2];
      if (i === N3 - 1) {
        px = x;
        py = y;
        pz = z;
      }
      const kp = (this.histHead - n + Math.max(0, j - 1) + N3) % N3;
      tmp.set(px - this.hist[kp * 3], py - this.hist[kp * 3 + 1], pz - this.hist[kp * 3 + 2]);
      if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
      tmp.normalize();
      tmp2.set(cam.x - px, cam.y - py, cam.z - pz).normalize();
      axis.crossVectors(tmp, tmp2);
      const l = axis.length() || 1;
      const w = BALL_R * 0.62 * this.widthK * Math.pow(i / (N3 - 1), 0.7);
      const ax = (axis.x / l) * w;
      const ay = (axis.y / l) * w;
      const az = (axis.z / l) * w;
      this.trailPos[i * 6] = px + ax;
      this.trailPos[i * 6 + 1] = py + ay;
      this.trailPos[i * 6 + 2] = pz + az;
      this.trailPos[i * 6 + 3] = px - ax;
      this.trailPos[i * 6 + 4] = py - ay;
      this.trailPos[i * 6 + 5] = pz - az;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trail.visible = true;
  }

  updateSpeed(x, y, z, vx, vy, vz, speed, flying, reduced) {
    if (!this.speed) return;
    const k = flying && !reduced && this.visible ? Math.max(0, Math.min(1, (speed - 13) / 18)) : 0;
    this.speed.material.opacity = k * 0.55;
    this.speed.visible = k > 0.02;
    if (!this.speed.visible) return;
    if (++this.speedTick % 3 !== 0) return;
    tmp.set(vx / speed, vy / speed, vz / speed);
    // Two axes across the flight.
    axis.crossVectors(tmp, Math.abs(tmp.y) < 0.9 ? UP : Z).normalize();
    tmp2.crossVectors(tmp, axis);
    let s = this.speedSeed;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < this.speedN; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.55 + rnd() * 0.9;
      const back = 0.4 + rnd() * 1.6;
      const len = (0.8 + rnd() * 1.8) * (0.6 + k);
      const ox = (axis.x * Math.cos(a) + tmp2.x * Math.sin(a)) * r;
      const oy = (axis.y * Math.cos(a) + tmp2.y * Math.sin(a)) * r;
      const oz = (axis.z * Math.cos(a) + tmp2.z * Math.sin(a)) * r;
      const sx = x + ox - tmp.x * back;
      const sy = y + oy - tmp.y * back;
      const sz = z + oz - tmp.z * back;
      this.speedPos[i * 6] = sx;
      this.speedPos[i * 6 + 1] = sy;
      this.speedPos[i * 6 + 2] = sz;
      this.speedPos[i * 6 + 3] = sx - tmp.x * len;
      this.speedPos[i * 6 + 4] = sy - tmp.y * len;
      this.speedPos[i * 6 + 5] = sz - tmp.z * len;
    }
    this.speedSeed = s;
    this.speed.geometry.attributes.position.needsUpdate = true;
  }

  clearTrail() {
    this.histN = 0;
    this.trail.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    if (!v) {
      this.shadow.visible = false;
      this.line.visible = false;
      this.mark.visible = false;
      this.trail.visible = false;
      if (this.speed) this.speed.visible = false;
    }
  }

  dispose() {
    this.gfx.scene.remove(this.group, this.shadow, this.line, this.mark, this.trail);
    this.material.dispose();
    this.outline?.material.dispose();
    this.shadowMat.dispose();
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.mark.geometry.dispose();
    this.mark.material.dispose();
    this.trailGeo.dispose();
    this.trailMat.dispose();
    if (this.speed) {
      this.gfx.scene.remove(this.speed);
      this.speed.geometry.dispose();
      this.speed.material.dispose();
    }
  }
}

/** The trajectory preview: dots along the first seconds of the real simulated path, and where it first lands. */
export class PreviewDots {
  constructor(gfx, max = 120) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.fade = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('fade', new THREE.BufferAttribute(this.fade, 1));
    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(PALETTE.cream) }, uInk: { value: new THREE.Color(PALETTE.outline) }, uPx: gfx.shared.uPx } }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.landing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 32), new THREE.MeshBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    this.landing.add(ring, dot);
    this.landing.renderOrder = 6;
    this.landing.visible = false;
    gfx.scene.add(this.points, this.landing);
    this.count = 0;
  }

  /** points: flat xyz array, n dots; landing: [x,y,z,nx,ny,nz] or null. */
  set(points, n, landing) {
    const m = Math.min(n, this.max);
    for (let i = 0; i < m; i++) {
      this.pos[i * 3] = points[i * 3];
      this.pos[i * 3 + 1] = points[i * 3 + 1];
      this.pos[i * 3 + 2] = points[i * 3 + 2];
      this.fade[i] = 1 - i / Math.max(1, m);
    }
    this.geo.setDrawRange(0, m);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.fade.needsUpdate = true;
    this.points.visible = m > 0;
    if (landing) {
      this.landing.position.set(landing[0], landing[1], landing[2]);
      this.landing.quaternion.setFromUnitVectors(Z, tmp.set(landing[3], landing[4], landing[5]));
      this.landing.visible = true;
    } else this.landing.visible = false;
  }

  hide() {
    this.points.visible = false;
    this.landing.visible = false;
  }
}

export { UP };

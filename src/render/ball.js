// Ball views: the striped ball, its ribbon trail, the shadow disc projected onto the world below along gravity
// and the altitude line; ghost balls are translucent and tinted. The preview dots live here too.
import * as THREE from 'three';
import { BALL_R, centersAt, MAX_PLANETS } from '../sim/hole.js';
import { surfaceF, surfaceNormal } from '../sim/planet.js';
import { TOON_VERT, BALL_FRAG, DOT_VERT, DOT_FRAG } from './shaders.js';
import { outlineMaterial } from './planets.js';
import { PALETTE } from './gfx.js';

const C = new Float64Array(MAX_PLANETS * 3);
const N = new Float64Array(3);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const geo = new THREE.SphereGeometry(BALL_R, 28, 18);
{
  // The stripe is read from the vertex "height" (the ball's own y), so it stays put as the ball rolls visually.
  const pos = geo.attributes.position;
  const h = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    h[i] = pos.getY(i) / BALL_R;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
  }
  geo.setAttribute('height', new THREE.BufferAttribute(h, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export class BallView {
  constructor(gfx, look, ghost = false) {
    this.gfx = gfx;
    this.ghost = ghost;
    this.group = new THREE.Group();
    this.material = new THREE.ShaderMaterial({
      vertexShader: TOON_VERT,
      fragmentShader: BALL_FRAG,
      vertexColors: true,
      transparent: ghost,
      depthWrite: !ghost,
      uniforms: {
        uLight: { value: new THREE.Vector3(0.45, 0.8, 0.35) },
        uRim: { value: new THREE.Color(PALETTE.cream) },
        uStripe: { value: new THREE.Color(look.stripe ?? PALETTE.coral) },
        uAlpha: { value: ghost ? 0.45 : 1 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.setLook(look);
    this.group.add(this.mesh);
    if (!ghost) {
      this.outline = new THREE.Mesh(geo, outlineMaterial(0.035));
      this.group.add(this.outline);
    }
    this.spin = new THREE.Quaternion();
    // Shadow disc and altitude line.
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: PALETTE.outline, transparent: true, opacity: ghost ? 0.18 : 0.42, depthWrite: false }));
    this.shadow.renderOrder = 2;
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: ghost ? 0.15 : 0.35 }));
    // Trail ribbon.
    this.trailN = gfx.tier.trail;
    this.trailPos = new Float32Array(this.trailN * 2 * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.trailGeo.setIndex(idx);
    const alpha = new Float32Array(this.trailN * 2);
    for (let i = 0; i < this.trailN; i++) alpha[i * 2] = alpha[i * 2 + 1] = i / this.trailN;
    this.trailGeo.setAttribute('fade', new THREE.BufferAttribute(alpha, 1));
    this.trail = new THREE.Mesh(this.trailGeo, new THREE.MeshBasicMaterial({ color: look.trail ?? PALETTE.coral, transparent: true, opacity: ghost ? 0.25 : 0.7, side: THREE.DoubleSide, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.history = [];
    this.trailOn = false;
    this.visible = true;
    gfx.scene.add(this.group, this.shadow, this.line, this.trail);
    this.fade = 1;
  }

  setLook(look) {
    this.material.uniforms.uStripe.value.set(look.stripe ?? PALETTE.coral);
    const col = this.mesh.geometry.attributes.color;
    const c = new THREE.Color(look.body ?? PALETTE.cream);
    if (this.ghost) c.lerp(new THREE.Color(look.tint ?? PALETTE.teal), 0.5);
    this.bodyColour = c;
    this.mesh.material.uniforms.uRim.value.set(look.body ?? PALETTE.cream);
    this.mesh.material.defines = this.mesh.material.defines || {};
    this.mesh.material.uniformsNeedUpdate = true;
    // Vertex colour is shared geometry; tint through the stripe/rim and a per-mesh colour via onBeforeRender.
    this.mesh.onBeforeRender = () => {
      const a = this.mesh.geometry.attributes.color;
      if (a.array[0] !== c.r || a.array[1] !== c.g || a.array[2] !== c.b) {
        for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
        a.needsUpdate = true;
      }
    };
    if (this.trail) this.trail.material.color.set(look.trail ?? PALETTE.coral);
  }

  /** Places the ball; `vel` spins it; `hole`/`t` project the shadow. */
  update(hole, t, x, y, z, vx, vy, vz, dt, flying, fade = 1) {
    this.group.position.set(x, y, z);
    this.fade = fade;
    this.material.uniforms.uAlpha.value = (this.ghost ? 0.45 : 1) * fade;
    this.material.transparent = this.ghost || fade < 1;
    if (this.outline) this.outline.visible = fade >= 0.99;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed > 0.05 && dt > 0) {
      // Roll the ball about the axis perpendicular to its motion (visual only).
      tmp.set(vx, vy, vz).normalize();
      tmp2.set(0, 1, 0);
      const axis = new THREE.Vector3().crossVectors(tmp2, tmp).normalize();
      if (axis.lengthSq() > 0.01) {
        const q = new THREE.Quaternion().setFromAxisAngle(axis, (speed * dt) / BALL_R);
        this.spin.premultiply(q).normalize();
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
    if (best >= 0 && bestD < 60) {
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
      this.shadow.position.set(sx + N[0] * 0.03, sy + N[1] * 0.03, sz + N[2] * 0.03);
      this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmp.set(N[0], N[1], N[2]));
      const s = BALL_R * (1 + Math.min(alt, 30) * 0.045);
      this.shadow.scale.set(s, s, 1);
      this.shadow.material.opacity = (this.ghost ? 0.18 : 0.45) * Math.max(0.12, 1 - alt / 40) * fade;
      this.shadow.visible = this.visible;
      const lp = this.line.geometry.attributes.position;
      lp.setXYZ(0, x, y, z);
      lp.setXYZ(1, sx, sy, sz);
      lp.needsUpdate = true;
      this.line.visible = this.visible && alt > 0.6;
      this.line.material.opacity = (this.ghost ? 0.15 : 0.35) * fade;
      this.alt = alt;
    } else {
      this.shadow.visible = false;
      this.line.visible = false;
      this.alt = 0;
    }
    // Trail: a ribbon through the last positions, widening toward the ball.
    if (flying) {
      this.history.push(x, y, z);
      if (this.history.length > this.trailN * 3) this.history.splice(0, this.history.length - this.trailN * 3);
    } else if (this.history.length) {
      this.history.splice(0, 3); // let it fade away behind a resting ball
    }
    const n = this.history.length / 3;
    if (n >= 2) {
      const camDir = tmp2.copy(this.gfx.camera.position).sub(this.group.position).normalize();
      for (let i = 0; i < this.trailN; i++) {
        const j = Math.max(0, Math.min(n - 1, i - (this.trailN - n)));
        const px = this.history[j * 3];
        const py = this.history[j * 3 + 1];
        const pz = this.history[j * 3 + 2];
        const k = Math.max(0, j - 1);
        tmp.set(px - this.history[k * 3], py - this.history[k * 3 + 1], pz - this.history[k * 3 + 2]);
        if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(tmp.normalize(), camDir).normalize().multiplyScalar(BALL_R * 0.55 * (i / this.trailN));
        this.trailPos[i * 6] = px + side.x;
        this.trailPos[i * 6 + 1] = py + side.y;
        this.trailPos[i * 6 + 2] = pz + side.z;
        this.trailPos[i * 6 + 3] = px - side.x;
        this.trailPos[i * 6 + 4] = py - side.y;
        this.trailPos[i * 6 + 5] = pz - side.z;
      }
      this.trailGeo.attributes.position.needsUpdate = true;
      this.trail.visible = this.visible;
    } else this.trail.visible = false;
  }

  clearTrail() {
    this.history.length = 0;
    this.trail.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    if (!v) {
      this.shadow.visible = false;
      this.line.visible = false;
      this.trail.visible = false;
    }
  }

  dispose() {
    this.gfx.scene.remove(this.group, this.shadow, this.line, this.trail);
    this.material.dispose();
    this.outline?.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.trailGeo.dispose();
    this.trail.material.dispose();
  }
}

/** The trajectory preview: dots along the first seconds of the real simulated path. */
export class PreviewDots {
  constructor(gfx, max = 120) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.fade = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('fade', new THREE.BufferAttribute(this.fade, 1));
    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(PALETTE.cream) } } }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.landing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 24), new THREE.MeshBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
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
      this.landing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmp.set(landing[3], landing[4], landing[5]));
      this.landing.visible = true;
    } else this.landing.visible = false;
  }

  hide() {
    this.points.visible = false;
    this.landing.visible = false;
  }
}

export { UP };

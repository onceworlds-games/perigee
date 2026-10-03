// Particles: one pooled Points cloud for puffs on landings, sparks on bounces, glitter on a cup, a burst on a
// hole-in-one. No allocation after setup; the budget follows the quality tier.
import * as THREE from 'three';
import { PALETTE } from './gfx.js';

const VERT = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  attribute float life;
  uniform float uPx;
  varying vec3 vT;
  varying float vL;
  void main() {
    vT = tint;
    vL = life;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Sized by distance, but never a blur filling the screen when a puff is next to the camera.
    gl_PointSize = min(size * (0.4 + 0.6 * life) * (150.0 / max(-mv.z, 1.0)), 26.0) * uPx;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vT;
  varying float vL;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    vec3 col = mix(vT, vec3(1.0, 0.97, 0.9), smoothstep(0.22, 0.0, r) * 0.5);
    gl_FragColor = vec4(col, smoothstep(0.5, 0.32, r) * min(1.0, vL * 1.6));
    #include <colorspace_fragment>
  }
`;

const CACHE = new Map();
function colourOf(hex) {
  let c = CACHE.get(hex);
  if (!c) CACHE.set(hex, (c = new THREE.Color(hex)));
  return c;
}

export class Fx {
  constructor(gfx) {
    this.gfx = gfx;
    this.max = gfx.tier.particles;
    this.build();
    gfx.onEvent((what) => {
      if (what === 'quality') {
        this.gfx.scene.remove(this.points);
        this.geo.dispose();
        this.max = gfx.tier.particles;
        this.build();
      }
    });
  }

  build() {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.tint = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.decay = new Float32Array(n);
    this.grav = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.geo.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: { uPx: this.gfx.shared.uPx } }));
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
    this.next = 0;
    this.gfx.scene.add(this.points);
  }

  /** Emits `count` particles at p, scattered along n (a surface normal or the velocity) with the given colours. */
  burst(p, n, count, { colours = [PALETTE.cream], speed = 3, size = 1.6, decay = 1.6, spread = 1, pull = 0 } = {}) {
    if (!this.max) return;
    const cols = colours.map((c) => colourOf(c));
    count = Math.min(Math.round(count), this.max);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const c = cols[k % cols.length];
      this.pos[i * 3] = p[0];
      this.pos[i * 3 + 1] = p[1];
      this.pos[i * 3 + 2] = p[2];
      const rx = (Math.random() - 0.5) * spread;
      const ry = (Math.random() - 0.5) * spread;
      const rz = (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = (n[0] + rx) * s;
      this.vel[i * 3 + 1] = (n[1] + ry) * s;
      this.vel[i * 3 + 2] = (n[2] + rz) * s;
      this.grav[i * 3] = -n[0] * pull;
      this.grav[i * 3 + 1] = -n[1] * pull;
      this.grav[i * 3 + 2] = -n[2] * pull;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.tint[i * 3] = c.r;
      this.tint[i * 3 + 1] = c.g;
      this.tint[i * 3 + 2] = c.b;
      this.life[i] = 1;
      this.decay[i] = decay * (0.7 + Math.random() * 0.6);
    }
  }

  update(dt) {
    if (!this.max) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt * this.decay[i];
      if (this.life[i] < 0) this.life[i] = 0;
      this.vel[i * 3] += this.grav[i * 3] * dt;
      this.vel[i * 3 + 1] += this.grav[i * 3 + 1] * dt;
      this.vel[i * 3 + 2] += this.grav[i * 3 + 2] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.visible = any;
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.life.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
      this.geo.attributes.tint.needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
    this.points.visible = false;
  }
}

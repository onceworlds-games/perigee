// The sky: a nebula sphere, a parallax starfield in two layers and drifting dust near the worlds.
import * as THREE from 'three';
import { SKY_VERT, SKY_FRAG, STAR_VERT, STAR_FRAG } from './shaders.js';
import { PALETTE } from './gfx.js';
import { makeRng } from '../sim/rng.js';

export class Backdrop {
  constructor(gfx, seed = 1) {
    this.gfx = gfx;
    this.group = new THREE.Group();
    this.seed = seed;
    this.time = 0;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uBase: { value: new THREE.Color(PALETTE.space) },
          uA: { value: new THREE.Color(0x19524d) },
          uB: { value: new THREE.Color(0x5a2e1a) },
          uC: { value: new THREE.Color(0x4a2434) },
          uSeed: { value: (seed % 1000) * 0.37 },
        },
      }),
    );
    this.sky.renderOrder = -10;
    this.group.add(this.sky);
    this.stars = [];
    this.build(gfx.tier);
    gfx.scene.add(this.group);
  }

  build(tier) {
    for (const s of this.stars) {
      this.group.remove(s);
      s.geometry.dispose();
      s.material.dispose();
    }
    this.stars = [];
    const rng = makeRng(this.seed + 17);
    const layer = (count, radius, size, colour) => {
      const pos = new Float32Array(count * 3);
      const sz = new Float32Array(count);
      const ph = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = rng.unit();
        pos[i * 3] = u[0] * radius;
        pos[i * 3 + 1] = u[1] * radius;
        pos[i * 3 + 2] = u[2] * radius;
        sz[i] = size * (0.5 + rng.next() * rng.next() * 1.5);
        ph[i] = rng.next() * 6.28;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
      g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(colour) } },
      });
      const p = new THREE.Points(g, m);
      p.renderOrder = -9;
      this.group.add(p);
      this.stars.push(p);
      return p;
    };
    layer(Math.floor(tier.stars * 0.7), 560, 2.2, PALETTE.cream);
    layer(Math.floor(tier.stars * 0.3), 420, 1.6, PALETTE.ice);
    if (tier.dust > 0) {
      const d = layer(tier.dust, 1, 0.9, 0x9fb8a8);
      // Dust lives among the worlds (a slow drift), not on the far sphere.
      const pos = d.geometry.attributes.position.array;
      for (let i = 0; i < tier.dust; i++) {
        pos[i * 3] = (rng.next() - 0.5) * 160;
        pos[i * 3 + 1] = (rng.next() - 0.5) * 80;
        pos[i * 3 + 2] = (rng.next() - 0.5) * 160;
      }
      d.geometry.attributes.position.needsUpdate = true;
      d.material.uniforms.uScale.value = 2.5;
      this.dust = d;
    }
  }

  update(dt, cameraPos, reduced) {
    this.time += dt;
    for (const s of this.stars) s.material.uniforms.uTime.value = reduced ? 0 : this.time;
    for (const s of this.stars) s.material.uniforms.uScale.value = Math.max(1, this.gfx.height / 540) * (s === this.dust ? 2.5 : 1);
    // The far layers follow the camera (parallax comes from the two radii); dust stays put and drifts.
    for (const s of this.stars) if (s !== this.dust) s.position.copy(cameraPos);
    this.sky.position.copy(cameraPos);
    if (this.dust && !reduced) this.dust.rotation.y += dt * 0.004;
  }
}

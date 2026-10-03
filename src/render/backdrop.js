// The sky: a painted nebula and a pale sun baked into a cube once per hole (so a frame costs one texture lookup),
// a parallax starfield in two layers, a few four-point sparkles, a far ringed giant for scale and dust drifting
// among the worlds that slides past the camera.
import * as THREE from 'three';
import { SKY_VERT, SKY_FRAG, STAR_VERT, STAR_FRAG, SPARKLE_FRAG, DUST_VERT, DUST_FRAG } from './shaders.js';
import { PALETTE } from './gfx.js';
import { kindColours, atmoMaterial, discMaterial, planetGeometry, outlineMaterial } from './planets.js';
import { PLANET_VERT, PLANET_FRAG } from './shaders.js';
import { makeRng } from '../sim/rng.js';

export class Backdrop {
  constructor(gfx, seed = 1) {
    this.gfx = gfx;
    this.group = new THREE.Group();
    this.far = new THREE.Group(); // follows the camera: the sky is at infinity
    this.group.add(this.far);
    this.seed = seed;
    this.time = 0;
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uBase: { value: new THREE.Color(0x0d2621) },
        uDeep: { value: new THREE.Color(0x040c0a) },
        uA: { value: new THREE.Color(0x1d6b62) },
        uB: { value: new THREE.Color(0x8a4320) },
        uC: { value: new THREE.Color(0x7a3346) },
        uSun: gfx.shared.uSun,
        uSunCol: { value: new THREE.Color(0xfbeed2) },
        uBand: { value: new THREE.Vector3(0.2, 1, 0.1).normalize() },
        uOff: { value: new THREE.Vector3() },
      },
    });
    this.skyScene = new THREE.Scene();
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), this.skyMat);
    this.skyScene.add(this.skyMesh);
    this.cubeTarget = null;
    this.cubeCam = null;
    this.stars = [];
    this.giant = null;
    this.build(gfx.tier);
    gfx.scene.add(this.group);
    this.setSeed(seed);
    gfx.onEvent((what) => {
      if (what === 'quality') {
        this.build(gfx.tier);
        this.bake();
      } else if (what === 'restored') this.bake();
      else if (what === 'sky') this.setSeed(gfx.skySeed ?? this.seed);
    });
  }

  /** A new sky for a new hole: the nebula moves, the band tilts, the giant sits elsewhere. */
  setSeed(seed) {
    this.seed = seed;
    const rng = makeRng((seed >>> 0) + 101);
    const u = this.skyMat.uniforms;
    u.uOff.value.set(rng.range(-20, 20), rng.range(-20, 20), rng.range(-20, 20));
    const b = rng.unit();
    u.uBand.value.set(b[0] * 0.5, 1, b[2] * 0.5).normalize();
    this.placeGiant(rng);
    this.bake();
  }

  /** Renders the sky into a cube map, used as the scene's background. */
  bake() {
    const size = this.gfx.tier.sky;
    if (!this.cubeTarget || this.cubeTarget.width !== size) {
      this.cubeTarget?.dispose();
      // Half floats keep the dark gradients smooth where the GPU can render to them; bytes elsewhere.
      let half = false;
      try {
        half = !!this.gfx.renderer.extensions.has('EXT_color_buffer_float') || !!this.gfx.renderer.extensions.has('EXT_color_buffer_half_float');
      } catch {}
      this.cubeTarget = new THREE.WebGLCubeRenderTarget(size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter });
      this.cubeCam = new THREE.CubeCamera(1, 100, this.cubeTarget);
    }
    try {
      this.cubeCam.update(this.gfx.renderer, this.skyScene);
      this.gfx.scene.background = this.cubeTarget.texture;
    } catch {
      this.gfx.scene.background = new THREE.Color(PALETTE.space);
    }
  }

  placeGiant(rng) {
    if (this.giant) {
      this.gfx.dispose(this.giant);
      this.giant = null;
    }
    // A far gas giant with rings, high in the sky: the solar system around the course.
    const d = rng.unit();
    const dir = new THREE.Vector3(d[0], Math.abs(d[1]) * 0.6 + 0.25, d[2]).normalize();
    const R = 46;
    const pl = { i: 9, kind: 'gas', R, hmax: 0, gas: true, black: false, patches: [], lobes: new Float64Array(0) };
    const g = new THREE.Group();
    const k = kindColours('gas');
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      vertexColors: true,
      defines: { KIND_GAS: 1 },
      uniforms: {
        uSun: this.gfx.shared.uSun,
        uTime: this.gfx.shared.uTime,
        uPx: this.gfx.shared.uPx,
        uRim: { value: new THREE.Color(rng.next() < 0.5 ? 0xbfe3ea : 0xf7dcae) },
        uShade: { value: new THREE.Vector3(0.36, 0.42, 0.46) },
        uSpace: { value: new THREE.Color(0x0d2621) },
        uSeed: { value: rng.range(0, 50) },
        uDetail: { value: 1 },
        uFog: { value: 0 },
        uPatch: { value: [new THREE.Vector4(0, 1, 0, 2), new THREE.Vector4(0, 1, 0, 2), new THREE.Vector4(0, 1, 0, 2), new THREE.Vector4(0, 1, 0, 2)] },
        uPatchT: { value: new THREE.Vector4() },
      },
    });
    const mesh = new THREE.Mesh(planetGeometry(pl, 16), mat);
    mesh.material.uniforms.uRim.value.lerp(new THREE.Color(k.base), 0.2);
    g.add(mesh);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 40, 24), atmoMaterial(this.gfx, 0xf2b070, 1.12, 0.6, 2.0, null, R * 1.12));
    g.add(shell);
    this.giantCenter = new THREE.Vector3();
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(R * 4.4, R * 4.4), discMaterial(this.gfx, 0xf3e5c3, 0xbf6a3a, { inner: 0.6, alpha: 0.55, center: this.giantCenter, shadowR: R }));
    ring.rotation.set(-Math.PI / 2 + rng.range(0.25, 0.6), rng.range(-0.4, 0.4), rng.range(-0.3, 0.3));
    g.add(ring);
    g.position.copy(dir).multiplyScalar(520);
    this.giantDir = dir;
    g.traverse((o) => {
      o.renderOrder = -8;
      o.frustumCulled = false;
    });
    this.far.add(g);
    this.giant = g;
  }

  build(tier) {
    for (const s of this.stars) {
      this.far.remove(s);
      this.group.remove(s);
      s.geometry.dispose();
      s.material.dispose();
    }
    this.stars = [];
    this.dust = null;
    const rng = makeRng(this.seed + 17);
    const points = (count, radius, size, frag, vert = STAR_VERT) => {
      const pos = new Float32Array(count * 3);
      const sz = new Float32Array(count);
      const ph = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = rng.unit();
        pos[i * 3] = u[0] * radius;
        pos[i * 3 + 1] = u[1] * radius;
        pos[i * 3 + 2] = u[2] * radius;
        sz[i] = size * (0.45 + rng.next() * rng.next() * 1.6);
        ph[i] = rng.next() * 6.28;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
      g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(PALETTE.cream) }, uAlpha: { value: 0.5 } },
      });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = -9;
      this.stars.push(p);
      return p;
    };
    const a = points(Math.floor(tier.stars * 0.7), 900, 2.6, STAR_FRAG);
    const b = points(Math.floor(tier.stars * 0.3), 700, 1.8, STAR_FRAG);
    b.material.uniforms.uColor.value.set(PALETTE.ice);
    this.far.add(a, b);
    if (tier.sparkles) {
      const s = points(tier.sparkles, 800, 15, SPARKLE_FRAG);
      this.far.add(s);
    }
    if (tier.dust > 0) {
      const d = points(tier.dust, 1, 0.9, DUST_FRAG, DUST_VERT);
      // Dust lives among the worlds (a slow drift), not on the far sphere.
      const pos = d.geometry.attributes.position.array;
      for (let i = 0; i < tier.dust; i++) {
        pos[i * 3] = (rng.next() - 0.5) * 200;
        pos[i * 3 + 1] = (rng.next() - 0.5) * 120;
        pos[i * 3 + 2] = (rng.next() - 0.5) * 200;
      }
      d.geometry.attributes.position.needsUpdate = true;
      d.material.uniforms.uColor.value.set(0xd8e6d4);
      d.renderOrder = 6;
      this.group.add(d);
      this.dust = d;
    }
  }

  update(dt, cameraPos, reduced) {
    this.time += dt;
    const scale = Math.max(1, this.gfx.height / 540) * Math.min(2, this.gfx.shared.uPx.value);
    for (const s of this.stars) {
      s.material.uniforms.uTime.value = reduced ? 0 : this.time;
      s.material.uniforms.uScale.value = s === this.dust ? this.gfx.shared.uPx.value : scale;
    }
    // The far layers follow the camera (the sky is at infinity); dust stays among the worlds and drifts.
    this.far.position.copy(cameraPos);
    if (this.giantCenter && this.giant) this.giantCenter.copy(this.giant.position).add(this.far.position);
    if (this.giant && !reduced) this.giant.children[0].rotation.y += dt * 0.01;
  }
}

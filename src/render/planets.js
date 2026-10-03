// Planet views: a smooth, displaced icosphere built from the same heightAt the physics uses (what you see is what
// you hit), coloured by kind and height, drawn with the toon planet shader (surface detail per kind, patches as
// uniforms), a constant-width ink outline and a glowing atmosphere; gas giants wear rings, the black hole a disc.
// Boost rings, wormholes and the cup (ring, flag, beacon) live here too.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../sim/planet.js';
import { centersAt, MAX_PLANETS } from '../sim/hole.js';
import { PLANET_VERT, PLANET_FRAG, OUTLINE_VERT, OUTLINE_FRAG, SHELL_VERT, ATMO_FRAG, DISC_VERT, DISC_FRAG, BEAM_VERT, BEAM_FRAG, FLAG_VERT, FLAG_FRAG } from './shaders.js';
import { PALETTE } from './gfx.js';

// base/low/high: the height ramp; rim: the limb light; atmo: the shell (0 for none); shade: the shadow's tint.
const KIND = {
  meadow: { base: 0x7cb85a, low: 0x4c8a3c, high: 0xb2dc7c, rim: 0xb4f2dc, atmo: 0x5fd3b8, shade: [0.42, 0.52, 0.56] },
  dust: { base: 0xdb7638, low: 0xa54e1f, high: 0xf3ab6a, rim: 0xffd29c, atmo: 0xf09a5a, shade: [0.46, 0.46, 0.52] },
  ice: { base: 0xc8e7ef, low: 0x86bfd0, high: 0xf4fcfe, rim: 0xf0fcff, atmo: 0xb8eaf6, shade: [0.5, 0.6, 0.68] },
  lava: { base: 0x45302e, low: 0x2a1b1a, high: 0x664642, rim: 0xff8a50, atmo: 0xe0602a, shade: [0.55, 0.45, 0.45] },
  moss: { base: 0x3b7d5a, low: 0x24553d, high: 0x62ad7c, rim: 0x9be8cf, atmo: 0x3fb39a, shade: [0.42, 0.52, 0.56] },
  metal: { base: 0x9ba4a9, low: 0x687276, high: 0xccd3d6, rim: 0xf3e5c3, atmo: 0, shade: [0.44, 0.5, 0.56] },
  comet: { base: 0xe6eff1, low: 0xa9bfc6, high: 0xffffff, rim: 0xd8f6ff, atmo: 0xbfe9f5, shade: [0.5, 0.6, 0.68] },
  gas: { base: 0xd99550, low: 0xc0773a, high: 0xf0c48c, rim: 0xf7dcae, atmo: 0xf2b070, shade: [0.5, 0.48, 0.52] },
  hole: { base: 0x040807, low: 0x000000, high: 0x0b1f1a, rim: 0xf06a5c, atmo: 0, shade: [1, 1, 1] },
};
const PATCH_TYPE = { lava: 1, ice: 2, pad: 3, tar: 4 };

export function kindColours(kind) {
  return KIND[kind] ?? KIND.dust;
}

// One indexed unit icosphere per subdivision level, shared by every planet built at that level.
const SPHERES = new Map();
function unitSphere(detail) {
  let g = SPHERES.get(detail);
  if (!g) {
    const ico = new THREE.IcosahedronGeometry(1, detail);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    g = mergeVertices(ico, 1e-5);
    ico.dispose();
    SPHERES.set(detail, g);
  }
  return g;
}

/** Builds the displaced, coloured geometry of a planet (the same surface the ball rolls on), smooth-shaded. */
export function planetGeometry(pl, detail) {
  const src = unitSphere(detail);
  const g = new THREE.BufferGeometry();
  const pos = src.attributes.position.array.slice();
  g.setIndex(src.index.clone());
  const n = pos.length / 3;
  const colours = new Float32Array(n * 3);
  const heights = new Float32Array(n);
  const k = kindColours(pl.kind);
  const base = new THREE.Color(k.base);
  const low = new THREE.Color(k.low);
  const high = new THREE.Color(k.high);
  const c = new THREE.Color();
  const span = Math.max(0.06, pl.hmax);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    const dx = x / l;
    const dy = y / l;
    const dz = z / l;
    const h = pl.gas || pl.black ? 0 : heightAt(pl, dx, dy, dz);
    const r = pl.R * (1 + h);
    pos[i * 3] = dx * r;
    pos[i * 3 + 1] = dy * r;
    pos[i * 3 + 2] = dz * r;
    heights[i] = h;
    // Valleys dark, crests light.
    const t = Math.max(0, Math.min(1, (h + span * 0.5) / (span * 1.5)));
    c.copy(low).lerp(base, Math.min(1, t * 2)).lerp(high, Math.max(0, t * 2 - 1) * 0.8);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('height', new THREE.BufferAttribute(heights, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function planetMaterial(gfx, pl, seed) {
  const k = kindColours(pl.kind);
  const patches = [];
  const types = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const p = pl.patches[i];
    patches.push(p ? new THREE.Vector4(p.ux, p.uy, p.uz, p.cos) : new THREE.Vector4(0, 1, 0, 2));
    if (p) types[i] = PATCH_TYPE[p.type] ?? 0;
  }
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    vertexColors: true,
    defines: { [`KIND_${pl.kind.toUpperCase()}`]: 1 },
    uniforms: {
      uSun: gfx.shared.uSun,
      uTime: gfx.shared.uTime,
      uPx: gfx.shared.uPx,
      uRim: { value: new THREE.Color(k.rim) },
      uShade: { value: new THREE.Vector3(...k.shade) },
      uSpace: { value: new THREE.Color(PALETTE.space) },
      uSeed: { value: (seed % 97) * 1.37 + pl.i * 5.1 },
      uDetail: { value: gfx.tier.shading },
      uFog: { value: 1 },
      uPatch: { value: patches },
      uPatchT: { value: new THREE.Vector4(...types) },
    },
  });
}

export function outlineMaterial(gfx, width, colour = PALETTE.outline) {
  return new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    transparent: false,
    uniforms: { uWidth: { value: width }, uPx: gfx.shared.uPx, uRes: gfx.shared.uRes, uColor: { value: new THREE.Color(colour) }, uAlpha: { value: 1 } },
  });
}

export function atmoMaterial(gfx, colour, scale, strength = 0.9, power = 2.2, center = null, shellR = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    uniforms: {
      uColor: { value: new THREE.Color(colour) },
      uSun: gfx.shared.uSun,
      uStrength: { value: strength },
      uFmax: { value: Math.sqrt(Math.max(0.05, 1 - 1 / (scale * scale))) },
      uPower: { value: power },
      uCenter: { value: center ?? new THREE.Vector3(0, 0, -1e5) },
      uShellR: { value: shellR },
    },
  });
}

export function discMaterial(gfx, a, b, { inner = 0.6, spin = 0, alpha = 0.85, center = null, shadowR = 0, additive = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uInner: { value: inner },
      uTime: gfx.shared.uTime,
      uSpin: { value: spin },
      uAlpha: { value: alpha },
      uCenter: { value: center ?? new THREE.Vector3() },
      uShadowR: { value: shadowR },
      uSun: gfx.shared.uSun,
    },
  });
}

export class PlanetView {
  constructor(gfx, hole, pl, seed) {
    this.pl = pl;
    this.group = new THREE.Group();
    const k = kindColours(pl.kind);
    const tier = gfx.tier;
    const detail = pl.kind === 'comet' || pl.R < 3 ? Math.max(5, Math.round(tier.small * 0.6)) : pl.R < 6.5 ? tier.small : tier.detail;
    const geo = planetGeometry(pl, detail);
    this.material = planetMaterial(gfx, pl, seed);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.group.add(this.mesh);
    if (!pl.black) {
      this.outline = new THREE.Mesh(geo, outlineMaterial(gfx, tier.outline));
      this.outline.userData.sharedGeometry = true;
      this.group.add(this.outline);
    }
    if (k.atmo && !pl.black) {
      // Gas giants: the shell is the drag zone (1.35 R), so the glow shows where a ball slows.
      const scale = pl.gas ? 1.35 : pl.kind === 'comet' ? 1.25 : 1.09;
      const shellR = pl.R * (pl.gas ? 1 : 1 + pl.hmax) * scale;
      this.center = new THREE.Vector3();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(shellR, 48, 32), atmoMaterial(gfx, k.atmo, shellR / pl.R, pl.gas ? 0.8 : pl.kind === 'dust' || pl.kind === 'lava' ? 0.45 : 0.7, pl.gas ? 2.2 : 3.6, this.center, shellR));
      shell.renderOrder = 3;
      this.group.add(shell);
      this.shell = shell;
    }
    if (pl.gas) {
      // A ring system, tilted, in the planet's own colours (decoration: the ring has no body).
      this.ringCenter = new THREE.Vector3();
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(pl.R * 4.6, pl.R * 4.6), discMaterial(gfx, 0xf3e5c3, 0xd86a2a, { inner: 0.62, alpha: 0.8, center: this.ringCenter, shadowR: pl.R }));
      ring.rotation.set(-Math.PI / 2 + 0.28, 0.35, 0.15);
      ring.renderOrder = 4;
      this.group.add(ring);
      this.ring = ring;
    }
    if (pl.black) {
      // A dark heart, a hot accretion disc and a coral glow.
      this.discCenter = new THREE.Vector3();
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(pl.R * 7, pl.R * 7), discMaterial(gfx, 0xf06a5c, 0xf3c080, { inner: 0.36, spin: 1.4, alpha: 0.95, additive: true }));
      disc.rotation.set(-Math.PI / 2 + 0.5, 0, 0.3);
      this.group.add(disc);
      this.disc = disc;
      this.center = new THREE.Vector3();
      const glow = new THREE.Mesh(new THREE.SphereGeometry(pl.R * 1.9, 32, 20), atmoMaterial(gfx, PALETTE.coral, 1.9, 1.2, 1.4, this.center, pl.R * 1.9));
      glow.renderOrder = 3;
      this.group.add(glow);
    }
    this.group.position.set(pl.c[0], pl.c[1], pl.c[2]);
  }

  update(time, cx, cy, cz) {
    this.group.position.set(cx, cy, cz);
    if (this.ringCenter) this.ringCenter.set(cx, cy, cz);
    if (this.center) this.center.set(cx, cy, cz);
  }
}

/** All the views of a hole: planets, rings, portals and the cup. */
export class HoleView {
  constructor(gfx, hole, seed = 1) {
    this.gfx = gfx;
    this.hole = hole;
    this.group = new THREE.Group();
    this.planets = hole.planets.map((pl) => {
      const v = new PlanetView(gfx, hole, pl, seed);
      this.group.add(v.group);
      return v;
    });
    this.centers = new Float64Array(MAX_PLANETS * 3);
    this.rings = hole.rings.map((r) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.2, 12, 48), new THREE.MeshBasicMaterial({ color: PALETTE.teal }));
      const inner = new THREE.Mesh(new THREE.TorusGeometry(r.r * 0.82, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(r.r * 2.9, r.r * 2.9), discMaterial(gfx, 0x2a8f8a, 0xbfe3ea, { inner: 0.55, spin: 2.5, alpha: 0.55, additive: true }));
      // Chevrons point the way the ring pushes.
      for (let i = 0; i < 4; i++) {
        const ch = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 3), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ch.position.set(Math.cos(a) * r.r, Math.sin(a) * r.r, 0);
        ch.rotation.x = Math.PI / 2;
        g.add(ch);
      }
      g.add(m, inner, glow);
      g.position.set(r.x, r.y, r.z);
      g.lookAt(r.x + r.ax, r.y + r.ay, r.z + r.az);
      this.group.add(g);
      return g;
    });
    this.worms = [];
    for (const w of hole.worms) {
      for (const [end, col, col2] of [[w.a, PALETTE.coral, 0xf3c080], [w.b, PALETTE.teal, 0xbfe3ea]]) {
        const g = new THREE.Group();
        const swirl = new THREE.Mesh(new THREE.PlaneGeometry(w.r * 2.2, w.r * 2.2), discMaterial(gfx, col, col2, { inner: 0.0, spin: 3.0, alpha: 0.9, additive: true }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(w.r, 0.16, 10, 48), new THREE.MeshBasicMaterial({ color: col }));
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(w.r * 1.12, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
        g.add(swirl, ring, ring2);
        g.position.set(end.x, end.y, end.z);
        g.lookAt(end.x + end.ax, end.y + end.ay, end.z + end.az);
        this.group.add(g);
        this.worms.push(g);
      }
    }
    this.cup = this.buildCup();
    this.group.add(this.cup);
    gfx.scene.add(this.group);
    this.camPos = new THREE.Vector3();
  }

  buildCup() {
    const gfx = this.gfx;
    const r = this.hole.cup.r;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.08, 10, 40), new THREE.MeshBasicMaterial({ color: PALETTE.coral }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r + 0.12, 0.035, 6, 40), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.02;
    const dark = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 32), new THREE.MeshBasicMaterial({ color: 0x020605 }));
    dark.rotation.x = -Math.PI / 2;
    dark.position.y = 0.025;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(r * 5, r * 5), discMaterial(gfx, PALETTE.coral, 0xf3c080, { inner: 0.22, alpha: 0.5, additive: true }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
    pole.position.set(r * 0.92, 1.3, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
    knob.position.set(r * 0.92, 2.62, 0);
    this.flagMat = new THREE.ShaderMaterial({ vertexShader: FLAG_VERT, fragmentShader: FLAG_FRAG, side: THREE.DoubleSide, uniforms: { uTime: gfx.shared.uTime, uColor: { value: new THREE.Color(PALETTE.coral) } } });
    const flagGeo = new THREE.PlaneGeometry(1.0, 0.6, 10, 1);
    flagGeo.translate(0.5, 0, 0);
    const flag = new THREE.Mesh(flagGeo, this.flagMat);
    flag.position.set(r * 0.92 + 0.02, 2.22, 0);
    this.flag = flag;
    // The beacon: seen from across the system, gone when the camera is close.
    this.beamMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(0xf6b48c) }, uAlpha: { value: 0.45 }, uTime: gfx.shared.uTime } });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 14, 10, 1, true), this.beamMat);
    beam.position.y = 7;
    this.beam = beam;
    g.add(dark, glow, ring, lip, pole, knob, flag, beam);
    return g;
  }

  setFlagColour(hex) {
    this.flagMat.uniforms.uColor.value.set(hex);
  }

  /** Moves everything on rails to time t and animates what spins. */
  update(t, dt, reduced) {
    const c = centersAt(this.hole, t, this.centers);
    for (let i = 0; i < this.planets.length; i++) this.planets[i].update(t, c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
    const cp = this.hole.cup;
    if (cp.p >= 0) {
      this.cup.position.set(c[cp.p * 3] + cp.dx * cp.radial, c[cp.p * 3 + 1] + cp.dy * cp.radial, c[cp.p * 3 + 2] + cp.dz * cp.radial);
      this.cup.quaternion.setFromUnitVectors(UP, NV.set(cp.dx, cp.dy, cp.dz));
      // The beacon fades out as the camera comes close (it would only be in the way of a putt).
      const d = this.camPos.copy(this.gfx.camera.position).distanceTo(this.cup.position);
      this.beamMat.uniforms.uAlpha.value = Math.max(0, Math.min(0.55, (d - 22) / 30));
      this.beam.visible = d > 22;
    }
    if (!reduced) {
      for (const r of this.rings) r.rotation.z = t * 0.6;
      for (const w of this.worms) w.rotation.z = t * 0.8;
    }
    this.time = t;
  }

  dispose() {
    this.gfx.dispose(this.group);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const NV = new THREE.Vector3();

// Planet views: a displaced icosphere built from the same heightAt the physics uses, vertex colours by kind,
// height and patch, a toon material, an inverted-hull outline and an atmosphere shell; rings, portals, the cup.
import * as THREE from 'three';
import { heightAt, patchAt } from '../sim/planet.js';
import { centersAt, MAX_PLANETS } from '../sim/hole.js';
import { TOON_VERT, TOON_FRAG, OUTLINE_VERT, OUTLINE_FRAG, ATMO_VERT, ATMO_FRAG, GAS_FRAG } from './shaders.js';
import { PALETTE } from './gfx.js';
import { makeRng } from '../sim/rng.js';

const KIND = {
  meadow: { base: 0x6fae4e, low: 0x4f8f3e, high: 0x9ccd6a, rim: 0xf3e5c3, atmo: 0x7fd8c8, gloss: 0 },
  dust: { base: 0xd86a2a, low: 0xa04a1e, high: 0xf0a060, rim: 0xffd9a8, atmo: 0xf0a060, gloss: 0 },
  ice: { base: 0xbfe3ea, low: 0x7fbdcc, high: 0xeaf7fa, rim: 0xffffff, atmo: 0xbfe3ea, gloss: 0.6 },
  lava: { base: 0x3a2a2c, low: 0x24181a, high: 0x5a4042, rim: 0xff8a50, atmo: 0xd86a2a, gloss: 0, glow: 1 },
  moss: { base: 0x2f6b4f, low: 0x1f4a36, high: 0x4e9a6a, rim: 0xbfe3ea, atmo: 0x2a8f8a, gloss: 0 },
  metal: { base: 0x8a949a, low: 0x5c666c, high: 0xc0c8cc, rim: 0xf3e5c3, atmo: 0, gloss: 0.5 },
  comet: { base: 0xdfe9ec, low: 0x9fb8c0, high: 0xffffff, rim: 0xbfe3ea, atmo: 0xbfe3ea, gloss: 0.3 },
  gas: { base: 0xd9924a, low: 0xb86a2c, high: 0xf3c080, rim: 0xffd9a8, atmo: 0xf0a060, gloss: 0 },
  hole: { base: 0x050807, low: 0x000000, high: 0x0b1f1a, rim: 0xf06a5c, atmo: 0, gloss: 0 },
};
const PATCH = { lava: 0xff5a2a, ice: 0xdcf4f8, pad: 0xf06a5c, tar: 0x14100f };

export function kindColours(kind) {
  return KIND[kind] ?? KIND.dust;
}

function toonMaterial(k, frag = TOON_FRAG) {
  return new THREE.ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: frag,
    vertexColors: true,
    uniforms: {
      uLight: { value: new THREE.Vector3(0.45, 0.8, 0.35) },
      uRim: { value: new THREE.Color(k.rim) },
      uTime: { value: 0 },
      uGlow: { value: k.glow ?? 0 },
      uGloss: { value: k.gloss ?? 0 },
      uColor2: { value: new THREE.Color(0xf3c080) },
    },
  });
}

export function outlineMaterial(width, colour = PALETTE.outline) {
  return new THREE.ShaderMaterial({ vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG, side: THREE.BackSide, uniforms: { uWidth: { value: width }, uColor: { value: new THREE.Color(colour) } } });
}

export function atmoMaterial(colour, power = 3, strength = 0.6) {
  return new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, uniforms: { uColor: { value: new THREE.Color(colour) }, uPower: { value: power }, uStrength: { value: strength } } });
}

/** Builds the displaced, coloured geometry of a planet (the same surface the ball rolls on). */
export function planetGeometry(pl, detail, seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const n = pos.count;
  const colours = new Float32Array(n * 3);
  const heights = new Float32Array(n);
  const k = kindColours(pl.kind);
  const base = new THREE.Color(k.base);
  const low = new THREE.Color(k.low);
  const high = new THREE.Color(k.high);
  const rng = makeRng(seed);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    const dx = x / l;
    const dy = y / l;
    const dz = z / l;
    const h = pl.gas || pl.black ? 0 : heightAt(pl, dx, dy, dz);
    const r = pl.R * (1 + h);
    pos.setXYZ(i, dx * r, dy * r, dz * r);
    heights[i] = pl.gas ? dy : h;
    // Colour by height: valleys dark, crests light, with a little speckle so flat faces are not flat colour.
    const t = Math.max(0, Math.min(1, (h + 0.1) / 0.28));
    c.copy(low).lerp(base, Math.min(1, t * 2)).lerp(high, Math.max(0, t * 2 - 1));
    const speck = (rng.next() - 0.5) * 0.06;
    c.r += speck;
    c.g += speck;
    c.b += speck;
    if (pl.patches.length) {
      const p = patchAt(pl, dx, dy, dz);
      if (p) {
        const pc = new THREE.Color(PATCH[p.type] ?? 0xffffff);
        // A soft edge: blend by how deep inside the patch the vertex is.
        const depth = (dx * p.ux + dy * p.uy + dz * p.uz - p.cos) / (1 - p.cos);
        c.lerp(pc, Math.min(1, 0.35 + depth * 3));
        if (p.type === 'pad') {
          const stripe = Math.floor(depth * 12) % 2 === 0 ? 0.85 : 1.15;
          c.multiplyScalar(stripe);
        }
      }
    }
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('height', new THREE.BufferAttribute(heights, 1));
  g.computeVertexNormals();
  return g;
}

export class PlanetView {
  constructor(hole, pl, tier, seed) {
    this.pl = pl;
    this.group = new THREE.Group();
    const k = kindColours(pl.kind);
    const detail = pl.R < 3 ? Math.max(2, tier.detail - 2) : pl.R < 6 ? Math.max(2, tier.detail - 1) : tier.detail;
    const geo = planetGeometry(pl, detail, seed + pl.i * 31);
    this.material = toonMaterial(k, pl.gas ? GAS_FRAG : TOON_FRAG);
    if (pl.gas) {
      this.material.uniforms.uColor2.value = new THREE.Color(k.high);
      this.material.uniforms.uLight.value = new THREE.Vector3(0.45, 0.8, 0.35);
    }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.group.add(this.mesh);
    if (!pl.black) {
      this.outline = new THREE.Mesh(geo, outlineMaterial(Math.max(0.05, pl.R * 0.012)));
      this.group.add(this.outline);
    }
    if (k.atmo && !pl.black) {
      const scale = pl.gas ? 1.3 : pl.atmo ? 1.28 : 1.12;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(pl.R * (1 + pl.hmax) * scale, 32, 20), atmoMaterial(k.atmo, pl.gas ? 2.2 : 3.2, pl.gas ? 0.75 : 0.45));
      this.group.add(shell);
      this.shell = shell;
    }
    if (pl.black) {
      // A dark heart with an accretion ring and a hot rim.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(pl.R * 2.2, pl.R * 0.35, 8, 48), new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2.4;
      this.group.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(pl.R * 3.1, pl.R * 0.12, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.6 }));
      ring2.rotation.x = Math.PI / 2.4;
      this.group.add(ring2);
      this.rings = [ring, ring2];
      const glow = new THREE.Mesh(new THREE.SphereGeometry(pl.R * 1.6, 24, 16), atmoMaterial(PALETTE.coral, 1.6, 0.9));
      this.group.add(glow);
    }
    this.group.position.set(pl.c[0], pl.c[1], pl.c[2]);
  }

  update(time, cx, cy, cz, reduced) {
    this.group.position.set(cx, cy, cz);
    this.material.uniforms.uTime.value = reduced ? 0 : time;
    if (this.rings && !reduced) {
      this.rings[0].rotation.z = time * 0.4;
      this.rings[1].rotation.z = -time * 0.25;
    }
  }
}

/** All the views of a hole: planets, rings, portals and the cup. */
export class HoleView {
  constructor(gfx, hole, seed = 1) {
    this.gfx = gfx;
    this.hole = hole;
    this.group = new THREE.Group();
    this.planets = hole.planets.map((pl) => {
      const v = new PlanetView(hole, pl, gfx.tier, seed);
      this.group.add(v.group);
      return v;
    });
    this.centers = new Float64Array(MAX_PLANETS * 3);
    this.rings = hole.rings.map((r) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.22, 10, 40), new THREE.MeshBasicMaterial({ color: PALETTE.teal }));
      const inner = new THREE.Mesh(new THREE.TorusGeometry(r.r * 0.8, 0.07, 6, 40), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
      const g = new THREE.Group();
      g.add(m, inner);
      g.position.set(r.x, r.y, r.z);
      g.lookAt(r.x + r.ax, r.y + r.ay, r.z + r.az);
      this.group.add(g);
      return g;
    });
    this.worms = [];
    for (const w of hole.worms) {
      for (const [end, col] of [[w.a, PALETTE.coral], [w.b, PALETTE.teal]]) {
        const g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.SphereGeometry(w.r * 0.8, 20, 14), atmoMaterial(col, 1.4, 1.2));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(w.r, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: col }));
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(w.r * 0.7, 0.1, 6, 40), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
        ring2.rotation.x = Math.PI / 2;
        g.add(disc, ring, ring2);
        g.position.set(end.x, end.y, end.z);
        this.group.add(g);
        this.worms.push(g);
      }
    }
    this.cup = this.buildCup();
    this.group.add(this.cup);
    gfx.scene.add(this.group);
  }

  buildCup() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.hole.cup.r, 0.09, 8, 36), new THREE.MeshBasicMaterial({ color: PALETTE.coral }));
    ring.rotation.x = Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.RingGeometry(this.hole.cup.r * 0.6, this.hole.cup.r * 1.8, 36), new THREE.MeshBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    const dark = new THREE.Mesh(new THREE.CircleGeometry(this.hole.cup.r * 0.85, 24), new THREE.MeshBasicMaterial({ color: PALETTE.outline }));
    dark.rotation.x = -Math.PI / 2;
    dark.position.y = 0.02;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.4, 6), new THREE.MeshBasicMaterial({ color: PALETTE.cream }));
    pole.position.set(this.hole.cup.r * 0.9, 1.2, 0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: PALETTE.coral, side: THREE.DoubleSide }));
    flag.position.set(this.hole.cup.r * 0.9 + 0.47, 2.1, 0);
    this.flag = flag;
    g.add(ring, glow, dark, pole, flag);
    return g;
  }

  setFlagColour(hex) {
    this.flag.material.color.set(hex);
  }

  /** Moves everything on rails to time t and animates what glows. */
  update(t, dt, reduced) {
    const c = centersAt(this.hole, t, this.centers);
    for (let i = 0; i < this.planets.length; i++) this.planets[i].update(t, c[i * 3], c[i * 3 + 1], c[i * 3 + 2], reduced);
    const cp = this.hole.cup;
    if (cp.p >= 0) {
      this.cup.position.set(c[cp.p * 3] + cp.dx * cp.radial, c[cp.p * 3 + 1] + cp.dy * cp.radial, c[cp.p * 3 + 2] + cp.dz * cp.radial);
      this.cup.quaternion.setFromUnitVectors(UP, new THREE.Vector3(cp.dx, cp.dy, cp.dz));
      this.cup.rotateY(reduced ? 0 : t * 0.15);
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

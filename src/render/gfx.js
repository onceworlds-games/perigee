// The renderer: canvas, scene, camera, resize, quality tiers, context loss, a pause when hidden, the uniforms every
// material shares (the sun, the clock, the pixel ratio) and the print overlay (vignette and paper grain).
import * as THREE from 'three';
import { settings } from '../game/platform.js';

export const PALETTE = {
  space: 0x0b1f1a,
  deep: 0x050f0d,
  cream: 0xf3e5c3,
  orange: 0xd86a2a,
  teal: 0x2a8f8a,
  coral: 0xf06a5c,
  ice: 0xbfe3ea,
  outline: 0x10201b,
  rose: 0xd97a8a,
};

// `?quality=low|medium|high` pins the tier (store art and look checks on a real GPU).
const FORCED = (() => {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    return ['low', 'medium', 'high'].includes(q) ? q : null;
  } catch {
    return null;
  }
})();

// detail/small: icosphere subdivisions for big and small worlds; shading: 0 flat bands, 1 one layer of surface
// detail, 2 all of it; sky: the baked sky's cube face size.
export const QUALITY = {
  low: { detail: 10, small: 7, shading: 0, stars: 900, sparkles: 0, particles: 60, trail: 36, maxRatio: 1.25, dust: 0, sky: 128, outline: 1.4, speedLines: 0 },
  medium: { detail: 20, small: 13, shading: 1, stars: 1800, sparkles: 14, particles: 200, trail: 48, maxRatio: 1.75, dust: 180, sky: 256, outline: 1.5, speedLines: 8 },
  high: { detail: 30, small: 20, shading: 2, stars: 2800, sparkles: 26, particles: 400, trail: 64, maxRatio: 2, dust: 420, sky: 512, outline: 1.6, speedLines: 12 },
};

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(PALETTE.space, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
    this.camera.position.set(0, 10, 30);
    // One sun for the whole system: every material reads these uniforms by reference.
    this.shared = {
      uSun: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
      uTime: { value: 0 },
      uPx: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
    };
    this.lightDir = this.shared.uSun.value;
    this.quality = 'high';
    this.tier = QUALITY.high;
    this.lost = false;
    this.width = 1;
    this.height = 1;
    this.listeners = [];
    this.frameMs = 16;
    this.autoLevel = 2; // 0 low, 1 medium, 2 high: the game's own governor when the player chose Auto
    this.slowFrames = 0;
    this.fastFrames = 0;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      for (const fn of this.listeners) fn('restored');
    });
    this.overlay = makeOverlay();
    this.applyQuality();
    this.resize();
    settings.onChange(() => this.applyQuality());
  }

  onEvent(fn) {
    this.listeners.push(fn);
  }

  /** A new sky for a hole: where the sun is and the seed that paints the nebula. */
  setSky(x, y, z, seed) {
    const s = this.shared.uSun.value;
    const l = Math.sqrt(x * x + y * y + z * z);
    if (!(l > 1e-6)) return;
    if (seed === this.skySeed && Math.abs(s.x - x / l) + Math.abs(s.y - y / l) + Math.abs(s.z - z / l) < 1e-4) return;
    s.set(x / l, y / l, z / l);
    this.skySeed = seed;
    for (const fn of this.listeners) fn('sky');
  }

  /** The quality to draw at: the player's fixed choice, or the governor's level under Auto. */
  applyQuality() {
    const choice = FORCED ?? settings.choice;
    let q = choice === 'auto' ? ['low', 'medium', 'high'][this.autoLevel] : choice;
    if (!QUALITY[q]) q = 'high';
    if (q !== this.quality) {
      this.quality = q;
      this.tier = QUALITY[q];
      for (const fn of this.listeners) fn('quality');
    }
    if (this.overlay) this.overlay.classList.toggle('grain', q !== 'low');
    this.resize();
  }

  /** Measures frame time; steps the governor down when frames are slow and back up carefully. */
  govern(dtMs) {
    if ((FORCED ?? settings.choice) !== 'auto') return;
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    if (this.frameMs > 30) {
      // A slow device steps down within about a second of slow frames; it steps back up only after 20 calm seconds.
      if (++this.slowFrames > 45 && this.autoLevel > 0) {
        this.autoLevel--;
        this.slowFrames = 0;
        this.fastFrames = 0;
        this.applyQuality();
      }
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (this.frameMs < 14 && ++this.fastFrames > 1200 && this.autoLevel < 2) {
        this.autoLevel++;
        this.fastFrames = 0;
        this.applyQuality();
      }
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const ratio = Math.min(settings.pixelRatio(2), this.tier.maxRatio);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.shared.uPx.value = ratio;
    this.shared.uRes.value.set(Math.max(1, Math.floor(w * ratio)), Math.max(1, Math.floor(h * ratio)));
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 55; // portrait phones see a little more
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.lost) return;
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(obj) {
    obj.traverse?.((o) => {
      if (!o.userData?.sharedGeometry) o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
    obj.parent?.remove(obj);
  }
}

/** The print overlay: a vignette and a fine paper grain over the canvas (CSS, so it costs the GPU nothing). */
function makeOverlay() {
  try {
    const el = document.createElement('div');
    el.className = 'print';
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    el.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
    const game = document.getElementById('game');
    game?.after(el);
    return el;
  } catch {
    return null;
  }
}

export function color(hex) {
  return new THREE.Color(hex);
}

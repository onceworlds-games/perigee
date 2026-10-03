// The renderer: canvas, scene, camera, resize, quality tiers, context loss, a pause when hidden.
import * as THREE from 'three';
import { settings } from '../game/platform.js';

export const PALETTE = {
  space: 0x0b1f1a,
  cream: 0xf3e5c3,
  orange: 0xd86a2a,
  teal: 0x2a8f8a,
  coral: 0xf06a5c,
  ice: 0xbfe3ea,
  outline: 0x11201c,
  rose: 0xd97a8a,
};

export const QUALITY = {
  low: { detail: 4, stars: 900, particles: 60, trail: 24, maxRatio: 1.25, dust: 0 },
  medium: { detail: 5, stars: 1800, particles: 200, trail: 40, maxRatio: 2, dust: 150 },
  high: { detail: 5, stars: 3000, particles: 400, trail: 64, maxRatio: 2, dust: 400 },
};

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(PALETTE.space, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
    this.camera.position.set(0, 10, 30);
    this.lightDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
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
    this.applyQuality();
    this.resize();
    settings.onChange(() => this.applyQuality());
  }

  onEvent(fn) {
    this.listeners.push(fn);
  }

  /** The quality to draw at: the player's fixed choice, or the governor's level under Auto. */
  applyQuality() {
    const choice = settings.choice;
    let q = choice === 'auto' ? ['low', 'medium', 'high'][this.autoLevel] : choice;
    if (!QUALITY[q]) q = 'high';
    if (q !== this.quality) {
      this.quality = q;
      this.tier = QUALITY[q];
      for (const fn of this.listeners) fn('quality');
    }
    this.resize();
  }

  /** Measures frame time; steps the governor down when frames are slow and back up carefully. */
  govern(dtMs) {
    if (settings.choice !== 'auto') return;
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    if (this.frameMs > 30) {
      if (++this.slowFrames > 90 && this.autoLevel > 0) {
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
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
    obj.parent?.remove(obj);
  }
}

export function color(hex) {
  return new THREE.Color(hex);
}

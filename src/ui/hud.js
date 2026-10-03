// The canvas HUD: the power ring around the ball, the hole clock, distance and height, drawn crisp at any
// pixel ratio and kept out of the platform's corner and the touch corners.
import { settings } from '../game/platform.js';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.ratio = 1;
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const r = settings.pixelRatio(2);
    this.w = w;
    this.h = h;
    this.ratio = r;
    this.canvas.width = Math.floor(w * r);
    this.canvas.height = Math.floor(h * r);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
  }

  /**
   * One frame. s: { ballX, ballY (screen px, or null), charge (0..1 or -1 when not charging), aiming, timer
   * (seconds left or -1), urgent, dist (m), alt (m), touch, safeTop, strokes, par, state }
   */
  draw(s) {
    this.clear();
    const c = this.ctx;
    c.font = '700 15px Jost, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineCap = 'round';
    if (s.ballX !== null && s.aiming) {
      const r = s.ballR ?? 44;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(243, 229, 195, 0.35)';
      c.beginPath();
      c.arc(s.ballX, s.ballY, r, 0, Math.PI * 2);
      c.stroke();
      // The loft, beside the ring: tilt the camera to change it.
      if (s.loft !== undefined) {
        c.font = '700 14px Jost, sans-serif';
        c.textAlign = 'left';
        c.fillStyle = 'rgba(243, 229, 195, 0.9)';
        c.shadowColor = '#11201c';
        c.shadowOffsetY = 2;
        c.fillText(`${s.loft}°`, s.ballX + r + 8, s.ballY);
        c.shadowOffsetY = 0;
        c.textAlign = 'center';
      }
      if (s.charge >= 0) {
        const a0 = -Math.PI / 2;
        const a1 = a0 + Math.PI * 2 * s.charge;
        c.lineWidth = 9;
        c.strokeStyle = s.charge > 0.85 ? '#f06a5c' : s.charge > 0.5 ? '#d86a2a' : '#2a8f8a';
        c.beginPath();
        c.arc(s.ballX, s.ballY, r, a0, a1);
        c.stroke();
        c.fillStyle = '#f3e5c3';
        c.font = '700 18px Righteous, Jost, sans-serif';
        c.fillText(`${Math.round(s.charge * 100)}`, s.ballX, s.ballY - r - 18);
      }
    }
    // Strokes: a big number at the top right, out of the platform's corner.
    if (s.strokes !== undefined && s.state !== 'watch') {
      const x = this.w - 18 - (s.touch ? 0 : 0);
      const y = s.safeTop + 30;
      c.textAlign = 'right';
      c.fillStyle = '#f3e5c3';
      c.font = '400 34px Righteous, Jost, sans-serif';
      c.shadowColor = '#11201c';
      c.shadowOffsetY = 3;
      c.fillText(`${s.strokes}`, x, y);
      c.shadowOffsetY = 0;
      c.font = '700 12px Jost, sans-serif';
      c.fillStyle = 'rgba(243, 229, 195, 0.8)';
      c.fillText(s.strokes === 1 ? 'STROKE' : 'STROKES', x, y + 24);
      c.textAlign = 'center';
    }
    // The hole clock and the distance line sit under the hole name: centred, or right of the platform's
    // buttons on a narrow screen.
    // On a narrow screen everything here sits left-aligned beside the platform's buttons, under the hole name.
    const narrow = this.w < 560;
    const cx = narrow ? 148 : this.w / 2;
    c.textAlign = narrow ? 'left' : 'center';
    if (s.timer >= 0) {
      const t = Math.ceil(s.timer);
      c.font = `${s.urgent ? '400 30px' : '400 22px'} Righteous, Jost, sans-serif`;
      c.fillStyle = s.urgent ? '#f06a5c' : '#f3e5c3';
      c.shadowColor = '#11201c';
      c.shadowOffsetY = 2;
      c.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, cx, s.safeTop + (narrow ? 66 : 72));
      c.shadowOffsetY = 0;
    }
    if (s.dist !== undefined && s.state !== 'watch') {
      const y = s.safeTop + (s.timer >= 0 ? (narrow ? 90 : 98) : narrow ? 66 : 72);
      c.font = `700 ${narrow ? 13 : 15}px Jost, sans-serif`;
      c.fillStyle = 'rgba(243, 229, 195, 0.9)';
      c.shadowColor = '#11201c';
      c.shadowOffsetY = 2;
      const parts = [`${Math.round(s.dist)} m to cup`];
      if (s.alt > 0.5) parts.push(`${Math.round(s.alt)} m up`);
      c.fillText(parts.join('  ·  '), cx, y);
      c.shadowOffsetY = 0;
    }
    c.textAlign = 'center';
  }
}

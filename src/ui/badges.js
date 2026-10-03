// Badge icons drawn in the game's own style: flat shapes in the palette with a dark outline, on a transparent
// background. Also used by the store script (?poster=badge-<id>).
const C = { cream: '#f3e5c3', orange: '#d86a2a', teal: '#2a8f8a', coral: '#f06a5c', ice: '#bfe3ea', ink: '#11201c', space: '#0b1f1a', green: '#6fae4e', gold: '#e8c15a' };

function ball(ctx, x, y, r) {
  ctx.save();
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.cream;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = C.coral;
  ctx.fillRect(x - r, y - r * 0.16, r * 2, r * 0.32);
  ctx.restore();
  ctx.restore();
}

function planet(ctx, x, y, r, colour, dark) {
  ctx.save();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y + r * 0.25, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y - r * 0.3, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ring(ctx, x, y, rx, ry, colour, w) {
  ctx.save();
  ctx.lineWidth = w;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function cup(ctx, x, y, r) {
  ctx.save();
  ctx.lineWidth = r * 0.3;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.coral;
  ctx.lineWidth = r * 0.22;
  ctx.stroke();
  ctx.strokeStyle = C.cream;
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.7, y);
  ctx.lineTo(x + r * 0.7, y - r * 2.6);
  ctx.stroke();
  ctx.fillStyle = C.coral;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.7, y - r * 2.6);
  ctx.lineTo(x + r * 2.0, y - r * 2.15);
  ctx.lineTo(x + r * 0.7, y - r * 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function star(ctx, x, y, r, colour) {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, size, colour = C.cream) {
  ctx.save();
  ctx.font = `${size}px Righteous, Jost, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = C.ink;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawBadge(ctx, id, S = 256) {
  ctx.clearRect(0, 0, S, S);
  const m = S / 2;
  ctx.save();
  // A soft round plate so the icon reads on any background.
  ctx.fillStyle = C.space;
  ctx.beginPath();
  ctx.arc(m, m, S * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = S * 0.03;
  ctx.strokeStyle = C.cream;
  ctx.stroke();
  ctx.restore();
  switch (id) {
    case 'first-cup':
      planet(ctx, m, m + S * 0.42, S * 0.5, C.green, '#4f8f3e');
      cup(ctx, m + S * 0.02, m + S * 0.0, S * 0.12);
      ball(ctx, m - S * 0.22, m - S * 0.02, S * 0.08);
      break;
    case 'slingshot':
      planet(ctx, m + S * 0.1, m + S * 0.05, S * 0.17, C.orange, '#a04a1e');
      ring(ctx, m + S * 0.1, m + S * 0.05, S * 0.33, S * 0.2, C.ice, S * 0.035);
      ball(ctx, m - S * 0.22, m + S * 0.12, S * 0.075);
      break;
    case 'perigee':
      star(ctx, m, m - S * 0.05, S * 0.3, C.gold);
      label(ctx, '1', m, m - S * 0.05, S * 0.26, C.ink);
      ball(ctx, m + S * 0.25, m + S * 0.25, S * 0.08);
      break;
    case 'aerobrake':
      planet(ctx, m, m + S * 0.1, S * 0.26, C.orange, '#b86a2c');
      ring(ctx, m, m + S * 0.1, S * 0.36, S * 0.36, 'rgba(240,160,96,0.5)', S * 0.06);
      ball(ctx, m + S * 0.02, m - S * 0.3, S * 0.07);
      ctx.save();
      ctx.strokeStyle = C.cream;
      ctx.lineWidth = S * 0.03;
      ctx.beginPath();
      ctx.moveTo(m - S * 0.4, m - S * 0.28);
      ctx.quadraticCurveTo(m - S * 0.2, m - S * 0.36, m - S * 0.06, m - S * 0.3);
      ctx.stroke();
      ctx.restore();
      break;
    case 'lost-in-space':
      ball(ctx, m, m - S * 0.06, S * 0.11);
      for (const [dx, dy, r] of [[-0.3, -0.25, 0.02], [0.28, -0.3, 0.015], [0.32, 0.2, 0.02], [-0.25, 0.28, 0.015], [0.05, 0.32, 0.012]]) {
        ctx.fillStyle = C.ice;
        ctx.beginPath();
        ctx.arc(m + dx * S, m + dy * S, r * S, 0, Math.PI * 2);
        ctx.fill();
      }
      label(ctx, '+1', m, m + S * 0.22, S * 0.17, C.coral);
      break;
    case 'photo-finish':
      ctx.save();
      ctx.strokeStyle = C.cream;
      ctx.lineWidth = S * 0.035;
      ctx.beginPath();
      ctx.arc(m, m, S * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m, m);
      ctx.lineTo(m, m - S * 0.22);
      ctx.moveTo(m, m);
      ctx.lineTo(m + S * 0.16, m + S * 0.1);
      ctx.strokeStyle = C.coral;
      ctx.stroke();
      ctx.restore();
      ball(ctx, m + S * 0.26, m + S * 0.26, S * 0.07);
      break;
    case 'under-par':
      planet(ctx, m, m + S * 0.5, S * 0.55, C.teal, '#16524e');
      label(ctx, '-1', m, m - S * 0.08, S * 0.34, C.ice);
      break;
    case 'daily-streak-7':
      label(ctx, '7', m, m - S * 0.02, S * 0.42, C.gold);
      ring(ctx, m, m, S * 0.32, S * 0.32, C.coral, S * 0.03);
      break;
    case 'wild-card':
      ctx.save();
      ctx.translate(m, m);
      ctx.rotate(-0.25);
      ctx.fillStyle = C.ice;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = S * 0.025;
      ctx.beginPath();
      ctx.roundRect(-S * 0.17, -S * 0.24, S * 0.34, S * 0.48, S * 0.04);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      star(ctx, m, m, S * 0.11, C.coral);
      break;
    case 'full-course': {
      const cols = [C.green, C.orange, C.ice, '#3a2a2c', '#2f6b4f', '#8a949a', C.coral, C.teal];
      cols.forEach((c, i) => {
        const a = (i / 8) * Math.PI * 2;
        planet(ctx, m + Math.cos(a) * S * 0.27, m + Math.sin(a) * S * 0.27, S * 0.08, c, 'rgba(0,0,0,0.25)');
      });
      ball(ctx, m, m, S * 0.08);
      break;
    }
    case 'level-10':
      label(ctx, '10', m, m - S * 0.02, S * 0.36, C.cream);
      ring(ctx, m, m, S * 0.33, S * 0.33, C.gold, S * 0.035);
      break;
    default:
      ball(ctx, m, m, S * 0.2);
  }
}

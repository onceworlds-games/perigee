// Planetoids: the surface function, its normal and the gravity field. Pure arithmetic (+ - * / sqrt):
// the render mesh is built from the same heightAt, so what you see is what you hit.

export const SURFACES = {
  meadow: { rest: 0.55, fric: 0.45, roll: 0.22 },
  dust: { rest: 0.55, fric: 0.35, roll: 0.17 },
  ice: { rest: 0.5, fric: 0.05, roll: 0.025 },
  lava: { rest: 0.5, fric: 0.35, roll: 0.17 },
  moss: { rest: 0.2, fric: 0.7, roll: 0.34 },
  metal: { rest: 0.75, fric: 0.3, roll: 0.14 },
  comet: { rest: 0.9, fric: 0.3, roll: 0.14 },
  gas: { rest: 0, fric: 0, roll: 0 },
  hole: { rest: 0, fric: 0, roll: 0 },
};

/** Height factor h(dir) for a unit direction: the surface radius is R * (1 + h). */
export function heightAt(pl, dx, dy, dz) {
  let h = 0;
  const L = pl.lobes;
  for (let k = 0; k < L.length; k += 5) {
    const d = dx * L[k] + dy * L[k + 1] + dz * L[k + 2];
    if (d > 0) {
      const m = L[k + 4];
      let p = d;
      for (let j = 1; j < m; j++) p *= d;
      h += L[k + 3] * p;
    }
  }
  return h;
}

/** Signed distance from the surface along the radial: d - r(dir). Negative inside. */
export function surfaceF(pl, px, py, pz, cx, cy, cz) {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-9) return -pl.R;
  if (pl.lobes.length === 0) return d - pl.R;
  const inv = 1 / d;
  return d - pl.R * (1 + heightAt(pl, dx * inv, dy * inv, dz * inv));
}

/** Surface radius in a unit direction. */
export function radiusAt(pl, dx, dy, dz) {
  return pl.R * (1 + heightAt(pl, dx, dy, dz));
}

const E = 0.02;

/** Outward surface normal at a point near the surface, by central differences of surfaceF. Writes out[o..o+2]. */
export function surfaceNormal(pl, px, py, pz, cx, cy, cz, out, o = 0) {
  if (pl.lobes.length === 0) {
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    out[o] = dx / d;
    out[o + 1] = dy / d;
    out[o + 2] = dz / d;
    return out;
  }
  let nx = surfaceF(pl, px + E, py, pz, cx, cy, cz) - surfaceF(pl, px - E, py, pz, cx, cy, cz);
  let ny = surfaceF(pl, px, py + E, pz, cx, cy, cz) - surfaceF(pl, px, py - E, pz, cx, cy, cz);
  let nz = surfaceF(pl, px, py, pz + E, cx, cy, cz) - surfaceF(pl, px, py, pz - E, cx, cy, cz);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (l < 1e-12) {
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    nx = dx / d;
    ny = dy / d;
    nz = dz / d;
  } else {
    nx /= l;
    ny /= l;
    nz /= l;
  }
  out[o] = nx;
  out[o + 1] = ny;
  out[o + 2] = nz;
  return out;
}

/** Gravity magnitude at distance d from the centre: g0 (R/d)^2 inside `full`, then a smooth fall to 0 at `inf`. */
export function gravityScalar(pl, d) {
  if (d <= pl.R) return (pl.g0 * d) / pl.R; // inside (ghost shots, safety): linear, never infinite
  if (d >= pl.inf) return 0;
  const q = pl.R / d;
  let g = pl.g0 * q * q;
  if (d > pl.full) {
    const s = (d - pl.full) / (pl.inf - pl.full);
    g *= 1 - s * s * (3 - 2 * s);
  }
  return g;
}

/** Which patch (if any) a unit direction on the surface falls in. */
export function patchAt(pl, dx, dy, dz) {
  const P = pl.patches;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (dx * p.ux + dy * p.uy + dz * p.uz >= p.cos) return p;
  }
  return null;
}

/** The largest height factor a planet's lobes can reach (for a quick contact test). */
export function maxHeight(lobes) {
  let h = 0;
  for (let k = 0; k < lobes.length; k += 5) if (lobes[k + 3] > 0) h += lobes[k + 3];
  return h;
}

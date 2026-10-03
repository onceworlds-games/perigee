// Rails: where a moving planetoid or comet is at a given match time. Pure functions of time, built with
// + - * / and sqrt only, so every page computes the same position for the same time.
//
//   circle: a loop around a centre in the plane of two unit vectors (points from the rational parametrization of
//           the circle, joined by uniform Catmull-Rom segments whose durations follow their chord lengths)
//   line:   back and forth between two points with a smooth ease
//   sweep:  from a to b and back to a at once (a comet that keeps coming)

const K = 48; // points on a circle

export function prepareRail(r) {
  if (!r) return null;
  if (r.type === 'circle') {
    const pts = new Float64Array(K * 3);
    const [cx, cy, cz] = r.center;
    const [ux, uy, uz] = r.u;
    const [vx, vy, vz] = r.v;
    const half = K / 2;
    for (let j = 0; j < half; j++) {
      const s = -1 + (2 * j) / half; // tan(theta/2) in [-1, 1): the right half of the circle
      const d = 1 + s * s;
      const cs = (1 - s * s) / d;
      const sn = (2 * s) / d;
      for (let side = 0; side < 2; side++) {
        const i = side === 0 ? j : j + half;
        const c = side === 0 ? cs : -cs;
        const sg = side === 0 ? sn : -sn;
        pts[i * 3] = cx + r.radius * (c * ux + sg * vx);
        pts[i * 3 + 1] = cy + r.radius * (c * uy + sg * vy);
        pts[i * 3 + 2] = cz + r.radius * (c * uz + sg * vz);
      }
    }
    // Segment i runs from point i to point i+1 (wrapping); its share of the period follows its chord length.
    const cum = new Float64Array(K + 1);
    let total = 0;
    for (let i = 0; i < K; i++) {
      const a = i * 3;
      const b = ((i + 1) % K) * 3;
      const dx = pts[b] - pts[a];
      const dy = pts[b + 1] - pts[a + 1];
      const dz = pts[b + 2] - pts[a + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
      cum[i + 1] = total;
    }
    for (let i = 1; i <= K; i++) cum[i] /= total;
    cum[K] = 1;
    return { type: 'circle', pts, cum, period: r.period, phase: r.phase || 0, dir: r.dir === -1 ? -1 : 1 };
  }
  if (r.type === 'line' || r.type === 'sweep') return { type: r.type, a: r.a.slice(), b: r.b.slice(), period: r.period, phase: r.phase || 0 };
  return null;
}

function frac(u) {
  return u - Math.floor(u);
}

/** Writes the rail position at time t (seconds) into out[o..o+2]. */
export function railPos(rail, t, out, o = 0) {
  if (rail.type === 'circle') {
    let u = frac((t / rail.period) * rail.dir + rail.phase);
    const cum = rail.cum;
    // Find the segment: cum is sorted, K is small, so a linear scan is cheap and branch-light.
    let i = 0;
    while (i < K - 1 && cum[i + 1] <= u) i++;
    const span = cum[i + 1] - cum[i];
    const s = span > 0 ? (u - cum[i]) / span : 0;
    const p = rail.pts;
    const i0 = ((i - 1 + K) % K) * 3;
    const i1 = i * 3;
    const i2 = ((i + 1) % K) * 3;
    const i3 = ((i + 2) % K) * 3;
    const s2 = s * s;
    const s3 = s2 * s;
    for (let k = 0; k < 3; k++) {
      const p0 = p[i0 + k];
      const p1 = p[i1 + k];
      const p2 = p[i2 + k];
      const p3 = p[i3 + k];
      out[o + k] = 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
    }
    return out;
  }
  let u = frac(t / rail.period + rail.phase);
  let s;
  if (rail.type === 'line') {
    s = u < 0.5 ? u * 2 : 2 - u * 2;
    s = s * s * (3 - 2 * s);
  } else s = u;
  for (let k = 0; k < 3; k++) out[o + k] = rail.a[k] + (rail.b[k] - rail.a[k]) * s;
  return out;
}

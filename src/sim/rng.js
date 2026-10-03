// Seeded random numbers (mulberry32): the same seed gives the same sequence on every page and in Node.

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Integer in [0, n). */
    int: (n) => Math.floor(next() * n),
    /** Float in [lo, hi). */
    range: (lo, hi) => lo + (hi - lo) * next(),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** A unit vector, by rejection sampling in the cube (no trigonometry). */
    unit() {
      for (;;) {
        const x = next() * 2 - 1;
        const y = next() * 2 - 1;
        const z = next() * 2 - 1;
        const l2 = x * x + y * y + z * z;
        if (l2 > 0.04 && l2 <= 1) {
          const inv = 1 / Math.sqrt(l2);
          return [x * inv, y * inv, z * inv];
        }
      }
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
  };
  return rng;
}

/** A 32-bit hash of any string (FNV-1a), to seed from names and ids. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combines numbers and strings into one seed. */
export function seedOf(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' ? (Math.floor(p) >>> 0) : hashStr(String(p));
    h = Math.imul(h ^ v, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

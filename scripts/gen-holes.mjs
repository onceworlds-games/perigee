// Builds data/holes.json: nine verified holes for each of the eight worlds, each generated from a real solution
// and graded. Pars are steered toward 3 x par 2, 4 x par 3 and 2 x par 4 per world, easiest first.
//   node scripts/gen-holes.mjs [world]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateHole } from '../src/sim/gen.js';
import { WORLDS } from '../src/sim/worlds.js';
import { seedOf } from '../src/sim/rng.js';

const only = process.argv[2];
const TARGETS = [2, 2, 2, 3, 3, 3, 3, 4, 4];
const holes = [];
const t0 = Date.now();
for (const w of WORLDS) {
  if (only && w.id !== only) continue;
  const got = [];
  let n = 0;
  for (let i = 0; got.length < 9 && n < 60; i++, n++) {
    const want = TARGETS[got.length];
    const seed = seedOf('library', w.id, i);
    const h = generateHole(w.id, seed, { candidates: 3000, par: want, attempts: 4 });
    if (!h) continue;
    if (h.par !== want && n < 40) continue; // keep trying for the wanted par while there is budget
    got.push(h);
    console.log(`${w.id} ${got.length}/9 par ${h.par} (${want}) frac ${h.grade.frac.toFixed(2)} flight ${h.grade.flight}s ${h.feat} "${h.name}"`);
  }
  got.sort((a, b) => a.par - b.par || b.grade.frac - a.grade.frac);
  got.forEach((h, i) => {
    h.id = `${w.id}-${i + 1}`;
    h.index = i + 1;
  });
  holes.push(...got);
}
mkdirSync('data', { recursive: true });
if (!only) writeFileSync('data/holes.json', JSON.stringify({ v: 1, holes }));
const dist = [2, 3, 4].map((p) => `${p}: ${holes.filter((h) => h.par === p).length}`).join('  ');
console.log(`${holes.length} holes, par ${dist}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

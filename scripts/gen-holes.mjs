// Builds data/holes.json: nine verified holes for each of the eight worlds, each built from a real solution, then
// graded by the bots' own play.
//   node scripts/gen-holes.mjs [world]
//   node scripts/gen-holes.mjs --regrade        re-par the shipped holes from the bots' own results (keeps the holes)
//   node scripts/gen-holes.mjs --replace-hard   swap holes the bots find nearly unplayable for fresh ones, regrade
//
// Grading: the reference shot's sensitivity (how many nudged copies still sink) says how hard the *builder's*
// solution is, not how hard the hole plays, and it tracks bot strokes poorly. So every hole is played by Pro and
// Club bots on fixed seeds; their mean strokes are its difficulty grade, the easiest 30% are par 2, the hardest 25%
// par 4, and each world is ordered easiest first (its last hole is its hardest: the tour's boss hole).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { generateHole } from '../src/sim/gen.js';
import { WORLDS } from '../src/sim/worlds.js';
import { seedOf } from '../src/sim/rng.js';
import { prepareHole } from '../src/sim/hole.js';
import { playHole } from '../src/sim/play.js';

const GRADE_PLAYS = 12;
const SHARE = { 2: 0.3, 3: 0.45 }; // the rest par 4

/** Mean strokes of Pro and Club bots on a hole (no pick-up cap while measuring). */
function botGrade(data) {
  // Keyed by the hole's seed, not its id (ids change when a world is re-ordered), so a grade never changes by itself.
  const h = prepareHole({ ...data, id: `seed-${data.seed}`, par: 9 });
  let pro = 0;
  let club = 0;
  for (let k = 0; k < GRADE_PLAYS; k++) {
    pro += playHole(h, 'pro', 7000 + k).strokes;
    club += playHole(h, 'club', 8000 + k).strokes;
  }
  return { pro: Math.round((pro / GRADE_PLAYS) * 100) / 100, club: Math.round((club / GRADE_PLAYS) * 100) / 100 };
}

function regrade() {
  const lib = JSON.parse(readFileSync('data/holes.json', 'utf8'));
  const t0 = Date.now();
  for (const h of lib.holes) {
    const g = botGrade(h);
    h.grade = { ...h.grade, pro: g.pro, club: g.club };
    delete h.grade.bot;
  }
  const diff = (h) => h.grade.pro + h.grade.club;
  const ranked = lib.holes.slice().sort((a, b) => diff(a) - diff(b) || a.seed - b.seed);
  const n2 = Math.round(ranked.length * SHARE[2]);
  const n3 = Math.round(ranked.length * SHARE[3]);
  ranked.forEach((h, i) => (h.par = i < n2 ? 2 : i < n2 + n3 ? 3 : 4));
  const holes = [];
  for (const w of WORLDS) {
    const list = lib.holes.filter((h) => h.world === w.id).sort((a, b) => a.par - b.par || diff(a) - diff(b) || a.seed - b.seed);
    list.forEach((h, i) => {
      h.id = `${w.id}-${i + 1}`;
      h.index = i + 1;
    });
    holes.push(...list);
  }
  writeFileSync('data/holes.json', JSON.stringify({ v: 1, holes }));
  const dist = [2, 3, 4].map((p) => `${p}: ${holes.filter((h) => h.par === p).length}`).join('  ');
  console.log(`regraded ${holes.length} holes, par ${dist}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const w of WORLDS) console.log(w.id.padEnd(10), holes.filter((h) => h.world === w.id).map((h) => `${h.par}(${h.grade.pro.toFixed(1)})`).join(' '));
}

function build(only) {
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
  const dist = [2, 3, 4].map((p) => `${p}: ${holes.filter((h) => h.par === p).length}`).join('  ');
  console.log(`${holes.length} holes, par ${dist}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (only) return;
  writeFileSync('data/holes.json', JSON.stringify({ v: 1, holes }));
  regrade();
}

/**
 * Replaces the holes that play like needles (Pro bots average more than maxPro strokes: most players would hit the
 * pick-up cap) or like gimmes (a Pro holes it in one nearly every time) with fresh ones from the same world, then
 * regrades everything.
 */
function replaceHard(maxPro = 5.5, minPro = 1.5) {
  const lib = JSON.parse(readFileSync('data/holes.json', 'utf8'));
  for (const h of lib.holes) h.grade = { ...h.grade, ...botGrade(h) };
  const bad = lib.holes.filter((h) => h.grade.pro > maxPro || h.grade.pro < minPro);
  console.log(`replacing ${bad.length}: ${bad.map((h) => `${h.id}(${h.grade.pro})`).join(' ')}`);
  const seeds = new Set(lib.holes.map((h) => h.seed));
  for (const old of bad) {
    for (let i = 0; i < 80; i++) {
      const seed = seedOf('library-2', old.world, old.seed, i);
      if (seeds.has(seed)) continue;
      const h = generateHole(old.world, seed, { candidates: 3000, par: old.par, attempts: 4 });
      if (!h) continue;
      const g = botGrade(h);
      if (g.pro > maxPro - 0.5 || g.pro < minPro + 0.3) continue;
      h.grade = { ...h.grade, pro: g.pro, club: g.club };
      seeds.add(seed);
      lib.holes[lib.holes.indexOf(old)] = h;
      console.log(`  ${old.id} -> "${h.name}" pro ${g.pro} club ${g.club}`);
      break;
    }
  }
  writeFileSync('data/holes.json', JSON.stringify({ v: 1, holes: lib.holes }));
  regrade();
}

if (process.argv.includes('--regrade')) regrade();
else if (process.argv.includes('--replace-hard')) replaceHard();
else build(process.argv[2]);

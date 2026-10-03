// Scoring modes, result words and standings. Pure.
import { RESULT_WORDS } from './worlds.js';

export const MAX_OVER = 4; // strokes per hole are capped at par + 4 (then the ball is picked up)

export function strokeCap(par) {
  return par + MAX_OVER;
}

/** Stableford-like points for a hole: eagle 5, birdie 4, par 3, bogey 2, double 1, worse 0. */
export function pointsFor(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return 5;
  if (d === -1) return 4;
  if (d === 0) return 3;
  if (d === 1) return 2;
  if (d === 2) return 1;
  return 0;
}

/** The word shown for a finished hole. */
export function resultWord(strokes, par, pickedUp) {
  if (pickedUp) return RESULT_WORDS.pickup;
  if (strokes === 1) return RESULT_WORDS.ace;
  const d = Math.max(-3, Math.min(3, strokes - par));
  return RESULT_WORDS[String(d)] ?? RESULT_WORDS[0];
}

/**
 * A player's total under a scoring mode from their per-hole results.
 * results: [{ strokes, par, first (sank first on that hole), pickedUp }], unplayed holes are null.
 * Returns { total, lowerIsBetter }.
 */
export function totalFor(mode, results) {
  let total = 0;
  for (const r of results) {
    if (!r) continue;
    if (mode === 'points') total += pointsFor(r.strokes, r.par);
    else if (mode === 'speed') total += Math.max(1, r.strokes - (r.first ? 1 : 0));
    else total += r.strokes;
  }
  return { total, lowerIsBetter: mode !== 'points' };
}

/** Standings: [{ id, total, holes, thru }] best first, ties by fewer strokes then by id (deterministic). */
export function standings(mode, scores, ids) {
  const rows = ids.map((id) => {
    const res = scores[id] ?? [];
    const { total, lowerIsBetter } = totalFor(mode, res);
    const strokes = res.reduce((a, r) => a + (r ? r.strokes : 0), 0);
    const thru = res.filter(Boolean).length;
    return { id, total, strokes, thru, lowerIsBetter };
  });
  rows.sort((a, b) => (a.lowerIsBetter ? a.total - b.total : b.total - a.total) || a.strokes - b.strokes || (a.id < b.id ? -1 : 1));
  let place = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0 || rows[i].total !== rows[i - 1].total) place = i + 1;
    rows[i].place = place;
  }
  return rows;
}

/** Total par of a round's holes. */
export function parTotal(holes) {
  return holes.reduce((a, h) => a + (h?.par ?? 3), 0);
}

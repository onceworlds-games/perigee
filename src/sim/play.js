// Plays a whole hole with a bot, headless: plan, shoot, simulate, repeat until it drops or the stroke cap. Used by
// the balance harness and the tests (the live game is event-driven and uses the same pieces one shot at a time).
import { makeRng, seedOf } from './rng.js';
import { makeBall, launchAt, simulate, distToCup, HOLED, REST, DT } from './ball.js';
import { planShot, thinkTime } from './bots.js';
import { strokeCap } from './score.js';
import { modsFor } from './cards.js';

const HOLE_CAP_STEPS = 120 * 60;

/**
 * opts.card: a card id the bot plays on its first shot (mod cards), or 'mulligan' (the better of two first shots).
 * Returns { strokes, holed, ace, pickedUp, seconds, shots }.
 */
export function playHole(hole, tier, seed, opts = {}) {
  const rng = makeRng(seedOf(seed, hole.id ?? hole.seed, tier));
  const cap = strokeCap(hole.par);
  const b = makeBall(hole, hole.tee.p, [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
  b.quiet = true;
  let t = 0; // hole clock, seconds
  let shots = 0;
  let holed = false;
  const log = [];
  let cardLeft = opts.card ?? null;
  let retries = 0;
  while (!holed && shots + b.penalties < cap) {
    t += thinkTime(tier, rng);
    let mods = null;
    let useMulligan = false;
    if (cardLeft) {
      if (cardLeft === 'mulligan') useMulligan = true;
      else {
        mods = modsFor(cardLeft, b.rest.g);
        if (mods && mods.thruster) mods.thrust = 60;
        if (mods && mods.braker) mods.brake = { from: 90, to: 200 };
      }
      cardLeft = null;
    }
    const before = { g: b.rest.g, dx: b.rest.dx, dy: b.rest.dy, dz: b.rest.dz };
    let plan = planShot(hole, b, t, tier, seedOf(seed, hole.id ?? hole.seed, tier, shots, retries), mods);
    if (mods) {
      // A player looks at the preview with and without the card and keeps it for a better moment if it doesn't help.
      const plain = planShot(hole, b, t, tier, seedOf(seed, hole.id ?? hole.seed, tier, shots, retries), null);
      if (plain.score >= plan.score) {
        plan = plain;
        mods = null;
        cardLeft = opts.card;
      }
    }
    launchAt(hole, b, t, plan.p[0], plan.p[1], plan.p[2], plan.v[0], plan.v[1], plan.v[2], mods);
    shots++;
    const n = simulate(hole, b, HOLE_CAP_STEPS);
    t += n * DT;
    if (b.mode === HOLED) holed = true;
    else if (b.mode !== REST) {
      // Still flying at the cap (a long orbit): the hole clock ends it, count it as a pick-up.
      break;
    }
    if (useMulligan && !holed) {
      // Mulligan: if the shot went badly (lost, the wrong world, or still far from the cup), take it back.
      const bad = b.penalties > 0 || b.rest.g !== hole.cup.p || distToCup(hole, b) > 5;
      if (bad) {
        b.mode = REST;
        b.penalties = 0;
        shots--;
        retries++;
        const back = makeBall(hole, before.g, [before.dx, before.dy, before.dz]);
        Object.assign(b, { rest: back.rest, rx: back.rx, ry: back.ry, rz: back.rz, g: back.g, vx: 0, vy: 0, vz: 0, mode: REST });
      }
    }
    log.push({ shot: shots, mode: b.mode, pen: b.penalties, speed: plan.speed });
  }
  const strokes = Math.min(cap, shots + b.penalties);
  return { strokes: holed ? strokes : cap, holed, ace: holed && strokes === 1, pickedUp: !holed, seconds: t, shots: log };
}

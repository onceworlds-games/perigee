// Cards: the roguelite rule-set. Each card is a modifier that rides on a shot event, so every page simulates the
// same ball. The draft is derived from the match seed, the hole and the player, so a reload shows the same three.
import { makeRng, seedOf } from './rng.js';

export const CARDS = [
  { id: 'thruster', name: 'Thruster', blurb: 'Tap mid-flight: boost', kind: 'act' },
  { id: 'magnet', name: 'Magnet', blurb: 'The cup pulls, 12 m', kind: 'mod' },
  { id: 'brake', name: 'Brake', blurb: 'Hold mid-flight: slow', kind: 'act' },
  { id: 'ghost', name: 'Ghost', blurb: 'Pass through one world', kind: 'mod' },
  { id: 'bouncy', name: 'Bouncy', blurb: 'Bounces keep their pace', kind: 'mod' },
  { id: 'sticky', name: 'Sticky', blurb: 'First landing sticks', kind: 'mod' },
  { id: 'preview', name: 'Long Look', blurb: 'Three-second preview', kind: 'view' },
  { id: 'mulligan', name: 'Mulligan', blurb: 'Take a shot back', kind: 'undo' },
  { id: 'gravity', name: 'Heavy', blurb: 'Your world pulls x1.4', kind: 'mod' },
  { id: 'luck', name: 'Lucky Cup', blurb: 'Cup one and a half wide', kind: 'mod' },
];
export const CARD_IDS = CARDS.map((c) => c.id);
export const HAND_MAX = 3;

export function cardById(id) {
  return CARDS.find((c) => c.id === id) ?? null;
}

/** The three cards offered to a player after a hole (deterministic; never the same card twice). */
export function draftFor(matchSeed, holeIndex, playerId) {
  const rng = makeRng(seedOf(matchSeed, holeIndex, playerId, 'draft'));
  const pool = CARD_IDS.slice();
  rng.shuffle(pool);
  return pool.slice(0, 3);
}

/**
 * The simulation mods for a shot that plays `cardId` from a ball resting on planet `g`.
 * Mods are plain data (sent with the shot); `acts` (thrust, brake) are added later as the player taps.
 */
export function modsFor(cardId, g) {
  switch (cardId) {
    case 'magnet':
      return { magnet: true };
    case 'ghost':
      return { ghost: true };
    case 'bouncy':
      return { bouncy: true };
    case 'sticky':
      return { sticky: true };
    case 'gravity':
      return { gplanet: g, gfactor: 1.4 };
    case 'luck':
      return { luck: true };
    case 'thruster':
      return { thruster: true };
    case 'brake':
      return { braker: true };
    default:
      return null;
  }
}

/** Validates mods from another page: only known keys, sane numbers. Returns clean mods or null. */
export function cleanMods(m, maxPlanet) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  if (m.magnet === true) out.magnet = true;
  if (m.ghost === true) out.ghost = true;
  if (m.bouncy === true) out.bouncy = true;
  if (m.sticky === true) out.sticky = true;
  if (m.luck === true) out.luck = true;
  if (m.thruster === true) out.thruster = true;
  if (m.braker === true) out.braker = true;
  if (Number.isInteger(m.gplanet) && m.gplanet >= 0 && m.gplanet < maxPlanet && m.gfactor === 1.4) {
    out.gplanet = m.gplanet;
    out.gfactor = 1.4;
  }
  if (Number.isInteger(m.thrust) && m.thrust >= 0 && m.thrust < 120 * 120 && out.thruster) out.thrust = m.thrust;
  if (m.brake && Number.isInteger(m.brake.from) && Number.isInteger(m.brake.to) && m.brake.from >= 0 && m.brake.to > m.brake.from && m.brake.to - m.brake.from <= 120 * 3 && m.brake.to < 120 * 120 && out.braker) out.brake = { from: m.brake.from, to: m.brake.to };
  return Object.keys(out).length ? out : null;
}

// The eight worlds: what kinds of planetoids they hold, how big and heavy, which hazards and movers, and the
// tone of the names the generator gives their holes.

export const WORLDS = [
  {
    id: 'pebble',
    name: 'Pebble Belt',
    count: [3, 4],
    kinds: ['meadow', 'meadow', 'dust'],
    R: [5, 9],
    g: [9, 12],
    cupR: 0.75,
    gap: [10, 18],
    words: ['Pebble', 'Skip', 'Hop', 'Little', 'Lazy', 'First', 'Soft', 'Short'],
  },
  {
    id: 'binary',
    name: 'Binary Dance',
    count: [3, 5],
    kinds: ['meadow', 'dust', 'moss'],
    R: [5, 10],
    g: [10, 13],
    cupR: 0.6,
    gap: [10, 20],
    binary: true,
    words: ['Waltz', 'Twin', 'Partner', 'Tango', 'Two-step', 'Swing', 'Spin', 'Pair'],
  },
  {
    id: 'lava',
    name: 'Lava Moons',
    count: [3, 5],
    kinds: ['lava', 'dust', 'metal', 'dust'],
    R: [5, 11],
    g: [10, 14],
    cupR: 0.6,
    gap: [10, 22],
    patches: ['lava', 'lava', 'pad'],
    words: ['Ember', 'Cinder', 'Scorch', 'Crust', 'Furnace', 'Glow', 'Ash', 'Kiln'],
  },
  {
    id: 'ice',
    name: 'Ice Garden',
    count: [3, 5],
    kinds: ['ice', 'moss', 'meadow', 'ice'],
    R: [5, 11],
    g: [9, 13],
    cupR: 0.6,
    gap: [10, 20],
    patches: ['ice', 'ice', 'tar'],
    words: ['Frost', 'Glass', 'Slide', 'Sleet', 'Rime', 'Drift', 'Thaw', 'Pane'],
  },
  {
    id: 'clockwork',
    name: 'Clockwork',
    count: [4, 6],
    kinds: ['metal', 'metal', 'dust'],
    R: [4, 9],
    g: [10, 14],
    cupR: 0.6,
    gap: [10, 20],
    lines: true,
    rings: true,
    patches: ['pad'],
    words: ['Cog', 'Tick', 'Mainspring', 'Escapement', 'Gear', 'Pendulum', 'Ratchet', 'Dial'],
  },
  {
    id: 'wormhole',
    name: 'Wormhole Alley',
    count: [3, 5],
    kinds: ['dust', 'meadow', 'moss'],
    R: [5, 10],
    g: [10, 13],
    cupR: 0.6,
    gap: [12, 24],
    worms: true,
    words: ['Shortcut', 'Stitch', 'Fold', 'Needle', 'Tunnel', 'Hem', 'Loop', 'Thread'],
  },
  {
    id: 'casino',
    name: 'Black Hole Casino',
    count: [4, 6],
    kinds: ['metal', 'dust', 'lava', 'moss'],
    R: [4, 9],
    g: [10, 14],
    cupR: 0.55,
    gap: [10, 22],
    blackhole: true,
    patches: ['pad', 'tar', 'lava'],
    words: ['Jackpot', 'Double', 'Roulette', 'High Roller', 'All In', 'Odds', 'Croupier', 'Chip'],
  },
  {
    id: 'comet',
    name: 'Comet Run',
    count: [3, 5],
    kinds: ['meadow', 'dust', 'ice'],
    R: [5, 11],
    g: [10, 14],
    cupR: 0.6,
    gap: [12, 24],
    comets: true,
    gas: true,
    words: ['Tail', 'Streak', 'Thin Air', 'Skim', 'Long Haul', 'Coma', 'Flyby', 'Dive'],
  },
];

export const WORLD_IDS = WORLDS.map((w) => w.id);

export function worldById(id) {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

/** Which world an Auto round plays at hole index i (a ramp from friendly to wild, varied by the match seed). */
export function autoWorld(seed, i, holes) {
  const ramp = ['pebble', 'binary', 'ice', 'lava', 'wormhole', 'clockwork', 'comet', 'casino'];
  if (i === 0) return 'pebble';
  const span = Math.max(1, holes - 1);
  const tier = Math.min(ramp.length - 1, Math.floor(((i - 1) / span) * ramp.length) + 1);
  const pick = (seed + i * 7) % 2 === 0 ? tier : Math.max(1, tier - 1);
  return ramp[pick];
}

/** Round names for the funny labels between holes. */
export const RESULT_WORDS = {
  ace: 'Perigee!',
  '-3': 'Albatross!',
  '-2': 'Eagle!',
  '-1': 'Birdie!',
  0: 'Par',
  1: 'Bogey',
  2: 'Double',
  3: 'Triple',
  pickup: 'Picked up',
};

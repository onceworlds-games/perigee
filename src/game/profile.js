// The player's profile in ow.save: a versioned schema parsed defensively (missing, empty, corrupt, newer or older
// all load), written on meaningful events and at most every few seconds, flushed when the page hides.
// Levels unlock looks; records, perigees, the daily streak, cards seen and tutorial flags live here too.
import { saves, badges, boards, now } from './platform.js';
import { num } from '../sim/hole.js';

export const VERSION = 1;
export const MAX_LEVEL = 30;

export const SKINS = [
  { id: 'classic', name: 'Classic', body: 0xf3e5c3, stripe: 0xf06a5c, level: 1 },
  { id: 'teal', name: 'Lagoon', body: 0xbfe3ea, stripe: 0x2a8f8a, level: 3 },
  { id: 'ember', name: 'Ember', body: 0xd86a2a, stripe: 0xf3e5c3, level: 5 },
  { id: 'moss', name: 'Moss', body: 0x6fae4e, stripe: 0x1f4a36, level: 8 },
  { id: 'rose', name: 'Rose', body: 0xd97a8a, stripe: 0xf3e5c3, level: 11 },
  { id: 'night', name: 'Night', body: 0x11201c, stripe: 0xf06a5c, level: 14 },
  { id: 'gold', name: 'Gold', body: 0xe8c15a, stripe: 0x8a5a12, level: 18 },
  { id: 'comet', name: 'Comet', body: 0xffffff, stripe: 0x2a8f8a, level: 24 },
];
export const TRAILS = [
  { id: 'coral', name: 'Coral', colour: 0xf06a5c, level: 1 },
  { id: 'teal', name: 'Teal', colour: 0x2a8f8a, level: 4 },
  { id: 'cream', name: 'Cream', colour: 0xf3e5c3, level: 7 },
  { id: 'orange', name: 'Orange', colour: 0xd86a2a, level: 10 },
  { id: 'ice', name: 'Ice', colour: 0xbfe3ea, level: 16 },
  { id: 'rose', name: 'Rose', colour: 0xd97a8a, level: 21 },
];
export const PLINKS = [
  { id: 'marimba', name: 'Marimba', level: 1 },
  { id: 'vibes', name: 'Vibes', level: 6 },
  { id: 'kalimba', name: 'Kalimba', level: 12 },
  { id: 'bell', name: 'Bell', level: 20 },
];
export const FLAGS = [
  { id: 'coral', name: 'Coral', colour: 0xf06a5c, level: 1 },
  { id: 'cream', name: 'Cream', colour: 0xf3e5c3, level: 2 },
  { id: 'teal', name: 'Teal', colour: 0x2a8f8a, level: 9 },
  { id: 'orange', name: 'Orange', colour: 0xd86a2a, level: 13 },
  { id: 'ice', name: 'Ice', colour: 0xbfe3ea, level: 22 },
];
export const CELEBRATIONS = [
  { id: 'glitter', name: 'Glitter', level: 1 },
  { id: 'rings', name: 'Rings', level: 15 },
  { id: 'fountain', name: 'Fountain', level: 19 },
  { id: 'nova', name: 'Nova', level: 26 },
];
export const BALL_NAMES = ['Pebble', 'Comet', 'Moonlet', 'Dumpling', 'Marble', 'Nugget', 'Ping', 'Sprocket', 'Acorn', 'Biscuit', 'Orbit', 'Snowball'];

export const BADGE_IDS = ['first-cup', 'slingshot', 'perigee', 'aerobrake', 'lost-in-space', 'photo-finish', 'under-par', 'daily-streak-7', 'wild-card', 'full-course', 'level-10'];

export function xpForLevel(level) {
  // 120, 260, 420, ... a gentle quadratic
  return Math.floor(100 * (level - 1) + 20 * (level - 1) * (level - 1));
}

export function levelFor(xp) {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}

export function fresh() {
  return {
    v: VERSION,
    xp: 0,
    look: { skin: 'classic', trail: 'coral', plink: 'marimba', flag: 'coral', party: 'glitter', name: 0 },
    records: {}, // world -> best 9-hole strokes
    perigees: [], // hole ids with a hole-in-one
    daily: { day: 0, streak: 0, best: 0, last: 0 },
    seen: [], // cards seen
    tut: {}, // hint id -> times shown
    stats: { holes: 0, strokes: 0, rounds: 0, wins: 0, aces: 0, lost: 0, slings: 0, aero: 0, worlds: [] },
    tour: { stage: 0, best: null },
    badges: [],
  };
}

/** Loads whatever is saved into a valid profile. */
export function parse(raw) {
  const p = fresh();
  if (!raw || typeof raw !== 'object') return p;
  p.xp = num(raw.xp, 0, 1e9, 0);
  if (raw.look && typeof raw.look === 'object') {
    for (const k of ['skin', 'trail', 'plink', 'flag', 'party']) if (typeof raw.look[k] === 'string') p.look[k] = raw.look[k];
    p.look.name = num(raw.look.name, 0, BALL_NAMES.length - 1, 0) | 0;
  }
  if (raw.records && typeof raw.records === 'object') for (const [k, v] of Object.entries(raw.records)) if (typeof k === 'string' && k.length < 20 && Number.isFinite(v)) p.records[k] = num(v, 1, 999, 0);
  if (Array.isArray(raw.perigees)) p.perigees = raw.perigees.filter((x) => typeof x === 'string' && x.length < 24).slice(0, 500);
  if (raw.daily && typeof raw.daily === 'object') p.daily = { day: num(raw.daily.day, 0, 1e7, 0) | 0, streak: num(raw.daily.streak, 0, 1e5, 0) | 0, best: num(raw.daily.best, 0, 99, 0) | 0, last: num(raw.daily.last, 0, 1e7, 0) | 0 };
  if (Array.isArray(raw.seen)) p.seen = raw.seen.filter((x) => typeof x === 'string' && x.length < 16).slice(0, 20);
  if (raw.tut && typeof raw.tut === 'object') for (const [k, v] of Object.entries(raw.tut)) if (k.length < 20) p.tut[k] = num(v, 0, 99, 0) | 0;
  if (raw.stats && typeof raw.stats === 'object') {
    for (const k of ['holes', 'strokes', 'rounds', 'wins', 'aces', 'lost', 'slings', 'aero']) p.stats[k] = num(raw.stats[k], 0, 1e8, 0) | 0;
    if (Array.isArray(raw.stats.worlds)) p.stats.worlds = raw.stats.worlds.filter((x) => typeof x === 'string' && x.length < 16).slice(0, 8);
  }
  if (raw.tour && typeof raw.tour === 'object') p.tour = { stage: num(raw.tour.stage, 0, 999, 0) | 0, best: Number.isFinite(raw.tour.best) ? num(raw.tour.best, 1, 999, 0) : null };
  if (Array.isArray(raw.badges)) p.badges = raw.badges.filter((x) => BADGE_IDS.includes(x));
  // Equipped looks must exist and be unlocked (a newer save on an older build).
  const lvl = levelFor(p.xp);
  const check = (list, id) => list.some((x) => x.id === id && x.level <= lvl);
  if (!check(SKINS, p.look.skin)) p.look.skin = 'classic';
  if (!check(TRAILS, p.look.trail)) p.look.trail = 'coral';
  if (!check(PLINKS, p.look.plink)) p.look.plink = 'marimba';
  if (!check(FLAGS, p.look.flag)) p.look.flag = 'coral';
  if (!check(CELEBRATIONS, p.look.party)) p.look.party = 'glitter';
  return p;
}

export class Profile {
  constructor() {
    this.data = fresh();
    this.dirty = false;
    this.lastWrite = 0;
    this.loaded = false;
    this.listeners = [];
  }

  async load() {
    const raw = await saves.get('profile');
    this.data = parse(raw);
    this.loaded = true;
    this.emit();
    return this.data;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  get level() {
    return levelFor(this.data.xp);
  }

  /** The look to draw: colours resolved from the equipped ids. */
  look() {
    const d = this.data.look;
    const skin = SKINS.find((s) => s.id === d.skin) ?? SKINS[0];
    const trail = TRAILS.find((s) => s.id === d.trail) ?? TRAILS[0];
    const flag = FLAGS.find((s) => s.id === d.flag) ?? FLAGS[0];
    return { body: skin.body, stripe: skin.stripe, trail: trail.colour, flag: flag.colour, plink: d.plink, party: d.party, name: BALL_NAMES[d.name] ?? BALL_NAMES[0], skin: skin.id, trailId: trail.id };
  }

  /** Marks the profile changed; writes soon (at most every 3 s), or at once when `flush`. */
  save(flush = false) {
    this.dirty = true;
    const t = Date.now();
    if (flush || t - this.lastWrite > 3000) this.write();
  }

  write() {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastWrite = Date.now();
    saves.set('profile', this.data);
  }

  tick() {
    if (this.dirty && Date.now() - this.lastWrite > 3000) this.write();
  }

  /** XP for a finished hole; returns { xp, levelUp }. */
  holeDone({ strokes, par, ace, pickedUp, world }) {
    const before = this.level;
    let xp = pickedUp ? 4 : 10;
    if (!pickedUp && strokes < par) xp += (par - strokes) * 8;
    if (ace) xp += 20;
    this.data.xp += xp;
    this.data.stats.holes++;
    this.data.stats.strokes += strokes;
    if (ace) this.data.stats.aces++;
    if (world && !this.data.stats.worlds.includes(world)) this.data.stats.worlds.push(world);
    this.save();
    const levelUp = this.level > before ? this.level : 0;
    if (levelUp >= 10) this.award('level-10');
    return { xp, levelUp };
  }

  roundDone({ strokes, parTotal, holes, world, won, cards, mode }) {
    this.data.stats.rounds++;
    if (won) this.data.stats.wins++;
    this.data.xp += 15 + (won ? 25 : 0);
    if (holes === 9 && world && world !== 'auto' && world !== 'random' && (!this.data.records[world] || strokes < this.data.records[world])) this.data.records[world] = strokes;
    if (holes === 9 && strokes < parTotal) this.award('under-par');
    if (won && cards) this.award('wild-card');
    if (this.data.stats.worlds.length >= 8) this.award('full-course');
    if (holes === 9 && !cards && mode === 'strokes') boards.submit('best-9', strokes, { lowerIsBetter: true });
    if (this.level >= 10) this.award('level-10');
    this.save(true);
  }

  perigee(holeId) {
    if (!this.data.perigees.includes(holeId)) this.data.perigees.push(holeId);
    this.award('perigee');
    boards.submit('holes-in-one', this.data.perigees.length);
    this.save();
  }

  /** The daily: records today's result and the streak (consecutive days played). */
  dailyDone(day, strokes) {
    const d = this.data.daily;
    if (d.day !== day) {
      d.streak = d.day === day - 1 ? d.streak + 1 : 1;
      d.day = day;
      d.best = strokes;
    } else if (!d.best || strokes < d.best) d.best = strokes;
    d.last = day;
    if (d.streak >= 7) this.award('daily-streak-7');
    boards.submit('daily-streak', d.streak);
    this.save(true);
  }

  sawCard(id) {
    if (!this.data.seen.includes(id)) {
      this.data.seen.push(id);
      this.save();
    }
  }

  /** Shows a hint the first `times` times it is asked for; returns true when it should show now. */
  hint(id, times = 3) {
    const n = this.data.tut[id] ?? 0;
    if (n >= times) return false;
    this.data.tut[id] = n + 1;
    this.save();
    return true;
  }

  award(id) {
    if (!BADGE_IDS.includes(id) || this.data.badges.includes(id)) return;
    this.data.badges.push(id);
    this.save();
    badges.award(id);
  }

  equip(kind, id) {
    const lvl = this.level;
    const lists = { skin: SKINS, trail: TRAILS, plink: PLINKS, flag: FLAGS, party: CELEBRATIONS };
    const item = lists[kind]?.find((x) => x.id === id);
    if (!item || item.level > lvl) return false;
    this.data.look[kind] = id;
    this.save(true);
    this.emit();
    return true;
  }

  nextName() {
    this.data.look.name = (this.data.look.name + 1) % BALL_NAMES.length;
    this.save(true);
    this.emit();
  }
}

export const today = () => Math.floor(now() / 86400000);

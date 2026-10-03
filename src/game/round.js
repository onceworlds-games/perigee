// The rules of a round, run by the authority (the host's page in a match; the player's own page for a solo
// activity). Everything a new host needs is in the table's `g` record, keyed by the match id, so `adopt()` can be
// called as often as needed. Shots are records other pages write (`s.<pid>`); the authority simulates them with the
// same physics, validates them, and writes the canonical rest into `g.cur`.
//
// Phases: intro (the fly-in; shots are not accepted yet) -> play -> between (standings, card draft) -> ... -> final.
import { prepareHole, centersAt, num, MAX_PLANETS, BALL_R } from '../sim/hole.js';
import { makeBall, launchAt, stepBall, planetVel, ballPos, placeBall, REST, HOLED, DT, MAX_SPEED } from '../sim/ball.js';
import { generateHoleSteps } from '../sim/gen.js';
import { planShotSteps, thinkTime, botIdentity } from '../sim/bots.js';
import { strokeCap, standings } from '../sim/score.js';
import { draftFor, cleanMods, modsFor, CARD_IDS, HAND_MAX } from '../sim/cards.js';
import { autoWorld, WORLD_IDS, WORLD_PAIRS } from '../sim/worlds.js';
import { makeRng, seedOf } from '../sim/rng.js';
import { G_KEY, shotKey } from './table.js';

export const INTRO_MS = 4500;
export const HOLE_CAP_MS = 180000;
export const AFTER_FIRST_MS = 30000;
export const BETWEEN_MS = 5000;
export const FINAL_MS = 20000;
export const AWAY_GRACE_MS = 20000;
export const REST_TOL = 0.35;
export const SHOT_TOL = 0.6;
const MAX_CATCHUP = 2400;

let library = null;
export function setLibrary(lib) {
  library = lib;
}
export function libraryHoles() {
  return library?.holes ?? [];
}

/** The hole list of a round from its settings and seed: library ids, or generator seeds for Random/Daily. */
export function pickHoles(kind, settings, seed, extra = {}) {
  const n = kind === 'daily' ? 1 : kind === 'practice' ? 1 : kind === 'tour' ? 9 : num(settings.holes, 1, 9, 6);
  const rng = makeRng(seed);
  const out = [];
  if (kind === 'daily') return [{ src: 'gen', world: WORLD_IDS[Math.floor(seed / 7) % WORLD_IDS.length], seed: seedOf('daily', seed) }];
  if (kind === 'practice') return [extra.hole ?? { src: 'lib', id: 'pebble-1' }];
  if (kind === 'tour') {
    const stage = extra.stage ?? 0;
    for (let w = 0; w < 3; w++) {
      const world = ['pebble', 'binary', 'ice', 'lava', 'wormhole', 'clockwork', 'comet', 'casino'][(stage + w * 3) % 8];
      for (const i of [2 + rng.int(2), 5 + rng.int(2), 9]) out.push({ src: 'lib', id: `${world}-${i}` });
    }
    return out;
  }
  const world = settings.world;
  for (let i = 0; i < n; i++) {
    if (world === 'random') out.push({ src: 'gen', world: autoWorld(seed, i, n), seed: seedOf('random', seed, i) });
    else {
      const pair = WORLD_PAIRS[world];
      const w = pair ? pair[i % 2] : world && world !== 'auto' && WORLD_IDS.includes(world) ? world : autoWorld(seed, i, n);
      // Easy first: the first hole of a round is from the friendly end of its world.
      const idx = i === 0 ? 1 + rng.int(3) : 1 + rng.int(9);
      out.push({ src: 'lib', id: `${w}-${idx}` });
    }
  }
  return out;
}

/** Resolves a hole entry to plain hole data (the library, or the generator for `gen` entries, which the Round caches). */
export function holeData(entry) {
  if (!entry) return null;
  if (entry.src === 'lib') return libraryHoles().find((h) => h.id === entry.id) ?? libraryHoles()[0] ?? null;
  return null;
}

export class Round {
  /**
   * ctx: { table, me (my id), clock() (ms), isAuthority(), online() (ids connected), isParticipant(id), players()
   *        (Map id -> player), privateOf(id), setPrivateFor(id, key, value), admitWaiting() (ids to admit at a hole
   *        start, or []), admit(ids), onEnd(), reportShot(record), seed, mid, kind, settings }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.table = ctx.table;
    this.gen = new Map(); // seed -> hole data (built at runtime)
    this.genJobs = new Map(); // seed -> iterator
    this.holes = new Map(); // index -> prepared hole
    this.balls = new Map(); // pid -> { b, key, acts, done }
    this.bots = new Map(); // pid -> { plan, at, think }
    this.away = new Map();
    this.localG = null;
  }

  g() {
    return this.table.get(G_KEY) ?? null;
  }

  write(patch) {
    const g = this.g();
    if (!g) return;
    this.table.set(G_KEY, { ...g, ...patch });
  }

  /** Starts a fresh round (the authority, at match start or when a solo activity begins). */
  start(players, botsSpec) {
    const { kind, settings, seed, mid } = this.ctx;
    const holes = pickHoles(kind, settings, seed, this.ctx.extra ?? {});
    const bots = {};
    const ids = players.slice();
    for (let k = 0; k < botsSpec; k++) {
      const id = `bot-${k + 1}`;
      bots[id] = botIdentity(seed, k);
      ids.push(id);
    }
    const scores = {};
    for (const id of ids) scores[id] = holes.map(() => null);
    const g = { mid, by: this.ctx.me, kind, settings: { ...settings }, holes, players: ids, bots, h: 0, phase: 'intro', t0: this.ctx.clock(), endsAt: 0, firstIn: null, cur: {}, scores, until: 0, results: null, played: {}, dealt: {}, joined: {}, over: false };
    this.table.set(G_KEY, g);
    for (const id of ids) this.table.set(shotKey(id), null);
    this.balls.clear();
    this.bots.clear();
    this.beginHole(g);
  }

  /** Prepared hole for index i (generating runtime holes in chunks; null until ready). */
  hole(i, g = this.g()) {
    if (!g) return null;
    if (this.holes.has(i)) return this.holes.get(i);
    const entry = g.holes[i];
    if (!entry) return null;
    let data = null;
    if (entry.src === 'lib') data = holeData(entry);
    else {
      data = this.gen.get(entry.seed) ?? null;
      if (!data) {
        let job = this.genJobs.get(entry.seed);
        if (!job) {
          job = generateHoleSteps(entry.world, entry.seed, { candidates: 1800, attempts: 5 });
          this.genJobs.set(entry.seed, job);
        }
        // A slice of work per call (the caller does this every frame): about 2-3 ms.
        const t = performance.now();
        for (;;) {
          const r = job.next();
          if (r.done) {
            data = r.value ?? holeData({ src: 'lib', id: `${entry.world}-1` });
            this.gen.set(entry.seed, data);
            this.genJobs.delete(entry.seed);
            break;
          }
          if (performance.now() - t > 2.5) return null;
        }
      }
    }
    if (!data) return null;
    const hole = prepareHole(data);
    this.holes.set(i, hole);
    return hole;
  }

  /** The generator's progress for the hole being built (0-1), or 1. */
  genProgress(i) {
    const g = this.g();
    const entry = g?.holes[i];
    if (!entry || entry.src === 'lib' || this.gen.has(entry.seed)) return 1;
    return 0.5;
  }

  beginHole(g) {
    const t0 = this.ctx.clock();
    const cur = {};
    for (const id of g.players) cur[id] = { n: 0, rest: null, holed: false, up: false, prev: null };
    this.table.set(G_KEY, { ...g, phase: 'intro', t0, endsAt: t0 + INTRO_MS + HOLE_CAP_MS, firstIn: null, cur, played: {}, by: this.ctx.me });
    for (const id of g.players) this.table.set(shotKey(id), null);
    this.balls.clear();
    this.bots.clear();
    this.away.clear();
  }

  /** Called every frame by the authority's page. */
  tick() {
    if (!this.ctx.isAuthority()) return;
    const g = this.g();
    if (!g || g.mid !== this.ctx.mid || g.over) return;
    const now = this.ctx.clock();
    if (g.phase === 'intro') {
      if (now >= g.t0 + INTRO_MS) this.write({ phase: 'play', by: this.ctx.me });
      return;
    }
    if (g.phase === 'play') {
      const hole = this.hole(g.h, g);
      if (!hole) return;
      this.simulateAll(g, hole, now);
      this.runBots(g, hole, now);
      this.checkHoleEnd(g, hole, now);
      return;
    }
    if (g.phase === 'between') {
      this.dealPicks(g);
      this.hole(g.h + 1, g); // a runtime hole is built in slices during the intermission
      if (now >= g.until || this.everyoneOk(g, g.h)) this.nextHole(g);
      return;
    }
    if (g.phase === 'final') {
      if (now >= g.until || this.everyoneOk(g, 'final')) {
        this.write({ over: true });
        this.ctx.onEnd?.();
      }
    }
  }

  everyoneOk(g, what) {
    const online = this.ctx.online().filter((id) => g.players.includes(id));
    if (!online.length) return false;
    for (const id of online) {
      const p = this.ctx.players().get(id);
      if (p?.presence?.ok !== what) return false;
    }
    return true;
  }

  /** Local simulation of every current shot (the authority's canonical balls). */
  simulateAll(g, hole, now) {
    for (const pid of g.players) {
      const s = this.table.get(shotKey(pid));
      const cur = g.cur[pid];
      if (!cur || cur.holed || cur.up) continue;
      if (!s || s.h !== g.h || s.n !== cur.n + 1) continue;
      let entry = this.balls.get(pid);
      const key = `${s.h}.${s.n}.${JSON.stringify(s.acts ?? null)}`;
      if (!entry || entry.key !== key) {
        const rec = this.validShot(g, hole, pid, s, cur);
        if (!rec) continue;
        const b = makeBall(hole, cur.rest ? cur.rest.g : hole.tee.p, cur.rest ? cur.rest.d : [hole.tee.dx, hole.tee.dy, hole.tee.dz]);
        b.quiet = true;
        launchAt(hole, b, (rec.at - g.t0) / 1000, rec.p[0], rec.p[1], rec.p[2], rec.v[0], rec.v[1], rec.v[2], rec.mods);
        entry = { b, key, done: false, rec };
        this.balls.set(pid, entry);
      }
      if (entry.done) continue;
      const b = entry.b;
      const target = Math.floor((now - entry.rec.at) / 1000 / DT);
      let k = 0;
      while (b.step < target && k < MAX_CATCHUP && b.mode !== REST && b.mode !== HOLED) {
        stepBall(hole, b);
        k++;
      }
      if (b.mode === REST || b.mode === HOLED) {
        entry.done = true;
        this.settle(g, hole, pid, s, b, now);
      }
    }
  }

  /** Checks a shot record from another page; returns a clean copy or null. */
  validShot(g, hole, pid, s, cur) {
    if (!s || typeof s !== 'object') return null;
    const p = Array.isArray(s.p) && s.p.length === 3 ? s.p.map((v) => num(v, -200, 200, NaN)) : null;
    const v = Array.isArray(s.v) && s.v.length === 3 ? s.v.map((v) => num(v, -60, 60, NaN)) : null;
    if (!p || !v || p.some(Number.isNaN) || v.some(Number.isNaN)) return null;
    const at = num(s.at, g.t0 + INTRO_MS - 2000, g.t0 + INTRO_MS + HOLE_CAP_MS + 5000, NaN);
    if (Number.isNaN(at)) return null;
    // Must leave from where the ball rests (at that time), at most full power plus the world's own motion.
    const t = (at - g.t0) / 1000;
    const c = centersAt(hole, t, CS);
    const rest = cur.rest ?? { g: hole.tee.p, d: [hole.tee.dx, hole.tee.dy, hole.tee.dz] };
    const b = makeBall(hole, rest.g, rest.d);
    b.t0 = t;
    const rp = ballPos(hole, b, [0, 0, 0]);
    if (Math.hypot(p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]) > SHOT_TOL) return null;
    const vp = planetVel(hole, rest.g, t);
    const rel = Math.hypot(v[0] - vp[0], v[1] - vp[1], v[2] - vp[2]);
    if (rel > MAX_SPEED + 0.5) return null;
    // Mods ride on the shot; acts (a thruster tap, a brake hold) arrive later in the same record.
    const merged = s.mods && typeof s.mods === 'object' ? { ...s.mods } : null;
    if (merged && s.acts && typeof s.acts === 'object') {
      if (Number.isInteger(s.acts.thrust)) merged.thrust = s.acts.thrust;
      if (s.acts.brake && typeof s.acts.brake === 'object') merged.brake = { from: s.acts.brake.from, to: s.acts.brake.to };
    }
    let mods = cleanMods(merged, hole.n);
    const card = typeof s.card === 'string' && CARD_IDS.includes(s.card) ? s.card : null;
    if (!g.bots[pid] && (card || mods)) {
      // A card must come from the player's hand; the authority takes it out and shows it. Mods without a card,
      // or mods that don't match the card, are dropped.
      const hand = this.handOf(pid);
      const fresh = this.g();
      const already = fresh.played[pid] === card && fresh.cur[pid]?.playedN === s.n;
      if (!card || (!hand.includes(card) && !already)) mods = null;
      else {
        if (JSON.stringify(modsFor(card, rest.g)) !== JSON.stringify(stripActs(mods))) mods = null;
        if (!already) {
          this.ctx.setPrivateFor(pid, 'hand', hand.filter((c, i) => i !== hand.indexOf(card)));
          this.write({ played: { ...fresh.played, [pid]: card }, cur: { ...fresh.cur, [pid]: { ...fresh.cur[pid], playedN: s.n } } });
        }
      }
    }
    return { p, v, at, mods };
  }

  handOf(pid) {
    const h = this.ctx.privateOf(pid)?.hand;
    return Array.isArray(h) ? h.filter((c) => CARD_IDS.includes(c)).slice(0, HAND_MAX) : [];
  }

  /** The authority's ball for pid came to rest or dropped: write the canonical result (the shooter's claim if it agrees). */
  settle(g, hole, pid, s, b, now) {
    const fresh = this.g();
    if (!fresh || fresh.h !== g.h || fresh.phase !== 'play') return;
    const cur = fresh.cur[pid];
    if (!cur || cur.n !== s.n - 1) return;
    const holed = b.mode === HOLED;
    let rest = holed ? null : { g: b.rest.g, d: [b.rest.dx, b.rest.dy, b.rest.dz] };
    if (!holed && s.rest && s.rest.g === b.rest.g && Array.isArray(s.rest.d)) {
      const d = s.rest.d.map((v) => num(v, -1, 1, NaN));
      if (!d.some(Number.isNaN)) {
        const R = hole.planets[b.rest.g]?.R ?? 1;
        if (Math.hypot(d[0] - b.rest.dx, d[1] - b.rest.dy, d[2] - b.rest.dz) * R < REST_TOL) rest = { g: b.rest.g, d };
      }
    }
    const n = s.n + b.penalties;
    const cap = strokeCap(hole.par);
    const up = !holed && n >= cap;
    const next = { ...cur, n: Math.min(n, cap), rest, holed, up, prev: { n: cur.n, rest: cur.rest }, at: holed ? now : cur.at };
    const patch = { cur: { ...fresh.cur, [pid]: next } };
    if (holed && !fresh.firstIn) {
      patch.firstIn = pid;
      patch.endsAt = Math.min(fresh.endsAt, now + AFTER_FIRST_MS);
    }
    this.write(patch);
  }

  /** Who still has to finish the hole: bots, and participants who are connected (or only briefly away). */
  active(g, now) {
    const out = [];
    for (const pid of g.players) {
      if (g.bots[pid]) {
        out.push(pid);
        continue;
      }
      if (!this.ctx.isParticipant(pid)) continue;
      const p = this.ctx.players().get(pid);
      const connected = p && p.connected !== false;
      if (connected) {
        this.away.delete(pid);
        out.push(pid);
      } else {
        if (!this.away.has(pid)) this.away.set(pid, now);
        if (now - this.away.get(pid) < AWAY_GRACE_MS) out.push(pid);
      }
    }
    return out;
  }

  checkHoleEnd(g, hole, now) {
    const active = this.active(g, now);
    const unfinished = active.filter((pid) => !g.cur[pid]?.holed && !g.cur[pid]?.up);
    if (unfinished.length && now < g.endsAt) return;
    // Results for this hole.
    const scores = { ...g.scores };
    const cap = strokeCap(hole.par);
    for (const pid of g.players) {
      const c = g.cur[pid] ?? { n: 0 };
      const holed = !!c.holed;
      const row = (scores[pid] ?? g.holes.map(() => null)).slice();
      row[g.h] = { strokes: holed ? c.n : cap, par: hole.par, first: g.firstIn === pid, pickedUp: !holed };
      scores[pid] = row;
    }
    const last = g.h >= g.holes.length - 1;
    if (last || g.kind === 'practice') {
      const rows = standings(g.settings.scoring ?? 'strokes', scores, g.players);
      this.write({ scores, phase: 'final', until: now + FINAL_MS, results: rows.map((r) => ({ id: r.id, total: r.total, strokes: r.strokes, place: r.place })) });
    } else this.write({ scores, phase: 'between', until: now + BETWEEN_MS });
  }

  nextHole(g) {
    const h = g.h + 1;
    // Latecomers may join now: they get par + 2 for the holes they missed.
    const joiners = this.ctx.admitWaiting?.() ?? [];
    const players = g.players.slice();
    const scores = { ...g.scores };
    const joined = { ...g.joined };
    for (const id of joiners) {
      if (players.includes(id)) continue;
      players.push(id);
      joined[id] = h;
      scores[id] = g.holes.map((e, i) => {
        if (i >= h) return null;
        const hd = this.hole(i)?.par ?? 3;
        return { strokes: hd + 2, par: hd, first: false, pickedUp: false };
      });
    }
    if (joiners.length) this.ctx.admit?.(joiners.filter((id) => !g.players.includes(id)));
    this.beginHole({ ...g, h, players, scores, joined });
  }

  /** Card picks: a player's private `pick` for the hole just played goes into their hand (validated). */
  dealPicks(g) {
    if (!g.settings.cards || g.settings.cards === 'off') return;
    for (const pid of g.players) {
      if (g.bots[pid] || g.dealt[pid] === g.h) continue;
      const pick = this.ctx.privateOf(pid)?.pick;
      if (!pick || pick.h !== g.h || typeof pick.card !== 'string') continue;
      const offer = draftFor(this.ctx.seed, g.h, pid);
      if (!offer.includes(pick.card)) continue;
      const hand = this.handOf(pid);
      if (hand.length < HAND_MAX) this.ctx.setPrivateFor(pid, 'hand', [...hand, pick.card]);
      this.write({ dealt: { ...this.g().dealt, [pid]: g.h } });
    }
  }

  /** A mulligan request from pid: take the last finished shot back (the card leaves the hand). */
  mulligan(pid) {
    const g = this.g();
    if (!g || g.phase !== 'play') return false;
    const cur = g.cur[pid];
    if (!cur || !cur.prev || cur.holed || cur.up) return false;
    const s = this.table.get(shotKey(pid));
    if (!s || s.n !== cur.prev.n + 1) return false;
    const entry = this.balls.get(pid);
    if (entry && !entry.done) return false; // still flying
    const hand = this.handOf(pid);
    if (!hand.includes('mulligan') && !g.bots[pid]) return false;
    if (!g.bots[pid]) this.ctx.setPrivateFor(pid, 'hand', hand.filter((c, i) => i !== hand.indexOf('mulligan')));
    this.table.set(shotKey(pid), null);
    this.balls.delete(pid);
    this.write({ cur: { ...g.cur, [pid]: { ...cur, n: cur.prev.n, rest: cur.prev.rest, prev: null } }, played: { ...g.played, [pid]: 'mulligan' } });
    return true;
  }

  /** Bots: plan in chunks, wait a human-like while, then shoot. */
  runBots(g, hole, now) {
    for (const pid of Object.keys(g.bots)) {
      const cur = g.cur[pid];
      if (!cur || cur.holed || cur.up) continue;
      const s = this.table.get(shotKey(pid));
      if (s && s.h === g.h && s.n === cur.n + 1) continue; // its shot is in the air (or waiting to be settled)
      let bot = this.bots.get(pid);
      const n = cur.n + 1;
      if (!bot || bot.n !== n) {
        const rng = makeRng(seedOf(this.ctx.seed, g.h, pid, n));
        const rest = cur.rest ?? { g: hole.tee.p, d: [hole.tee.dx, hole.tee.dy, hole.tee.dz] };
        const ball = makeBall(hole, rest.g, rest.d);
        const think = thinkTime(g.bots[pid].tier, rng);
        const at = now + think * 1000;
        bot = { n, at, plan: planShotSteps(hole, ball, (at - g.t0) / 1000, g.bots[pid].tier, seedOf(this.ctx.seed, g.h, pid, n, 'plan')), result: null };
        this.bots.set(pid, bot);
      }
      if (!bot.result) {
        const r = bot.plan.next(); // one chunk (8 candidates) per frame per bot
        if (r.done) bot.result = r.value;
        continue;
      }
      if (now < bot.at) continue;
      const at = Math.max(now, bot.at);
      // The plan was made for bot.at; a late frame shifts it slightly on a moving world, which is fine for a bot.
      this.table.set(shotKey(pid), { h: g.h, n, p: bot.result.p, v: bot.result.v, at, mods: null, acts: null });
    }
  }

  /** A new authority (host change, reload) carries on from the table. Safe to call repeatedly. */
  adopt() {
    const g = this.g();
    if (!g || g.mid !== this.ctx.mid || !this.ctx.isAuthority()) return false;
    if (g.by !== this.ctx.me) {
      this.balls.clear();
      this.bots.clear();
      this.write({ by: this.ctx.me });
    }
    return true;
  }
}

const CS = new Float64Array(MAX_PLANETS * 3);

function stripActs(m) {
  if (!m) return null;
  const { thrust, brake, ...rest } = m;
  return rest;
}

export { BALL_R };

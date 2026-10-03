// The round rules and the session, headless: a host page and two client pages share one table (room state), shoot,
// settle, snap, change host, reload, pick cards, pick up and run through to the final standings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Round, setLibrary, INTRO_MS, pickHoles } from '../src/game/round.js';
import { Session } from '../src/game/session.js';
import { localTable, G_KEY, shotKey } from '../src/game/table.js';
import { REST, HOLED, DT } from '../src/sim/ball.js';
import { planShot } from '../src/sim/bots.js';
import { draftFor } from '../src/sim/cards.js';

const lib = JSON.parse(readFileSync(new URL('../data/holes.json', import.meta.url), 'utf8'));
setLibrary(lib);

/** A pretend room shared by a few pages: one table, a clock, private values, connection flags. */
function makeRoom(ids) {
  const table = localTable();
  const priv = Object.fromEntries(ids.map((id) => [id, {}]));
  const players = new Map(ids.map((id) => [id, { id, connected: true, presence: null }]));
  let now = 0;
  const room = { table, priv, players, host: ids[0], seed: 4242, mid: 'm1', settings: { holes: 2, world: 'pebble-binary', scoring: 'strokes', preview: 'short', cards: 'on', fill: 'off' }, now: () => now, advance: (ms) => (now += ms), connected: new Set(ids), ended: 0 };
  room.ctx = (me) => ({
    table,
    me,
    clock: () => now,
    isAuthority: () => room.host === me && room.connected.has(me),
    online: () => ids.filter((id) => room.connected.has(id)),
    isParticipant: (id) => ids.includes(id),
    players: () => players,
    privateOf: (id) => priv[id],
    setPrivateFor: (id, k, v) => {
      if (v == null) delete priv[id][k];
      else priv[id][k] = v;
    },
    admitWaiting: () => [],
    admit: () => {},
    onEnd: () => room.ended++,
    seed: room.seed,
    mid: room.mid,
    kind: 'match',
    settings: room.settings,
  });
  return room;
}

function page(room, me) {
  const ctx = room.ctx(me);
  const events = [];
  const round = new Round(ctx);
  const session = new Session({ table: ctx.table, me, clock: ctx.clock, isParticipant: ctx.isParticipant, onEvent: (pid, ev) => events.push([pid, ev.k]) });
  return { me, round, session, events, ctx };
}

/** One frame for every page: the authority ticks, everyone syncs. */
function frame(room, pages, ms = 50) {
  room.advance(ms);
  for (const p of pages) {
    if (p.ctx.isAuthority()) {
      p.round.adopt();
      p.round.tick();
    }
    const g = p.round.g();
    const hole = g ? p.round.hole(g.h, g) : null;
    p.session.update(g, hole, room.now(), ms);
  }
}

function runUntil(room, pages, pred, maxMs = 120000, step = 50) {
  for (let t = 0; t < maxMs; t += step) {
    frame(room, pages, step);
    if (pred()) return true;
  }
  return false;
}

/** The local player shoots like a Club bot would. */
function botShoot(p, room) {
  const s = p.session;
  const b = s.myBall();
  const g = s.g;
  const plan = planShot(s.hole, b, (room.now() - g.t0) / 1000, 'pro', 99);
  return s.shoot(plan.dir, Math.min(1, plan.speed / 38), room.now());
}

test('a two-hole round: shots settle through the host, pages agree, results and standings land', () => {
  const room = makeRoom(['a', 'b', 'c']);
  const pages = ['a', 'b', 'c'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b', 'c'], 0);
  const g0 = room.table.get(G_KEY);
  assert.equal(g0.phase, 'intro');
  assert.equal(g0.holes.length, 2);
  assert.ok(g0.holes.every((h) => h.src === 'lib'));
  assert.ok(runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000));
  for (const p of pages) assert.equal(p.session.state(), 'aim');
  // Everyone shoots at once.
  for (const p of pages) assert.ok(botShoot(p, room), `${p.me} shoots`);
  for (const p of pages) assert.equal(p.session.state(), 'flying');
  assert.ok(runUntil(room, pages, () => ['a', 'b', 'c'].every((id) => room.table.get(G_KEY).cur[id].n >= 1), 60000), 'all first shots settled by the host');
  const g1 = room.table.get(G_KEY);
  for (const id of ['a', 'b', 'c']) {
    const cur = g1.cur[id];
    assert.ok(cur.holed || cur.rest, `${id} has a canonical rest or holed`);
    assert.ok(cur.n >= 1 && cur.n <= 7);
  }
  // Every page's ball matches the canonical rest (no snap needed for honest pages).
  for (const p of pages) {
    for (const id of ['a', 'b', 'c']) {
      const cur = g1.cur[id];
      const b = p.session.entry(id)?.b;
      if (cur.holed) assert.equal(b.mode, HOLED);
      else {
        assert.equal(b.mode, REST);
        assert.equal(b.rest.g, cur.rest.g);
        assert.ok(Math.hypot(b.rest.dx - cur.rest.d[0], b.rest.dy - cur.rest.d[1], b.rest.dz - cur.rest.d[2]) < 1e-9);
      }
    }
  }
  // Play the hole out: keep shooting whenever a page can.
  let guard = 0;
  while (room.table.get(G_KEY).phase === 'play' && guard++ < 400) {
    for (const p of pages) if (p.session.state() === 'aim') botShoot(p, room);
    runUntil(room, pages, () => pages.some((p) => p.session.state() === 'aim') || room.table.get(G_KEY).phase !== 'play', 60000);
  }
  const g2 = room.table.get(G_KEY);
  assert.equal(g2.phase, 'between');
  for (const id of ['a', 'b', 'c']) assert.ok(g2.scores[id][0].strokes >= 1 && g2.scores[id][0].strokes <= 6);
  // Card picks: a valid pick lands in the hand, a bogus one does not.
  const offer = draftFor(room.seed, 0, 'b');
  room.priv.b.pick = { h: 0, card: offer[1] };
  room.priv.c.pick = { h: 0, card: 'nonsense' };
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'intro', 10000);
  assert.deepEqual(room.priv.b.hand, [offer[1]]);
  assert.equal(room.priv.c.hand, undefined);
  assert.equal(room.table.get(G_KEY).h, 1);
  // Second hole: b plays its card on the shot; the host takes it out of the hand and shows it.
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  pages[1].session.card = offer[1];
  const rec = botShoot(pages[1], room);
  assert.equal(rec.card, offer[1]);
  runUntil(room, pages, () => room.table.get(G_KEY).cur.b.n >= 1, 60000);
  assert.deepEqual(room.priv.b.hand, []);
  assert.equal(room.table.get(G_KEY).played.b, offer[1]);
  // The rest pick up: the hole ends, the final standings exist, the match ends.
  for (const p of pages) {
    const g = p.round.g();
    if (p.ctx.isAuthority()) {
      for (const id of ['a', 'c']) {
        const cur = p.round.g().cur[id];
        if (!cur.holed) p.round.write({ cur: { ...p.round.g().cur, [id]: { ...cur, n: 7, up: true, rest: null } } });
      }
    }
  }
  guard = 0;
  while (room.table.get(G_KEY).phase === 'play' && guard++ < 400) {
    for (const p of pages) if (p.session.state() === 'aim') botShoot(p, room);
    runUntil(room, pages, () => pages.some((p) => p.session.state() === 'aim') || room.table.get(G_KEY).phase !== 'play', 60000);
  }
  const g3 = room.table.get(G_KEY);
  assert.equal(g3.phase, 'final');
  assert.equal(g3.results.length, 3);
  assert.ok(g3.results.every((r) => r.place >= 1 && Number.isFinite(r.total)));
  runUntil(room, pages, () => room.ended > 0, 30000);
  assert.equal(room.ended, 1);
});

test('a host change mid-flight: the new host adopts the record and settles the shot the same way', () => {
  const room = makeRoom(['a', 'b']);
  const pages = ['a', 'b'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b'], 1);
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  botShoot(pages[1], room);
  frame(room, pages, 500);
  // The host goes: b becomes the authority with a fresh Round (as a reloaded page would).
  room.connected.delete('a');
  room.host = 'b';
  const fresh = page(room, 'b');
  const before = room.table.get(G_KEY);
  assert.notEqual(before.by, 'b');
  frame(room, [fresh], 50);
  assert.equal(room.table.get(G_KEY).by, 'b', 'the new host signs the record');
  assert.ok(runUntil(room, [fresh], () => room.table.get(G_KEY).cur.b.n >= 1, 60000), 'the shot still settles');
  // Compare with what an uninterrupted simulation says.
  const s = room.table.get(shotKey('b'));
  const cur = room.table.get(G_KEY).cur.b;
  assert.ok(cur.holed || cur.rest);
  // The claim is only a hint: when the shooter's page got there first, its honest claim is kept as is.
  if (cur.rest && s.rest) assert.deepEqual(cur.rest.d, s.rest.d, 'an honest claim is kept as is');
  // The bot shot too (host-run), and its record is valid.
  runUntil(room, [fresh], () => !!room.table.get(shotKey('bot-1')), 20000);
  const bs = room.table.get(shotKey('bot-1'));
  assert.ok(bs && bs.h === 0 && bs.n >= 1);
});

test('a reloaded page restores its ball from the record and keeps playing', () => {
  const room = makeRoom(['a', 'b']);
  const pages = ['a', 'b'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b'], 0);
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  botShoot(pages[1], room);
  runUntil(room, pages, () => room.table.get(G_KEY).cur.b.n >= 1, 60000);
  const cur = room.table.get(G_KEY).cur.b;
  const again = page(room, 'b');
  frame(room, [pages[0], again], 50);
  const b = again.session.entry('b').b;
  if (cur.holed) assert.equal(b.mode, HOLED);
  else {
    assert.equal(b.mode, REST);
    assert.equal(b.rest.g, cur.rest.g);
    assert.equal(again.session.state(), 'aim');
  }
  // A page that reloads mid-flight resumes from the shot record at the right step.
  if (!cur.holed) {
    botShoot(again, room);
    frame(room, [pages[0], again], 1000);
    const late = page(room, 'b');
    frame(room, [pages[0], late], 50);
    const e = late.session.entry('b');
    assert.ok(e.rec && e.rec.n === cur.n + 1);
    assert.ok(e.b.step > 100, `fast-forwarded to the clock (${e.b.step} steps)`);
  }
});

test('bad shot records are ignored by the host and never crash a client', () => {
  const room = makeRoom(['a', 'b']);
  const pages = ['a', 'b'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b'], 0);
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  const bad = [
    { h: 0, n: 1, p: [NaN, 0, 0], v: [1, 1, 1], at: room.now() },
    { h: 0, n: 1, p: [0, 0, 0], v: [1e9, 0, 0], at: room.now() },
    { h: 0, n: 1, p: 'x', v: [1, 1, 1], at: room.now() },
    { h: 0, n: 5, p: [0, 0, 0], v: [1, 1, 1], at: room.now() },
    { h: 0, n: 1, p: [0, 0, 0], v: [50, 0, 0], at: room.now(), mods: { gplanet: 99, gfactor: 7, thrust: 'x' } },
    null,
    42,
  ];
  for (const rec of bad) {
    room.table.set(shotKey('b'), rec);
    for (let i = 0; i < 10; i++) frame(room, pages, 100);
    assert.equal(room.table.get(G_KEY).cur.b.n, 0, 'nothing counted');
  }
  // A shot from the wrong place (teleport) is ignored too.
  const g = room.table.get(G_KEY);
  room.table.set(shotKey('b'), { h: 0, n: 1, p: [0, 0, 0], v: [5, 5, 5], at: room.now() });
  for (let i = 0; i < 40; i++) frame(room, pages, 100);
  assert.equal(room.table.get(G_KEY).cur.b.n, 0);
  assert.equal(g.mid, 'm1');
});

test('the hole clock ends a hole: thirty seconds after the first drop, three minutes at most', () => {
  const room = makeRoom(['a', 'b']);
  const pages = ['a', 'b'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b'], 0);
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  const g = room.table.get(G_KEY);
  assert.ok(g.endsAt - g.t0 >= 180000);
  // Nobody shoots: the cap ends the hole with pick-ups.
  assert.ok(runUntil(room, pages, () => room.table.get(G_KEY).phase !== 'play', 200000, 1000));
  const g2 = room.table.get(G_KEY);
  assert.ok(g2.scores.a[0].pickedUp && g2.scores.b[0].pickedUp);
  assert.equal(g2.scores.a[0].strokes, g2.scores.a[0].par + 4);
});

test('pickHoles: daily, practice, tour and the world pairs', () => {
  assert.equal(pickHoles('daily', {}, 20000).length, 1);
  assert.equal(pickHoles('practice', {}, 1, { hole: { src: 'lib', id: 'ice-3' } })[0].id, 'ice-3');
  const tour = pickHoles('tour', {}, 5, { stage: 2 });
  assert.equal(tour.length, 9);
  assert.ok(tour.every((e) => e.src === 'lib'));
  const pair = pickHoles('match', { holes: 6, world: 'lava-ice' }, 9);
  assert.ok(pair.every((e, i) => e.id.startsWith(i % 2 ? 'ice' : 'lava')));
  const rnd = pickHoles('match', { holes: 3, world: 'random' }, 9);
  assert.ok(rnd.every((e) => e.src === 'gen' && typeof e.seed === 'number'));
  assert.equal(pickHoles('match', { holes: 99, world: 'auto' }, 1).length, 6, 'absurd settings fall back');
});

export { INTRO_MS, DT };

test('cards: a thruster act reaches the host, Long Look is consumed, a mulligan takes a shot back', () => {
  const room = makeRoom(['a', 'b']);
  const pages = ['a', 'b'].map((id) => page(room, id));
  pages[0].round.start(['a', 'b'], 0);
  runUntil(room, pages, () => room.table.get(G_KEY).phase === 'play', 10000);
  room.priv.b.hand = ['thruster', 'preview', 'mulligan'];
  // b shoots with the thruster and taps it a moment later; the host's canonical rest must include the boost.
  pages[1].session.card = 'thruster';
  const rec = botShoot(pages[1], room);
  assert.equal(rec.card, 'thruster');
  assert.deepEqual(rec.mods, { thruster: true });
  frame(room, pages, 400);
  assert.ok(pages[1].session.act('thrust', room.now()), 'the tap is recorded');
  const s = room.table.get(shotKey('b'));
  assert.ok(Number.isInteger(s.acts.thrust));
  runUntil(room, pages, () => room.table.get(G_KEY).cur.b.n >= 1, 60000);
  const cur = room.table.get(G_KEY).cur.b;
  const local = pages[1].session.entry('b').b;
  if (!cur.holed) {
    assert.equal(local.mode, REST);
    assert.ok(Math.hypot(local.rest.dx - cur.rest.d[0], local.rest.dy - cur.rest.d[1], local.rest.dz - cur.rest.d[2]) < 1e-9, 'host and shooter agree with the act applied');
  }
  assert.deepEqual(room.priv.b.hand, ['preview', 'mulligan']);
  assert.equal(room.table.get(G_KEY).played.b, 'thruster');
  if (cur.holed) return;
  // Long Look: played on the next shot, it leaves the hand even though it changes nothing in the physics.
  pages[1].session.card = 'preview';
  const rec2 = botShoot(pages[1], room);
  assert.equal(rec2.card, 'preview');
  assert.equal(rec2.mods, null);
  runUntil(room, pages, () => room.table.get(G_KEY).cur.b.n >= cur.n + 1 || room.table.get(G_KEY).cur.b.holed, 60000);
  assert.deepEqual(room.priv.b.hand, ['mulligan']);
  const cur2 = room.table.get(G_KEY).cur.b;
  if (cur2.holed) return;
  // Mulligan: the host takes the last shot back.
  assert.ok(pages[0].round.mulligan('b'));
  const cur3 = room.table.get(G_KEY).cur.b;
  assert.equal(cur3.n, cur.n);
  assert.deepEqual(cur3.rest, cur.rest);
  assert.deepEqual(room.priv.b.hand, []);
  frame(room, pages, 50);
  assert.equal(pages[1].session.state(), 'aim');
  const b = pages[1].session.entry('b').b;
  assert.equal(b.rest.g, cur.rest.g);
});

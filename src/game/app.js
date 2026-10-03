// The app: screens, the room, matches and the solo activities in the clubhouse. Joins the room first, then builds
// the scene. The match's rules run in Round (host), every page draws from Session, Play handles the controls.
import { ow, onPlatform, joinRoom, on, settings, controls, now as pnow, ui, onPlatformEvent, avatarUrl, safe } from './platform.js';
import { roomTable, localTable, G_KEY } from './table.js';
import { Round, setLibrary, FINAL_MS, buildEntry, entryReady, pickHoles } from './round.js';
import { Session } from './session.js';
import { Play } from './play.js';
import { Profile, today } from './profile.js';
import { Screens } from '../ui/screens.js';
import { Hud } from '../ui/hud.js';
import { Input } from '../ui/input.js';
import { Gfx } from '../render/gfx.js';
import { Backdrop } from '../render/backdrop.js';
import { World } from '../render/world.js';
import { ChaseCamera } from '../render/camera.js';
import { Audio } from '../audio/audio.js';
import { Showcase } from '../render/showcase.js';
import { draftFor, HAND_MAX } from '../sim/cards.js';
import { standings, resultWord, parTotal } from '../sim/score.js';
import { WORLDS, worldById, WORLD_IDS } from '../sim/worlds.js';
import { seedOf } from '../sim/rng.js';
import { planShot } from '../sim/bots.js';
import { MAX_SPEED, makeBall, launchAt, runToRest, ballPos } from '../sim/ball.js';
import { prepareHole, teePos } from '../sim/hole.js';
import library from '../../data/holes.json';

const SHOWCASE_SEED = 3728827386;

export const JOIN_OPTIONS = {
  mode: 'links',
  maxPlayers: 8,
  minPlayers: 1,
  lobby: 'bar',
  settings: [
    { id: 'holes', label: 'Holes', options: [3, 6, 9], default: 6 },
    {
      id: 'world',
      label: 'World',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'random', label: 'Random' },
        { value: 'pebble-binary', label: 'Pebble & Binary' },
        { value: 'lava-ice', label: 'Lava & Ice' },
        { value: 'clockwork-wormhole', label: 'Clockwork & Wormhole' },
        { value: 'casino-comet', label: 'Casino & Comet' },
      ],
      default: 'auto',
    },
    { id: 'scoring', label: 'Scoring', options: [{ value: 'strokes', label: 'Strokes' }, { value: 'points', label: 'Points' }, { value: 'speed', label: 'Speed' }], default: 'strokes' },
    { id: 'preview', label: 'Preview', options: [{ value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }, { value: 'none', label: 'None' }], default: 'short' },
    { id: 'cards', label: 'Cards', options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], default: 'off' },
    { id: 'fill', label: 'Fill', options: [{ value: 'off', label: 'Off' }, { value: '4', label: 'Bots to 4' }, { value: '8', label: 'Bots to 8' }], default: '4' },
  ],
};

export class App {
  constructor(params) {
    this.params = params;
    this.testing = params.has('test') || /localhost$/.test(location.hostname);
    this.auto = params.get('test') === 'auto';
    this.canvas = document.getElementById('game');
    this.gfx = new Gfx(this.canvas);
    this.backdrop = new Backdrop(this.gfx, 7);
    this.world = new World(this.gfx);
    this.camera = new ChaseCamera(this.gfx.camera);
    this.hud = new Hud(document.getElementById('hud'));
    this.input = new Input(this.canvas);
    this.screens = new Screens(document.getElementById('ui'), this);
    this.audio = new Audio();
    this.profile = new Profile();
    this.room = null;
    this.round = null;
    this.session = null;
    this.play = null;
    this.mode = 'boot'; // boot | title | club | match | solo | closed
    this.solo = null; // { kind, table, priv, pausedAt, pausedTotal }
    this.last = 0;
    this.presenceSent = '';
    this.presenceAt = 0;
    this.avatars = new Map();
    this.shown = new Set(); // between/final cards shown, keyed by mid.h
    this.banked = new Set();
    this.roundXp = 0;
    this.showcase = null;
    this.results = null;
    this.lastHole = null;
    setLibrary(library);
    window.addEventListener('resize', () => this.resize());
    settings.onChange(() => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.profile.write();
      else this.last = 0;
    });
    this.camera.reduced = settings.reducedMotion;
    if (settings.reducedMotion) document.body.classList.add('reduced');
    // Any gesture inside the game may wake a suspended audio context; Esc backs out of the clubhouse screens.
    this.input.on('press', () => this.audio.resume());
    this.input.on('keydown', (k) => {
      this.audio.resume();
      if (k === 'Escape' && this.mode === 'club' && this.screens.name !== 'club') this.club();
      if (k === 'Enter' && this.mode === 'title' && document.activeElement?.tagName !== 'BUTTON') this.screens.current?.querySelector('button')?.click();
    });
  }

  resize() {
    this.gfx.resize();
    this.hud.resize();
  }

  async start() {
    // Join first, before any heavy scene: a reload must not miss its seat.
    const roomP = joinRoom(JOIN_OPTIONS);
    await this.profile.load();
    this.world.setLook(this.profile.look());
    this.audio.setPlink(this.profile.look().plink);
    this.profile.onChange(() => {
      this.world.setLook(this.profile.look());
      this.showcase?.setLook(this.profile.look());
      this.audio.setPlink(this.profile.look().plink);
    });
    this.room = await roomP;
    if (!this.room) {
      this.screens.closed('disconnected', () => location.reload());
      return;
    }
    this.wireRoom(this.room);
    onPlatformEvent('pause', () => this.pause(true));
    onPlatformEvent('resume', () => this.pause(false));
    this.title();
    requestAnimationFrame((t) => this.frame(t));
    if (this.testing) window.__perigee = this;
  }

  // ---------------------------------------------------------------- screens
  title() {
    this.mode = 'title';
    controls.set(null);
    this.showShowcase();
    // One button over the world: the platform's Ready strip waits for the clubhouse.
    safe(() => this.room.hideLobby?.(true));
    this.screens.title(() => {
      this.audio.start();
      this.enter(true);
    });
    if (this.auto) setTimeout(() => this.screens.current?.querySelector('button')?.click(), 300);
  }

  /**
   * After the title: the match if one is running, else the clubhouse. Play means play: the player readies at once
   * (alone in a public server the round starts after the countdown); a private server's host picks and starts.
   */
  enter(fromPlay = false) {
    const m = this.room.match;
    if (m.phase === 'playing' || m.phase === 'starting') this.enterMatch();
    else {
      this.club();
      if (fromPlay && m.phase === 'lobby' && !(this.room.kind === 'private' && this.room.isHost)) safe(() => this.room.setReady(true));
    }
  }

  club() {
    this.leaveMatch();
    this.mode = 'club';
    controls.set(null);
    safe(() => this.room.hideLobby?.(false));
    this.showShowcase();
    this.drawClub();
    if (this.auto && this.room.kind === 'solo') setTimeout(() => this.room.setReady(true), 500);
  }

  /** Draws (or redraws: the host changed a setting, the host moved) the clubhouse. */
  drawClub() {
    const room = this.room;
    const soloOk = !(room.kind === 'private' && room.isHost && room.players.size > 1);
    const d = this.profile.data.daily;
    const day = today();
    const editable = !!room.isHost && room.match.phase === 'lobby';
    this.screens.clubhouse({
      profile: this.profile,
      room,
      schema: JOIN_OPTIONS.settings,
      values: Object.fromEntries(JOIN_OPTIONS.settings.map((st) => [st.id, room.settings?.[st.id] ?? st.default])),
      editable,
      onSetting: (id, value) => {
        safe(() => room.setSetting(id, value));
        this.audio.click();
        this.drawClub();
      },
      solo: soloOk,
      results: this.results,
      daily: { played: d.day === day, best: d.best, streak: d.last >= day - 1 ? d.streak : 0 },
      onDaily: () => this.startSolo('daily'),
      onPractice: () => {
        safe(() => this.room.hideLobby?.(true));
        this.screens.practice(this.profile, (id) => this.startSolo('practice', { hole: { src: 'lib', id } }), () => this.club());
      },
      onTour: () => this.startSolo('tour', { stage: this.profile.data.tour.stage }),
      onLocker: () => {
        safe(() => this.room.hideLobby?.(true));
        this.screens.locker(this.profile, () => this.club());
      },
      onInvite: () => ui.showInvite(),
    });
  }

  /** The title and clubhouse scene: a small solar system turning while a ball flies its orbit into the cup. */
  showShowcase() {
    if (!this.showcase) {
      // "Tail Slingshot": a ball swung round a ringed giant into a cup across the system (found by its seed).
      const data = library.holes.find((h) => h.seed === SHOWCASE_SEED) ?? library.holes.find((h) => h.world === 'comet') ?? library.holes[0];
      this.showcase = new Showcase(this.gfx, this.world, data);
    }
    this.showcase.enter(this.profile.look());
    this.showcase.shiftX = 0;
    this.camera.mode = 'orbit';
    this.camera.endIntro();
  }

  // ---------------------------------------------------------------- the room
  wireRoom(room) {
    on(room, 'matchstart', () => {
      if (this.solo) this.endSolo(true);
      if (room.isHost) this.hostStart();
      this.enterMatch();
    });
    on(room, 'matchend', () => this.club());
    on(room, 'host', () => this.round?.adopt());
    on(room, 'reconnect', () => this.round?.adopt());
    on(room, 'back', () => this.round?.adopt());
    on(room, 'close', (reason) => this.closed(reason));
    on(room, 'rename', () => {
      if (this.play) this.play.sideKey = '';
    });
    on(room, 'join', (p) => this.loadAvatar(p.id));
    // The clubhouse shows the settings and who picks them: redraw it when either changes.
    const redraw = () => {
      if (this.mode === 'club' && this.screens.name === 'club') this.drawClub();
    };
    on(room, 'settings', redraw);
    on(room, 'host', redraw);
    on(room, 'match', redraw);
    on(room, 'join', redraw);
    on(room, 'leave', redraw);
    on(room, 'message', (data, from) => this.onMessage(data, from));
  }

  hostStart() {
    const room = this.room;
    this.startedFor = room.match.id;
    const participants = room.match.participants.slice();
    const fill = room.settings.fill;
    const want = fill === '8' ? 8 : fill === '4' ? 4 : 0;
    const bots = Math.max(0, want - participants.length);
    this.makeMatchRound();
    this.round.start(participants, bots);
  }

  makeMatchRound() {
    const room = this.room;
    const ctx = {
      table: roomTable(room),
      me: room.me.id,
      clock: () => room.matchNow(),
      isAuthority: () => room.isHost && room.connected,
      online: () => room.online.map((p) => p.id),
      isParticipant: (id) => room.isParticipant(id),
      players: () => room.players,
      privateOf: (id) => (id === room.me.id ? room.private : room.privateOf(id)) ?? {},
      setPrivateFor: (id, k, v) => safe(() => (id === room.me.id ? room.setPrivate(k, v) : room.setPrivateFor(id, k, v))),
      admitWaiting: () => room.spectators.filter((p) => p.connected !== false && !p.idle).map((p) => p.id),
      admit: (ids) => safe(() => room.admit(ids)),
      onEnd: () => safe(() => room.endMatch()),
      seed: room.match.seed ?? 1,
      mid: room.match.id,
      kind: 'match',
      settings: room.settings,
      extra: { first: (this.profile.data.stats.holes ?? 0) === 0 },
    };
    this.round = new Round(ctx);
    this.session = new Session({ table: ctx.table, me: ctx.me, clock: ctx.clock, isParticipant: (id) => room.isParticipant(id), onEvent: (...a) => this.play?.onEvent(...a) });
    this.roundCtx = ctx;
  }

  enterMatch() {
    if (this.mode === 'match' && this.round && this.roundCtx?.mid === this.room.match.id) return;
    this.leaveMatch();
    this.mode = 'match';
    this.results = null;
    this.makeMatchRound();
    this.round.adopt();
    for (const id of this.room.match.participants) this.loadAvatar(id);
    this.makePlay('match');
  }

  makePlay(kind) {
    this.play?.dispose();
    this.showcase?.leave();
    const room = this.room;
    this.play = new Play({
      session: this.session,
      round: this.round,
      world: this.world,
      camera: this.camera,
      hud: this.hud,
      screens: this.screens,
      audio: this.audio,
      input: this.input,
      profile: this.profile,
      clock: this.roundCtx.clock,
      me: room.me.id,
      kind,
      names: (id) => this.nameOf(id),
      isBot: (id) => !!this.session.g?.bots?.[id],
      playerInfo: (id) => room.players.get(id) ?? null,
      setPresence: (p) => this.setPresence(p),
      preview: this.solo ? this.profile.data.preview ?? 'short' : room.settings.preview,
      touch: () => controls.touch,
    });
    this.play.handProvider = () => {
      const h = this.roundCtx.privateOf(room.me.id)?.hand;
      return Array.isArray(h) ? h.slice(0, HAND_MAX) : [];
    };
    this.play.onPickUp = () => this.pickUp();
    this.play.onMulligan = () => this.mulligan();
    this.play.onMyHole = (info) => this.myHole(info);
    this.play.onQuit = () => this.endSolo(false);
    this.play.onNext = () => this.nextPractice();
    this.play.ui = null;
    this.shown.clear();
    this.roundXp = 0;
  }

  leaveMatch() {
    if (this.play) {
      this.play.dispose();
      this.play = null;
    }
    this.round = null;
    this.session = null;
    this.roundCtx = null;
    this.screens.clear();
    this.world.hidePreview();
  }

  nameOf(id) {
    const g = this.session?.g;
    if (g?.bots?.[id]) return g.bots[id].name;
    return this.room.players.get(id)?.name ?? 'Someone';
  }

  loadAvatar(id) {
    if (this.avatars.has(id)) return;
    this.avatars.set(id, null);
    Promise.resolve(avatarUrl(id, 'head')).then((url) => {
      if (url) this.avatars.set(id, url);
    });
  }

  setPresence(p) {
    const s = JSON.stringify(p);
    const t = Date.now();
    if (s === this.presenceSent || t - this.presenceAt < 250) return;
    this.presenceSent = s;
    this.presenceAt = t;
    if (this.mode === 'match') safe(() => this.room.setPresence(p));
  }

  closed(reason) {
    this.leaveMatch();
    if (this.solo) this.endSolo(true);
    this.mode = 'closed';
    controls.set(null);
    this.screens.closed(reason, async () => {
      this.screens.clear();
      const room = await joinRoom(JOIN_OPTIONS);
      if (!room) return this.screens.closed('disconnected', () => location.reload());
      this.room = room;
      this.wireRoom(room);
      this.enter();
    });
  }

  pause(paused) {
    if (!this.solo) return;
    const s = this.solo;
    if (paused && !s.pausedAt) s.pausedAt = pnow();
    else if (!paused && s.pausedAt) {
      s.pausedTotal += pnow() - s.pausedAt;
      s.pausedAt = 0;
    }
  }

  // ---------------------------------------------------------------- solo activities
  startSolo(kind, extra = {}) {
    this.leaveMatch();
    const room = this.room;
    const table = localTable();
    const priv = {};
    const solo = { kind, table, priv, pausedAt: 0, pausedTotal: 0, n: (this.soloN = (this.soloN ?? 0) + 1), extra };
    this.solo = solo;
    const clock = () => (solo.pausedAt ? solo.pausedAt : pnow()) - solo.pausedTotal;
    const day = today();
    const ctx = {
      table,
      me: room.me.id,
      clock,
      isAuthority: () => true,
      online: () => [room.me.id],
      isParticipant: () => true,
      players: () => room.players,
      privateOf: () => priv,
      setPrivateFor: (id, k, v) => {
        if (v === null || v === undefined) delete priv[k];
        else priv[k] = v;
      },
      admitWaiting: () => [],
      admit: () => {},
      onEnd: () => {},
      seed: kind === 'daily' ? day : seedOf(kind, Date.now(), solo.n),
      mid: `solo-${solo.n}`,
      kind,
      settings: { holes: kind === 'tour' ? 9 : 1, world: 'auto', scoring: 'strokes', preview: this.profile.data.preview ?? 'short', cards: kind === 'tour' ? 'on' : 'off', fill: 'off' },
      extra,
    };
    this.round = new Round(ctx);
    this.session = new Session({ table, me: ctx.me, clock, isParticipant: () => true, onEvent: (...a) => this.play?.onEvent(...a) });
    this.roundCtx = ctx;
    this.mode = 'solo';
    safe(() => room.hideLobby?.(true));
    this.makePlay(kind);
    this.round.start([room.me.id], 0);
  }

  endSolo(silent) {
    const s = this.solo;
    this.solo = null;
    this.leaveMatch();
    safe(() => this.room.hideLobby?.(false));
    if (!silent) this.club();
    return s;
  }

  nextPractice() {
    const s = this.solo;
    if (!s || s.kind !== 'practice') return;
    const id = s.extra.hole?.id ?? 'pebble-1';
    const [world, n] = id.split('-');
    const next = Number(n) >= 9 ? `${WORLD_IDS[(WORLD_IDS.indexOf(world) + 1) % WORLD_IDS.length]}-1` : `${world}-${Number(n) + 1}`;
    this.startSolo('practice', { hole: { src: 'lib', id: next } });
  }

  // ---------------------------------------------------------------- actions from play
  pickUp() {
    const g = this.session?.g;
    if (!g) return;
    const me = this.room.me.id;
    const cur = g.cur[me];
    if (!cur || cur.holed || cur.up) return;
    // The player gives up the hole: in a match the host does the bookkeeping from the claim; solo the round is ours.
    if (this.round && this.roundCtx.isAuthority()) {
      const hole = this.round.hole(g.h);
      const cap = hole ? hole.par + 4 : 7;
      this.round.write({ cur: { ...this.round.g().cur, [me]: { ...cur, n: cap, up: true } } });
      this.round.balls.delete(me);
    } else safe(() => this.room.send({ t: 'pickup', h: g.h }, { to: this.room.host }));
    this.screens.toast('Picked up', 'ice', 1500);
  }

  /** Take the last shot back (the Mulligan card): the authority does it, or is asked to. */
  mulligan() {
    const g = this.session?.g;
    if (!g || g.phase !== 'play') return;
    const me = this.room.me.id;
    if (this.round && this.roundCtx.isAuthority()) {
      if (this.round.mulligan(me)) this.screens.toast('Shot taken back', 'ice', 1400);
      else this.screens.toast('Nothing to take back', 'ice', 1200);
    } else {
      safe(() => this.room.send({ t: 'mull', h: g.h }, { to: this.room.host }));
      this.screens.toast('Asking for it back', 'ice', 1200);
    }
  }

  myHole({ strokes, par, ace, b, holeId, world, now, endsAt }) {
    this.profile.award('first-cup');
    if (ace && holeId) this.profile.perigee(holeId);
    if (endsAt && endsAt - now < 1500 && endsAt - now > 0) this.profile.award('photo-finish');
    if (b && b.passes) {
      for (let i = 0; i < b.passes.length; i++) if (i !== b.shotPlanet && b.passes[i] < 10 && b.passes[i] > -1) this.profile.award('slingshot');
    }
  }

  /** Host-side requests from other pages (pick up). */
  onMessage(data, from) {
    if (!this.round || !this.roundCtx?.isAuthority() || !data || typeof data !== 'object') return;
    const g = this.round.g();
    if (!g || !from || !g.players.includes(from.id)) return;
    if (data.t === 'pickup' && data.h === g.h && g.phase === 'play') {
      const cur = g.cur[from.id];
      if (!cur || cur.holed || cur.up) return;
      const hole = this.round.hole(g.h);
      const cap = hole ? hole.par + 4 : 7;
      this.round.write({ cur: { ...g.cur, [from.id]: { ...cur, n: cap, up: true } } });
      this.round.balls.delete(from.id);
    } else if (data.t === 'mull' && data.h === g.h) this.round.mulligan(from.id);
  }

  // ---------------------------------------------------------------- the frame
  frame(t) {
    requestAnimationFrame((n) => this.frame(n));
    const dtMs = this.last ? Math.min(100, t - this.last) : 16;
    this.last = t;
    const dt = dtMs / 1000;
    if (!settings.reducedMotion) this.gfx.shared.uTime.value = (this.gfx.shared.uTime.value + dt) % 3600;
    try {
      this.step(dt, dtMs);
    } catch (e) {
      console.error(e);
    }
    this.gfx.govern(dtMs);
    this.gfx.render();
  }

  step(dt, dtMs) {
    this.profile.tick();
    if (this.mode === 'match' || this.mode === 'solo') {
      const ctx = this.roundCtx;
      const now = ctx.clock();
      if (this.mode === 'match' && this.room.match.id !== ctx.mid && this.room.match.phase !== 'playing') return this.club();
      if (ctx.isAuthority()) {
        if (!this.round.adopt() && this.mode === 'match' && this.room.match.phase === 'playing' && this.startedFor !== ctx.mid) {
          this.startedFor = ctx.mid;
          this.hostStart();
        }
        this.round.tick();
      }
      const g = this.round.g();
      const valid = g && g.mid === ctx.mid ? g : null;
      const hole = valid ? this.round.hole(valid.h, valid) : null;
      if (valid && !hole) {
        if (this.screens.name !== 'building') this.screens.building();
        this.backdrop.update(dt, this.gfx.camera.position, settings.reducedMotion);
        return;
      }
      if (this.screens.name === 'building') this.screens.clear();
      // Build the next runtime hole ahead, a little each frame (on every page: each builds its own copy).
      const next = valid?.holes?.[valid.h + 1];
      if (next && !entryReady(next)) buildEntry(next, valid.phase === 'between' ? 3 : 1);
      this.session.update(valid, hole, now, dtMs);
      this.phaseScreens(valid, hole, now);
      if (valid && hole && (valid.phase === 'play' || valid.phase === 'intro')) {
        if (!this.play.ui || this.screens.name !== 'play') this.play.ui = this.screens.playUi();
        this.play.update(dt, now);
      } else if (valid && hole) {
        this.play.ui = null;
        this.world.update(this.session, this.room.me.id, (now - valid.t0) / 1000, dt, settings.reducedMotion);
        this.camera.update(dt, hole, (now - valid.t0) / 1000, this.camera.target.x, this.camera.target.y, this.camera.target.z, 0, 0, 0, false);
        this.hud.clear();
      }
      if (this.auto) this.autopilot(now);
    } else {
      // The clubhouse and the title: the showcase system turns slowly while a ball flies its orbit.
      if (this.showcase) this.showcase.update(dt, settings.reducedMotion);
      this.hud.clear();
      this.prebuild();
      this.audio.ambience(dt, { playing: false, reduced: settings.reducedMotion });
    }
    this.backdrop.update(dt, this.gfx.camera.position, settings.reducedMotion);
  }

  /**
   * Builds runtime holes before they're asked for: the first Random hole during the countdown, today's Daily while
   * the player looks around the clubhouse. A slice a frame, so nothing hitches.
   */
  prebuild() {
    const m = this.room?.match;
    if (m && m.phase === 'starting' && this.room.settings?.world === 'random') {
      const first = pickHoles('match', this.room.settings, m.seed ?? 1)[0];
      if (!entryReady(first)) return void buildEntry(first, 4);
    }
    if (this.mode === 'club' || this.mode === 'title') {
      const daily = pickHoles('daily', {}, today())[0];
      if (!entryReady(daily)) buildEntry(daily, 1.5);
    }
  }

  /** The between-hole card and the final results, once per phase, from the record. */
  phaseScreens(g, hole, now) {
    if (!g) return;
    const me = this.room.me.id;
    const key = `${g.mid}.${g.h}.${g.phase}`;
    if (g.phase === 'between' || g.phase === 'final') this.bankHole(g, hole);
    if (g.phase === 'between') {
      if (!this.shown.has(key)) {
        this.shown.add(key);
        this.play.okSent = null;
        const mine = g.scores[me]?.[g.h];
        const word = mine ? resultWord(mine.strokes, mine.par, mine.pickedUp) : 'Hole done';
        const cards = g.settings.cards === 'on' && g.players.includes(me) && this.room.isParticipant?.(me) !== false;
        const draft = cards ? draftFor(this.roundCtx.seed, g.h, me) : [];
        const hand = this.play.handProvider();
        const next = this.round.hole(g.h + 1);
        const nextEntry = g.holes[g.h + 1];
        this.screens.between({
          word,
          rows: this.rows(g),
          room: this.room,
          draft: hand.length < HAND_MAX ? draft : [],
          onPick: (id) => {
            this.roundCtx.setPrivateFor(me, 'pick', { h: g.h, card: id });
            this.profile.sawCard(id);
            this.audio.card();
            this.screens.toast('Picked', 'ice', 800);
            const row = this.screens.current?.querySelector('.row');
            row?.querySelectorAll('.cardbtn').forEach((b) => (b.disabled = true));
          },
          onReady: () => {
            this.play.okSent = g.h;
            this.setPresence({ scr: 'between', ok: g.h });
            this.audio.click();
          },
          ready: false,
          holeName: hole ? `${hole.name} · Par ${hole.par}` : '',
          nextName: next ? `${worldById(next.world).name} · ${next.name}` : nextEntry ? worldById(nextEntry.world ?? nextEntry.id?.split('-')[0]).name : '',
        });
        this.play.okAction = () => this.screens.current?.querySelector('.btn.teal')?.click();
        if (this.auto) setTimeout(() => this.screens.current?.querySelector('.cardbtn')?.click(), 200);
      }
      if (this.screens.timerEl) this.screens.timerEl.textContent = `${Math.max(0, Math.ceil((g.until - now) / 1000))}`;
      return;
    }
    if (g.phase === 'final') {
      if (!this.shown.has(key)) {
        this.shown.add(key);
        this.play.okSent = null;
        const rows = this.rows(g, g.results);
        const winner = rows[0];
        const solo = this.mode === 'solo';
        const total = parTotal(g.holes.map((e, i) => this.round.hole(i)));
        const mine = rows.find((r) => r.id === me);
        const title = solo ? (g.kind === 'practice' ? 'Done' : mine && mine.strokes <= total ? 'Under par!' : 'Round done') : winner ? `${winner.name} wins` : 'Round done';
        this.bankRound(g, rows, total);
        this.screens.final({
          rows,
          room: this.room,
          title,
          xpLine: g.kind === 'practice' ? '' : `+${this.roundXp} XP · Level ${this.profile.level}`,
          over: false,
          doneLabel: g.kind === 'practice' ? 'Next hole' : 'Done',
          onDone: () => {
            if (g.kind === 'practice') this.nextPractice();
            else if (solo) this.endSolo(false);
            else {
              this.play.okSent = 'final';
              this.setPresence({ scr: 'final', ok: 'final' });
              this.screens.current?.querySelector('.btn.teal')?.setAttribute('disabled', '');
            }
          },
        });
        this.play.okAction = () => this.screens.current?.querySelector('.btn.teal')?.click();
        this.results = rows;
        if (this.auto) setTimeout(() => this.screens.current?.querySelector('.btn.teal')?.click(), 400);
      }
      if (this.mode === 'solo' && g.over) this.endSolo(false);
    }
  }

  rows(g, results = null) {
    const me = this.room.me.id;
    const list = results ?? standings(g.settings.scoring ?? 'strokes', g.scores, g.players);
    return list.map((r) => {
      const last = g.scores[r.id]?.[g.h];
      return { id: r.id, place: r.place, name: this.nameOf(r.id), total: r.total, strokes: r.strokes ?? 0, me: r.id === me, bot: !!g.bots[r.id], avatar: this.avatars.get(r.id) ?? null, word: last && g.phase === 'between' ? resultWord(last.strokes, last.par, last.pickedUp) : '' };
    });
  }

  bankHole(g, hole) {
    const me = this.room.me.id;
    const key = `${g.mid}.${g.h}`;
    if (this.banked.has(key)) return;
    const mine = g.scores[me]?.[g.h];
    if (!mine) return;
    this.banked.add(key);
    if (g.kind === 'practice') return;
    const { xp } = this.profile.holeDone({ strokes: mine.strokes, par: mine.par, ace: mine.strokes === 1 && !mine.pickedUp, pickedUp: mine.pickedUp, world: hole?.world });
    this.roundXp += xp;
  }

  bankRound(g, rows, total) {
    const me = this.room.me.id;
    const key = `${g.mid}.round`;
    if (this.banked.has(key)) return;
    this.banked.add(key);
    const mine = rows.find((r) => r.id === me);
    if (!mine || g.kind === 'practice') return;
    const won = mine.place === 1 && rows.length > 1;
    const worldSetting = g.settings.world;
    const single = g.holes.every((e) => (e.id ?? '').split('-')[0] === (g.holes[0].id ?? '').split('-')[0]) ? (g.holes[0].id ?? '').split('-')[0] : null;
    this.profile.roundDone({ strokes: mine.strokes, parTotal: total, holes: g.holes.length, world: single ?? worldSetting, won, cards: g.settings.cards === 'on', mode: g.settings.scoring });
    this.roundXp += 15 + (won ? 25 : 0);
    if (g.kind === 'daily') this.profile.dailyDone(today(), mine.strokes);
    if (g.kind === 'tour') {
      this.profile.data.tour.stage++;
      if (!this.profile.data.tour.best || mine.strokes < this.profile.data.tour.best) this.profile.data.tour.best = mine.strokes;
      this.profile.save(true);
    }
  }

  /** Replays a library hole's reference shot and reports where it ended (the Node harness compares). */
  hash(holeId) {
    const data = library.holes.find((h) => h.id === holeId) ?? library.holes[0];
    const h = prepareHole(data);
    const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
    b.quiet = true;
    launchAt(h, b, data.ref.t0, data.ref.p[0], data.ref.p[1], data.ref.p[2], data.ref.v[0], data.ref.v[1], data.ref.v[2], null);
    const mode = runToRest(h, b, 120 * 40);
    const p = ballPos(h, b, [0, 0, 0]);
    return { id: data.id, mode, step: b.step, p, bounces: b.bounces, rolled: b.rolled };
  }

  /** ?test=auto: plays by itself so a headless browser can run the loop. */
  autopilot(now) {
    const s = this.session;
    if (!s || !s.hole || !s.g) return;
    if (s.state() !== 'aim') return;
    if (now - (this.autoAt ?? 0) < 1500) return;
    this.autoAt = now;
    const b = s.myBall();
    const plan = planShot(s.hole, b, (now - s.g.t0) / 1000, 'club', seedOf('auto', now));
    s.shoot(plan.dir, Math.min(1, plan.speed / MAX_SPEED), now);
  }
}

export { library };

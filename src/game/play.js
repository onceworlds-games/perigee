// The play controller for one round on this page: input to the session, camera, HUD, hand, standings strip,
// events to sound, particles, toasts and badges. The app creates one per round (match or solo) and disposes it.
import { ballPos, planetVel, FLY, ROLL, HOLED, LOST, REST, DT } from '../sim/ball.js';
import { centersAt, cupPos, teePos, MAX_PLANETS } from '../sim/hole.js';
import { standings, resultWord, strokeCap } from '../sim/score.js';
import { draftFor, cardById } from '../sim/cards.js';
import { worldById } from '../sim/worlds.js';
import { controls, settings } from './platform.js';
import { INTRO_MS } from './round.js';
import { shotKey } from './table.js';

const C = new Float64Array(MAX_PLANETS * 3);
const P = [0, 0, 0];
const PREVIEW_SECONDS = { short: 1.2, long: 3, none: 0 };

export class Play {
  /**
   * deps: { session, round, world, camera, hud, screens, audio, input, profile, clock(), me, names(id) -> string,
   *         isBot(id), playerInfo(id) -> { connected, idle }, setPresence(obj), preview (setting), touch(), kind }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.ui = null;
    this.actionsKey = '';
    this.handKey = '';
    this.sideKey = '';
    this.holeShown = -1;
    this.introDone = false;
    this.spectate = null; // pid being watched
    this.pickupArmed = 0;
    this.holedHandled = new Set();
    this.banked = new Set();
    this.lastTick = 0;
    this.upLevelled = false;
    this.lastState = '';
    this.sawHints = new Set();
    this.previewSetting = deps.preview ?? 'short';
    this.lastPreviewAt = 0;
    this.shootHeld = false;
    this.okSent = null;
    this.bindInput();
  }

  dispose() {
    this.unbind?.();
    controls.set(null);
    this.world.hidePreview();
    this.screens.clearHint();
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const i = this.input;
    const offs = [];
    const on = (ev, fn) => {
      i.on(ev, fn);
      offs.push(() => {
        const list = i.handlers[ev];
        const k = list?.indexOf(fn);
        if (k >= 0) list.splice(k, 1);
      });
    };
    on('keydown', (k) => this.keyDown(k));
    on('keyup', (k) => this.keyUp(k));
    on('orbit', (dx, dy) => {
      if (this.session.charging) return;
      this.camera.mode = 'orbit';
      this.camera.nudge(-dx, dy);
    });
    on('press', (x, y, type) => {
      if (this.camera.mode === 'intro') {
        this.camera.endIntro(); // the fly-in is skippable
        return;
      }
      // A press on the ball starts the charge (hold to charge, release to shoot); elsewhere it orbits.
      const bp = this.ballScreen();
      if (bp && Math.hypot(bp.x - x, bp.y - y) < 64 && this.session.state() === 'aim') {
        if (this.session.startCharge()) this.hinted('charge', 'Release to shoot');
      }
    });
    on('release', (x, y, tap) => {
      if (this.session.charging) this.session.release(this.aimDir());
    });
    on('cancel', () => this.session.cancelCharge());
    on('zoom', (d) => this.camera.zoom(d));
    this.unbind = () => offs.forEach((f) => f());
  }

  keyDown(k) {
    if (this.camera.mode === 'intro') {
      this.camera.endIntro();
      return;
    }
    const st = this.session.state();
    if (k === ' ') {
      if (st === 'aim') {
        if (this.session.startCharge()) this.hinted('charge', 'Release to shoot');
      } else if (st === 'holed' || st === 'up') this.cycleSpectate(1);
      return;
    }
    if (k === 'Escape') {
      this.session.cancelCharge();
      return;
    }
    if (k === 'q' || k === 'e') {
      if (st === 'flying') this.actCard(true);
      else if (st === 'aim') this.cycleCard(k === 'q' ? 1 : -1);
      return;
    }
    if (k === '1' || k === '2' || k === '3') {
      if (st === 'aim') this.pickCard(this.hand()[Number(k) - 1]);
      return;
    }
    if (k === 'r') {
      this.lookAtCup();
      return;
    }
    if (k === 'f') {
      if (this.kind !== 'match') {
        const order = ['short', 'long', 'none'];
        this.previewSetting = order[(order.indexOf(this.previewSetting) + 1) % 3];
        this.screens.toast({ short: 'Preview: short', long: 'Preview: long', none: 'Preview: off' }[this.previewSetting], 'ice', 900);
      }
      return;
    }
    if (k === 'x') {
      this.pickUp();
      return;
    }
    if (k === 'p') {
      if (st === 'holed' || st === 'up' || st === 'aim') this.session.startReplay();
      return;
    }
    if (k === 'c' || k === 'ArrowRight') {
      if (st === 'holed' || st === 'up' || st === 'watch') this.cycleSpectate(1);
      return;
    }
    if (k === 'ArrowLeft') {
      if (st === 'holed' || st === 'up' || st === 'watch') this.cycleSpectate(-1);
      return;
    }
    if (k === 'Enter') {
      if (this.okAction) this.okAction();
      return;
    }
    if (k === 'n') {
      if (this.kind === 'practice') this.onNext?.();
    }
  }

  keyUp(k) {
    if (k === ' ') {
      if (this.session.charging) this.session.release(this.aimDir());
      return;
    }
    if (k === 'q' || k === 'e') {
      if (this.session.braking) this.session.act('brakeEnd');
    }
  }

  aimDir() {
    const a = this.camera.aimDir();
    return [a.x, a.y, a.z];
  }

  ballScreen() {
    const b = this.session.myBall();
    if (!b || !this.session.hole) return null;
    ballPos(this.session.hole, b, P);
    return this.world.project(P[0], P[1], P[2]);
  }

  hand() {
    return this.handCards ?? [];
  }

  cycleCard(dir) {
    const h = this.hand();
    if (!h.length) return;
    const i = h.indexOf(this.session.card);
    const next = i < 0 ? (dir > 0 ? 0 : h.length - 1) : (i + dir + h.length + 1) % (h.length + 1);
    this.session.card = next === h.length ? null : h[next];
    this.audio.click();
  }

  pickCard(id) {
    if (!id) return;
    if (id === 'mulligan') {
      this.onMulligan?.();
      return;
    }
    this.session.card = this.session.card === id ? null : id;
    this.audio.click();
    if (this.session.card) {
      const c = cardById(id);
      if (c) this.screens.toast(c.name, 'ice', 900);
    }
  }

  actCard() {
    const s = this.session;
    if (s.act('thrust')) {
      this.audio.ring();
      return;
    }
    if (s.act('brake')) this.audio.click();
  }

  lookAtCup() {
    if (!this.session.hole) return;
    const c = cupPos(this.session.hole, this.clock() / 1000);
    this.camera.mode = 'orbit';
    this.camera.faceToward(c[0], c[1], c[2]);
    this.audio.click();
  }

  pickUp() {
    const st = this.session.state();
    if (st !== 'aim' && st !== 'flying' && st !== 'settling') return;
    const now = Date.now();
    if (now - this.pickupArmed > 2500) {
      this.pickupArmed = now;
      this.screens.toast('Pick up? Again to confirm', 'ice', 2400);
      return;
    }
    this.pickupArmed = 0;
    this.onPickUp?.();
  }

  cycleSpectate(dir) {
    const g = this.session.g;
    if (!g) return;
    const ids = g.players.filter((id) => id !== this.me && !g.cur[id]?.holed);
    if (!ids.length) return;
    const i = ids.indexOf(this.spectate);
    this.spectate = ids[(i + dir + ids.length) % ids.length];
    this.camera.mode = 'follow';
    this.audio.click();
  }

  hinted(id, text) {
    if (this.sawHints.has(id)) return;
    this.sawHints.add(id);
    if (this.profile.hint(id)) this.screens.hint(text);
  }

  // ---------------------------------------------------------------- per frame
  update(dt, now) {
    const g = this.session.g;
    const hole = this.session.hole;
    if (!this.ui) this.ui = this.screens.playUi();
    if (!g || !hole) return;
    const t = (now - g.t0) / 1000;
    const st = this.session.state();
    const touch = this.touch();
    // Hole change: the intro, the name, the hand.
    if (g.h !== this.holeShown) {
      this.holeShown = g.h;
      this.introDone = false;
      this.spectate = null;
      this.session.card = null;
      this.world.setHole(hole, g.holes?.[g.h]?.seed ?? g.h + 1);
      this.ui.hole.textContent = `${g.h + 1}/${g.holes.length} · ${hole.name}`;
      this.ui.par.textContent = `${worldById(hole.world).name} · Par ${hole.par}`;
      const tee = teePos(hole, t);
      const cup = cupPos(hole, t);
      this.camera.setUp(hole.tee.dx, hole.tee.dy, hole.tee.dz, true);
      this.camera.target.set(tee[0], tee[1], tee[2]);
      this.camera.faceToward(cup[0], cup[1], cup[2]);
      if (!settings.reducedMotion) this.camera.startIntro(cup, tee, [hole.tee.dx, hole.tee.dy, hole.tee.dz], [hole.cup.dx, hole.cup.dy, hole.cup.dz]);
      this.camera.wantDist = 11;
      this.audio.card();
      if (g.h === 0) this.hinted('look', touch ? 'Drag to look around' : 'Drag to look, R for the cup');
    }
    // The hand (cards in my private values come through the app).
    this.handCards = this.handProvider ? this.handProvider() : [];
    // Camera target: my ball, the spectated ball, or the replay.
    let targetBall = this.session.myBall();
    let targetEntry = this.session.entry(this.me);
    if (this.session.replay) targetBall = this.session.replay.b;
    else if (st === 'watch' || ((st === 'holed' || st === 'up') && this.spectate)) {
      if (!this.spectate || !g.players.includes(this.spectate)) this.spectate = g.players.find((id) => id !== this.me && !g.cur[id]?.holed) ?? null;
      const e = this.spectate ? this.session.entry(this.spectate) : null;
      if (e) {
        targetBall = e.b;
        targetEntry = e;
      }
    }
    if (targetBall) {
      ballPos(hole, targetBall, P);
      const flying = targetBall.mode === FLY || targetBall.mode === ROLL || targetBall.mode === LOST;
      if (flying && this.camera.mode !== 'orbit' && this.camera.mode !== 'intro') this.camera.mode = 'follow';
      if (targetBall.mode === FLY && this.camera.mode === 'orbit' && targetEntry && targetEntry.b === targetBall && targetEntry.rec && !targetEntry.done && targetBall.step < 3) this.camera.mode = 'follow';
      // Up: the world under the ball.
      const c = centersAt(hole, t, C);
      const gi = targetBall.mode === REST || targetBall.mode === ROLL ? targetBall.g : this.nearest(hole, c, P);
      this.camera.setUp(P[0] - c[gi * 3], P[1] - c[gi * 3 + 1], P[2] - c[gi * 3 + 2]);
      if (targetBall.mode === REST && this.camera.mode === 'follow') this.camera.mode = 'orbit';
      this.camera.wantDist = flying ? 13 : 11;
      this.camera.update(dt, hole, t, P[0], P[1], P[2], targetBall.vx, targetBall.vy, targetBall.vz, flying);
    }
    // Preview while aiming.
    const seconds = this.kind === 'match' ? PREVIEW_SECONDS[g.settings.preview] ?? 1.2 : PREVIEW_SECONDS[this.previewSetting];
    const longLook = this.session.card === 'preview' || (g.played?.[this.me] === 'preview');
    if (st === 'aim' && seconds > 0 || (st === 'aim' && longLook)) {
      if (now - this.lastPreviewAt > 40) {
        this.session.preview(this.aimDir(), longLook ? 3 : seconds);
        this.lastPreviewAt = now;
      }
      this.world.showPreview(this.session);
    } else this.world.hidePreview();
    // Hints at the moment of need.
    if (st === 'aim' && this.lastState !== 'aim') this.hinted('shoot', touch ? 'Hold Shoot to charge' : 'Hold Space to charge');
    if (st === 'flying' && this.lastState === 'aim') this.hinted('curve', 'Watch the curve');
    if (st === 'aim' && g.cur[this.me]?.n === 1 && this.lastState !== 'aim') this.hinted('loft', 'Tilt up to loft');
    this.lastState = st;
    // Touch controls follow the state.
    this.syncControls(st, touch);
    this.syncActions(st, g, touch);
    this.syncHand(st, touch);
    this.syncSide(g, hole);
    this.syncWatching(st, g);
    // Presence: what I am doing (the host reads `ok` to skip the intermission).
    const scr = st === 'watch' ? 'watch' : g.phase;
    this.setPresence({ scr, ok: this.okSent });
    // HUD.
    const bp = this.ballScreen();
    const myBall = this.session.myBall();
    let ballR = 40;
    if (bp && myBall) {
      ballPos(hole, myBall, P);
      const top = this.world.project(P[0] + this.camera.up.x * 0.35, P[1] + this.camera.up.y * 0.35, P[2] + this.camera.up.z * 0.35);
      if (top) ballR = Math.max(28, Math.min(140, Math.hypot(top.x - bp.x, top.y - bp.y) + 22));
    }
    const left = g.phase === 'play' ? Math.max(0, (g.endsAt - now) / 1000) : -1;
    const showTimer = g.phase === 'play' && (g.firstIn || left < 60);
    if (showTimer && left < 10 && Math.floor(left) !== this.lastTick) {
      this.lastTick = Math.floor(left);
      this.audio.tick(left < 4);
    }
    const myEntry = this.session.entry(this.me);
    this.hud.draw({
      ballX: bp && st === 'aim' ? bp.x : null,
      ballY: bp ? bp.y : 0,
      ballR,
      charge: this.session.charging ? this.session.charge : -1,
      aiming: st === 'aim',
      timer: showTimer ? left : -1,
      urgent: left >= 0 && left < 10,
      dist: st === 'watch' ? undefined : this.session.distance(),
      alt: myEntry?.view?.alt ?? (this.world.balls.get(this.me)?.view.alt ?? 0),
      touch,
      safeTop: this.safeTop(),
      safeBottom: 0,
      strokes: g.cur[this.me]?.n ?? 0,
      par: hole.par,
      state: st,
      hand: this.handCards.length > 0,
    });
    // Ambience from my ball.
    if (myBall) {
      ballPos(hole, myBall, P);
      const c = centersAt(hole, t, C);
      let near = 1e9;
      for (let i = 0; i < hole.n; i++) {
        const d = Math.hypot(P[0] - c[i * 3], P[1] - c[i * 3 + 1], P[2] - c[i * 3 + 2]) - hole.planets[i].R;
        if (d < near) near = d;
      }
      const speed = Math.hypot(myBall.vx, myBall.vy, myBall.vz);
      this.audio.ambience(dt, { near: Math.max(0, near), speed: myBall.mode === FLY ? speed : 0, altitude: Math.max(0, near), playing: g.phase === 'play', reduced: settings.reducedMotion });
    }
    this.world.update(this.session, this.me, t, dt, settings.reducedMotion);
  }

  safeTop() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sat');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  nearest(hole, c, p) {
    let best = 0;
    let bd = 1e18;
    for (let i = 0; i < hole.n; i++) {
      const d = (p[0] - c[i * 3]) ** 2 + (p[1] - c[i * 3 + 1]) ** 2 + (p[2] - c[i * 3 + 2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  syncControls(st, touch) {
    const key = `${st}:${this.handCards.length > 0}:${this.session.braking}`;
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    const buttons = [];
    if (st === 'aim' || st === 'flying' || st === 'settling' || st === 'intro') buttons.push({ id: 'shoot', label: 'Shoot', key: ' ' });
    if (this.handCards.length || st === 'flying') buttons.push({ id: 'card', label: 'Card', key: 'q' });
    if (st === 'aim' || st === 'flying' || st === 'settling') buttons.push({ id: 'cup', label: 'Cup', key: 'r' });
    if (st === 'holed' || st === 'up' || st === 'watch') buttons.push({ id: 'next', label: 'Watch', key: 'c' });
    controls.set(buttons.length ? { buttons } : null);
  }

  syncActions(st, g, touch) {
    const list = [];
    if (st === 'aim' || st === 'flying' || st === 'settling') list.push({ id: 'pickup', label: 'Pick up', key: 'X', onClick: () => this.pickUp() });
    if ((st === 'holed' || st === 'up' || st === 'aim') && this.session.lastShotRec && !this.session.replay) list.push({ id: 'replay', label: 'Replay', key: 'P', onClick: () => this.session.startReplay() });
    if (this.kind === 'practice' && st !== 'watch') list.push({ id: 'next', label: 'Next hole', key: 'N', cls: 'teal', onClick: () => this.onNext?.() });
    if (this.kind !== 'match') list.push({ id: 'quit', label: 'Quit', key: 'Esc', onClick: () => this.onQuit?.() });
    if (!touch && (st === 'holed' || st === 'up' || st === 'watch')) list.push({ id: 'watch', label: 'Watch next', key: 'C', onClick: () => this.cycleSpectate(1) });
    const key = list.map((a) => a.id).join(',') + (touch ? 't' : '');
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.screens.setActions(this.ui.actions, list, touch);
    this.ui.left.className = `leftbtns${touch ? ' touch' : ''}`;
  }

  syncHand(st, touch) {
    const cards = st === 'aim' ? this.handCards : [];
    const key = `${cards.join(',')}|${this.session.card}|${touch}`;
    if (key === this.handKey) return;
    this.handKey = key;
    this.screens.setHand(this.ui.hand, cards, this.session.card, (id) => this.pickCard(id), touch, 'hand');
  }

  syncSide(g, hole) {
    const rows = standings(g.settings.scoring ?? 'strokes', g.scores, g.players).map((r) => {
      const cur = g.cur[r.id];
      const info = this.playerInfo(r.id);
      const holeN = cur ? cur.n : 0;
      const label = `${r.total}${cur ? ` · ${cur.holed ? 'in' : cur.up ? 'up' : holeN}` : ''}`;
      return { id: r.id, place: r.place, name: this.names(r.id), total: r.total, label, me: r.id === this.me, done: !!(cur && (cur.holed || cur.up)), bot: this.isBot(r.id), away: !!(info && info.connected === false) };
    });
    const key = rows.map((r) => `${r.id}:${r.label}:${r.done}:${r.away}:${r.place}`).join('|');
    if (key === this.sideKey) return;
    this.sideKey = key;
    this.screens.setSide(this.ui.side, rows);
  }

  syncWatching(st, g) {
    const w = this.ui.watching;
    const text = st === 'watch' ? (this.spectate ? `Watching ${this.names(this.spectate)}` : 'Watching') : st === 'holed' && this.spectate ? `Watching ${this.names(this.spectate)}` : '';
    if (w.textContent !== text) w.textContent = text;
    w.style.display = text ? '' : 'none';
  }

  // ---------------------------------------------------------------- ball events
  onEvent(pid, ev, pos, b, entry) {
    const mine = pid === this.me;
    const vol = mine ? 1 : 0.5;
    const n = this.normalAt(pos);
    switch (ev.k) {
      case 'shot':
        if (mine) this.audio.shot(Math.min(1, ev.a / 38));
        else this.audio.tone?.(300, { gain: 0.05, decay: 0.15 });
        this.world.fx.burst(pos, n, mine ? 10 : 4, { colours: [0xf3e5c3, 0xd86a2a], speed: 2.5, size: 1.2, decay: 2.2 });
        this.world.balls.get(pid)?.view.clearTrail();
        break;
      case 'bounce':
      case 'land': {
        if (entry?.relaunch) break;
        if (mine) this.audio[ev.k === 'bounce' ? 'bounce' : 'land'](ev.c, ev.a);
        else if (ev.a > 4) this.audio.bounce(ev.c, ev.a * 0.4);
        const col = { lava: [0xff5a2a, 0xffd080], ice: [0xeaf7fa, 0xbfe3ea], metal: [0xc0c8cc, 0xf3e5c3], moss: [0x4e9a6a, 0x2f6b4f], meadow: [0x9ccd6a, 0x6fae4e], pad: [0xf06a5c, 0xf3e5c3], tar: [0x14100f, 0x3a2a2c] }[ev.c] ?? [0xf0a060, 0xd86a2a];
        this.world.fx.burst(pos, n, Math.min(24, 4 + Math.round(ev.a * 1.5)) * (mine ? 1 : 0.5), { colours: col, speed: 1.5 + ev.a * 0.25, size: 1.5, decay: 1.8, spread: 1.4 });
        if (mine && ev.a > 10) this.camera.kick(Math.min(0.5, ev.a / 40));
        break;
      }
      case 'holed': {
        const key = `${pid}:${this.session.holeIndex}`;
        if (this.holedHandled.has(key)) break;
        this.holedHandled.add(key);
        const g = this.session.g;
        const strokes = (g?.cur?.[pid]?.n ?? 0) + 1 + (b.penalties ?? 0);
        const par = this.session.hole?.par ?? 3;
        const ace = strokes === 1;
        this.audio.holed(ace && mine);
        this.celebrate(pos, n, ace, mine);
        if (mine) {
          this.screens.toast(resultWord(strokes, par), 'coral', ace ? 3200 : 2000);
          this.camera.kick(0.25);
          this.onMyHole?.({ strokes, par, ace, b, holeId: this.session.hole?.id, world: this.session.hole?.world, now: this.clock(), endsAt: g?.endsAt ?? 0 });
        } else this.screens.toast(`${this.names(pid)} · ${resultWord(strokes, par)}`, 'ice', 1400);
        break;
      }
      case 'lip':
        if (mine) {
          this.audio.oooh();
          this.screens.toast('Lip out!', 'ice', 1200);
        }
        this.world.fx.burst(pos, n, 8, { colours: [0xf06a5c, 0xf3e5c3], speed: 3, size: 1.2, decay: 2 });
        break;
      case 'lost':
        if (mine) {
          this.audio.lost();
          this.screens.toast({ space: 'Lost in space · +1', lava: 'Lava · +1', gas: 'Swallowed · +1', hole: 'Gone · +1' }[ev.a] ?? 'Lost · +1', 'coral', 2000);
          if (ev.a === 'space') this.profile.award('lost-in-space');
          this.profile.data.stats.lost++;
        }
        this.world.fx.burst(pos, [0, 1, 0], 14, { colours: ev.a === 'lava' ? [0xff5a2a, 0xffd080] : [0xbfe3ea, 0xf3e5c3], speed: 3, size: 1.6, decay: 1.5, spread: 2 });
        break;
      case 'rest':
        if (mine) {
          const d = this.session.distance();
          if (d < 1.5 && !this.session.g?.cur?.[pid]?.holed) {
            this.audio.oooh();
            this.screens.toast('So close', 'ice', 1300);
          }
          if (b.aero > 30 && b.penalties === 0) this.profile.award('aerobrake');
        }
        break;
      case 'warp':
        this.audio.warp();
        this.world.fx.burst(pos, [0, 1, 0], 16, { colours: [0x2a8f8a, 0xf06a5c], speed: 4, size: 1.5, decay: 1.8, spread: 2 });
        break;
      case 'ring':
        if (mine) this.audio.ring();
        this.world.fx.burst(pos, [b.vx, b.vy, b.vz].map((v) => v / 20), 10, { colours: [0x2a8f8a, 0xf3e5c3], speed: 2, size: 1.3, decay: 2 });
        break;
      case 'thrust':
        if (mine) this.audio.boing();
        this.world.fx.burst(pos, [-b.vx, -b.vy, -b.vz].map((v) => v / 20), 12, { colours: [0xd86a2a, 0xf3e5c3], speed: 3, size: 1.4, decay: 2 });
        break;
      case 'leave':
        if (mine && ev.a > 6) this.audio.noise?.({ gain: 0.06, decay: 0.1, freq: 900 });
        break;
      default:
        break;
    }
  }

  normalAt(pos) {
    const hole = this.session.hole;
    if (!hole) return [0, 1, 0];
    const c = centersAt(hole, (this.clock() - (this.session.g?.t0 ?? 0)) / 1000, C);
    const i = this.nearest(hole, c, pos);
    const d = [pos[0] - c[i * 3], pos[1] - c[i * 3 + 1], pos[2] - c[i * 3 + 2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  celebrate(pos, n, ace, mine) {
    const style = mine ? this.profile.look().party : 'glitter';
    const fx = this.world.fx;
    if (style === 'rings') fx.burst(pos, n, 40, { colours: [0x2a8f8a, 0xf3e5c3], speed: 5, size: 1.1, decay: 1.2, spread: 2.5 });
    else if (style === 'fountain') fx.burst(pos, n, 50, { colours: [0xf06a5c, 0xd86a2a, 0xf3e5c3], speed: 6, size: 1.4, decay: 0.9, spread: 0.6, pull: 6 });
    else if (style === 'nova') fx.burst(pos, n, 70, { colours: [0xffffff, 0xf06a5c, 0xbfe3ea], speed: 8, size: 1.6, decay: 1.1, spread: 3 });
    else fx.burst(pos, n, 30, { colours: [0xf3e5c3, 0xf06a5c, 0xbfe3ea], speed: 4, size: 1.2, decay: 1.4, spread: 2 });
    if (ace) fx.burst(pos, n, 60, { colours: [0xf06a5c, 0xd86a2a, 0xffffff], speed: 9, size: 1.8, decay: 0.8, spread: 3 });
  }
}

export { draftFor, strokeCap, INTRO_MS, shotKey, planetVel, DT };

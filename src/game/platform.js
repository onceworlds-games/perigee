// The one place the game talks to the platform SDK. On Onceworlds `window.onceworlds` is injected before this
// runs; opened on its own (npm run dev, poster mode, tests) the game gets a stand-in: saves in localStorage and a
// solo room where the player is the host and readies straight into a match. Every call is guarded so an SDK
// failure never throws into the frame loop.

function soloRoom(player) {
  const listeners = new Map();
  const me = { id: player.id, name: player.name, presence: null, team: 0, connected: true, ready: false };
  let started = 0;
  let n = 0;
  const priv = {};
  const emit = (ev, ...args) => {
    for (const fn of listeners.get(ev) ?? []) {
      try {
        fn(...args);
      } catch {}
    }
  };
  const room = {
    id: 'solo',
    kind: 'solo',
    invite: null,
    teams: 0,
    open: true,
    me,
    players: new Map([[me.id, me]]),
    state: {},
    host: me.id,
    closed: false,
    connected: true,
    settings: {},
    private: priv,
    match: { phase: 'lobby', n: 0, id: '', min: 1, participants: [], seed: 1 },
    spectating: false,
    canStart: true,
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return room.match.phase === 'playing' ? [me] : [];
    },
    get spectators() {
      return [];
    },
    get leftOut() {
      return [];
    },
    get notReady() {
      return [];
    },
    get allReady() {
      return true;
    },
    get running() {
      return room.match.phase === 'playing';
    },
    isParticipant: (id) => room.match.phase === 'playing' && id === me.id,
    matchNow: () => (started ? Date.now() - started : 0),
    send() {},
    setPresence(d) {
      me.presence = d;
    },
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
      emit('state', k, v, me.id);
    },
    setPrivate(k, v) {
      if (v === null || v === undefined) delete priv[k];
      else priv[k] = v;
    },
    setPrivateFor(id, k, v) {
      room.setPrivate(k, v);
    },
    privateOf: () => priv,
    presenceAt: (id) => (id === me.id ? me.presence : null),
    setTeam() {},
    setOpen(o) {
      room.open = !!o;
    },
    setSetting(id, v) {
      room.settings[id] = v;
      emit('settings', room.settings);
    },
    hideLobby() {},
    clearReady() {},
    reportResult() {},
    kick() {},
    voteKick() {},
    transferHost() {},
    admit() {},
    pauseMatch() {},
    setReady(ready) {
      me.ready = !!ready;
      if (ready && room.match.phase === 'lobby') room.startMatch();
    },
    startMatch() {
      started = Date.now();
      n++;
      room.match = { phase: 'playing', n, id: `solo${n}-${Date.now().toString(36)}`, min: 1, participants: [me.id], startedAt: started, seed: (Math.random() * 1e9) >>> 0 };
      emit('match', room.match);
      emit('matchstart', room.match);
    },
    endMatch() {
      if (room.match.phase !== 'playing') return;
      started = 0;
      me.ready = false;
      const prev = room.match;
      room.match = { phase: 'lobby', n, id: prev.id, min: 1, participants: [], seed: prev.seed };
      emit('match', room.match, prev);
      emit('matchend', room.match, prev);
    },
    leave() {
      room.closed = true;
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    off(ev, fn) {
      listeners.get(ev)?.delete(fn);
    },
  };
  return room;
}

function standalone() {
  const key = (k) => `perigee:${k}`;
  const store = {
    get(k) {
      try {
        const v = localStorage.getItem(key(k));
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(key(k), JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem(key(k));
      } catch {}
    },
  };
  let id = store.get('guest-id');
  if (!id) {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    store.set('guest-id', id);
  }
  const player = { id, name: 'You', guest: true };
  const listeners = new Map();
  const stick = { x: 0, y: 0 };
  return {
    mode: 'standalone',
    env: {},
    player: { get: async () => player, rename: async () => null, avatarUrl: async () => null },
    save: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v), delete: async (k) => store.del(k), list: async () => [] },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async () => soloRoom(player), on: () => () => {}, current: null },
    ui: { setMenuPosition() {}, requestFullscreen() {}, showInvite() {}, setOrientation() {} },
    controls: { set() {}, stick, pressed: () => false, touch: false },
    settings: { quality: 'high', scale: 1, pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max), reducedMotion: false, choice: 'auto', on() {} },
    now: () => Date.now(),
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };
}

export const ow = typeof window !== 'undefined' && window.onceworlds ? window.onceworlds : standalone();
export const onPlatform = ow.mode !== 'standalone';

/** Calls an SDK method and returns its result (or a fallback) instead of throwing. */
export function safe(fn, fallback) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.catch(() => fallback);
    return r;
  } catch {
    return fallback;
  }
}

export const now = () => safe(() => ow.now(), Date.now()) ?? Date.now();

export const settings = {
  get quality() {
    return safe(() => ow.settings?.quality, 'high') ?? 'high';
  },
  get choice() {
    return safe(() => ow.settings?.choice, 'auto') ?? 'auto';
  },
  get reducedMotion() {
    return safe(() => ow.settings?.reducedMotion, false) ?? false;
  },
  pixelRatio(max = 2) {
    const r = safe(() => ow.settings?.pixelRatio?.(max), null);
    return typeof r === 'number' && r > 0 ? r : Math.min(window.devicePixelRatio || 1, max);
  },
  onChange(fn) {
    safe(() => ow.settings?.on?.('change', fn));
  },
};

export const controls = {
  set(spec) {
    safe(() => ow.controls?.set?.(spec));
  },
  get touch() {
    return safe(() => ow.controls?.touch, false) ?? false;
  },
  get stick() {
    return safe(() => ow.controls?.stick, null) ?? { x: 0, y: 0 };
  },
  pressed(id) {
    return safe(() => ow.controls?.pressed?.(id), false) ?? false;
  },
};

export const saves = {
  get: (k) => safe(() => ow.save.get(k), null),
  set: (k, v) => safe(() => ow.save.set(k, v), null),
};

export const badges = { award: (id) => safe(() => ow.badges.award(id), false) };
export const boards = { submit: (name, score, opts) => safe(() => ow.leaderboards.submit(name, score, opts), null) };
export const ui = {
  showInvite: () => safe(() => ow.ui.showInvite()),
  setMenuPosition: (p) => safe(() => ow.ui.setMenuPosition(p)),
};
export const avatarUrl = (id, kind = 'head') => safe(() => ow.player.avatarUrl(id, kind), null);
export const onPlatformEvent = (ev, fn) => safe(() => ow.on(ev, fn));

/** Joins the room once, as the page loads, with fixed options. */
export function joinRoom(opts) {
  return safe(() => ow.rooms.join(opts), null);
}

/** Listens on a room, never letting a handler's exception reach the SDK. */
export function on(room, ev, fn) {
  try {
    return room.on(ev, (...args) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    });
  } catch {
    return () => {};
  }
}

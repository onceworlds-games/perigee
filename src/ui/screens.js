// DOM screens and overlays: title, clubhouse, between-hole card, final results, closed, locker, practice picker,
// the top bar, the standings strip, the action buttons, the card hand, toasts and hints. Labels, not sentences.
// Every string from another player goes through textContent.
import { SKINS, TRAILS, PLINKS, FLAGS, CELEBRATIONS, BALL_NAMES, xpForLevel, levelFor } from '../game/profile.js';
import { WORLDS } from '../sim/worlds.js';
import { cardById } from '../sim/cards.js';
import { resultWord } from '../sim/score.js';

const $ = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (label, cls, onClick, key) => {
  const b = $('button', `btn ${cls ?? ''}`);
  b.append(document.createTextNode(label));
  if (key) b.append($('span', 'key', key));
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick?.();
  });
  return b;
};
const colourHex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Screens {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.current = null;
    this.name = '';
    this.toastEl = null;
    this.toastTimer = 0;
    this.hintEl = null;
    this.hintTimer = 0;
    this.overlay = $('div');
    this.root.append(this.overlay);
    this.avatars = new Map();
  }

  show(name, el) {
    this.current?.remove();
    this.current = el;
    this.name = name;
    if (el) this.root.append(el);
  }

  clear() {
    this.show('', null);
  }

  // ---------------------------------------------------------------- title
  title(onPlay) {
    const s = $('div', 'screen');
    s.append($('h1', 'title', 'Perigee'));
    s.append($('div', 'sub', 'Golf on tiny worlds'));
    const b = button('Play', 'big');
    b.addEventListener('click', () => onPlay());
    s.append(b);
    this.show('title', s);
    return s;
  }

  // ---------------------------------------------------------------- clubhouse
  clubhouse({ profile, room, solo, results, onDaily, onPractice, onTour, onLocker, onInvite, daily }) {
    const s = $('div', 'screen top lobby');
    const head = $('div', 'row');
    const lvl = $('div', 'sub', `Level ${profile.level} · ${profile.look().name}`);
    head.append(lvl);
    s.append(head);
    const xp = $('div', 'xp');
    const bar = $('i');
    const lo = xpForLevel(profile.level);
    const hi = xpForLevel(profile.level + 1);
    bar.style.width = `${Math.round(100 * Math.min(1, (profile.data.xp - lo) / Math.max(1, hi - lo)))}%`;
    xp.append(bar);
    xp.style.maxWidth = '320px';
    s.append(xp);
    if (results) s.append(this.resultsTable(results, room, true));
    if (solo) {
      const row = $('div', 'row');
      const d = button(daily.played ? `Daily · ${daily.best}` : 'Daily', 'teal', onDaily);
      row.append(d, button('Practice', 'teal', onPractice), button(`Tour ${profile.data.tour.stage + 1}`, 'teal', onTour));
      s.append(row);
      if (daily.streak > 0) s.append($('div', 'badgeline', `Daily streak ${daily.streak}`));
    }
    const row2 = $('div', 'row');
    row2.append(button('Locker', 'ghost small', onLocker));
    if (room && room.players.size < 2 && onInvite) row2.append(button('Invite', 'ghost small', onInvite));
    s.append(row2);
    this.show('club', s);
    return s;
  }

  // ---------------------------------------------------------------- locker
  locker(profile, onBack) {
    const s = $('div', 'screen top lobby');
    const card = $('div', 'card');
    card.append($('h2', '', 'Locker'));
    const lvl = profile.level;
    const grid = $('div', 'locker');
    const groupSw = (label, list, kind, colourOf) => {
      const g = $('div', 'group');
      g.append($('span', 'lbl', label));
      for (const it of list) {
        const locked = it.level > lvl;
        const b = $('button', `swatch${profile.data.look[kind] === it.id ? ' on' : ''}${locked ? ' locked' : ''}`);
        b.style.background = colourOf(it);
        b.dataset.level = String(it.level);
        b.title = it.name;
        b.setAttribute('aria-label', it.name);
        b.addEventListener('click', () => {
          if (profile.equip(kind, it.id)) this.locker(profile, onBack);
        });
        g.append(b);
      }
      grid.append(g);
    };
    groupSw('Ball', SKINS, 'skin', (it) => `linear-gradient(180deg, ${colourHex(it.body)} 40%, ${colourHex(it.stripe)} 40%, ${colourHex(it.stripe)} 60%, ${colourHex(it.body)} 60%)`);
    groupSw('Trail', TRAILS, 'trail', (it) => colourHex(it.colour));
    groupSw('Flag', FLAGS, 'flag', (it) => colourHex(it.colour));
    const groupPill = (label, list, kind) => {
      const g = $('div', 'group');
      g.append($('span', 'lbl', label));
      for (const it of list) {
        const locked = it.level > lvl;
        const b = $('button', `pill${profile.data.look[kind] === it.id ? ' on' : ''}${locked ? ' locked' : ''}`, locked ? `${it.name} · ${it.level}` : it.name);
        b.addEventListener('click', () => {
          if (profile.equip(kind, it.id)) this.locker(profile, onBack);
        });
        g.append(b);
      }
      grid.append(g);
    };
    groupPill('Plink', PLINKS, 'plink');
    groupPill('Party', CELEBRATIONS, 'party');
    const g = $('div', 'group');
    g.append($('span', 'lbl', 'Name'));
    const nb = $('button', 'pill on', BALL_NAMES[profile.data.look.name]);
    nb.addEventListener('click', () => {
      profile.nextName();
      this.locker(profile, onBack);
    });
    g.append(nb);
    grid.append(g);
    card.append(grid);
    const stats = profile.data.stats;
    card.append($('div', 'badgeline', `${stats.holes} holes · ${profile.data.perigees.length} perigees · ${stats.wins} wins`));
    s.append(card, button('Back', 'ghost', onBack, 'Esc'));
    this.show('locker', s);
    return s;
  }

  // ---------------------------------------------------------------- practice picker
  practice(profile, onPick, onBack) {
    const s = $('div', 'screen top lobby');
    const card = $('div', 'card');
    card.append($('h2', '', 'Practice'));
    const grid = $('div', 'grid');
    for (const w of WORLDS) {
      const b = $('button', 'worldbtn');
      b.append(document.createTextNode(w.name));
      const rec = profile.data.records[w.id];
      b.append($('small', '', rec ? `Best ${rec}` : ' '));
      b.addEventListener('click', () => this.practiceHoles(w, onPick, () => this.practice(profile, onPick, onBack)));
      grid.append(b);
    }
    card.append(grid);
    s.append(card, button('Back', 'ghost', onBack, 'Esc'));
    this.show('practice', s);
  }

  practiceHoles(world, onPick, onBack) {
    const s = $('div', 'screen top lobby');
    const card = $('div', 'card');
    card.append($('h2', '', world.name));
    const grid = $('div', 'grid');
    for (let i = 1; i <= 9; i++) {
      const b = $('button', 'worldbtn', `Hole ${i}`);
      b.addEventListener('click', () => onPick(`${world.id}-${i}`));
      grid.append(b);
    }
    card.append(grid);
    s.append(card, button('Back', 'ghost', onBack, 'Esc'));
    this.show('practice', s);
  }

  // ---------------------------------------------------------------- in play: top bar, side strip, actions, hand
  playUi() {
    const wrap = $('div');
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const top = $('div', 'topbar');
    const hole = $('div', 'hole', '');
    const par = $('div', 'par', '');
    top.append(hole, par);
    const side = $('div', 'side');
    const actions = $('div', 'actions');
    const left = $('div', 'leftbtns');
    const hand = $('div', 'hand');
    const watching = $('div', 'watching', '');
    watching.style.display = 'none';
    wrap.append(top, side, actions, left, hand, watching);
    for (const el of [actions, left, hand]) el.style.pointerEvents = 'auto';
    this.show('play', wrap);
    return { wrap, hole, par, side, actions, left, hand, watching };
  }

  /** Rebuilds the action buttons (only when the set changes). */
  setActions(container, list, touch) {
    container.className = `actions${touch ? ' touch' : ''}`;
    container.replaceChildren();
    for (const a of list) {
      const b = button(a.label, `small ${a.cls ?? 'ghost'}`, a.onClick, touch ? '' : a.key);
      if (a.id) b.dataset.id = a.id;
      container.append(b);
    }
  }

  setHand(container, cards, selected, onPick, touch, mode) {
    container.className = `hand${touch ? ' touch' : ''}`;
    container.replaceChildren();
    if (mode === 'draft') {
      for (const id of cards) {
        const c = cardById(id);
        const b = $('button', 'cardbtn pick');
        b.append($('b', '', c?.name ?? id), $('small', '', c?.blurb ?? ''));
        b.addEventListener('click', () => onPick(id));
        container.append(b);
      }
      return;
    }
    cards.forEach((id, i) => {
      const c = cardById(id);
      const b = $('button', `cardbtn${selected === id ? ' on' : ''}`);
      b.append($('b', '', c?.name ?? id), $('small', '', touch ? c?.blurb ?? '' : `${i + 1} · ${c?.blurb ?? ''}`));
      b.addEventListener('click', () => onPick(id));
      container.append(b);
    });
  }

  /** The standings strip: [{ id, name, total, thru, me, done, bot, away, place }]. */
  setSide(container, rows) {
    container.replaceChildren();
    for (const r of rows.slice(0, 8)) {
      const line = $('div', `line${r.me ? ' me' : ''}${r.done ? ' done' : ''}`);
      const name = $('span', '', `${r.place}. ${r.name}${r.bot ? ' (bot)' : ''}${r.away ? ' · away' : ''}`);
      const num = $('span', '', r.label);
      line.append(name, num);
      container.append(line);
    }
  }

  // ---------------------------------------------------------------- between holes / final
  resultsTable(rows, room, compact = false) {
    const t = $('table', 'board');
    for (const r of rows.slice(0, compact ? 8 : 12)) {
      const tr = $('tr', r.me ? 'me' : '');
      const place = $('td', 'num', `${r.place}`);
      const name = $('td', 'name');
      if (r.avatar) {
        const img = $('img');
        img.crossOrigin = 'anonymous';
        img.src = r.avatar;
        img.alt = '';
        name.append(img);
      }
      name.append(document.createTextNode(r.name));
      if (r.bot) name.append($('span', 'tag', '(bot)'));
      if (r.word) name.append($('span', 'tag', r.word));
      const total = $('td', 'num', `${r.total}`);
      tr.append(place, name, total);
      t.append(tr);
    }
    return t;
  }

  between({ word, rows, room, draft, onPick, onReady, ready, seconds, holeName, nextName }) {
    const s = $('div', 'screen');
    s.append($('div', `word ${word.includes('!') ? 'coral' : ''}`, word));
    const card = $('div', 'card');
    card.append($('h2', '', holeName));
    card.append(this.resultsTable(rows, room));
    if (draft && draft.length) {
      card.append($('div', 'sub', 'Pick a card'));
      const hand = $('div', 'row');
      this.setHand(hand, draft, null, onPick, false, 'draft');
      hand.className = 'row';
      card.append(hand);
    }
    s.append(card);
    const row = $('div', 'row');
    row.append($('div', 'sub', `Next: ${nextName}`));
    const b = button(ready ? 'Ready' : 'Next', ready ? 'ghost' : 'teal', onReady, 'Enter');
    if (ready) b.disabled = true;
    row.append(b);
    s.append(row);
    this.show('between', s);
    this.timerEl = $('div', 'sub', '');
    s.append(this.timerEl);
    return s;
  }

  final({ rows, room, onDone, title, xpLine, over, doneLabel = 'Done' }) {
    const s = $('div', 'screen lobby');
    s.append($('div', 'word coral', title));
    const card = $('div', 'card');
    card.append(this.resultsTable(rows, room));
    if (xpLine) card.append($('div', 'badgeline', xpLine));
    s.append(card);
    if (!over) s.append(button(doneLabel, 'teal', onDone, 'Enter'));
    this.show('final', s);
    return s;
  }

  building(progress) {
    const s = $('div', 'screen');
    s.append($('div', 'word', 'Charting'));
    const p = $('div', 'progress');
    p.append($('i'));
    s.append(p);
    this.show('building', s);
  }

  closed(reason, onAgain) {
    const s = $('div', 'screen closed');
    const msg = { kicked: 'You were removed', disconnected: 'Connection lost', replaced: 'Playing in another tab', left: 'You left', moved: 'Moved' }[reason] ?? 'Connection lost';
    const btn = { kicked: 'Play', disconnected: 'Rejoin', replaced: 'Play here', left: 'Play', moved: 'Play' }[reason] ?? 'Rejoin';
    s.append($('div', 'word', msg), button(btn, 'big', onAgain));
    this.show('closed', s);
  }

  // ---------------------------------------------------------------- toasts and hints
  toast(text, cls = '', ms = 1800) {
    this.toastEl?.remove();
    const el = $('div', `toast ${cls}`, text);
    this.overlay.append(el);
    this.toastEl = el;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.remove();
      if (this.toastEl === el) this.toastEl = null;
    }, ms);
  }

  hint(text, ms = 2600) {
    this.hintEl?.remove();
    const el = $('div', 'hint', text);
    this.overlay.append(el);
    this.hintEl = el;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      el.remove();
      if (this.hintEl === el) this.hintEl = null;
    }, ms);
  }

  clearHint() {
    this.hintEl?.remove();
    this.hintEl = null;
  }
}

export { resultWord, levelFor };

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

// Flat glyphs for the clubhouse stamps (drawn here, in the palette).
const ICONS = {
  sun: '<svg viewBox="0 0 48 48"><g fill="#d86a2a"><circle cx="24" cy="24" r="10"/><g stroke="#d86a2a" stroke-width="4" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M38.1 9.9l-4.2 4.2M14.1 33.9l-4.2 4.2"/></g></g></svg>',
  flag: '<svg viewBox="0 0 48 48"><ellipse cx="24" cy="40" rx="16" ry="5" fill="#2a8f8a"/><ellipse cx="24" cy="39" rx="4" ry="1.6" fill="#11201c"/><path d="M25 39V8" stroke="#11201c" stroke-width="3" stroke-linecap="round"/><path d="M26 8l14 6-14 6z" fill="#f06a5c"/></svg>',
  ringed: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="12" fill="#d86a2a"/><path d="M14 20h20" stroke="#f3c080" stroke-width="3"/><path d="M13 27h22" stroke="#b85a24" stroke-width="2.5"/><ellipse cx="24" cy="25" rx="22" ry="6.5" fill="none" stroke="#2a8f8a" stroke-width="3.2" transform="rotate(-18 24 25)"/></svg>',
  ball: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16" fill="#f3e5c3" stroke="#11201c" stroke-width="3"/><path d="M9 21c9 4 21 4 30 0v6c-9 4-21 4-30 0z" fill="#f06a5c"/><circle cx="18" cy="16" r="3.5" fill="#fff" opacity="0.8"/></svg>',
};

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
    const s = $('div', 'screen titlescreen');
    s.append($('h1', 'title', 'Perigee'));
    const b = button('Play', 'big play');
    b.addEventListener('click', () => onPlay());
    s.append(b);
    this.show('title', s);
    return s;
  }

  // ---------------------------------------------------------------- clubhouse
  /**
   * The lobby: the course ticket (the match settings: the host changes them, everyone sees them), the solo stamps
   * (daily, practice, tour, locker), the level, the last round. The platform's Ready/Start strip sits under it.
   */
  clubhouse({ profile, room, schema, values, editable, onSetting, solo, results, onDaily, onPractice, onTour, onLocker, onInvite, daily }) {
    const s = $('div', 'screen club');
    // The course ticket.
    const t = $('div', 'ticket paper');
    const head = $('div', 'tk-head');
    head.append($('span', 'tk-title', 'Course'), $('span', 'tk-tag', editable ? 'Host' : room?.players?.size > 1 ? 'Host picks' : ''));
    t.append(head);
    const rows = $('div', 'tk-rows');
    for (const set of schema) {
      const opts = set.options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
      const i = Math.max(0, opts.findIndex((o) => o.value === values[set.id]));
      const row = $('div', `tk-row${editable ? ' edit' : ''}`);
      row.append($('span', 'tk-k', set.label));
      if (editable) {
        const prev = $('button', 'tk-arrow', '‹');
        prev.setAttribute('aria-label', `${set.label}: previous`);
        prev.addEventListener('click', () => onSetting(set.id, opts[(i - 1 + opts.length) % opts.length].value));
        const next = $('button', 'tk-arrow', '›');
        next.setAttribute('aria-label', `${set.label}: next`);
        next.addEventListener('click', () => onSetting(set.id, opts[(i + 1) % opts.length].value));
        const v = $('button', 'tk-v', opts[i].label);
        v.addEventListener('click', () => onSetting(set.id, opts[(i + 1) % opts.length].value));
        row.append(prev, v, next);
      } else row.append($('span', 'tk-v', opts[i].label));
      rows.append(row);
    }
    t.append(rows);
    if (onInvite && room && room.players.size < 2) {
      const inv = button('Invite', 'ghost small invite', onInvite);
      t.append(inv);
    }
    s.append(t);
    // The stamps: things to do alone while the round waits.
    const st = $('div', 'stamps');
    const stamp = (cls, label, sub, icon, onClick, enabled = true) => {
      const b = $('button', `stamp ${cls}`);
      const i = $('span', 'st-icon');
      i.innerHTML = ICONS[icon]; // a constant drawing from this file, never player text
      b.append(i, $('b', '', label), $('small', '', sub));
      if (!enabled) b.disabled = true;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        onClick?.();
      });
      st.append(b);
    };
    stamp('daily', 'Daily', daily.played ? `Best ${daily.best}` : daily.streak > 0 ? `Streak ${daily.streak}` : 'New', 'sun', onDaily, solo);
    stamp('practice', 'Practice', '72 holes', 'flag', onPractice, solo);
    stamp('tour', 'Tour', `Stage ${profile.data.tour.stage + 1}`, 'ringed', onTour, solo);
    stamp('locker', 'Locker', profile.look().name, 'ball', onLocker);
    s.append(st);
    // The level.
    const lv = $('div', 'level');
    const lo = xpForLevel(profile.level);
    const hi = xpForLevel(profile.level + 1);
    lv.append($('span', 'lv-n', `Level ${profile.level}`));
    const xp = $('div', 'xp');
    const bar = $('i');
    bar.style.width = `${Math.round(100 * Math.min(1, (profile.data.xp - lo) / Math.max(1, hi - lo)))}%`;
    xp.append(bar);
    lv.append(xp);
    st.append(lv);
    if (results && results.length) {
      const r = $('div', 'lastround paper');
      r.append($('div', 'tk-head', ''), this.resultsTable(results, room, true));
      r.firstChild.append($('span', 'tk-title', 'Last round'));
      s.append(r);
    }
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

  final({ rows, room, onDone, title, xpLine, over, doneLabel = 'Done', head = 'Scorecard' }) {
    const s = $('div', 'screen lobby');
    s.append($('div', 'word coral', title));
    const card = $('div', 'card');
    card.append($('h2', '', head));
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

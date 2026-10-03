// Input: drag to orbit (mouse or one finger), WASD/arrows nudge, Space or the on-screen Shoot button held to
// charge and released to shoot, Esc or a second finger cancels, wheel or buttons zoom. Keys clear on blur and when
// the tab hides; a finger that slides off is a release; two fingers cancel the charge.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.drag = null; // { id, x, y, moved }
    this.touches = new Map();
    this.handlers = {};
    this.dragSpeed = 0.0075;
    this.enabled = true;
    const on = (ev, fn, el = window) => el.addEventListener(ev, fn, { passive: false });
    on('keydown', (e) => this.onKey(e, true));
    on('keyup', (e) => this.onKey(e, false));
    on('blur', () => this.clear());
    on('visibilitychange', () => {
      if (document.hidden) this.clear();
    }, document);
    on('pointerdown', (e) => this.onDown(e), canvas);
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onUp(e));
    on('wheel', (e) => {
      e.preventDefault();
      this.emit('zoom', Math.sign(e.deltaY) * 1.2);
    }, canvas);
    on('contextmenu', (e) => e.preventDefault(), canvas);
  }

  on(ev, fn) {
    (this.handlers[ev] ??= []).push(fn);
  }

  emit(ev, ...args) {
    for (const fn of this.handlers[ev] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  clear() {
    for (const k of this.keys) this.emit('keyup', k);
    this.keys.clear();
    this.drag = null;
    this.touches.clear();
    this.emit('cancel');
  }

  onKey(e, down) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Keys the game uses don't scroll or type; Tab keeps moving focus between buttons; a key typed with a
    // modifier (a browser shortcut) is left alone.
    const used = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '1', '2', '3', 'x', 'Enter', 'c', '-', '=', '+', 'n', 'p'];
    if (used.includes(k) && !e.ctrlKey && !e.metaKey && !e.altKey && !(k === 'Enter' && e.target?.tagName === 'BUTTON')) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(k);
      this.emit('keydown', k);
    } else {
      this.keys.delete(k);
      this.emit('keyup', k);
    }
  }

  held(k) {
    return this.keys.has(k);
  }

  onDown(e) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        this.drag = null;
        this.emit('cancel');
        return;
      }
    }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button, type: e.pointerType };
    this.emit('press', e.clientX, e.clientY, e.pointerType);
  }

  onMove(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    this.emit('orbit', dx * this.dragSpeed, dy * this.dragSpeed);
  }

  onUp(e) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    if (this.drag && this.drag.id === e.pointerId) {
      const d = this.drag;
      this.drag = null;
      this.emit('release', e.clientX, e.clientY, d.moved < 8, d.type);
    }
  }
}

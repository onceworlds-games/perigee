// Procedural sound: marimba plinks by power, a whoosh by speed, surface thuds, a gravity hum that swells near
// worlds, spring boings, the cup plunk with a glimmer, a comic crowd "oooh", a hole-in-one fanfare, a calm pad
// and the timer tick. Everything through one compressor so nothing clips. The context starts on the first gesture.
const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // a pentatonic ladder

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.lastPlink = -1;
    this.hum = null;
    this.humGain = null;
    this.pad = null;
    this.padGain = null;
    this.whoosh = null;
    this.whooshGain = null;
    this.whooshFilter = null;
    this.noiseBuf = null;
    this.plink = 'marimba';
    this.lastTick = 0;
    this.muted = false;
  }

  /** Call from a tap or key inside the game. */
  start() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.8;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 10;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(c.destination);
      // Noise buffer for whooshes, thuds and the crowd.
      const len = c.sampleRate * 2;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Gravity hum: two detuned sines.
      this.humGain = c.createGain();
      this.humGain.gain.value = 0;
      this.humGain.connect(this.master);
      for (const f of [55, 55.6]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(this.humGain);
        o.start();
      }
      // Whoosh: filtered noise, gain by speed.
      this.whooshGain = c.createGain();
      this.whooshGain.gain.value = 0;
      this.whooshFilter = c.createBiquadFilter();
      this.whooshFilter.type = 'bandpass';
      this.whooshFilter.frequency.value = 600;
      this.whooshFilter.Q.value = 0.7;
      const ws = c.createBufferSource();
      ws.buffer = this.noiseBuf;
      ws.loop = true;
      ws.connect(this.whooshFilter);
      this.whooshFilter.connect(this.whooshGain);
      this.whooshGain.connect(this.master);
      ws.start();
      // Pad: slow chords from filtered saws.
      this.padGain = c.createGain();
      this.padGain.gain.value = 0;
      const pf = c.createBiquadFilter();
      pf.type = 'lowpass';
      pf.frequency.value = 500;
      pf.connect(this.padGain);
      this.padGain.connect(this.master);
      this.padFilter = pf;
      this.padOsc = [];
      for (const semis of [0, 7, 12, 16]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 110 * Math.pow(2, semis / 12);
        o.detune.value = (Math.random() - 0.5) * 8;
        const g = c.createGain();
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(pf);
        o.start();
        this.padOsc.push(o);
      }
      this.ready = true;
      if (c.state === 'suspended') c.resume().catch(() => {});
    } catch {
      this.ready = false;
    }
  }

  resume() {
    try {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {}
  }

  setPlink(id) {
    this.plink = id;
  }

  tone(freq, { type = 'sine', gain = 0.3, attack = 0.005, decay = 0.4, detune = 0, pan = 0, partials = null } = {}) {
    if (!this.ready) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
      g.connect(this.master);
      const list = partials ?? [[1, 1]];
      for (const [ratio, amp] of list) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = freq * ratio;
        o.detune.value = detune;
        const pg = c.createGain();
        pg.gain.value = amp;
        o.connect(pg);
        pg.connect(g);
        o.start(t);
        o.stop(t + attack + decay + 0.05);
      }
    } catch {}
  }

  noise({ gain = 0.3, attack = 0.002, decay = 0.2, freq = 800, q = 1, type = 'bandpass' } = {}) {
    if (!this.ready) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
      s.connect(f);
      f.connect(g);
      g.connect(this.master);
      s.start(t);
      s.stop(t + attack + decay + 0.05);
      return f;
    } catch {
      return null;
    }
  }

  /** A note from the ladder, never the same twice in a row, with a little random detune. */
  note(degreeHint, base = 440) {
    let i = Math.max(0, Math.min(NOTES.length - 1, Math.round(degreeHint)));
    if (i === this.lastPlink) i = (i + 1 + Math.floor(Math.random() * 2)) % NOTES.length;
    this.lastPlink = i;
    return base * Math.pow(2, NOTES[i] / 12);
  }

  /** The shot: a plink whose pitch follows the power. */
  shot(power) {
    const f = this.note(2 + power * 7, 330);
    const kit = {
      marimba: { type: 'sine', partials: [[1, 1], [4, 0.25], [9.2, 0.08]], decay: 0.35 },
      vibes: { type: 'sine', partials: [[1, 1], [2.76, 0.3], [5.4, 0.1]], decay: 0.9 },
      kalimba: { type: 'triangle', partials: [[1, 1], [3.1, 0.2]], decay: 0.5 },
      bell: { type: 'sine', partials: [[1, 0.8], [2, 0.4], [3.01, 0.3], [4.2, 0.2]], decay: 1.4 },
    }[this.plink] ?? { type: 'sine', partials: [[1, 1], [4, 0.25]], decay: 0.35 };
    this.tone(f, { ...kit, gain: 0.25 + power * 0.25, detune: (Math.random() - 0.5) * 14 });
    this.noise({ gain: 0.08 + power * 0.12, decay: 0.12, freq: 1800, q: 0.8 });
  }

  bounce(kind, speed) {
    const s = Math.min(1, speed / 14);
    const v = (Math.random() - 0.5) * 0.15;
    if (kind === 'metal' || kind === 'comet') this.tone(900 * (1 + v), { type: 'triangle', partials: [[1, 1], [2.7, 0.4], [5.1, 0.2]], gain: 0.15 + s * 0.2, decay: 0.3 });
    else if (kind === 'ice') this.tone(1800 * (1 + v), { type: 'sine', partials: [[1, 1], [3, 0.2]], gain: 0.1 + s * 0.15, decay: 0.22 });
    else if (kind === 'moss') this.noise({ gain: 0.12 + s * 0.2, decay: 0.16, freq: 160, q: 0.6, type: 'lowpass' });
    else if (kind === 'pad') this.tone(220, { type: 'square', gain: 0.18 + s * 0.15, decay: 0.35, partials: [[1, 0.6], [1.5, 0.4], [2, 0.3]] });
    else this.noise({ gain: 0.1 + s * 0.22, decay: 0.14, freq: 300 * (1 + v), q: 0.8, type: 'lowpass' });
    if (kind === 'pad') this.boing();
  }

  boing() {
    if (!this.ready) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.4);
      const g = c.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.5);
    } catch {}
  }

  land(kind, speed) {
    this.bounce(kind, Math.max(1.5, speed * 0.6));
  }

  holed(ace) {
    this.tone(180, { type: 'sine', partials: [[1, 1], [2, 0.3]], gain: 0.4, decay: 0.5 });
    const base = 660;
    for (let i = 0; i < 5; i++) setTimeout(() => this.tone(base * Math.pow(2, NOTES[(i * 2 + 3) % NOTES.length] / 12), { partials: [[1, 1], [3, 0.2]], gain: 0.16, decay: 0.5 }), 60 + i * 55);
    if (ace) setTimeout(() => this.fanfare(), 350);
  }

  fanfare() {
    const seq = [[0, 0], [4, 0.12], [7, 0.24], [12, 0.38], [16, 0.52], [19, 0.66], [24, 0.84]];
    for (const [semi, dt] of seq) setTimeout(() => this.tone(440 * Math.pow(2, semi / 12), { type: 'triangle', partials: [[1, 1], [2, 0.3], [3, 0.15]], gain: 0.22, decay: 0.7 }), dt * 1000);
    setTimeout(() => this.tone(880, { partials: [[1, 0.6], [1.5, 0.5], [2, 0.4], [2.5, 0.3]], gain: 0.3, decay: 1.8 }), 1000);
  }

  /** The crowd: formant-filtered noise sweeping like an "oooh". */
  oooh() {
    if (!this.ready) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.25);
      g.gain.linearRampToValueAtTime(0.2, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      g.connect(this.master);
      for (const [f0, f1, q] of [[350, 450, 8], [700, 900, 10], [2400, 2600, 14]]) {
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = q;
        f.frequency.setValueAtTime(f0, t);
        f.frequency.linearRampToValueAtTime(f1, t + 0.7);
        s.connect(f);
        f.connect(g);
      }
      s.start(t);
      s.stop(t + 1.4);
    } catch {}
  }

  lost() {
    this.tone(220, { type: 'sine', gain: 0.25, decay: 0.6, partials: [[1, 1], [0.5, 0.5]] });
    setTimeout(() => this.tone(165, { type: 'sine', gain: 0.22, decay: 0.8 }), 180);
  }

  warp() {
    if (!this.ready) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
      const g = c.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.45);
    } catch {}
  }

  ring() {
    this.tone(523, { type: 'triangle', partials: [[1, 1], [2, 0.5]], gain: 0.2, decay: 0.3 });
    setTimeout(() => this.tone(784, { type: 'triangle', gain: 0.18, decay: 0.4 }), 70);
  }

  click() {
    this.tone(1200 + Math.random() * 200, { type: 'square', gain: 0.06, decay: 0.05 });
  }

  tick(urgent) {
    this.tone(urgent ? 1400 : 1000, { type: 'square', gain: 0.05, decay: 0.04 });
  }

  card() {
    this.tone(660, { type: 'triangle', partials: [[1, 1], [2, 0.3]], gain: 0.15, decay: 0.25 });
    setTimeout(() => this.tone(990, { type: 'triangle', gain: 0.12, decay: 0.3 }), 90);
  }

  /** Per frame: the hum by nearness to a world, the whoosh by speed, the pad by altitude. */
  ambience(dt, { near = 1, speed = 0, altitude = 0, playing = false, reduced = false }) {
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      const hum = playing ? Math.max(0, 1 - near / 12) * 0.12 : 0;
      this.humGain.gain.setTargetAtTime(hum, t, 0.2);
      const w = playing ? Math.min(1, speed / 30) : 0;
      this.whooshGain.gain.setTargetAtTime(w * 0.2, t, 0.1);
      this.whooshFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.1);
      this.padGain.gain.setTargetAtTime(0.18, t, 1.5);
      this.padFilter.frequency.setTargetAtTime(300 + Math.min(altitude, 30) * 25 + (reduced ? 0 : Math.sin(t * 0.2) * 60), t, 0.8);
    } catch {}
  }
}

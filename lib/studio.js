'use strict';
// The studio's state and transitions: which bus (A or B) is on air, which scene each one holds,
// and the transition running. Commands go to FFmpeg through `send(lines)` (lib/zmq.js), which
// applies everything sent together on the same frame. See lib/compositor.js for the picture:
//
//   base (on air) ─┬──────────────────────────────┐
//                  ├─ blend@mix (fade, dip)  ────┼─ out ─▶ program
//   next ──────────┴─ overlay@tr (slide, wipe) ──┘
//
// A transition is a list of steps. A switch (base / next / out) is only changed while its
// picture isn't the one on air, and the steps are a few frames apart, so nothing flashes.
const { EventEmitter } = require('events');
const { sceneCommands, OUT, BUS } = require('./compositor');

const TYPES = ['cut', 'fade', 'dip', 'slide', 'wipe'];
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)); // smoothstep
const even = (n) => 2 * Math.round(n / 2);
const GAP = 70; // ms between steps: a couple of frames, so each step has landed before the next

class Studio extends EventEmitter {
  constructor({ send = () => {}, tickMs = 33, gapMs = GAP } = {}) {
    super();
    this.send = send;
    this.tickMs = tickMs;
    this.gapMs = gapMs;
    this.q = { width: 1280, height: 720, fps: 30 };
    this.index = {};
    this.slots = 4;
    this.live = 'a';
    this.scenes = { a: null, b: null };
    this.running = null; // { type, from, to }
    this.manual = null;  // T-bar: { from, to, stage }
    this.steps = [];
  }

  // FFmpeg (re)started with sceneA on air (bus A) and sceneB in Preview (bus B).
  reset({ q, index, slots = 4, sceneA, sceneB }) {
    this.stopTimer();
    this.q = q;
    this.index = index;
    this.slots = slots;
    this.live = 'a';
    this.scenes = { a: sceneA, b: sceneB };
    this.running = null;
    this.manual = null;
    this.steps = [];
    this.emit('change', this.state());
  }

  get off() { return this.live === 'a' ? 'b' : 'a'; }
  get busy() { return !!(this.running || this.manual); }
  state() {
    return {
      onAir: this.scenes[this.live] ? this.scenes[this.live].id : null,
      preview: this.scenes[this.off] ? this.scenes[this.off].id : null,
      transition: this.running ? this.running.type : this.manual ? 'tbar' : null,
    };
  }

  // Put a scene in Preview (the off-air bus; viewers don't see it).
  preview(scene) {
    if (this.busy) return false;
    this.scenes[this.off] = scene;
    this.send(sceneCommands(scene, this.off, this.q, this.index, this.slots));
    this.emit('change', this.state());
    return true;
  }

  // Update a scene that is showing (edited, or a camera renamed) in place.
  refresh(scene) {
    for (const bus of ['a', 'b']) {
      if (this.scenes[bus] && this.scenes[bus].id === scene.id) {
        this.scenes[bus] = scene;
        this.send(sceneCommands(scene, bus, this.q, this.index, this.slots));
      }
    }
  }

  // --- steps --------------------------------------------------------------------------------
  // Each step: { lines } (sent, then a short gap), { anim: (t) => lines, ms }, or { call: fn }.
  run(steps) {
    this.steps = steps;
    this.next();
  }

  next() {
    this.stopTimer();
    const step = this.steps.shift();
    if (!step) return;
    if (step.call) { step.call(); this.next(); return; }
    if (step.lines) {
      this.send(step.lines);
      this.timer = setTimeout(() => this.next(), step.gap ?? this.gapMs);
      return;
    }
    if (step.anim) {
      const start = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / step.ms);
        this.send(step.anim(ease(t)));
        if (t >= 1) { this.stopTimer(); this.timer = setTimeout(() => this.next(), this.gapMs); }
      };
      tick();
      this.interval = setInterval(tick, this.tickMs);
    }
  }

  stopTimer() {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  // Preview → Program with a transition. Returns false while another one is running.
  take(type = 'cut', ms = 600) {
    if (this.busy) return false;
    if (!TYPES.includes(type)) type = 'cut';
    ms = Math.max(100, Math.min(5000, Number(ms) || 600));
    const from = this.live;
    const to = this.off;
    const W = this.q.width;
    const base = (bus) => `streamselect@base map ${BUS[bus]}`;
    const next = (bus) => `streamselect@next map ${BUS[bus]}`;
    const out = (k) => `streamselect@out map ${OUT[k]}`;
    const swapped = { call: () => { this.live = to; this.emit('change', this.state()); } };
    const done = { call: () => { this.running = null; this.emit('change', this.state()); } };
    let steps;
    if (type === 'cut') {
      steps = [{ lines: [base(to)] }, swapped, { lines: [next(from)], gap: 0 }, done];
    } else if (type === 'fade') {
      steps = [
        { lines: ['blend@mix all_opacity 0', 'blend@mix enable 1'] },
        { lines: [out('mix')] },
        { anim: (t) => [`blend@mix all_opacity ${t.toFixed(3)}`], ms },
        { lines: [base(to)] }, swapped,               // unseen: the fade shows `next` fully
        { lines: [out('base')] },
        { lines: [next(from), 'blend@mix enable 0'], gap: 0 }, done,
      ];
    } else if (type === 'dip') {
      steps = [
        { lines: [next('black')] },                  // unseen: `out` shows base
        { lines: ['blend@mix all_opacity 0', 'blend@mix enable 1'] },
        { lines: [out('mix')] },
        { anim: (t) => [`blend@mix all_opacity ${t.toFixed(3)}`], ms: ms / 2 },
        { lines: [base(to)] }, swapped,               // unseen: the screen is black
        { anim: (t) => [`blend@mix all_opacity ${(1 - t).toFixed(3)}`], ms: ms / 2 },
        { lines: [out('base')] },
        { lines: [next(from), 'blend@mix enable 0'], gap: 0 }, done,
      ];
    } else {
      const wipe = type === 'wipe';
      steps = [
        { lines: wipe ? ['crop@wipe w 2', 'overlay@tr x 0', 'overlay@tr enable 1'] : [`overlay@tr x ${W}`, 'overlay@tr enable 1'] },
        { lines: [out('tr')] },
        { anim: (t) => (wipe ? [`crop@wipe w ${Math.max(2, even(W * t))}`] : [`overlay@tr x ${even(W * (1 - t))}`]), ms },
        { lines: [base(to)] }, swapped,               // unseen: `next` covers the whole picture
        { lines: [out('base')] },
        { lines: [next(from), 'overlay@tr enable 0', `overlay@tr x ${W + 8}`, `crop@wipe w ${W}`], gap: 0 }, done,
      ];
    }
    this.running = { type, from, to };
    this.emit('change', this.state());
    this.run(steps);
    return true;
  }

  // The T-bar: a fade by hand. 0 = Program as it is, 1 = Preview fully on air (then it swaps).
  tbar(pos) {
    if (this.running) return false;
    pos = Math.max(0, Math.min(1, Number(pos) || 0));
    if (!this.manual) {
      if (pos <= 0) return true;
      this.manual = { from: this.live, to: this.off };
      this.send([`blend@mix all_opacity ${pos.toFixed(3)}`, 'blend@mix enable 1']);
      // Show the fade a moment later, once it is switched on.
      setTimeout(() => { if (this.manual) this.send(['streamselect@out map ' + OUT.mix]); }, this.gapMs);
      this.emit('change', this.state());
      return true;
    }
    const { from, to } = this.manual;
    if (pos >= 1) {
      this.send(['blend@mix all_opacity 1']);
      this.manual = null;
      this.running = { type: 'tbar', from, to };
      this.run([
        { lines: [`streamselect@base map ${BUS[to]}`] },
        { call: () => { this.live = to; this.emit('change', this.state()); } },
        { lines: [`streamselect@out map ${OUT.base}`] },
        { lines: [`streamselect@next map ${BUS[from]}`, 'blend@mix enable 0'], gap: 0 },
        { call: () => { this.running = null; this.emit('change', this.state()); } },
      ]);
    } else if (pos <= 0) {
      this.send(['blend@mix all_opacity 0']);
      this.manual = null;
      this.running = { type: 'tbar', from, to };
      this.run([
        { lines: [`streamselect@out map ${OUT.base}`] },
        { lines: ['blend@mix enable 0'], gap: 0 },
        { call: () => { this.running = null; this.emit('change', this.state()); } },
      ]);
    } else {
      this.send([`blend@mix all_opacity ${pos.toFixed(3)}`]);
    }
    return true;
  }

  // FFmpeg stopped in the middle of a transition: settle on where it was going.
  abort() {
    this.stopTimer();
    this.steps = [];
    if (this.running) this.live = this.running.to;
    this.running = null;
    this.manual = null;
  }

  close() { this.stopTimer(); }
}

module.exports = { Studio, TYPES, ease };

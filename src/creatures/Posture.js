// Staged posture transitions and one-shot body actions for quadrupeds.
//
// A posture is a point in a small space of body *channels* (how far the rear
// is lowered, whether the hind legs are folded, front lowered, paws reached
// forward, rolled onto a hip, ...). QuadrupedRig turns channels into body
// height, pitch and paw targets. Transitions are not weight blends: each
// channel moves in its own time window, so a dog sits by lowering its rear
// first, lies down front-first (or by sliding its paws out of a sit), and
// gets up front end first. Actions (shake, stretch, scratch, yawn) are timed
// channel tracks layered on top; ones that need a posture (a scratch needs a
// sit) get there first.
//
// Creature code asks for a posture with want(name) and plays actions with
// play(name); `weights` summarises the state as the legacy pose weights
// (sit, lie, sleep, eat, bow) that behaviour and UI code read.
import { clamp, lerp } from '../util/noise.js';

export const CHANNELS = ['rear', 'tuck', 'front', 'reach', 'side', 'curl', 'headLow', 'eat', 'bowRear', 'crouch',
  'rearStretch', 'headUp', 'shake', 'scratch', 'yawn', 'sniff'];

const POSTURES = {
  stand: {},
  sit: { rear: 1, tuck: 1 },
  lie: { rear: 1, tuck: 1, front: 1, reach: 1 },
  sleep: { rear: 1, tuck: 1, front: 1, reach: 1, side: 1, curl: 1, headLow: 1 },
  eat: { eat: 1, front: 0.18 },
  bow: { front: 1, reach: 0.8, bowRear: 1 },
};
export const POSTURE_NAMES = Object.keys(POSTURES);

// Per-channel windows [start, end] as fractions of the transition; channels
// not listed move over the whole transition.
const TRANSITIONS = {
  'stand>sit': { dur: 0.95, ch: { rear: [0.04, 0.8], tuck: [0.12, 0.88] } },
  'sit>stand': { dur: 0.75, ch: { rear: [0.08, 0.9], tuck: [0, 0.72] } },
  'sit>lie': { dur: 1.25, ch: { front: [0.25, 1], reach: [0, 0.8] } },
  'lie>sit': { dur: 0.85, ch: { front: [0, 0.75], reach: [0.12, 0.92] } },
  // front end first, as a dog folds its elbows and then drops its hindquarters
  'stand>lie': { dur: 1.6, ch: { front: [0, 0.5], reach: [0, 0.45], rear: [0.38, 1], tuck: [0.42, 1] } },
  // dogs rise front end first
  'lie>stand': { dur: 1.15, ch: { front: [0, 0.48], reach: [0, 0.42], rear: [0.32, 0.96], tuck: [0.3, 0.9] } },
  'lie>sleep': { dur: 2.6, ch: { side: [0, 0.6], curl: [0.15, 0.85], headLow: [0.5, 1] } },
  'sleep>lie': { dur: 1.3, ch: { headLow: [0, 0.45], side: [0.2, 1], curl: [0.1, 0.9] } },
  'stand>eat': { dur: 0.7, ch: { front: [0, 0.6], eat: [0.1, 1] } },
  'eat>stand': { dur: 0.6, ch: { eat: [0, 0.8], front: [0.2, 1] } },
  'stand>bow': { dur: 0.45, ch: { front: [0, 1], reach: [0, 0.85], bowRear: [0, 0.8] } },
  'bow>stand': { dur: 0.55, ch: { front: [0, 0.9], reach: [0.1, 1], bowRear: [0, 0.8] } },
};
const HOPS = {
  stand: { sleep: 'lie' },
  sit: { sleep: 'lie', eat: 'stand', bow: 'stand' },
  lie: { eat: 'stand', bow: 'stand' },
  sleep: { '*': 'lie' },
  eat: { '*': 'stand' },
  bow: { '*': 'stand' },
};

// Actions: tracks of [t, value] keys (t in seconds), interpolated smoothly.
// `need` is the posture the action is performed from.
const ACTIONS = {
  shake: { dur: 1.3, need: 'stand', tracks: {
    shake: [[0, 0], [0.12, 1], [0.95, 1], [1.3, 0]],
    crouch: [[0, 0], [0.15, 0.25], [1.0, 0.25], [1.3, 0]],
  } },
  // play-bow stretch, then a rear stretch with the hind legs drawn out behind
  stretch: { dur: 3.6, need: 'stand', tracks: {
    front: [[0, 0], [0.55, 1], [1.5, 1], [1.95, 0]],
    reach: [[0, 0], [0.5, 1.15], [1.55, 1.15], [1.95, 0]],
    bowRear: [[0, 0], [0.55, 1], [1.5, 1], [1.9, 0]],
    headUp: [[0, 0], [0.6, 0.55], [1.4, 0.65], [1.85, 0.15], [2.3, 0.5], [3.1, 0.45], [3.6, 0]],
    rearStretch: [[1.75, 0], [2.3, 1], [3.05, 1], [3.6, 0]],
  } },
  scratch: { dur: 2.6, need: 'sit', tracks: { scratch: [[0, 0], [0.4, 1], [2.2, 1], [2.6, 0]] } },
  yawn: { dur: 2.1, need: null, tracks: {
    yawn: [[0, 0], [0.7, 1], [1.25, 1], [1.7, 0.08], [2.1, 0]],
    headUp: [[0, 0], [0.7, 0.4], [1.3, 0.45], [2.1, 0]],
  } },
};
export const ACTION_NAMES = Object.keys(ACTIONS);

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function sampleTrack(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return lerp(v0, v1, smoother((t - t0) / Math.max(1e-6, t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

const zero = () => Object.fromEntries(CHANNELS.map((c) => [c, 0]));

export class Posture {
  constructor({ rnd = Math.random, start = 'stand' } = {}) {
    this.rnd = rnd;
    this.cur = start;          // posture reached (or being left)
    this.target = start;
    this.base = { ...zero(), ...POSTURES[start] };
    this.ch = { ...this.base };
    this.tr = null;            // active transition
    this.act = null;           // active action
    this.queue = [];
    this.sideSign = 1;         // which hip to roll onto
    this.scratchSide = 1;
    this.weights = { sit: 0, lie: 0, sleep: 0, eat: 0, bow: 0 };
    this.sniff = 0;
    this.summarise();
  }

  /** Request a posture ('stand' | 'sit' | 'lie' | 'sleep' | 'eat' | 'bow'; null = stand). */
  want(name) { this.target = name && POSTURES[name] ? name : 'stand'; }

  /** Jump straight to a posture (spawn / load). */
  snap(name = 'stand') {
    this.cur = this.target = name;
    this.base = { ...zero(), ...POSTURES[name] };
    this.tr = null; this.act = null; this.queue.length = 0;
    this.update(0);
  }

  /** Play a one-shot action ('shake' | 'stretch' | 'scratch' | 'yawn'). */
  play(name, opts = {}) {
    if (!ACTIONS[name]) return false;
    if (this.act?.name === name || this.queue.some((q) => q.name === name)) return true;
    if (name === 'scratch') this.scratchSide = opts.side ?? (this.rnd() < 0.5 ? 1 : -1);
    this.queue.push({ name, t: 0, ...opts });
    return true;
  }

  /** Currently playing (or queued) action name, else null. */
  get action() { return this.act?.name || this.queue[0]?.name || null; }
  get actionTime() { return this.act ? this.act.t : 0; }
  /** True while changing posture or performing an action. */
  get busy() { return !!(this.tr || this.act || this.queue.length || this.target !== this.cur); }
  /** The posture the body is in or heading to. */
  get posture() { return this.tr ? this.tr.to : this.cur; }

  begin(to) {
    // about half the time a dog lies down by way of a sit
    if (this.cur === 'stand' && to === 'lie' && this.rnd() < 0.45) to = 'sit';
    const def = TRANSITIONS[`${this.cur}>${to}`] || { dur: 0.8, ch: {} };
    if (to === 'sleep') this.sideSign = this.rnd() < 0.5 ? 1 : -1;
    this.tr = { from: { ...this.base }, to, def, t: 0, rate: 1 };
  }

  nextHop(from, to) {
    const h = HOPS[from];
    return (h && (h[to] || h['*'])) || to;
  }

  update(dt) {
    // posture transitions -------------------------------------------------
    // the goal is the requested posture, unless a queued action needs another
    const need = this.queue.length && this.queue[0].name ? ACTIONS[this.queue[0].name].need : null;
    const goal = need && !this.act ? need : this.target;
    if (this.tr && this.tr.to !== goal && goal === this.cur && this.tr.t / this.tr.def.dur < 0.6) {
      // changed our mind early: reverse back to where we came from, briskly
      const back = TRANSITIONS[`${this.tr.to}>${this.cur}`] || { dur: 0.7, ch: {} };
      this.tr = { from: { ...this.base }, to: this.cur, def: back, t: back.dur * 0.35, rate: 1.3 };
    }
    if (!this.tr && !this.act && goal !== this.cur) this.begin(this.nextHop(this.cur, goal));
    if (this.tr) {
      const tr = this.tr;
      tr.t += dt * tr.rate;
      const k = tr.t / tr.def.dur;
      const dest = POSTURES[tr.to];
      for (const c of CHANNELS) {
        const w = tr.def.ch[c] || [0, 1];
        const e = smoother(clamp((k - w[0]) / (w[1] - w[0]), 0, 1));
        this.base[c] = lerp(tr.from[c], dest[c] || 0, e);
      }
      if (k >= 1) { this.cur = tr.to; this.tr = null; }
    }

    // actions ---------------------------------------------------------------
    if (!this.act && !this.tr && this.queue.length && this.queue[0].name) {
      const q = this.queue[0];
      const def = ACTIONS[q.name];
      if (!def.need || def.need === this.cur) { this.queue.shift(); this.act = { ...q, def, t: 0 }; }
    }
    for (const c of CHANNELS) this.ch[c] = this.base[c];
    if (this.act) {
      const a = this.act;
      a.t += dt;
      for (const [c, keys] of Object.entries(a.def.tracks)) this.ch[c] = Math.max(this.ch[c], sampleTrack(keys, a.t));
      if (a.t >= a.def.dur) this.act = null;
    }
    this.ch.sniff = this.sniff;
    this.summarise();
    return this.ch;
  }

  summarise() {
    const c = this.ch, w = this.weights;
    const low = Math.min(c.rear, c.front);
    w.sleep = clamp(Math.min(c.side, low) * 1.1, 0, 1);
    w.lie = clamp(low - w.sleep, 0, 1);
    w.sit = clamp(c.rear * c.tuck * (1 - c.front), 0, 1);
    w.eat = clamp(c.eat, 0, 1);
    w.bow = clamp(c.front * (1 - c.rear), 0, 1);
    this.level = Math.max(w.sit, w.lie, w.sleep, w.eat, w.bow, c.rearStretch, c.shake, c.scratch);
  }
}

/** Channels for legacy pose weights {sit, lie, sleep, eat, bow} (static previews). */
export function channelsFromWeights(p = {}) {
  const ch = zero();
  const sit = p.sit || 0, lie = p.lie || 0, sleep = p.sleep || 0, eat = p.eat || 0, bow = p.bow || 0;
  ch.rear = Math.max(sit, lie, sleep);
  ch.tuck = ch.rear;
  ch.front = Math.max(lie, sleep, bow, 0.18 * eat);
  ch.reach = Math.max(lie, sleep, 0.8 * bow);
  ch.side = ch.curl = ch.headLow = sleep;
  ch.eat = eat;
  ch.bowRear = bow;
  return ch;
}

// Recorded sound playback: lazy-loaded buffers, variant rotation (no
// immediate repeats), pitch/volume jitter, 3D positioning via PannerNode,
// and looping voices that follow a moving source (e.g. a panting dog).
import { SOUNDS } from '../data/sounds.js';

export class SoundBank {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.buffers = new Map();   // url -> AudioBuffer | Promise
    this.last = new Map();      // id -> last variant index
    this.loops = new Map();     // key -> {src, gain, panner}
  }

  has(id) { return !!SOUNDS[id]?.files?.length; }

  load(url) {
    if (!this.buffers.has(url)) {
      const p = fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this.buffers.set(url, buf); return buf; })
        .catch((e) => { console.warn('sound failed', url, e.message); this.buffers.set(url, null); return null; });
      this.buffers.set(url, p);
    }
    return this.buffers.get(url);
  }

  /** Decode every file of the given ids ahead of time. */
  preload(ids = Object.keys(SOUNDS)) {
    return Promise.all(ids.flatMap((id) => (SOUNDS[id]?.files || []).map((f) => this.load(f))));
  }

  pick(id) {
    const files = SOUNDS[id].files;
    if (files.length === 1) return files[0];
    let i = Math.floor(Math.random() * files.length);
    if (i === this.last.get(id)) i = (i + 1) % files.length;
    this.last.set(id, i);
    return files[i];
  }

  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.2;
    p.rolloffFactor = 1.1;
    p.maxDistance = 80;
    this.setPos(p, pos);
    return p;
  }

  setPos(p, pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0.5; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y ?? 0.5, pos.z);
  }

  /**
   * Play a one-shot. opts: {pos:{x,y,z}, volume, rate, delay}
   * Returns the source node, or null while the buffer is still decoding.
   */
  play(id, opts = {}) {
    const def = SOUNDS[id];
    if (!def?.files?.length) return null;
    const url = this.pick(id);
    const buf = this.buffers.get(url);
    if (!buf || buf instanceof Promise) { this.load(url); return null; }
    const ctx = this.ctx, t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const jitter = def.pitch ?? 0.06;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const g = ctx.createGain();
    g.gain.value = (def.volume ?? 1) * (opts.volume ?? 1) * (1 + (Math.random() * 2 - 1) * (def.volJitter ?? 0.12));
    src.connect(g);
    let node = g;
    if (opts.pos && def.spatial !== false) { const p = this.panner(opts.pos); g.connect(p); node = p; }
    node.connect(this.out);
    const offset = def.trim?.[0] ?? 0;
    const dur = def.trim ? def.trim[1] - def.trim[0] : undefined;
    src.start(t, offset, dur);
    return src;
  }

  /** Start or update a looping voice; volume 0 fades it out. */
  loop(key, id, { pos, volume = 1, rate = 1 } = {}) {
    let v = this.loops.get(key);
    const ctx = this.ctx;
    if (!v) {
      if (volume <= 0.001) return;
      const def = SOUNDS[id]; if (!def?.files?.length) return;
      const url = def.files[0];
      const buf = this.buffers.get(url);
      if (!buf || buf instanceof Promise) { this.load(url); return; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(pos || { x: 0, z: 0 });
      src.connect(g).connect(p).connect(this.out);
      src.start(0, Math.random() * buf.duration);
      v = { src, g, p, def };
      this.loops.set(key, v);
    }
    v.g.gain.setTargetAtTime((v.def.volume ?? 1) * volume, ctx.currentTime, 0.25);
    v.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.3);
    if (pos) this.setPos(v.p, pos);
    if (volume <= 0.001) {
      v.idle = (v.idle || 0) + 1;
      if (v.idle > 240) { try { v.src.stop(); } catch { /* already stopped */ } this.loops.delete(key); }
    } else v.idle = 0;
  }

  /** Place the listener at the camera. */
  listen(camera) {
    const l = this.ctx.listener;
    const p = camera.position;
    const f = { x: 0, y: 0, z: -1 }, u = { x: 0, y: 1, z: 0 };
    const e = camera.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10]; u.x = e[4]; u.y = e[5]; u.z = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }
}

// Web Audio: an ambience bed, a positional stream, wind, and small
// synthesised effects. Starts on the first user gesture (browser policy).
import { clamp } from '../util/noise.js';

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.volume = game.state?.settings?.volume ?? 0.8;
    this.muted = false;
    game.events.on('footstep', (e) => this.footstep(e));
    game.events.on('build:placed', (e) => this.thunk(e.id === 'fence' ? 0.8 : 1));
    game.events.on('build:removed', () => this.thunk(0.6, 140));
    game.events.on('build:denied', () => this.blip(180, 0.12, 'triangle', 0.05));
    game.events.on('gate', () => this.gate());
    game.events.on('objective', () => this.chime([523.25, 659.25], 0.06));
    game.events.on('research', () => this.chime([783.99], 0.04));
    game.events.on('creature:befriended', () => this.chime([392, 493.88, 587.33, 783.99], 0.07));
    game.events.on('creature:settled', () => this.chime([440, 554.37, 659.25], 0.06));
    game.events.on('creature:stage', () => this.chime([523.25, 783.99, 1046.5], 0.06));
    game.events.on('care', () => this.pour());
    game.events.on('ui:click', () => this.blip(660, 0.05, 'sine', 0.035));
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    // white noise source shared by several voices
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Ambience bed (birdsong and breeze)
    fetch('assets/vendor/ez-tree/ambience.mp3').then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.42;
      src.connect(g).connect(this.master); src.start();
      this.amb = g;
    }).catch(() => {});
    // Stream: band-limited noise, panned and gained by distance
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.streamGain = ctx.createGain(); this.streamGain.gain.value = 0;
    this.streamPan = ctx.createStereoPanner();
    s.connect(bp).connect(lp).connect(this.streamGain).connect(this.streamPan).connect(this.master); s.start();
    // Wind
    const w = ctx.createBufferSource(); w.buffer = this.noise; w.loop = true; w.playbackRate.value = 0.5;
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 380;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.04;
    w.connect(wl).connect(this.windGain).connect(this.master); w.start();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  update(dt) {
    if (!this.ctx) return;
    const g = this.game, p = g.player.pos, t = this.ctx.currentTime;
    const wd = g.world.terrain.waterDist(p.x, p.z);
    const gain = 0.22 * Math.pow(clamp(1 - wd / 28, 0, 1), 2);
    this.streamGain.gain.setTargetAtTime(gain, t, 0.3);
    // pan toward the stream (it runs west of the meadow)
    const cam = g.camera; const right = { x: Math.cos(g.cameraRig.yaw), z: -Math.sin(g.cameraRig.yaw) };
    const toWest = -1; // stream mostly lies to the west
    this.streamPan.pan.setTargetAtTime(clamp(toWest * right.x * 0.7, -0.8, 0.8), t, 0.3);
    this.windGain.gain.setTargetAtTime(0.03 + 0.03 * (0.5 + 0.5 * Math.sin(g.time * 0.21)) * (0.5 + 0.5 * Math.sin(g.time * 0.077 + 1)), t, 1.0);
  }

  burst({ dur = 0.08, freq = 900, type = 'lowpass', q = 0.7, gain = 0.1, pan = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    s.connect(f).connect(g).connect(pn).connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  footstep(e) {
    if (!this.ctx) return;
    const g = this.game;
    const d = Math.hypot(e.x - g.player.pos.x, e.z - g.player.pos.z);
    if (d > 25) return;
    const onWood = g.world.outpost.bridgeHeight(e.x, e.z) !== null || g.world.outpost.porchHeight(e.x, e.z) !== null;
    const att = clamp(1 - d / 25, 0, 1);
    if (e.who === 'player') {
      if (onWood) { this.burst({ dur: 0.09, freq: 420, type: 'bandpass', q: 3, gain: 0.16 * att }); this.blip(110 + Math.random() * 20, 0.06, 'sine', 0.05 * att); }
      else { const sp = g.world.terrain.splatAt(e.x, e.z); this.burst({ dur: 0.11, freq: sp.path > 0.5 ? 1400 : 2400, type: sp.path > 0.5 ? 'bandpass' : 'highpass', q: 0.8, gain: (sp.path > 0.5 ? 0.09 : 0.05) * att * clamp(e.speed / 1.6, 0.5, 1.3) }); }
    } else {
      this.burst({ dur: 0.05, freq: 2800, type: 'highpass', q: 0.6, gain: 0.022 * att * clamp(e.size * 4, 0.5, 2) });
    }
  }

  blip(freq, dur, type = 'sine', gain = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  chime(notes, gain = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.11;
      for (const [mult, gg] of [[1, 1], [2.01, 0.25], [3.98, 0.08]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * gg, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0003, t + 1.6);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.7);
      }
    });
  }

  thunk(gain = 1, freq = 95) {
    if (!this.ctx) return;
    this.blip(freq, 0.18, 'sine', 0.12 * gain);
    this.burst({ dur: 0.12, freq: 600, type: 'lowpass', gain: 0.12 * gain });
  }

  gate() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(190, t + 0.35);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.45);
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.5);
    setTimeout(() => this.thunk(0.5, 160), 380);
  }

  pour() {
    this.burst({ dur: 0.6, freq: 1800, type: 'bandpass', q: 1.2, gain: 0.06 });
  }
}

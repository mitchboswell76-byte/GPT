// Gait model for procedural quadrupeds: which legs are on the ground when.
//
// Speed is expressed as a Froude number Fr = v² / (g·L) (L = hip height), so
// a puppy and an adult switch gaits at the same *relative* speed and their
// cadence scales with leg length (Alexander & Jayes' dynamic similarity:
// stride ≈ 2.3·L·Fr^0.3). Gaits blend continuously through a scalar `g`:
// 0 = lateral-sequence walk, 1 = diagonal trot, 2 = rotary gallop / bound.
// Selection uses hysteresis so a dog near a boundary doesn't flicker.
//
// Footfall offsets are phases of each leg's touchdown in the stride, with
// the left hind at 0. Per-leg phase ψ = frac(phase − offset): stance while
// ψ < duty, swing after.
import { clamp, lerp, smoothstep } from '../util/noise.js';

export const GRAV = 9.81;
export const frac = (x) => x - Math.floor(x);
/** Shortest signed difference b − a on the unit circle of phases. */
export const phaseDiff = (a, b) => { const d = b - a; return d - Math.round(d); };

const OFFS = {
  // lateral-sequence walk: LH, LF, RH, RF
  walk: { HL: 0, FL: 0.23, HR: 0.5, FR: 0.73 },
  // trot: diagonal pairs; the fore lands a touch before its diagonal hind
  trot: { HL: 0, FR: 0.97, HR: 0.5, FL: 0.47 },
  // rotary gallop, left hind leading: RH, LH, LF, RF, then gathered suspension
  gallop: { HR: 0.9, HL: 0, FL: 0.3, FR: 0.41 },
  // half bound (young dogs): hinds almost together, fores staggered
  bound: { HR: 0.95, HL: 0, FL: 0.36, FR: 0.45 },
};

function lerpPhase(a, b, t) { return frac(a + phaseDiff(a, b) * t); }

export class Gait {
  constructor(opts = {}) {
    this.bound = opts.bound ?? 0;
    this.g = 0;            // continuous gait blend
    this.want = 0;         // selected gait (0, 1, 2)
    this.phase = Math.random();
    this.offs = { ...OFFS.walk };
    this.duty = 0.7;
    this.freq = 1;
    this.fr = 0;
    this.speed = 0;
  }

  /** Stride frequency (Hz) for speed v and leg length L. */
  static frequency(v, L) {
    const fmin = 0.3 * Math.sqrt(GRAV / L);           // slow stepping / turning in place
    const fr = (v * v) / (GRAV * L);
    const stride = 2.3 * L * Math.pow(Math.max(fr, 0.02), 0.3);
    return Math.max(fmin, v / stride);
  }

  update(dt, speed, L) {
    this.speed = speed;
    const fr = this.fr = (speed * speed) / (GRAV * L);
    // hysteresis between gaits
    if (this.want === 0 && fr > 0.6) this.want = 1;
    else if (this.want === 1 && fr < 0.38) this.want = 0;
    if (this.want === 1 && fr > 2.7) this.want = 2;
    else if (this.want === 2 && fr < 1.9) this.want = fr < 0.38 ? 0 : 1;
    this.freq = Gait.frequency(speed, L);
    // a change of gait takes about one stride
    const rate = Math.max(1.4, this.freq * 1.1);
    this.g += clamp(this.want - this.g, -rate * dt, rate * dt);
    this.phase = frac(this.phase + this.freq * dt);

    const g = this.g;
    const gal = {};
    for (const k of Object.keys(OFFS.gallop)) gal[k] = lerpPhase(OFFS.gallop[k], OFFS.bound[k], this.bound);
    for (const k of Object.keys(OFFS.walk)) {
      this.offs[k] = g <= 1 ? lerpPhase(OFFS.walk[k], OFFS.trot[k], smoothstep(0, 1, g)) : lerpPhase(OFFS.trot[k], gal[k], smoothstep(1, 2, g));
    }
    const dWalk = lerp(0.74, 0.6, smoothstep(0.02, 0.55, fr));
    const dTrot = lerp(0.5, 0.36, smoothstep(0.5, 2.6, fr));
    const dGal = lerp(0.34, 0.25, smoothstep(2.5, 7, fr));
    this.duty = g <= 1 ? lerp(dWalk, dTrot, g) : lerp(dTrot, dGal, g - 1);
    return this;
  }

  /** Per-gait scalar: lerp across walk / trot / gallop by the blend. */
  mix(w, t, gl) { const g = this.g; return g <= 1 ? lerp(w, t, g) : lerp(t, gl, g - 1); }

  /** Weights of the three gaits (sum 1). */
  weights() {
    const g = this.g;
    return { walk: clamp(1 - g, 0, 1), trot: g <= 1 ? g : 2 - g, gallop: clamp(g - 1, 0, 1) };
  }

  legPhase(id) { return frac(this.phase - this.offs[id]); }
}

// ---- swing / stance shape functions ------------------------------------------
export const ease = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export function smoother(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Paw height profile over swing, peaking at `peak` (0..1). */
export function liftProfile(u, peak = 0.45) {
  const k = Math.log(0.5) / Math.log(peak);
  return Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), k));
}

/**
 * Forward progress of the paw over swing. It starts slowly (the paw peels
 * off the ground), travels fast mid-swing and reaches slightly past the
 * landing point before being drawn back onto it (swing-leg retraction), so
 * it lands with almost no velocity relative to the ground.
 */
export function swingProgress(u, reach = 0) {
  const base = smoother(clamp(u, 0, 1));
  const r = clamp((u - 0.5) / 0.5, 0, 1);
  return base + reach * Math.sin(Math.PI * r) * (1 - r * 0.3);
}

/** Bell bump on [a, b] peaking at the centre (0 outside). */
export function bump(t, a, b) {
  if (t <= a || t >= b) return 0;
  return Math.sin(Math.PI * (t - a) / (b - a));
}

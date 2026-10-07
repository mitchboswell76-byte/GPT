// Keeper pose tables. The supplied Mixamo clips (a near-static Idle and one
// in-place Walking cycle) are resampled into phase tables, and the other
// gaits are synthesised from them:
//   - careful walk: per-leg time warp (longer double support), softer knees,
//     damped arm swing, lowered gaze;
//   - jog: legs rebuilt with IK along designed ankle paths (flight phase,
//     high heel recovery, heel-to-toe roll), bent-elbow arm swing, forward
//     trunk lean, spring-mass pelvis bounce.
// Every table shares one phase convention: 0 = left heel strike, ~0.5 =
// right heel strike. Tables store local bone quaternions and the hips
// position, so they blend phase-locked and can be exported as clips.
import * as THREE from 'three';
import { solveTwoBone, aimBone, setBoneWorldQuaternion, rotateBoneAxis } from '../util/ik.js';

const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
export const SIDES = ['L', 'R'];
export const LEG = {
  L: { up: 'LeftUpLeg', knee: 'LeftLeg', foot: 'LeftFoot', toe: 'LeftToeBase', tip: 'LeftToe_End' },
  R: { up: 'RightUpLeg', knee: 'RightLeg', foot: 'RightFoot', toe: 'RightToeBase', tip: 'RightToe_End' },
};
export const ARM = {
  L: { sh: 'LeftShoulder', up: 'LeftArm', fore: 'LeftForeArm', hand: 'LeftHand' },
  R: { sh: 'RightShoulder', up: 'RightArm', fore: 'RightForeArm', hand: 'RightHand' },
};

const fract = (x) => x - Math.floor(x);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

/** Skeleton wrapper: bones by name, bind pose, model-space helpers. */
export class Rig {
  constructor(model) {
    this.model = model;
    this.list = [];
    this.by = {};
    model.traverse((o) => { if (o.isBone) { this.list.push(o); this.by[o.name.replace('mixamorig', '')] = o; } });
    this.index = new Map(this.list.map((b, i) => [b, i]));
    this.hips = this.by.Hips;
    this.bindQ = this.list.map((b) => b.quaternion.clone());
    this.bindP = this.list.map((b) => b.position.clone());
  }
  reset() {
    for (let i = 0; i < this.list.length; i++) { this.list[i].quaternion.copy(this.bindQ[i]); this.list[i].position.copy(this.bindP[i]); }
  }
  /** Model-space position of a bone (root transform removed). */
  mpos(name, out = new THREE.Vector3()) {
    this.by[name].getWorldPosition(out);
    return this.model.worldToLocal(out);
  }
  /** Model-space orientation of a bone. */
  mquat(name, out = new THREE.Quaternion()) {
    this.by[name].getWorldQuaternion(out);
    const m = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    return out.premultiply(m);
  }
  update() { this.model.updateMatrixWorld(true); }
}

/** n samples of a cycle (or of a timed clip) for every bone. */
export class PoseTable {
  constructor(name, rig, n, meta = {}) {
    this.name = name; this.n = n; this.nb = rig.list.length;
    this.q = new Float32Array(n * this.nb * 4);
    this.p = new Float32Array(n * 3);
    Object.assign(this, meta);
  }
  store(i, rig) {
    const o = i * this.nb * 4;
    for (let j = 0; j < this.nb; j++) {
      const q = rig.list[j].quaternion, k = o + j * 4;
      this.q[k] = q.x; this.q[k + 1] = q.y; this.q[k + 2] = q.z; this.q[k + 3] = q.w;
    }
    const hp = rig.hips.position; this.p[i * 3] = hp.x; this.p[i * 3 + 1] = hp.y; this.p[i * 3 + 2] = hp.z;
  }
  /** Pose the rig exactly at sample i (no blending). */
  load(i, rig) {
    const o = i * this.nb * 4;
    for (let j = 0; j < this.nb; j++) { const k = o + j * 4; rig.list[j].quaternion.set(this.q[k], this.q[k + 1], this.q[k + 2], this.q[k + 3]); }
    rig.hips.position.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
  }
  /** Build a THREE.AnimationClip from the table (for inspection / reuse). */
  toClip(rig) {
    const dur = this.period, times = new Float32Array(this.n + 1);
    for (let i = 0; i <= this.n; i++) times[i] = (i / this.n) * dur;
    const tracks = [];
    rig.list.forEach((b, j) => {
      const v = new Float32Array((this.n + 1) * 4);
      for (let i = 0; i <= this.n; i++) for (let c = 0; c < 4; c++) v[i * 4 + c] = this.q[((i % this.n) * this.nb + j) * 4 + c];
      tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, v));
    });
    const pv = new Float32Array((this.n + 1) * 3);
    for (let i = 0; i <= this.n; i++) for (let c = 0; c < 3; c++) pv[i * 3 + c] = this.p[(i % this.n) * 3 + c];
    tracks.push(new THREE.VectorKeyframeTrack(rig.hips.name + '.position', times, pv));
    return new THREE.AnimationClip('Keeper_' + this.name, dur, tracks);
  }
}

/** Phase-locked, weighted blend of tables (nlerp with hemisphere alignment). */
export class PoseBlender {
  constructor(rig) {
    this.rig = rig;
    this.acc = new Float32Array(rig.list.length * 4);
    this.pacc = new Float32Array(3);
    this.ref = new Float32Array(rig.list.length * 4);
    rig.bindQ.forEach((q, j) => { this.ref[j * 4] = q.x; this.ref[j * 4 + 1] = q.y; this.ref[j * 4 + 2] = q.z; this.ref[j * 4 + 3] = q.w; });
    this.w = 0;
  }
  begin() { this.acc.fill(0); this.pacc.fill(0); this.w = 0; }
  add(table, phase, weight) {
    if (weight < 1e-4) return;
    const f = fract(phase) * table.n;
    const i0 = Math.floor(f) % table.n, i1 = (i0 + 1) % table.n, t = f - Math.floor(f);
    const nb = table.nb, Q = table.q, A = this.acc, R = this.ref;
    const o0 = i0 * nb * 4, o1 = i1 * nb * 4;
    for (let j = 0; j < nb; j++) {
      const a = o0 + j * 4, b = o1 + j * 4, r = j * 4;
      const s1 = (Q[a] * Q[b] + Q[a + 1] * Q[b + 1] + Q[a + 2] * Q[b + 2] + Q[a + 3] * Q[b + 3]) < 0 ? -1 : 1;
      const x = Q[a] + (s1 * Q[b] - Q[a]) * t, y = Q[a + 1] + (s1 * Q[b + 1] - Q[a + 1]) * t;
      const z = Q[a + 2] + (s1 * Q[b + 2] - Q[a + 2]) * t, w = Q[a + 3] + (s1 * Q[b + 3] - Q[a + 3]) * t;
      const s = (x * R[r] + y * R[r + 1] + z * R[r + 2] + w * R[r + 3]) < 0 ? -weight : weight;
      A[r] += x * s; A[r + 1] += y * s; A[r + 2] += z * s; A[r + 3] += w * s;
    }
    const P = table.p, p0 = i0 * 3, p1 = i1 * 3;
    for (let c = 0; c < 3; c++) this.pacc[c] += (P[p0 + c] + (P[p1 + c] - P[p0 + c]) * t) * weight;
    this.w += weight;
  }
  apply() {
    const rig = this.rig, A = this.acc;
    if (this.w < 1e-6) { rig.reset(); return; }
    for (let j = 0; j < rig.list.length; j++) {
      const r = j * 4;
      const l = Math.hypot(A[r], A[r + 1], A[r + 2], A[r + 3]);
      if (l < 1e-8) rig.list[j].quaternion.copy(rig.bindQ[j]);
      else rig.list[j].quaternion.set(A[r] / l, A[r + 1] / l, A[r + 2] / l, A[r + 3] / l);
      rig.list[j].position.copy(rig.bindP[j]);
    }
    rig.hips.position.set(this.pacc[0] / this.w, this.pacc[1] / this.w, this.pacc[2] / this.w);
  }
}

function clipSampler(rig, clip) {
  const mixer = new THREE.AnimationMixer(rig.model);
  const action = mixer.clipAction(clip);
  action.play();
  return {
    at(t) { rig.reset(); action.time = t; mixer.update(0); },
    dispose() { action.stop(); mixer.uncacheAction(clip); mixer.uncacheClip(clip); mixer.uncacheRoot(rig.model); },
  };
}

/**
 * Foot geometry from a flat standing pose: heel and ball contact points and
 * the toe tip, as offsets in the foot bone's frame (model units, metres).
 */
function footGeometry(rig) {
  rig.update();
  const geo = {};
  for (const s of SIDES) {
    const L = LEG[s];
    const A = rig.mpos(L.foot), B = rig.mpos(L.toe), T = rig.mpos(L.tip);
    const Q = rig.mquat(L.foot);
    const fwd = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
    const H = new THREE.Vector3(A.x - fwd.x * 0.035, 0, A.z - fwd.z * 0.035);
    const ball = new THREE.Vector3(B.x, 0, B.z);
    const tip = new THREE.Vector3(T.x, 0, T.z);
    const qi = Q.clone().invert();
    geo[s] = {
      ankleH: A.y,
      heel: H.clone().sub(A).applyQuaternion(qi),     // ankle -> heel contact, foot frame
      ball: ball.clone().sub(A).applyQuaternion(qi),  // ankle -> ball contact, foot frame
      tip: tip.clone().sub(A).applyQuaternion(qi),
      toeOut: Math.atan2(fwd.x, fwd.z),
      refQ: Q.clone(),
      ankle: A.clone(), heelPos: H.clone(),
    };
  }
  return geo;
}

/** Heel / ball / ankle of a foot in model space for the current pose. */
function footPoints(rig, geo, s) {
  const L = LEG[s];
  const A = rig.mpos(L.foot);
  const Q = rig.mquat(L.foot);
  return {
    A, Q,
    heel: geo[s].heel.clone().applyQuaternion(Q).add(A),
    ball: geo[s].ball.clone().applyQuaternion(Q).add(A),
  };
}

// --- source clips ---------------------------------------------------------------

function buildIdle(rig, clip) {
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps));
  const tab = new PoseTable('idle', rig, n, { period: clip.duration, cyclic: true });
  const smp = clipSampler(rig, clip);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    smp.at((i / n) * clip.duration);
    rig.update();
    // relax the locked elbows a little and let the hands hang slightly forward
    for (const s of SIDES) {
      const A = ARM[s];
      rotateBoneAxis(rig.by[A.fore], AX, -0.2);
      rotateBoneAxis(rig.by[A.up], AX, -0.05);
    }
    tab.store(i, rig);
  }
  smp.dispose();
  void tmp;
  return tab;
}

/** Resample the Walking clip, aligned so phase 0 is the left heel strike. */
function buildWalk(rig, clip, geo, speed) {
  // The Mixamo clip's keys run from 1/30 s to its duration and the last key
  // repeats the first, so the true cycle is one frame shorter than the clip.
  const track = clip.tracks.find((t) => t.name.endsWith('.quaternion') && t.times.length > 4);
  const t0 = track.times[0], t1 = track.times[track.times.length - 1];
  const period = t1 - t0;
  const N = 124;
  const raw = new PoseTable('walkraw', rig, N);
  const smp = clipSampler(rig, clip);
  const heelY = { L: [], R: [] }, ballY = { L: [], R: [] }, ankleZ = { L: [], R: [] };
  for (let i = 0; i < N; i++) {
    smp.at(t0 + (i / N) * period);
    rig.update();
    raw.store(i, rig);
    for (const s of SIDES) {
      const f = footPoints(rig, geo, s);
      heelY[s].push(f.heel.y); ballY[s].push(f.ball.y); ankleZ[s].push(f.A.z);
    }
  }
  smp.dispose();
  // Heel strike: the heel drops through 1.5 cm. Lift-off: after that, the
  // ball rises through 1.2 cm. (Sub-sample interpolation of both crossings.)
  const cross = (arr, i0, thr, down) => {
    for (let k = 0; k < N; k++) {
      const i = (i0 + k) % N, j = (i + 1) % N;
      const a = arr[i], b = arr[j];
      if (down ? (a >= thr && b < thr) : (a <= thr && b > thr)) return i + (thr - a) / (b - a);
    }
    return i0;
  };
  const edges = (s) => {
    let best = 0;
    for (let i = 0; i < N; i++) if (heelY[s][i] > heelY[s][best]) best = i; // mid-swing
    const strike = cross(heelY[s], best, 0.015, true);
    const lift = cross(ballY[s], Math.floor(strike) + 2, 0.012, false);
    return { strike: strike / N, lift: fract(lift / N) };
  };
  const eL = edges('L'), eR = edges('R');
  const dL = fract(eL.lift - eL.strike), dR = fract(eR.lift - eR.strike);
  const D = (dL + dR) / 2;
  // Each leg runs on its own clock so that both strike exactly half a cycle
  // apart with the same duty factor; trunk and arms follow the left strike.
  const legClock = (e, d, u) => fract(u < D ? e.strike + (u / D) * d : e.strike + d + ((u - D) / (1 - D)) * (1 - d));
  const n = 64;
  const tab = new PoseTable('walk', rig, n, { period, cyclic: true, speed });
  const legBones = { L: Object.values(LEG.L), R: Object.values(LEG.R) };
  const owner = rig.list.map((b) => { const nm = b.name.replace('mixamorig', ''); return legBones.L.includes(nm) ? 'L' : legBones.R.includes(nm) ? 'R' : null; });
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const at = (phase, j, out) => {
    const f = fract(phase) * N, a = Math.floor(f) % N, b = (a + 1) % N, t = f - Math.floor(f);
    out.fromArray(raw.q, (a * raw.nb + j) * 4); q2.fromArray(raw.q, (b * raw.nb + j) * 4);
    return out.slerp(q2, t);
  };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const ph = { L: legClock(eL, dL, u), R: legClock(eR, dR, fract(u - 0.5)), T: fract(eL.strike + u) };
    for (let j = 0; j < raw.nb; j++) at(ph[owner[j] || 'T'], j, q).toArray(tab.q, (i * raw.nb + j) * 4);
    const f = ph.T * N, a = Math.floor(f) % N, b = (a + 1) % N, t = f - Math.floor(f);
    for (let c = 0; c < 3; c++) tab.p[i * 3 + c] = lerp(raw.p[a * 3 + c], raw.p[b * 3 + c], t);
  }
  tab.duty = { L: D, R: D };
  tab.dutyAvg = D;
  tab.source = { strikeL: eL.strike, strikeR: eR.strike, dutyL: dL, dutyR: dR };
  return tab;
}

// --- measurement shared by all gait tables -------------------------------------

/**
 * Per-foot facts the runtime planner needs: mid-stance ankle z (centre for
 * stride scaling), ankle elevation over the cycle, hip-to-ankle length.
 */
function measureGait(rig, tab, geo) {
  const n = tab.n;
  const m = { L: { z: [], y: [], len: [], x: [] }, R: { z: [], y: [], len: [], x: [] } };
  for (let i = 0; i < n; i++) {
    tab.load(i, rig); rig.update();
    for (const s of SIDES) {
      const A = rig.mpos(LEG[s].foot), H = rig.mpos(LEG[s].up);
      m[s].z.push(A.z); m[s].x.push(A.x); m[s].y.push(A.y - geo[s].ankleH); m[s].len.push(A.distanceTo(H));
    }
  }
  tab.feet = {};
  for (const s of SIDES) {
    const off = s === 'L' ? 0 : 0.5, D = tab.duty[s] ?? tab.dutyAvg;
    let zs = 0, k = 0;
    for (let i = 0; i < n; i++) { const p = fract(i / n - off); if (p < D) { zs += m[s].z[i]; k++; } }
    tab.feet[s] = { zMid: k ? zs / k : 0, x: m[s].x.reduce((a, b) => a + b, 0) / n };
  }
  tab.stride = tab.speed * tab.period;
  tab.cadence = 1 / tab.period;
}

// --- synthesised gaits -----------------------------------------------------------

/** Careful walk: longer stance, shorter reach, softer knees, quieter arms. */
function buildCalm(rig, walk, geo, opt) {
  const n = 64;
  const D0 = walk.dutyAvg, D1 = opt.duty;
  const tab = new PoseTable('calm', rig, n, { period: opt.period, cyclic: true, speed: opt.speed, duty: { L: D1, R: D1 }, dutyAvg: D1 });
  const warp = (p) => (p < D1 ? (p / D1) * D0 : D0 + ((p - D1) / (1 - D1)) * (1 - D0));
  // mean arm pose over the cycle (swing is damped toward it)
  const armBones = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'RightShoulder'];
  const mean = {};
  for (const name of armBones) {
    const j = rig.index.get(rig.by[name]);
    const acc = new THREE.Vector4();
    const ref = new THREE.Quaternion().fromArray(walk.q, j * 4);
    for (let i = 0; i < walk.n; i++) {
      const q = new THREE.Quaternion().fromArray(walk.q, (i * walk.nb + j) * 4);
      const s = q.dot(ref) < 0 ? -1 : 1;
      acc.x += q.x * s; acc.y += q.y * s; acc.z += q.z * s; acc.w += q.w * s;
    }
    acc.normalize(); mean[name] = new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w);
  }
  const legIdx = { L: Object.values(LEG.L).filter((b) => rig.by[b]).map((b) => rig.index.get(rig.by[b])), R: Object.values(LEG.R).filter((b) => rig.by[b]).map((b) => rig.index.get(rig.by[b])) };
  const hipsMean = new THREE.Vector3();
  for (let i = 0; i < walk.n; i++) hipsMean.add(new THREE.Vector3().fromArray(walk.p, i * 3));
  hipsMean.divideScalar(walk.n);
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const sampleInto = (tabSrc, phase, idxList) => {
    const f = fract(phase) * tabSrc.n, a = Math.floor(f) % tabSrc.n, b = (a + 1) % tabSrc.n, t = f - Math.floor(f);
    for (const j of idxList) {
      q.fromArray(tabSrc.q, (a * tabSrc.nb + j) * 4); q2.fromArray(tabSrc.q, (b * tabSrc.nb + j) * 4);
      rig.list[j].quaternion.copy(q.slerp(q2, t));
    }
  };
  const allIdx = rig.list.map((_, j) => j);
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    rig.reset();
    sampleInto(walk, ph, allIdx);
    // hips: same phase, gentler bob/sway, a little lower
    const f = ph * walk.n, a = Math.floor(f) % walk.n, b = (a + 1) % walk.n, t = f - Math.floor(f);
    const hp = new THREE.Vector3().fromArray(walk.p, a * 3).lerp(new THREE.Vector3().fromArray(walk.p, b * 3), t);
    rig.hips.position.copy(hipsMean).addScaledVector(hp.sub(hipsMean), 0.55);
    // legs on their own warped clocks
    sampleInto(walk, warp(ph), legIdx.L);
    sampleInto(walk, fract(warp(fract(ph - 0.5)) + 0.5), legIdx.R);
    rig.update();
    const ankles = {};
    for (const s of SIDES) ankles[s] = { p: rig.mpos(LEG[s].foot), q: rig.mquat(LEG[s].foot) };
    // pelvis lower -> softer knees: re-solve legs to the same ankles
    const drop = opt.drop;
    const hipsW = rig.hips.getWorldPosition(new THREE.Vector3());
    hipsW.y -= drop;
    rig.hips.position.copy(rig.hips.parent.worldToLocal(hipsW));
    rig.update();
    for (const s of SIDES) {
      const L = LEG[s];
      solveTwoBone(rig.by[L.up], rig.by[L.knee], rig.by[L.foot], rig.model.localToWorld(ankles[s].p.clone()), null, 1);
      setBoneWorldQuaternion(rig.by[L.foot], rig.model.getWorldQuaternion(new THREE.Quaternion()).multiply(ankles[s].q));
      rig.by[L.foot].updateWorldMatrix(false, true);
    }
    // arms: damp the swing toward the mean, elbows a touch more bent
    for (const name of armBones) {
      const bone = rig.by[name];
      bone.quaternion.slerp(mean[name], opt.armDamp);
    }
    rig.update();
    for (const s of SIDES) rotateBoneAxis(rig.by[ARM[s].fore], AX, -opt.elbow);
    // trunk forward a little, gaze down to the ground ahead
    rotateBoneAxis(rig.by.Spine, AX, opt.lean);
    rig.by.Spine.updateWorldMatrix(false, true);
    rotateBoneAxis(rig.by.Neck, AX, opt.gaze * 0.4);
    rotateBoneAxis(rig.by.Head, AX, opt.gaze * 0.6);
    tab.store(i, rig);
  }
  return tab;
}

/** Cubic Hermite through keys [{t, v:[...], d?:[...]}] (Catmull-Rom tangents). */
function spline(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const h = k1.t - k0.t, u = Math.min(1, Math.max(0, (t - k0.t) / h));
  const tan = (k, j) => {
    if (k.d) return k.d;
    const a = keys[Math.max(0, j - 1)], b = keys[Math.min(keys.length - 1, j + 1)];
    return a.v.map((_, c) => (b.v[c] - a.v[c]) / (b.t - a.t));
  };
  const m0 = tan(k0, i), m1 = tan(k1, i + 1);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return k0.v.map((_, c) => h00 * k0.v[c] + h10 * h * m0[c] + h01 * k1.v[c] + h11 * h * m1[c]);
}

/** Jog: designed foot paths solved with IK on top of the walk's upper body. */
function buildJog(rig, walk, geo, opt) {
  const n = 64, T = opt.period, v = opt.speed, D = opt.duty;
  const tab = new PoseTable('jog', rig, n, { period: T, cyclic: true, speed: v, duty: { L: D, R: D }, dutyAvg: D });
  const hipsMean = new THREE.Vector3();
  for (let i = 0; i < walk.n; i++) hipsMean.add(new THREE.Vector3().fromArray(walk.p, i * 3));
  hipsMean.divideScalar(walk.n);
  const stanceTravel = v * D * T;          // ground distance the body covers per stance
  const zLand = opt.landAhead;             // heel contact ahead of the root (model z)
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), tmp = new THREE.Vector3();
  const modelQ = () => rig.model.getWorldQuaternion(new THREE.Quaternion());
  // foot pitch (radians, + = toes up) over stance u and swing s
  const pitchStance = (u) => (u < 0.16 ? lerp(0.12, 0, smooth(u / 0.16)) : u < 0.45 ? 0 : -0.62 * Math.pow((u - 0.45) / 0.55, 1.6));
  const pitchSwing = (s) => spline([{ t: 0, v: [-0.62] }, { t: 0.3, v: [-0.42] }, { t: 0.62, v: [-0.05] }, { t: 0.9, v: [0.14] }, { t: 1, v: [0.12] }], s)[0];
  // foot orientation = flat reference rotated about its own lateral axis
  const footQ = (s, pitch) => {
    const g = geo[s];
    const lat = new THREE.Vector3(Math.cos(g.toeOut), 0, -Math.sin(g.toeOut));
    return new THREE.Quaternion().setFromAxisAngle(lat, -pitch).multiply(g.refQ);
  };
  // ankle position for a pivoting stance foot (model space)
  const stanceAnkle = (s, u) => {
    const g = geo[s];
    const Q = footQ(s, pitchStance(u));
    const fwd = new THREE.Vector3(Math.sin(g.toeOut), 0, Math.cos(g.toeOut));
    const heelG = new THREE.Vector3(g.heelPos.x * opt.narrow, 0, zLand - stanceTravel * u);
    const ballFlat = g.ball.clone().applyQuaternion(g.refQ).sub(g.heel.clone().applyQuaternion(g.refQ));
    const ballG = heelG.clone().add(new THREE.Vector3(ballFlat.x, 0, ballFlat.z));
    const h = g.heel.clone().applyQuaternion(Q), b = g.ball.clone().applyQuaternion(Q);
    const aH = heelG.clone().sub(h), aB = ballG.clone().sub(b);
    const w = smooth((h.y - b.y + 0.006) / 0.012);
    void fwd;
    return { A: aH.lerp(aB, w), Q };
  };
  const toeOff = { L: stanceAnkle('L', 1), R: stanceAnkle('R', 1) };
  const land = { L: stanceAnkle('L', 0), R: stanceAnkle('R', 0) };
  const swingAnkle = (s, sw) => {
    const a0 = toeOff[s].A, a1 = land[s].A;
    const Ts = (1 - D) * T;
    const keys = [
      { t: 0, v: [a0.z, a0.y], d: [-v * Ts * 0.55, 0.9 * Ts * 2.2] },
      { t: 0.28, v: [a0.z + 0.02, opt.kick] },
      { t: 0.55, v: [-0.08, opt.kick - 0.04] },
      { t: 0.8, v: [a1.z + 0.08, 0.27] },
      { t: 0.93, v: [a1.z + 0.05, 0.16] },
      { t: 1, v: [a1.z, a1.y], d: [-v * Ts * 0.5, -0.3] },
    ];
    const [z, y] = spline(keys, sw);
    const x = lerp(a0.x, a1.x, sw);
    return { A: new THREE.Vector3(x, y, z), Q: footQ(s, pitchSwing(sw)) };
  };
  // walk's leg bones give the IK a sensible bend plane and thigh twist
  const legIdx = SIDES.flatMap((s) => [LEG[s].up, LEG[s].knee, LEG[s].foot].map((b) => rig.index.get(rig.by[b])));
  const allIdx = rig.list.map((_, j) => j);
  const sampleInto = (src, phase, idxList) => {
    const f = fract(phase) * src.n, a = Math.floor(f) % src.n, b = (a + 1) % src.n, t = f - Math.floor(f);
    for (const j of idxList) {
      q.fromArray(src.q, (a * src.nb + j) * 4); q2.fromArray(src.q, (b * src.nb + j) * 4);
      rig.list[j].quaternion.copy(q.slerp(q2, t));
    }
  };
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    rig.reset();
    sampleInto(walk, ph, allIdx);
    // pelvis: spring-mass bounce (lowest at mid-stance), slight sway to the stance side
    const midL = D / 2;
    const bob = -opt.bob * Math.cos(2 * TAU * (ph - midL));
    const sway = 0.012 * Math.cos(TAU * (ph - midL));
    const hw = rig.hips.parent.localToWorld(hipsMean.clone());
    hw.y = opt.hipsH + bob; hw.x = sway; hw.z = 0.035;
    rig.hips.position.copy(rig.hips.parent.worldToLocal(hw));
    rig.update();
    // trunk: forward lean, a little more shoulder counter-rotation; head level
    rotateBoneAxis(rig.by.Hips, AX, 0.05);
    rig.by.Hips.updateWorldMatrix(false, true);
    rotateBoneAxis(rig.by.Spine, AX, opt.lean * 0.6);
    rotateBoneAxis(rig.by.Spine1, AX, opt.lean * 0.4);
    rotateBoneAxis(rig.by.Spine2, AY, 0.06 * Math.cos(TAU * (ph - 0.05)));
    rig.update();
    rotateBoneAxis(rig.by.Neck, AX, -opt.lean * 0.5);
    rotateBoneAxis(rig.by.Head, AX, -opt.lean * 0.45);
    rig.update();
    // legs
    for (const s of SIDES) {
      const L = LEG[s];
      const pf = fract(ph - (s === 'L' ? 0 : 0.5));
      sampleInto(walk, s === 'L' ? ph : ph, legIdx);
      const st = pf < D ? stanceAnkle(s, pf / D) : swingAnkle(s, (pf - D) / (1 - D));
      rig.update();
      const fwd = new THREE.Vector3(0, 0, 1);
      solveTwoBone(rig.by[L.up], rig.by[L.knee], rig.by[L.foot], rig.model.localToWorld(st.A.clone()), fwd, 1);
      setBoneWorldQuaternion(rig.by[L.foot], modelQ().multiply(st.Q));
      rig.by[L.foot].updateWorldMatrix(false, true);
      // toes stay on the floor during push-off
      const tip = rig.by[L.tip].getWorldPosition(tmp);
      const tipM = rig.model.worldToLocal(tip.clone());
      if (tipM.y < 0.004 && pf < D + 0.02) {
        const toe = rig.by[L.toe];
        const tp = rig.model.worldToLocal(toe.getWorldPosition(new THREE.Vector3()));
        const want = new THREE.Vector3(tipM.x, 0.004, tipM.z);
        const d0 = tipM.clone().sub(tp), d1 = want.sub(tp);
        const lat = new THREE.Vector3().crossVectors(d0, d1);
        if (lat.lengthSq() > 1e-10) rotateBoneAxis(toe, lat.normalize(), d0.angleTo(d1));
      }
    }
    rig.update();
    // arms: shoulder-driven swing with bent elbows (left arm forward at right strike)
    for (const s of SIDES) {
      const A = ARM[s];
      const sgn = s === 'L' ? 1 : -1;
      const c = Math.cos(TAU * (ph - (s === 'L' ? 0.5 : 0) - 0.05));
      const sh = rig.mpos(A.up);
      const swing = 0.09 + opt.armSwing * c;            // + forward
      const ab = 0.2 - 0.06 * c;                        // elbow out
      const upLen = rig.mpos(A.fore).distanceTo(sh), foreLen = rig.mpos(A.hand).distanceTo(rig.mpos(A.fore));
      const upDir = new THREE.Vector3(Math.sin(ab) * sgn, -Math.cos(ab), 0).applyAxisAngle(AX, -swing).normalize();
      const elbow = sh.clone().addScaledVector(upDir, upLen);
      const flex = opt.elbow + 0.22 * c;
      const across = 0.25 + 0.2 * c;
      const foreDir = upDir.clone().applyAxisAngle(AX, -flex).applyAxisAngle(AY, -sgn * across).normalize();
      const wrist = elbow.clone().addScaledVector(foreDir, foreLen);
      aimBone(rig.by[A.up], rig.by[A.fore], rig.model.localToWorld(elbow.clone()));
      aimBone(rig.by[A.fore], rig.by[A.hand], rig.model.localToWorld(wrist.clone()));
    }
    tab.store(i, rig);
  }
  return tab;
}

/** Build every table for the keeper's skeleton (once per model instance). */
export function buildKeeperTables(rig, clips, opts) {
  const root = rig.model.parent;
  const savedP = root.position.clone(), savedQ = root.quaternion.clone();
  root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
  const idle = buildIdle(rig, clips.idle);
  idle.load(0, rig);
  const geo = footGeometry(rig);
  const walk = buildWalk(rig, clips.walk, geo, opts.walkSpeed);
  measureGait(rig, walk, geo);
  const calm = buildCalm(rig, walk, geo, opts.calm);
  measureGait(rig, calm, geo);
  const jog = buildJog(rig, walk, geo, opts.jog);
  measureGait(rig, jog, geo);
  idle.duty = { L: 1, R: 1 }; idle.dutyAvg = 1;
  rig.reset();
  root.position.copy(savedP); root.quaternion.copy(savedQ); root.updateMatrixWorld(true);
  return { idle, walk, calm, jog, geo };
}

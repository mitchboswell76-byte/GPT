// Procedural quadruped animation layered over a model's idle clip.
//
// The supplied dog models only contain idle clips, so locomotion and poses are
// generated here: a phase-driven gait plants each paw on the terrain and swings
// it to a predicted landing point; two-bone IK (plus a hock segment for hind
// legs) bends the limbs to reach; pose weights (sit, lie, sleep, eat, bow) move
// the body and paw targets; look-at, tail, ear and breathing layers add life.
// Everything is computed in world space, so it works for any rig in rigs.js.
import * as THREE from 'three';
import { RIGS } from './rigs.js';
import { solveTwoBone, aimBone, rotateBoneAxis, setBoneWorldQuaternion, setBoneWorldPosition } from '../util/ik.js';
import { clamp, lerp, smoothstep, angleDiff, damp } from '../util/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const G = 9.81;
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

const WALK_OFFS = { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 };

export class QuadrupedRig {
  constructor(model, rigId) {
    this.def = RIGS[rigId];
    this.model = model;
    const get = (n) => {
      if (!n) return null;
      const b = model.getObjectByName(n);
      if (!b) console.warn('rig bone missing', n);
      return b;
    };
    const d = this.def;
    this.root = get(d.root);
    this.spine = d.spine.map(get).filter(Boolean);
    this.neck = d.neck.map(get).filter(Boolean);
    this.head = get(d.head);
    this.jaw = get(d.jaw);
    this.tail = d.tail.map(get).filter(Boolean);
    this.ears = { L: d.ears.L.map(get).filter(Boolean), R: d.ears.R.map(get).filter(Boolean) };
    this.legs = Object.entries(d.legs).map(([id, L]) => ({
      id, front: L.front, side: L.side,
      upper: get(L.upper), lower: get(L.lower), hock: get(L.hock), end: get(L.end), toe: get(L.toe),
      ik: {}, planted: new THREE.Vector3(), foot: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(),
      swing: null, lastPsi: 0, offset: WALK_OFFS[id],
    }));
    this.mesh = null;
    model.traverse((o) => { if (o.isSkinnedMesh && o.morphTargetDictionary && !this.mesh) this.mesh = o; });
    this.phase = 0;
    this.earState = { L: { a: 0, v: 0 }, R: { a: 0, v: 0 } };
    this.prevHeadY = null; this.headVel = 0;
    this.initialised = false;
  }

  /** Measure the rest pose. Holder must be identity, at the world origin. */
  captureRest() {
    this.model.updateWorldMatrix(true, true);
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    let hip = 0, fz = 0, hz = 0;
    for (const L of this.legs) {
      const end = wp(L.end), toe = wp(L.toe);
      L.contact = new THREE.Vector3(end.x, 0, toe.z * 0.6 + end.z * 0.4);
      L.endOffset = end.clone().sub(L.contact);
      L.restEndQ = L.end.getWorldQuaternion(new THREE.Quaternion());
      if (L.hock) L.hockOffset = wp(L.hock).sub(end);
      const tipBone = L.hock || L.lower;
      L.tipLocal = tipBone.worldToLocal(end.clone());
      L.hipRest = wp(L.upper);
      L.length = wp(L.upper).distanceTo(wp(L.lower)) + wp(L.lower).distanceTo(L.hock ? wp(L.hock) : end) + (L.hock ? wp(L.hock).distanceTo(end) : 0);
      hip += L.hipRest.y / 4;
      if (L.front) fz += L.contact.z / 2; else hz += L.contact.z / 2;
      L.hintSign = L.front ? -1 : 1;
    }
    this.hipHeight = hip;
    this.frontZ = fz; this.hindZ = hz;
    this.bodyLength = fz - hz;
    this.headRest = this.head ? wp(this.head) : new THREE.Vector3(0, hip * 1.4, fz);
  }

  gaitParams(speed, L) {
    const fr = speed / Math.sqrt(G * L);
    const stride = L * (0.95 + 1.35 * Math.min(fr, 1.8));
    const freqMin = 0.32 * Math.sqrt(G / L) / Math.PI;
    const freq = Math.max(freqMin, speed / stride);
    const duty = lerp(0.68, 0.4, smoothstep(0.3, 1.5, fr));
    const trot = smoothstep(0.5, 0.95, fr);
    const lift = L * (0.17 + 0.13 * Math.min(fr, 1.5));
    return { fr, stride, freq, duty, trot, lift };
  }

  /** Snap feet to their home positions (spawn / teleport). */
  resetFeet(ctx) {
    for (const L of this.legs) {
      const h = this.homeWorld(L, ctx, 0);
      L.planted.copy(h); L.foot.copy(h); L.swing = null;
    }
    this.initialised = true;
  }

  poseOffset(L, P, Lw) {
    // Paw target offsets (root space, metres) for each pose.
    const o = new THREE.Vector3();
    if (L.front) {
      o.z += Lw * (0.62 * P.lie + 0.66 * P.sleep + 0.45 * P.bow - 0.05 * P.sit);
      o.x += L.side * Lw * (0.1 * P.eat + 0.05 * P.bow);
    } else {
      const t = this.def.poseTweaks || {};
      const lying = P.lie + P.sleep;
      o.z += Lw * (0.32 * P.sit + (t.lieHindFwd ?? 0.4) * lying);
      o.x += L.side * Lw * ((t.lieHindOut ?? 0.22) * lying + 0.08 * P.sit);
    }
    return o;
  }

  homeWorld(L, ctx, tAhead) {
    const s = ctx.scale, Lw = this.hipHeight * s;
    const local = L.contact.clone().multiplyScalar(s).add(this.poseOffset(L, ctx.pose, Lw));
    const yaw = ctx.yaw + (ctx.yawRate || 0) * tAhead;
    local.applyAxisAngle(UP, yaw);
    local.add(ctx.position);
    if (tAhead) local.addScaledVector(ctx.velocity, tAhead);
    local.y = ctx.ground(local.x, local.z);
    return local;
  }

  /**
   * ctx: { dt, time, holder, rootObj, position, yaw, yawRate, velocity, speed,
   *        scale, ground(x,z), pose{sit,lie,sleep,eat,bow}, look{target,weight},
   *        tail{wag,freq,height}, pant, blink, slopePitch }
   */
  update(ctx) {
    const { dt, scale: s } = ctx;
    const Lw = this.hipHeight * s;
    const P = ctx.pose;
    const g = this.gaitParams(ctx.speed, Lw);
    this.gait = g;
    if (!this.initialised) this.resetFeet(ctx);

    // --- gait phase and swing progress
    this.phase = (this.phase + g.freq * dt) % 1;
    const T = 1 / g.freq, stanceDur = g.duty * T, swingDur = Math.max(0.08, (1 - g.duty) * T);
    const moving = ctx.speed > 0.06;
    const lying = Math.max(P.lie, P.sleep, P.sit);
    let swingL = 0, swingR = 0, swingF = 0, swingH = 0, swingSum = 0;
    for (const L of this.legs) {
      const off = L.front ? L.offset : L.offset - 0.25 * g.trot;
      const psi = ((this.phase + off) % 1 + 1) % 1;
      const entered = psi >= g.duty && (L.lastPsi < g.duty || psi < L.lastPsi);
      L.lastPsi = psi;
      if (!L.swing) {
        const home = this.homeWorld(L, ctx, 0);
        const err = Math.hypot(home.x - L.planted.x, home.z - L.planted.z);
        const tol = (moving ? 0.02 : 0.16) * Lw;
        if ((entered && err > tol) || err > 1.25 * Lw) {
          L.swing = { s: 0, dur: err > 1.25 * Lw && !entered ? swingDur * 0.7 : swingDur };
          L.from.copy(L.planted);
        }
        if (err > 4 * Lw) { L.planted.copy(home); L.swing = null; }
      }
      if (L.swing) {
        L.swing.s += dt / L.swing.dur;
        const sN = Math.min(1, L.swing.s);
        const tRemain = (1 - sN) * L.swing.dur;
        const tgt = this.homeWorld(L, ctx, tRemain + (moving ? stanceDur * 0.5 : 0));
        L.target.copy(tgt);
        const e = sN * sN * (3 - 2 * sN);
        L.foot.lerpVectors(L.from, tgt, e);
        const liftH = (moving ? g.lift : g.lift * 0.55) * (1 - 0.7 * lying);
        L.foot.y = lerp(L.from.y, tgt.y, e) + Math.sin(Math.PI * sN) * liftH;
        L.swingS = sN;
        if (L.swing.s >= 1) { L.planted.copy(tgt); L.foot.copy(tgt); L.swing = null; L.swingS = 0; ctx.onStep?.(L); }
        const w = Math.sin(Math.PI * sN);
        swingSum += w; if (L.side > 0) swingL += w; else swingR += w;
        if (L.front) swingF += w; else swingH += w;
      } else {
        L.foot.copy(L.planted); L.swingS = 0;
      }
    }

    // --- body placement on the holder
    const bobAmp = Lw * 0.045 * Math.min(g.fr, 1.4) * (moving ? 1 : 0.3);
    const bob = bobAmp * (swingSum / 2 - 0.5);
    const pitchBob = 0.045 * (swingH - swingF) * Math.min(g.fr, 1.2);
    const roll = 0.04 * (swingL - swingR) * Math.min(g.fr, 1.2);
    const ptw = this.def.poseTweaks || {};
    const dy = Lw * (-0.05 * P.sit - (ptw.lieDrop ?? 0.6) * P.lie - ((ptw.lieDrop ?? 0.6) + 0.04) * P.sleep - 0.06 * P.eat - 0.16 * P.bow);
    const lieRearDrop = (ptw.lieRearPitch ?? 0) * (P.lie + P.sleep);
    const pitch = -0.5 * P.sit + 0.02 * P.lie + 0.05 * P.sleep + 0.13 * P.eat + 0.36 * P.bow - lieRearDrop + pitchBob + (ctx.slopePitch || 0);
    const wsum = P.sit + P.bow + P.eat + 1e-4;
    const pivotZ = (this.frontZ * P.sit + this.hindZ * (P.bow + P.eat)) / wsum * s;
    const pivot = new THREE.Vector3(0, Lw, pivotZ);
    const holder = ctx.holder;
    holder.quaternion.setFromEuler(new THREE.Euler(pitch, 0, roll));
    holder.scale.setScalar(s);
    holder.position.copy(pivot).sub(pivot.clone().applyQuaternion(holder.quaternion)).add(new THREE.Vector3(0, dy + bob, 0));
    ctx.rootObj.updateMatrixWorld(true);

    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, ctx.yaw);
    const lat = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQ);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ);

    // --- spine bends into turns
    const bend = clamp((ctx.yawRate || 0) * 0.09, -0.22, 0.22);
    if (this.spine.length > 2 && Math.abs(bend) > 1e-4) {
      rotateBoneAxis(this.spine[1], UP, bend * 0.5);
      rotateBoneAxis(this.spine[2], UP, bend * 0.5);
      this.spine[1].updateWorldMatrix(false, true);
    }

    // --- legs
    for (const L of this.legs) this.solveLeg(L, ctx, s, P, yawQ, lat);

    // --- head and neck
    this.solveHead(ctx, yawQ, lat, P);

    // --- tail
    const tw = ctx.tail || { wag: 0, freq: 2, height: 0 };
    this.tailPhase = (this.tailPhase || 0) + dt * tw.freq * Math.PI * 2;
    if (this.tail.length) {
      rotateBoneAxis(this.tail[0], lat, tw.height + 0.25 * P.sleep);
      for (let i = 0; i < this.tail.length; i++) {
        const t = this.tail[i];
        t.updateWorldMatrix(true, false);
        const amp = tw.wag * (i === 0 ? 0.55 : 0.32 + 0.1 * i);
        rotateBoneAxis(t, UP, amp * Math.sin(this.tailPhase - i * 0.65));
        t.updateWorldMatrix(false, true);
      }
    }

    // --- ears: damped spring driven by head vertical acceleration
    const hy = this.head ? this.head.getWorldPosition(tmpV).y : 0;
    if (this.prevHeadY !== null && dt > 0) {
      const v = (hy - this.prevHeadY) / dt;
      const acc = (v - this.headVel) / dt;
      this.headVel = v;
      for (const side of ['L', 'R']) {
        const st = this.earState[side];
        st.v += (-90 * st.a - 9 * st.v - acc * 0.06) * dt;
        st.a = clamp(st.a + st.v * dt, -0.5, 0.5);
        const bones = this.ears[side];
        if (bones[0]) {
          rotateBoneAxis(bones[0], fwd, (side === 'L' ? 1 : -1) * (st.a - 0.08 * (ctx.perk || 0)));
          bones[0].updateWorldMatrix(false, true);
        }
      }
    }
    this.prevHeadY = hy;

    // --- jaw (panting) and morphs
    if (this.jaw && ctx.pant > 0.01) {
      rotateBoneAxis(this.jaw, lat, ctx.pant * (0.16 + 0.05 * Math.sin(ctx.time * 15)));
      this.jaw.updateWorldMatrix(false, true);
    }
    if (this.mesh) {
      const dict = this.mesh.morphTargetDictionary, inf = this.mesh.morphTargetInfluences;
      const m = this.def.morphs;
      if (m.blink && dict[m.blink] !== undefined && ctx.blink !== undefined) inf[dict[m.blink]] = Math.max(inf[dict[m.blink]], ctx.blink);
      if (m.breath && dict[m.breath] !== undefined && ctx.breath !== undefined) inf[dict[m.breath]] = ctx.breath;
    }
  }

  solveLeg(L, ctx, s, P, yawQ, lat) {
    const swingW = L.swingS ? Math.sin(Math.PI * L.swingS) : 0;
    const endOff = L.endOffset.clone().multiplyScalar(s);
    if (L.front) endOff.y *= 1 - 0.6 * Math.max(P.lie, P.sleep) - 0.25 * P.bow;
    endOff.applyQuaternion(yawQ);
    const endT = L.foot.clone().add(endOff);
    const hint = lat.clone().multiplyScalar(L.hintSign);
    if (L.hock) {
      const hockOff = L.hockOffset.clone().multiplyScalar(s);
      const flat = Math.max(P.sit, P.lie, P.sleep);
      hockOff.applyAxisAngle(X, -1.42 * flat + 0.55 * swingW * (1 - flat));
      hockOff.applyQuaternion(yawQ);
      const hockT = endT.clone().add(hockOff);
      solveTwoBone(L.upper, L.lower, L.hock, hockT, hint, 1, L.ik);
      aimBone(L.hock, this.def.endIsChild ? L.end : L.tipLocal, endT);
    } else {
      solveTwoBone(L.upper, L.lower, this.def.endIsChild ? L.end : L.tipLocal, endT, hint, 1, L.ik);
    }
    if (!this.def.endIsChild) {
      const tipBone = L.hock || L.lower;
      setBoneWorldPosition(L.end, tipBone.localToWorld(L.tipLocal.clone()));
    }
    const q = yawQ.clone().multiply(L.restEndQ);
    const curl = L.front ? 1.25 * swingW + 0.35 * Math.max(P.lie, P.sleep) * 0 : 0.35 * swingW;
    if (curl) q.premultiply(tmpQ.setFromAxisAngle(lat, curl));
    setBoneWorldQuaternion(L.end, q);
    L.end.updateWorldMatrix(false, true);
  }

  solveHead(ctx, yawQ, lat, P) {
    if (!this.head) return;
    const look = ctx.look || {};
    let yawOff = 0, pitchOff = 0;
    if (look.target && look.weight > 0.001) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      const d = look.target.clone().sub(hp);
      const yawTo = Math.atan2(d.x, d.z);
      yawOff = clamp(angleDiff(ctx.yaw, yawTo), -1.15, 1.15) * look.weight;
      pitchOff = clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.6, 1.25) * look.weight;
    }
    // poses: sleeping rests the head low; sitting lifts it a little
    pitchOff += 0.8 * P.sleep + 0.2 * P.lie * (1 - P.sleep) + 0.42 * P.sit + 0.05 * P.bow + 1.0 * P.eat + (ctx.headDrop || 0);
    this.lookYaw = damp(this.lookYaw || 0, yawOff, 6, ctx.dt);
    this.lookPitch = damp(this.lookPitch || 0, pitchOff, 6, ctx.dt);
    const chain = [...this.neck, this.head];
    const wy = chain.length === 3 ? [0.25, 0.3, 0.45] : chain.map(() => 1 / chain.length);
    const wp = chain.length === 3 ? [0.35, 0.3, 0.35] : chain.map(() => 1 / chain.length);
    chain.forEach((b, i) => {
      b.updateWorldMatrix(true, false);
      rotateBoneAxis(b, UP, this.lookYaw * wy[i]);
      const latNow = lat.clone().applyAxisAngle(UP, this.lookYaw * wy.slice(0, i + 1).reduce((a, c) => a + c, 0));
      rotateBoneAxis(b, latNow, this.lookPitch * wp[i]);
      b.updateWorldMatrix(false, true);
    });
  }
}

// Procedural quadruped animation layered over a model's idle clip.
//
// The supplied dog models only contain idle clips, so everything else is
// generated here, each frame, starting from the bind pose:
//
// 1. Feet (planFeet). A gait model (Gait.js) says when each leg should be in
//    stance or swing. Stance paws stay locked to the ground in world space;
//    swing paws travel on an arc to a landing point predicted from velocity
//    and turn rate, so they never slide. Standing still, legs only step when
//    their paw is too far from where it belongs (turning on the spot,
//    squaring up after stopping, posture changes).
// 2. Body (placeBody). Hip and shoulder heights come from the paws: the body
//    vaults over a straight stance leg at the walk and sinks into the stance
//    legs at the trot and gallop, so the bob always matches the footfalls.
//    Pelvis and shoulders yaw and roll with their own legs, the spine flexes
//    laterally at the walk and in turns and arches/extends at the gallop, the
//    trunk leans with acceleration and into turns, and posture channels
//    (Posture.js) lower the rear or the chest.
// 3. Legs (solveLeg). Each paw rolls over its digits: the pastern / hock
//    angle follows the stance (heel lift at push-off, increased whenever the
//    limb would otherwise over-extend) and folds in swing (carpal flexion on
//    the fore, hock flexion on the hind). A soft two-bone solve with a fixed
//    hinge places shoulder/elbow or hip/stifle; paws align to the slope.
// 4. Head and neck: look-at, leading into turns, stabilised against body
//    pitch at the trot, nodding at the walk.
// 5. Secondary: tail and ears are spring chains (Secondary.js), jaw for
//    panting / yawning, breathing and blinking morphs.
import * as THREE from 'three';
import { RIGS } from './rigs.js';
import { Gait, GRAV, liftProfile, swingProgress, smoother, easeOut, bump } from './Gait.js';
import { SpringChain, Spring } from './Secondary.js';
import { channelsFromWeights } from './Posture.js';
import { solveLimb, aimBone } from './LegIK.js';
import { rotateBoneWorld, setBoneWorldQuaternion, setBoneWorldPosition } from '../util/ik.js';
import { clamp, lerp, smoothstep, angleDiff, damp } from '../util/noise.js';

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const _v1 = V(), _v2 = V(), _v3 = V(), _h = V(), _P = V(), _W = V(), _E = V();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qf = Q(), _qr = Q();
const _e = new THREE.Euler();

export class QuadrupedRig {
  constructor(model, rigId) {
    const d = this.def = RIGS[rigId];
    this.tune = d.tune || {};
    this.model = model;
    const get = (n) => {
      if (!n) return null;
      const b = model.getObjectByName(n);
      if (!b) console.warn('rig bone missing', n);
      return b || null;
    };
    this.pelvis = get(d.pelvis);
    this.spine = d.spine.map(get).filter(Boolean);
    this.chest = get(d.chest);
    this.neck = d.neck.map(get).filter(Boolean);
    this.head = get(d.head);
    this.jaw = get(d.jaw);
    this.tail = d.tail.map(get).filter(Boolean);
    this.ears = { L: d.ears.L.map(get).filter(Boolean), R: d.ears.R.map(get).filter(Boolean) };
    this.legs = Object.entries(d.legs).map(([id, L]) => ({
      id, front: L.front, side: L.side,
      scap: get(L.scap), upper: get(L.upper), lower: get(L.lower), hock: get(L.hock), end: get(L.end), toe: get(L.toe), tip: get(L.tip),
      state: 'stance', plant: V(), plantYaw: 0, foot: V(), footYaw: 0, normal: new THREE.Vector3(0, 1, 0), plantNormal: new THREE.Vector3(0, 1, 0),
      from: V(), fromYaw: 0, fromTheta: 0, fromNormal: new THREE.Vector3(0, 1, 0), target: V(), targetYaw: 0,
      u: 0, dur: 0.2, locked: false, lift: 0, s: 0.5, theta: 0, digits: 0, prevIn: true, force: false, dz: 0, swingW: 0,
    }));
    this.mesh = null;
    model.traverse((o) => { if (o.isSkinnedMesh && o.morphTargetDictionary && !this.mesh) this.mesh = o; });
    this.gait = new Gait({ bound: this.tune.bound });
    this.initialised = false;
    this.spd = 0; this.cyc = 0; this.low = 0;
    this.acc = 0; this.prevVf = 0;
    this.lean = new Spring(0, 1.6, 0.7);
    this.leanZ = new Spring(0, 1.4, 0.8);
    this.bobMean = { H: 0, F: 0 };
    this.gH = 0; this.gF = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.glance = { yaw: new Spring(0, 2.2, 0.9), pitch: new Spring(0, 2.2, 0.9), t: 2, ty: 0, tp: 0 };
    this.wagPhase = Math.random() * TAU;
    this.pantPhase = 0;
    this.idleT = Math.random() * 50;
    this.shuffleT = 4 + Math.random() * 6;
    this.stillT = 0;
    this.sniffT = 0;
  }

  /** Measure the rest pose. Holder must be identity, at the world origin. */
  captureRest() {
    this.model.updateWorldMatrix(true, true);
    const wp = (b) => b.getWorldPosition(V());
    const wq = (b) => b.getWorldQuaternion(Q());
    let hipY = 0, shY = 0, hipZ = 0, shZ = 0, hipW = 0, all = 0, fz = 0, hz = 0;
    for (const L of this.legs) {
      const pivot = wp(L.toe);
      L.pivotH = pivot.y;
      L.contact = new THREE.Vector3(pivot.x, 0, pivot.z);
      L.restEndQ = wq(L.end); L.restToeQ = wq(L.toe);
      const endP = wp(L.end);
      L.hipRest = wp(L.upper);
      all += L.hipRest.y / 4;
      if (L.front) {
        L.segVec = endP.clone().sub(pivot);               // carpus relative to the paw pivot
        L.tipArg = this.def.endIsChild ? L.end : L.lower.worldToLocal(endP.clone());
        L.reachMax = L.hipRest.distanceTo(wp(L.lower)) + wp(L.lower).distanceTo(endP);
        shY += L.hipRest.y / 2; shZ += L.hipRest.z / 2; fz += L.contact.z / 2;
      } else {
        const hockP = wp(L.hock);
        L.segVec = hockP.clone().sub(pivot);              // hock relative to the paw pivot
        L.endVec = endP.clone().sub(pivot);
        L.hockTip = L.hock.worldToLocal(endP.clone());
        L.tipArg = L.hock;
        L.reachMax = L.hipRest.distanceTo(wp(L.lower)) + wp(L.lower).distanceTo(hockP);
        hipY += L.hipRest.y / 2; hipZ += L.hipRest.z / 2; hipW += L.side * L.hipRest.x; hz += L.contact.z / 2;
      }
      // rotation (about the lateral axis) that lays the pastern / metatarsus flat, pointing back
      L.thetaFlat = -Math.atan2(L.segVec.y, -L.segVec.z);
      L.digitLen = L.tip ? wp(L.tip).distanceTo(pivot) : L.segVec.length() * 0.6;
    }
    this.hipY = hipY; this.shY = shY; this.hipZ = hipZ; this.shZ = shZ; this.hipW = Math.max(hipW, 0.01);
    this.hipHeight = all;               // creature "height" used by behaviour code
    this.legLen = hipY;                 // gait scaling
    this.bodyLen = shZ - hipZ;
    this.frontZ = fz; this.hindZ = hz;
    this.midRest = new THREE.Vector3(0, (hipY + shY) / 2, (hipZ + shZ) / 2);
    this.restPitch = Math.atan2(shY - hipY, shZ - hipZ);
    this.headRest = this.head ? wp(this.head) : new THREE.Vector3(0, all * 1.4, fz);
    this.pelvisRestQ = this.pelvis ? wq(this.pelvis) : Q();
    this.chestRestQ = this.chest ? wq(this.chest) : Q();
    this.headRestQ = this.head ? wq(this.head) : Q();
    this.neckLen = this.head && this.neck[0] ? wp(this.neck[0]).distanceTo(wp(this.head)) : all * 0.4;
    const t = this.tune;
    if (this.tail.length > 1) this.tailChain = new SpringChain(this.tail, { freq: 9, freqFalloff: 0.8, damping: 0.32, maxAngle: 1.1 });
    const em = t.earMass ?? 1;
    this.earChains = ['L', 'R'].filter((k) => this.ears[k].length).map((k) => {
      const bones = this.ears[k];
      const tipRest = wp(bones[bones.length - 1]);
      return {
        side: k === 'L' ? 1 : -1,
        chain: new SpringChain(bones, { freq: 4.2 / Math.sqrt(em), freqFalloff: 0.92, damping: 0.22 + 0.04 * em, maxAngle: 1.0 }),
        // keep the ear outside the cheek: lateral clearance of the tip at rest
        clear: Math.abs(tipRest.x) * 0.82,
      };
    });
    // the Labrador's ears are heavy enough to swing well clear of the clip
    this.earGravity = 0.06 * em;
  }

  /** Snap feet to their home positions (spawn / teleport). */
  resetFeet(ctx, ch) {
    for (const L of this.legs) {
      this.home(L, ctx, ch, 0, L.plant);
      L.foot.copy(L.plant); L.state = 'stance'; L.u = 0; L.locked = false;
      L.plantYaw = L.footYaw = ctx.yaw;
      this.groundNormal(ctx, L.plant, L.plantNormal); L.normal.copy(L.plantNormal);
    }
    this.gH = this.gF = ctx.position.y;
    this.tailChain?.reset();
    for (const e of this.earChains || []) e.chain.reset();
    this.initialised = true;
    this.bodyInit = false;
  }

  groundNormal(ctx, p, out) {
    const e = 0.06;
    const g = ctx.ground;
    out.set(g(p.x - e, p.z) - g(p.x + e, p.z), 2 * e, g(p.x, p.z - e) - g(p.x, p.z + e)).normalize();
    return out;
  }

  /** Where a paw belongs (ground contact, world) `tAhead` seconds from now. */
  home(L, ctx, ch, tAhead, out) {
    const s = ctx.scale, Lw = this.legLen * s, t = this.tune;
    out.set(L.contact.x * s, 0, L.contact.z * s);
    if (L.front) {
      out.z += Lw * ((t.liePawFwd ?? 0.9) * ch.reach + 0.04 * ch.rear * (1 - ch.front));
      out.x += L.side * Lw * (0.08 * ch.eat + 0.1 * ch.shake + 0.04 * ch.front);
    } else {
      out.z += Lw * ((t.sitPawFwd ?? 0.1) * ch.tuck - 0.6 * ch.rearStretch + 0.12 * ch.side);
      out.x += L.side * Lw * ((t.lieHindOut ?? 0.2) * ch.tuck * ch.front * (1 - ch.side) + 0.1 * ch.shake + 0.05 * ch.tuck);
      out.x += this.sideSign * Lw * 0.55 * ch.side;
    }
    // paws converge toward the midline as speed rises (single tracking)
    const w = this.gait.weights();
    out.x -= L.side * this.hipW * s * 0.22 * this.cyc * (w.trot + w.gallop);
    if (L.idle) { out.x += L.idle.x * Lw; out.z += L.idle.z * Lw; }
    const yaw = ctx.yaw + (ctx.yawRate || 0) * tAhead;
    out.applyAxisAngle(UP, yaw);
    out.x += ctx.position.x + ctx.velocity.x * tAhead;
    out.z += ctx.position.z + ctx.velocity.z * tAhead;
    out.y = ctx.ground(out.x, out.z);
    return out;
  }

  /**
   * ctx: { dt, time, rootObj, holder, position, yaw, yawRate, velocity, speed,
   *        scale, ground(x,z), posture (Posture) | pose{sit,lie,sleep,eat,bow},
   *        look{target,weight}, tail{wag,freq,height}, pant, blink, breath,
   *        perk, onStep(leg) }
   */
  update(ctx) {
    const dt = ctx.dt, s = ctx.scale;
    const P = ctx.posture || null;
    const ch = this.ch = P ? P.ch : channelsFromWeights(ctx.pose);
    this.sideSign = P?.sideSign ?? 1;
    const Lw = this.legLen * s;
    const vel = Math.hypot(ctx.velocity.x, ctx.velocity.z);
    const spdIn = Math.min(ctx.speed || 0, vel + 0.08 * Math.sqrt(GRAV * Lw));
    this.spd = this.initialised ? damp(this.spd, spdIn, 9, dt) : spdIn;
    this.gait.update(dt, this.spd, Lw);
    this.cyc = smoothstep(0.035, 0.11, this.spd / Math.sqrt(GRAV * Lw));
    this.low = Math.max(ch.rear, ch.front, 0.4 * ch.eat);
    if (!this.initialised) this.resetFeet(ctx, ch);

    const yaw = ctx.yaw;
    this.fwd = _v1.set(Math.sin(yaw), 0, Math.cos(yaw)).clone();
    this.lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    this.idleLife(ctx, ch, dt);
    this.planFeet(ctx, ch, Lw, dt);
    this.placeBody(ctx, ch, Lw, dt);
    for (const L of this.legs) this.solveLeg(L, ctx, ch, s);
    this.solveHead(ctx, ch, dt);
    this.secondary(ctx, ch, dt, s);
    this.bodyInit = true;
  }

  // ---- idle life: weight shifts and the odd repositioned paw ---------------------
  idleLife(ctx, ch, dt) {
    const still = this.cyc < 0.05 && Math.abs(ctx.yawRate || 0) < 0.2;
    this.stillT = still ? this.stillT + dt : 0;
    this.idleT += dt;
    if (still && this.low < 0.1 && ch.shake < 0.01 && this.stillT > 2) {
      this.shuffleT -= dt;
      if (this.shuffleT < 0) {
        // shift weight: move one paw to a slightly different spot
        this.shuffleT = 5 + Math.random() * 9;
        const L = this.legs[Math.floor(Math.random() * 4)];
        L.idle = { x: (Math.random() - 0.5) * 0.12, z: (Math.random() - 0.5) * 0.16 };
        L.force = true;
      }
    } else if (!still) for (const L of this.legs) L.idle = null;
  }

  // ---- feet ---------------------------------------------------------------------
  planFeet(ctx, ch, Lw, dt) {
    const g = this.gait;
    const T = 1 / g.freq;
    const stanceDur = g.duty * T, swingDur = clamp((1 - g.duty) * T, 0.1, 0.45);
    const moving = this.cyc > 0.5;
    const settle = this.stillT > 0.35;
    for (const L of this.legs) {
      const psi = g.legPhase(L.id);
      const inStance = psi < g.duty;
      const entered = !inStance && L.prevIn;
      L.prevIn = inStance;
      if (L.state === 'stance') {
        this.home(L, ctx, ch, 0, _h);
        const err = Math.hypot(_h.x - L.plant.x, _h.z - L.plant.z);
        const tol = moving ? 0.012 * Lw : (settle ? 0.07 : 0.16) * Lw * (1 + 1.5 * this.low);
        const far = err > (moving ? 0.9 : 0.75) * Lw;
        if (err > 4 * Lw) { L.plant.copy(_h); L.foot.copy(_h); L.plantYaw = L.footYaw = ctx.yaw; }
        else if ((entered && (err > tol || L.force)) || far) {
          L.force = false;
          L.state = 'swing'; L.u = 0;
          L.locked = entered && moving;
          L.dur = (moving ? swingDur : clamp(swingDur * 1.15, 0.16, 0.4) * (1 + 0.8 * this.low)) * (far && !entered ? 0.75 : 1);
          L.from.copy(L.plant); L.fromYaw = L.plantYaw; L.fromTheta = L.theta; L.fromNormal.copy(L.plantNormal);
          const rel = clamp(err / Lw, 0, 1);
          L.lift = Lw * (moving ? g.mix(0.075, 0.12, 0.15) : 0.05 + 0.06 * rel) * (1 - 0.65 * this.low);
          L.fold = moving ? 1 : 0.5 + 0.3 * rel;
        }
        L.s = moving ? clamp(psi / g.duty, 0, 1) : lerp(L.s, 0.45, 1 - Math.exp(-6 * dt));
      }
      if (L.state === 'swing') {
        if (L.locked) {
          if (!inStance) L.u = Math.max(L.u, (psi - g.duty) / (1 - g.duty));
          else if (psi < 0.25) L.u = 1;
          else { L.locked = false; L.dur = Math.max(0.05, swingDur * 0.5); }
        }
        if (!L.locked) L.u = Math.min(1, L.u + dt / L.dur);
        const u = L.u;
        const tRem = (1 - u) * (L.locked ? (1 - g.duty) * T : L.dur);
        this.home(L, ctx, ch, tRem + (moving ? stanceDur * 0.5 : 0), L.target);
        L.targetYaw = ctx.yaw + (ctx.yawRate || 0) * tRem;
        const reach = L.front ? g.mix(0.03, 0.07, 0.08) * this.cyc : 0.015;
        const hp = swingProgress(u, reach);
        L.foot.x = lerp(L.from.x, L.target.x, hp);
        L.foot.z = lerp(L.from.z, L.target.z, hp);
        L.foot.y = lerp(L.from.y, L.target.y, smoother(u)) + L.lift * liftProfile(u, L.front ? 0.4 : 0.48);
        L.footYaw = L.fromYaw + angleDiff(L.fromYaw, L.targetYaw) * smoother(u);
        L.swingW = Math.sin(Math.PI * u);
        if (u >= 1) {
          L.state = 'stance'; L.u = 0; L.swingW = 0; L.locked = false;
          L.plant.copy(L.target); L.foot.copy(L.target); L.plantYaw = L.footYaw = L.targetYaw;
          this.groundNormal(ctx, L.plant, L.plantNormal);
          L.s = 0;
          ctx.onStep?.(L);
        }
      } else {
        L.foot.copy(L.plant); L.footYaw = L.plantYaw; L.swingW = 0;
      }
      // paw / pastern angles
      const postW = L.front ? clamp(ch.reach * ch.front * 1.4, 0, 1) : clamp(ch.tuck, 0, 1);
      const postTheta = L.front ? L.thetaFlat * postW : L.thetaFlat * 0.92 * postW + 0.35 * ch.rearStretch;
      let gaitTheta, digits = 0;
      if (L.state === 'stance') {
        gaitTheta = this.stanceTheta(L, L.s) * this.cyc;
        L.normal.copy(L.plantNormal);
      } else {
        gaitTheta = this.swingTheta(L, L.u, L.fromTheta, 0);
        digits = (L.front ? 0.5 : 0.35) * bump(L.u, 0, 0.62) * L.fold;
        L.normal.copy(L.fromNormal).lerp(L.plantNormal, smoother(L.u)).normalize();
      }
      L.theta = lerp(gaitTheta, postTheta, postW);
      L.digits = L.state === 'stance' ? 0 : (L.theta + digits) * (1 - smoothstep(0.72, 0.97, L.u));
    }
  }

  stanceTheta(L, s) {
    const g = this.gait;
    if (L.front) return s < 0.55 ? lerp(-0.03, -0.12, s / 0.55) : lerp(-0.12, g.mix(0.4, 0.6, 0.75), smoother((s - 0.55) / 0.45));
    return s < 0.5 ? lerp(-0.05, 0, s / 0.5) : lerp(0, g.mix(0.22, 0.34, 0.45), smoother((s - 0.5) / 0.5));
  }

  swingTheta(L, u, t0, tLand) {
    const g = this.gait;
    const amt = L.fold ?? 1;
    const fold = (L.front ? g.mix(1.15, 1.6, 1.8) : g.mix(0.5, 0.72, 0.9)) * amt;
    const pk = L.front ? 0.36 : 0.42;
    if (u < pk) return lerp(t0, fold, easeOut(u / pk));
    return lerp(fold, tLand, smoother(clamp((u - pk) / (0.86 - pk), 0, 1)));
  }

  // ---- body ---------------------------------------------------------------------
  placeBody(ctx, ch, Lw, dt) {
    const s = ctx.scale, t = this.tune, g = this.gait, gw = g.weights(), cyc = this.cyc;
    const fwd = this.fwd, lat = this.lat;
    // ground height under each girdle, from the paws
    let gh = 0, gf = 0;
    for (const L of this.legs) {
      const y = L.state === 'stance' ? L.plant.y : lerp(L.from.y, L.target.y, L.u);
      if (L.front) gf += y / 2; else gh += y / 2;
    }
    if (!this.bodyInit) { this.gH = gh; this.gF = gf; }
    this.gH = damp(this.gH, gh, 9, dt); this.gF = damp(this.gF, gf, 9, dt);

    // gait loads per girdle
    let thH = 9, thF = 9, SH = 0, SF = 0, supL = 0, supR = 0;
    const lift = { FL: 0, FR: 0, HL: 0, HR: 0 }, dz = { FL: 0, FR: 0, HL: 0, HR: 0 };
    for (const L of this.legs) {
      _v2.subVectors(L.foot, ctx.position);
      const fz = _v2.dot(fwd) - L.hipRest.z * s;
      dz[L.id] = fz;
      if (L.state === 'stance') {
        const th = Math.abs(fz) / Lw;
        if (L.front) thF = Math.min(thF, th); else thH = Math.min(thH, th);
        const b = Math.sin(Math.PI * clamp(L.s, 0, 1));
        if (L.front) SF += b; else SH += b;
        if (L.side > 0) supL++; else supR++;
      } else lift[L.id] = L.swingW;
    }
    if (thH > 8) thH = 0.5; if (thF > 8) thF = 0.5;
    const runW = gw.trot + gw.gallop;
    const springA = Lw * g.mix(0, 0.045, 0.06);
    const rawH = gw.walk * (-0.16 * Lw * thH * thH) - runW * springA * SH;
    const rawF = gw.walk * (-0.16 * Lw * thF * thF) - runW * springA * SF;
    if (!this.bodyInit) { this.bobMean.H = rawH; this.bobMean.F = rawF; }
    this.bobMean.H = damp(this.bobMean.H, rawH, 1.2, dt); this.bobMean.F = damp(this.bobMean.F, rawF, 1.2, dt);
    const bobH = (rawH - this.bobMean.H) * cyc, bobF = (rawF - this.bobMean.F) * cyc;

    // girdle yaw (hip of the forward leg leads) and roll (swing side drops)
    const yawK = cyc * (0.05 * gw.walk + 0.02 * gw.trot + 0.012 * gw.gallop);
    const hw = this.hipW * s;
    const psiP = -yawK * clamp((dz.HL - dz.HR) / hw, -3, 3);
    const psiC = -yawK * clamp((dz.FL - dz.FR) / hw, -3, 3);
    const rollK = cyc * (0.07 * gw.walk + 0.04 * gw.trot + 0.025 * gw.gallop);
    let rhoP = -rollK * (lift.HL - lift.HR), rhoC = -rollK * (lift.FL - lift.FR);
    const sway = cyc * gw.walk * 0.025 * Lw * (supL - supR) * 0.5;

    // acceleration: trunk lags, pitches up when driving, dips its chest when braking
    const vf = ctx.velocity.x * fwd.x + ctx.velocity.z * fwd.z;
    const accRaw = dt > 0 && this.bodyInit ? (vf - this.prevVf) / dt : 0;
    this.prevVf = vf;
    this.acc = damp(this.acc, clamp(accRaw, -10, 10), 6, dt);
    const accN = this.acc / GRAV;
    const leanPitch = this.lean.update(clamp(-accN * 0.35, -0.16, 0.16), dt);
    const leanZ = this.leanZ.update(clamp(-accN * 0.18, -0.08, 0.08), dt) * Lw;
    const brake = clamp(-accN, 0, 0.6);

    // turning: lean into the curve, spine bends toward it
    const yr = ctx.yawRate || 0;
    const turnRoll = -clamp(this.spd * yr / GRAV, -0.6, 0.6) * 0.55;
    this.bend = damp(this.bend || 0, clamp(yr * 0.12, -0.32, 0.32), 8, dt);

    // gallop: spine arches as the hinds reach under, extends as the fores reach out
    const alpha = cyc * gw.gallop * (t.spineFlex ?? 0.22) * Math.cos(TAU * (g.phase - 0.97));

    // shake-off: a roll wave travelling from head to tail
    const shk = ch.shake;
    let shakeP = 0, shakeC = 0;
    if (shk > 0.001) {
      const f = 4.4 * Math.pow(0.5 / Lw, 0.3);
      const ph = TAU * f * (ctx.posture?.actionTime || 0);
      shakeC = shk * 0.26 * Math.sin(ph - 0.9);
      shakeP = shk * 0.2 * Math.sin(ph - 1.9);
      this.shakePh = ph;
    } else this.shakePh = null;

    // scratching: lean away from the scratching hind leg
    const scr = ch.scratch, scrSide = ctx.posture?.scratchSide ?? 1;

    // idle weight shift
    const idleW = smoothstep(0.5, 2, this.stillT) * (1 - this.low);
    const it = this.idleT;
    const idleX = idleW * Lw * 0.03 * (Math.sin(it * 0.41 + 1.3) * 0.7 + Math.sin(it * 0.97) * 0.3);
    const idleZ = idleW * Lw * 0.02 * Math.sin(it * 0.29 + 0.4);

    // posture: heights as fractions of the standing heights
    const hipDrop = ch.rear * lerp(t.sitHip ?? 0.6, lerp(t.lieHip ?? 0.66, t.sleepHip ?? 0.72, ch.side), ch.front)
      + 0.14 * ch.crouch + 0.1 * ch.rearStretch - 0.04 * ch.bowRear * ch.front + 0.04 * scr;
    const chestDrop = ch.front * (t.lieChest ?? 0.62) + 0.12 * ch.crouch - 0.06 * ch.rear * (1 - ch.front) - 0.05 * ch.rearStretch
      + 0.05 * ch.sniff + brake * 0.08 + 0.04 * ch.eat;
    const dzHip = Lw * (-0.1 * ch.rear * (1 - ch.front) - 0.2 * ch.rearStretch + 0.06 * ch.front * ch.rear);
    const dzCh = Lw * (0.1 * ch.front * ch.rear - 0.12 * ch.bowRear * ch.front + 0.12 * ch.rearStretch);

    const hipT = _v2.set(sway + idleX, this.gH - ctx.position.y + this.hipY * s * (1 - hipDrop) + bobH, this.hipZ * s + dzHip + leanZ + idleZ);
    const shT = _v3.set(sway + idleX, this.gF - ctx.position.y + this.shY * s * (1 - chestDrop) + bobF, this.shZ * s + dzCh + leanZ + idleZ);
    const tgtAng = Math.atan2(shT.y - hipT.y, shT.z - hipT.z);
    const pitch = this.restPitch - tgtAng + leanPitch;
    this.terrainPitch = Math.atan2(this.gH - this.gF, this.bodyLen * s);
    const sideRoll = this.sideSign * 0.5 * ch.side;
    const yawB = (psiP + psiC) / 2;
    const rollB = (rhoP + rhoC) / 2 + turnRoll + sideRoll * 0.25 + scr * scrSide * 0.1 + idleW * 0.02 * Math.sin(it * 0.41 + 1.3);
    const holder = ctx.holder;
    holder.quaternion.setFromEuler(_e.set(pitch, yawB, rollB, 'YXZ'));
    holder.scale.setScalar(s);
    _v1.addVectors(hipT, shT).multiplyScalar(0.5);
    holder.position.copy(_v1).sub(_h.copy(this.midRest).multiplyScalar(s).applyQuaternion(holder.quaternion));
    ctx.rootObj.updateWorldMatrix(true, false);
    holder.updateWorldMatrix(false, true);
    this.bodyPitch = pitch;

    // body axes in world
    holder.getWorldQuaternion(_q1);
    const bLat = this.bLat = (this.bLat || V()).copy(AX).applyQuaternion(_q1);
    const bUp = this.bUp = (this.bUp || V()).copy(AY).applyQuaternion(_q1);
    const bFwd = this.bFwd = (this.bFwd || V()).copy(AZ).applyQuaternion(_q1);

    // excited puppies wag the whole rear end
    const tw = ctx.tail || { wag: 0, freq: 2 };
    const wiggle = clamp((tw.freq - 3.5) / 3, 0, 1) * clamp(tw.wag, 0, 1) * 0.12 * (1 - cyc) * (1 - this.low) * Math.sin(this.wagPhase - 0.4);

    // pelvis
    if (this.pelvis) {
      axisRot(_q2, bUp, psiP - yawB + wiggle, bLat, -alpha / 2, bFwd, rhoP + sideRoll * 0.75 + shakeP - (rollB - turnRoll));
      rotateBoneWorld(this.pelvis, _q2);
      this.pelvis.updateWorldMatrix(false, true);
    }
    // spine: carries the chest from the pelvis frame to its own
    const n = this.spine.length;
    if (n) {
      const curl = this.sideSign * 0.55 * ch.curl;
      const dYaw = psiC - psiP - wiggle + this.bend + curl;
      const dPitch = alpha;
      const dRoll = rhoC - rhoP - sideRoll * 0.75 + shakeC - shakeP;
      for (const b of this.spine) {
        axisRot(_q2, bUp, dYaw / n, bLat, dPitch / n, bFwd, dRoll / n);
        rotateBoneWorld(b, _q2);
        b.updateWorldMatrix(false, true);
      }
    }
    // girdle hinge axes for the limbs
    this.pelvis?.getWorldQuaternion(_q1); _q1.multiply(_q3.copy(this.pelvisRestQ).invert());
    this.hipLat = (this.hipLat || V()).copy(AX).applyQuaternion(_q1);
    this.chest?.getWorldQuaternion(_q1); _q1.multiply(_q3.copy(this.chestRestQ).invert());
    this.shLat = (this.shLat || V()).copy(AX).applyQuaternion(_q1);
    this.chestQ = (this.chestQ || Q()).copy(_q1);
  }

  // ---- legs ---------------------------------------------------------------------
  segPoint(L, qf, theta, vec, s, out) {
    _qr.setFromAxisAngle(AX, theta);
    return out.copy(vec).multiplyScalar(s).applyQuaternion(_qr).applyQuaternion(qf).add(_P);
  }

  solveLeg(L, ctx, ch, s) {
    // paw frame: heading, then tilt onto the ground normal
    _q1.setFromAxisAngle(UP, L.footYaw);
    _q2.setFromUnitVectors(UP, L.normal);
    _qf.copy(_q2).multiply(_q1);
    _P.copy(L.foot).addScaledVector(L.normal, L.pivotH * s);
    const scrW = !L.front && ch.scratch > 0.001 && L.side === (ctx.posture?.scratchSide ?? 1) ? ch.scratch : 0;
    if (scrW) this.scratchTarget(L, ctx, s, scrW);
    let theta = scrW ? lerp(L.theta, 0.9, scrW) : L.theta;
    const hinge = L.front ? this.shLat : this.hipLat;

    // shoulder blade swings with the leg
    if (L.scap && this.tune.scapula) {
      L.upper.getWorldPosition(_v1);
      _v2.subVectors(_P, _v1);
      const ang = Math.atan2(_v2.dot(this.bFwd), -_v2.dot(this.bUp));
      rotateBoneWorld(L.scap, _q3.setFromAxisAngle(hinge, -this.tune.scapula * clamp(ang, -0.9, 0.9)));
      L.scap.updateWorldMatrix(false, true);
    }

    let W = this.segPoint(L, _qf, theta, L.segVec, s, _W);
    // heel lift: roll over the digits rather than over-extend the limb
    if (L.state === 'stance' && !scrW) {
      L.upper.getWorldPosition(_v1);
      const rmax = L.reachMax * s * (L.front ? 0.985 : 0.965);
      if (_v1.distanceTo(W) > rmax) {
        let lo = theta, hi = theta + 1.3;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) / 2;
          this.segPoint(L, _qf, mid, L.segVec, s, _W);
          if (_v1.distanceTo(_W) > rmax) lo = mid; else hi = mid;
        }
        theta = hi;
        W = this.segPoint(L, _qf, theta, L.segVec, s, _W);
      }
    }
    L.thetaUsed = theta;
    L.short = solveLimb(L.upper, L.lower, L.tipArg, W, hinge, L.front ? 1 : -1);

    _qr.setFromAxisAngle(AX, theta);
    _q3.copy(_qf).multiply(_qr);                 // pastern / metatarsus frame
    if (L.front) {
      if (this.def.endIsChild) aimBone(L.end, L.toe.getWorldPosition(_v2), _P);
      else {
        setBoneWorldPosition(L.end, L.lower.localToWorld(_v2.copy(L.tipArg)));
        setBoneWorldQuaternion(L.end, _q2.copy(_q3).multiply(L.restEndQ));
        L.end.updateWorldMatrix(false, true);
      }
    } else if (this.def.endIsChild) aimBone(L.hock, L.toe.getWorldPosition(_v2), _P);
    else {
      _E.copy(L.endVec).multiplyScalar(s).applyQuaternion(_q3).add(_P);
      aimBone(L.hock, L.hock.localToWorld(_v2.copy(L.hockTip)), _E);
      setBoneWorldPosition(L.end, L.hock.localToWorld(_v2.copy(L.hockTip)));
      setBoneWorldQuaternion(L.end, _q2.copy(_q3).multiply(L.restEndQ));
      L.end.updateWorldMatrix(false, true);
    }
    // digits: flat on the ground in stance, curled in swing
    const dg = scrW ? lerp(L.digits, 0.6, scrW) : L.digits;
    _qr.setFromAxisAngle(AX, dg);
    setBoneWorldQuaternion(L.toe, _q2.copy(_qf).multiply(_qr).multiply(L.restToeQ));
    L.toe.updateWorldMatrix(false, true);
  }

  /** Scratching: the hind paw reaches up beside the neck and rakes. */
  scratchTarget(L, ctx, s, w) {
    const Lw = this.legLen * s;
    const tA = ctx.posture?.actionTime || 0;
    const f = 5.2 * Math.pow(0.5 / Lw, 0.25);
    const rake = Math.sin(TAU * f * tA);
    const base = (this.neck[0] || this.chest).getWorldPosition(_v1);
    _v2.copy(base).addScaledVector(this.bLat, L.side * this.hipW * s * 0.75).addScaledVector(this.bUp, -0.05 * Lw)
      .addScaledVector(this.bFwd, -0.2 * Lw + rake * 0.07 * Lw).addScaledVector(this.bUp, rake * 0.04 * Lw);
    _P.lerp(_v2, w);
  }

  // ---- head and neck ------------------------------------------------------------
  solveHead(ctx, ch, dt) {
    if (!this.head) return;
    const look = ctx.look || {};
    let yawT = 0, pitchT = 0;
    const hp = this.head.getWorldPosition(_v1);
    if (look.target && look.weight > 0.001) {
      _v2.copy(look.target).sub(hp);
      const yawTo = Math.atan2(_v2.x, _v2.z);
      yawT = clamp(angleDiff(ctx.yaw, yawTo), -1.15, 1.15) * look.weight;
      pitchT = clamp(Math.atan2(-_v2.y, Math.hypot(_v2.x, _v2.z)), -0.6, 1.25) * look.weight;
    }
    // idle glances when nothing holds the dog's attention
    const gl = this.glance;
    const free = (1 - (look.weight || 0)) * (1 - this.cyc) * (1 - ch.headLow) * (1 - ch.eat) * (1 - ch.sniff);
    gl.t -= dt;
    if (gl.t < 0) {
      gl.t = 1.2 + Math.random() * 3.5;
      const big = Math.random() < 0.3;
      gl.ty = (Math.random() - 0.5) * (big ? 1.4 : 0.6);
      gl.tp = (Math.random() - 0.5) * 0.35 - (big ? 0.1 : 0);
      if (Math.random() < 0.3) { gl.ty = 0; gl.tp = 0; }
    }
    const gy = gl.yaw.update(gl.ty * free, dt, 2.4, 0.85), gp = gl.pitch.update(gl.tp * free, dt, 2.4, 0.85);
    yawT += gy; pitchT += gp;
    // posture: eating / sniffing / sleeping lower the head, stretching and yawning lift the chin
    pitchT += 1.05 * ch.eat + 0.95 * ch.headLow + 0.85 * ch.sniff - 0.55 * ch.headUp + 0.12 * ch.front * (1 - ch.headLow);
    yawT += this.sideSign * 0.55 * ch.curl;
    // anticipation: the head leads into turns
    yawT += clamp((ctx.yawRate || 0) * 0.24, -0.5, 0.5) * (1 - this.low);
    // sniffing sweeps the nose from side to side
    if (ch.sniff > 0.01) {
      this.sniffT += dt;
      yawT += ch.sniff * 0.22 * Math.sin(this.sniffT * 2.3) * Math.sin(this.sniffT * 0.7 + 1);
      pitchT += ch.sniff * 0.04 * Math.max(0, Math.sin(this.sniffT * 19)) * (Math.sin(this.sniffT * 1.3) > 0.2 ? 1 : 0);
    }
    const scr = ch.scratch, scrSide = ctx.posture?.scratchSide ?? 1;
    yawT += scr * scrSide * 0.45; pitchT += scr * 0.2;
    this.look.yaw = damp(this.look.yaw, yawT, 7, dt);
    this.look.pitch = damp(this.look.pitch, pitchT, 6, dt);

    // stabilise against trunk motion (relative to the root's heading)
    _q1.setFromAxisAngle(UP, ctx.yaw).invert().multiply(this.chestQ);
    _e.setFromQuaternion(_q1, 'YXZ');
    const cPitch = _e.x, cYaw = _e.y, cRoll = _e.z;
    const gaitStab = this.gait.mix(0.4, 0.85, 0.6);
    const stab = lerp(lerp(0.6, gaitStab, this.cyc), 0.9, Math.max(ch.rear, ch.front));
    let pitch = this.look.pitch - (cPitch - 0.6 * this.terrainPitch) * stab;
    let yawO = this.look.yaw - cYaw * 0.75;
    let roll = -cRoll * 0.75 - scr * scrSide * 0.35;
    // the head nods with the shoulders at the walk
    const gw = this.gait.weights();
    pitch += gw.walk * this.cyc * 0.05 * Math.sin(TAU * (this.gait.phase - this.gait.offs.FL) * 2 - 0.6);
    if (this.shakePh != null) {
      roll += ch.shake * 0.55 * Math.sin(this.shakePh);
      yawO += ch.shake * 0.12 * Math.sin(this.shakePh + 0.8);
    }
    const chain = [...this.neck, this.head];
    const wy = chain.length === 3 ? [0.3, 0.3, 0.4] : chain.map(() => 1 / chain.length);
    const wp = chain.length === 3 ? [0.4, 0.25, 0.35] : chain.map(() => 1 / chain.length);
    let accYaw = 0;
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i];
      accYaw += yawO * wy[i];
      rotateBoneWorld(b, _q2.setFromAxisAngle(this.bUp, yawO * wy[i]));
      b.updateWorldMatrix(false, true);
      _v2.copy(this.bLat).applyAxisAngle(this.bUp, accYaw);
      rotateBoneWorld(b, _q2.setFromAxisAngle(_v2, pitch * wp[i]));
      if (i === chain.length - 1 && Math.abs(roll) > 1e-4) {
        _v3.copy(this.bFwd).applyAxisAngle(this.bUp, accYaw);
        rotateBoneWorld(b, _q2.setFromAxisAngle(_v3, roll));
      }
      b.updateWorldMatrix(false, true);
    }
  }

  // ---- secondary motion ------------------------------------------------------------
  secondary(ctx, ch, dt, s) {
    const gw = this.gait.weights();
    const Lw = this.legLen * s;
    // jaw: panting and yawning
    this.pantPhase += dt * TAU * (3.2 + 0.8 * (ctx.pant || 0));
    const pant = (ctx.pant || 0) * (1 - ch.yawn);
    if (this.jaw) {
      const open = pant * (0.13 + 0.06 * Math.sin(this.pantPhase)) + ch.yawn * 0.55;
      if (open > 1e-3) {
        this.head.getWorldQuaternion(_q1).multiply(_q3.copy(this.headRestQ).invert());
        _v1.copy(AX).applyQuaternion(_q1);
        rotateBoneWorld(this.jaw, _q2.setFromAxisAngle(_v1, open * (this.tune.jawOpen ?? 1)));
        this.jaw.updateWorldMatrix(false, true);
      }
    }

    // tail: a spring chain driven at its base by mood, gait and posture
    const tw = ctx.tail || { wag: 0, freq: 2, height: 0 };
    this.wagPhase += dt * TAU * (tw.freq || 2);
    if (this.tailChain) {
      const runW = this.cyc * (0.5 * gw.trot + gw.gallop);
      const lowered = Math.max(ch.side, ch.rear * 0.8);
      const amp = clamp(tw.wag || 0, 0, 1.2) * 0.8 * (1 - 0.65 * runW) * (1 - 0.75 * ch.side);
      let wag = amp * Math.sin(this.wagPhase);
      if (this.shakePh != null) wag += ch.shake * 0.7 * Math.sin(this.shakePh - 2.6);
      const height = (tw.height || 0) * (1 - 0.5 * runW) - 0.12 * runW - 0.35 * lowered + 0.15 * ch.bowRear * ch.front;
      const curl = this.sideSign * 1.1 * ch.curl;
      this.pelvis.getWorldQuaternion(_q1).multiply(_q3.copy(this.pelvisRestQ).invert());
      const pLat = _v1.copy(AX).applyQuaternion(_q1).clone(), pUp = _v2.copy(AY).applyQuaternion(_q1).clone();
      const ground = ctx.ground, gClear = 0.012 * Lw;
      this.tailChain.update(dt, {
        drive: (i, dir) => {
          if (i === 0) { dir.applyAxisAngle(pLat, height); dir.applyAxisAngle(pUp, wag + curl * 0.4); }
          else { dir.applyAxisAngle(pLat, 0.12 * (tw.height || 0) - 0.15 * lowered); dir.applyAxisAngle(pUp, curl * 0.25); }
        },
        collide: (i, p) => { const gy = ground(p.x, p.z) + gClear; if (p.y < gy) p.y = gy; },
      });
    }

    // ears: heavy flaps that swing with the head; perk forward when excited
    if (this.earChains) {
      this.head.getWorldQuaternion(_q1).multiply(_q3.copy(this.headRestQ).invert());
      const hLat = _v1.copy(AX).applyQuaternion(_q1).clone();
      const hp = this.head.getWorldPosition(_v2).clone();
      const perk = clamp(ctx.perk || 0, 0, 1) * (1 - ch.headLow);
      for (const e of this.earChains) {
        const side = e.side;
        e.chain.update(dt, {
          gravity: this.earGravity,
          drive: (i, dir) => { if (i === 0) dir.applyAxisAngle(hLat, -0.22 * perk); },
          collide: (i, p) => {
            _v3.subVectors(p, hp);
            const d = _v3.dot(hLat) * side;
            if (d < e.clear * ctx.scale) p.addScaledVector(hLat, (e.clear * ctx.scale - d) * side);
          },
        });
      }
    }

    // morphs: breathing (faster while panting), blinks (eyes shut through a yawn)
    if (this.mesh) {
      const dict = this.mesh.morphTargetDictionary, inf = this.mesh.morphTargetInfluences;
      const m = this.def.morphs;
      const blink = Math.max(ctx.blink || 0, ch.yawn > 0.45 ? 1 : 0);
      if (m.blink && dict[m.blink] !== undefined) inf[dict[m.blink]] = Math.max(inf[dict[m.blink]], blink);
      if (m.breath && dict[m.breath] !== undefined && ctx.breath !== undefined) {
        inf[dict[m.breath]] = pant > 0.3 ? 0.5 + 0.5 * Math.sin(this.pantPhase) : ctx.breath;
      }
    }
  }

  /** Debug / test probe: paw contact state and error. */
  probe() {
    return this.legs.map((L) => ({
      id: L.id, state: L.state, u: L.u, s: L.s, theta: L.thetaUsed,
      toe: L.toe.getWorldPosition(V()), plant: L.plant.clone(), short: L.short,
    }));
  }
}

/** q = R(a1, t1) · R(a2, t2) · R(a3, t3), world axes. */
function axisRot(out, a1, t1, a2, t2, a3, t3) {
  out.setFromAxisAngle(a1, t1);
  out.multiply(_qa.setFromAxisAngle(a2, t2));
  out.multiply(_qa.setFromAxisAngle(a3, t3));
  return out;
}
const _qa = new THREE.Quaternion();

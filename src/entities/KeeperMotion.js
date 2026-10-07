// Procedural animation for the keeper, layered on the pose tables in
// KeeperClips.js:
//   1. phase-locked blend of idle / careful walk / walk / jog tables;
//   2. foot planner: stance feet are pinned in the world and roll heel ->
//      ball, swing feet follow the table path scaled to the real stride with
//      an offset that carries them onto the ground (slopes, porch, bridge);
//      standing feet take small corrective steps (stops, turning in place);
//   3. pelvis keeps the pose's leg lengths over the planted feet, plus
//      lean from acceleration, banking into turns and weight shifts;
//   4. leg IK with knee swivel, toe roll;
//   5. upper body: look-at led by the turn, breathing, idle life, and the
//      staged kneel / offer / stroke poses (see KeeperPoses).
import * as THREE from 'three';
import { Rig, PoseBlender, buildKeeperTables, LEG, SIDES } from './KeeperClips.js';
import { solveTwoBone, rotateBoneAxis, setBoneWorldQuaternion, translateBoneWorld } from '../util/ik.js';
import { damp, clamp, smoothstep, angleDiff, lerp } from '../util/noise.js';
import { KeeperPoses } from './KeeperPoses.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);
const mj = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (10 + t * (-15 + 6 * t))); // minimum jerk
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export const GAIT_SPEED = { calm: 0.95, walk: 1.65, jog: 2.5 };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _yawQ = (yaw, out = new THREE.Quaternion()) => out.setFromAxisAngle(UP, yaw);

/** Critically / under-damped spring on a scalar. */
class Spring {
  constructor(freq = 4, zeta = 0.7) { this.x = 0; this.v = 0; this.freq = freq; this.zeta = zeta; }
  step(target, dt) {
    const w = TAU * this.freq, n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
}

class Foot {
  constructor(s) {
    this.s = s; this.sign = s === 'L' ? 1 : -1; this.off = s === 'L' ? 0 : 0.5;
    this.planted = true;
    this.heel = new THREE.Vector3();
    this.yaw = 0;           // planted foot frame = root yaw at plant time
    this.swing = null;
    this.ankle = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.pf = 0; this.pfPrev = 0;
    this.len = 0.75;        // pose hip-ankle length this frame
    this.weight = 1;        // stance weight for the pelvis solve
    this.normal = new THREE.Vector3(0, 1, 0);
  }
}

export class KeeperMotion {
  constructor(player, clips) {
    this.player = player;
    this.game = player.game;
    this.rig = new Rig(player.model);
    this.B = this.rig.by;
    this.T = buildKeeperTables(this.rig, clips, {
      walkSpeed: GAIT_SPEED.walk,
      calm: { speed: GAIT_SPEED.calm, period: 1.24, duty: 0.66, drop: 0.035, armDamp: 0.55, elbow: 0.14, lean: 0.06, gaze: 0.14 },
      jog: { speed: GAIT_SPEED.jog, period: 0.76, duty: 0.35, landAhead: 0.2, hipsH: 0.885, bob: 0.026, kick: 0.42, lean: 0.13, armSwing: 0.5, elbow: 1.45, narrow: 0.85 },
    });
    this.geo = this.T.geo;
    this.blender = new PoseBlender(this.rig);
    this.gaits = [this.T.calm, this.T.walk, this.T.jog];
    const g = this.geo;
    // flat-foot heel->ball vector in the model frame (for pivoting)
    this.ballFlat = {};
    for (const s of SIDES) {
      const h = g[s].heel.clone().applyQuaternion(g[s].refQ), b = g[s].ball.clone().applyQuaternion(g[s].refQ);
      this.ballFlat[s] = b.sub(h).setY(0);
    }
    // standing stance (heel points, model frame): the idle clip's, slightly narrowed
    this.stance = {
      L: new THREE.Vector3(g.L.heelPos.x * 0.85 + 0.01, 0, g.L.heelPos.z * 0.6),
      R: new THREE.Vector3(g.R.heelPos.x * 0.85 + 0.01, 0, g.R.heelPos.z * 0.6),
    };
    this.legLen = this.B.LeftUpLeg.getWorldPosition(new THREE.Vector3()).distanceTo(this.B.LeftLeg.getWorldPosition(new THREE.Vector3()))
      + this.B.LeftLeg.getWorldPosition(new THREE.Vector3()).distanceTo(this.B.LeftFoot.getWorldPosition(new THREE.Vector3()));

    this.feet = { L: new Foot('L'), R: new Foot('R') };
    this.mode = 'stand';
    this.phase = 0;
    this.gait = 1;
    this.locoW = 0;
    this.idleT = 0;
    this.time = 0;
    this.stride = 1;
    this.cadence = 1;
    this.stopping = 0;
    this.pelvisDy = 0;
    this.pelvisDyV = 0;
    this.leanF = new Spring(2.2, 0.55);
    this.leanS = new Spring(1.6, 0.7);
    this.shift = new Spring(2.0, 0.8);
    this.prevSpeed = 0;
    this.prevYaw = null;
    this.yawRate = 0;
    this.accel = 0;
    this.exertion = 0;
    this.lastStep = -10;
    this.settleDone = true;
    this.events = [];
    this.poses = new KeeperPoses(this);
    this.initialised = false;
  }

  // --- helpers ------------------------------------------------------------------
  ground(x, z) { return this.game.world.groundAt(x, z); }

  groundNormal(x, z, out) {
    const e = 0.18;
    const hx = this.ground(x + e, z) - this.ground(x - e, z), hz = this.ground(x, z + e) - this.ground(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /** World heel point for a standing stance slot. */
  stanceHeel(s, pos, yaw, out) {
    out.copy(this.stance[s]).applyAxisAngle(UP, yaw).add(pos);
    out.y = this.ground(out.x, out.z);
    return out;
  }

  plantAt(f, heel, yaw) {
    f.heel.copy(heel); f.yaw = yaw; f.planted = true; f.swing = null;
    this.groundNormal(heel.x, heel.z, f.normal);
  }

  /** Place both feet in the standing stance (teleport / first frame). */
  snap() {
    const p = this.player;
    for (const s of SIDES) this.plantAt(this.feet[s], this.stanceHeel(s, p.pos, p.yaw, _v1), p.yaw);
    this.mode = 'stand'; this.locoW = 0; this.pelvisDy = 0; this.pelvisDyV = 0;
    this.prevYaw = p.yaw;
    this.initialised = true;
  }

  // --- main update --------------------------------------------------------------
  update(dt) {
    const p = this.player, rig = this.rig, B = this.B;
    if (!this.initialised) this.snap();
    this.time += dt;
    this.idleT += dt;
    this.events.length = 0;

    // kinematics of the root
    const yaw = p.yaw;
    if (dt > 0) {
      const yr = angleDiff(this.prevYaw ?? yaw, yaw) / dt;
      this.yawRate = damp(this.yawRate, yr, 12, dt);
      const ac = (p.speed - this.prevSpeed) / dt;
      this.accel = damp(this.accel, ac, 10, dt);
    }
    this.prevYaw = yaw; this.prevSpeed = p.speed;
    this.exertion = clamp(this.exertion + dt * (p.speed > 2 ? 0.12 : p.speed > 1.2 ? 0.01 : -0.05), 0, 1);

    // gait blend and cadence
    this.gait = damp(this.gait, p.gaitTarget ?? 1, 5, dt);
    const wC = clamp(1 - this.gait, 0, 1), wJ = clamp(this.gait - 1, 0, 1), wW = 1 - wC - wJ;
    this.gw = [wC, wW, wJ];
    const mix = (fn) => wC * fn(this.T.calm) + wW * fn(this.T.walk) + wJ * fn(this.T.jog);
    const vNat = mix((t) => t.speed), fNat = mix((t) => t.cadence), duty = mix((t) => t.dutyAvg);
    this.duty = duty;

    const kneeling = this.poses.active;
    const wantMove = p.moveIntent > 0 && p.targetSpeed > 0.01 && !kneeling;
    if (this.mode === 'stand' && (wantMove || p.speed > 0.25) && !kneeling) this.startGait();

    if (this.mode === 'move') {
      const r = p.speed / vNat;
      let cad = fNat * Math.pow(clamp(r, 0.45, 1.35), 0.5);
      if (!wantMove) cad = Math.max(cad, fNat * 0.8);
      this.cadence = cad;
      this.stride = clamp((p.speed / cad) / (vNat / fNat), 0, 1.5);
      this.phase += cad * dt;
      this.stopping = wantMove ? 0 : this.stopping + dt;
    }
    this.locoW = damp(this.locoW, this.mode === 'move' ? 1 : 0, this.mode === 'move' ? 9 : 5, dt);

    // 1. base pose
    this.blender.begin();
    this.blender.add(this.T.idle, this.idleT / this.T.idle.period, 1 - this.locoW);
    const gl = this.locoW;
    this.blender.add(this.T.calm, this.phase, gl * wC);
    this.blender.add(this.T.walk, this.phase, gl * wW);
    this.blender.add(this.T.jog, this.phase, gl * wJ);
    this.blender.apply();

    // root transform
    const bodyYaw = this.poses.bodyYaw(yaw);
    p.root.position.copy(p.pos);
    p.root.rotation.set(0, bodyYaw, 0);
    this.bodyYaw = bodyYaw;
    rig.update();

    // 2. feet
    this.updateFeet(dt, wantMove, { wC, wW, wJ });
    this.poses.updateLegs(dt);

    // 3. pelvis
    this.solvePelvis(dt);

    // 4. legs
    for (const s of SIDES) this.solveLeg(this.feet[s]);

    // 5. upper body
    this.upperBody(dt);
    this.poses.updateUpper(dt);

    for (const e of this.events) this.game.events.emit('footstep', e);
  }

  // --- gait / stand transitions ----------------------------------------------
  startGait() {
    const p = this.player;
    const fwd = _v1.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    // lead with the foot that is further back (or the one mid-step)
    let lead = null;
    for (const s of SIDES) if (this.feet[s].swing) lead = s;
    if (!lead) {
      const dL = this.feet.L.heel.clone().sub(p.pos).dot(fwd), dR = this.feet.R.heel.clone().sub(p.pos).dot(fwd);
      const turn = angleDiff(p.yaw, p.desiredYaw ?? p.yaw);
      if (Math.abs(dL - dR) > 0.06) lead = dL < dR ? 'L' : 'R';
      else if (Math.abs(turn) > 0.3) lead = turn > 0 ? 'L' : 'R';
      else lead = this.lastLead === 'L' ? 'R' : 'L';
    }
    this.lastLead = lead;
    const D = this.duty;
    this.phase = lead === 'L' ? D : D - 0.5;
    for (const s of SIDES) {
      const f = this.feet[s];
      f.pf = f.pfPrev = fract(this.phase - f.off);
      if (s === lead) this.beginGaitSwing(f, D);
      else if (f.swing) { // finish an idle step instantly where it is
        this.plantAt(f, this.heelFromAnkle(f, f.ankle, f.q, _v2), f.swing.yaw1 ?? f.yaw);
      }
    }
    this.mode = 'move';
    this.stopping = 0;
  }

  beginGaitSwing(f, D) {
    const fromPlant = f.planted;
    f.planted = false;
    f.swing = { kind: 'gait', D0: Math.min(D, f.pf), A0: fromPlant ? null : f.ankle.clone(), O0: null, yaw0: angleDiff(this.player.yaw, f.yaw), s: 0, fromPlant };
  }

  enterStand() {
    this.mode = 'stand';
    this.settleT = 0;
    this.settleDone = false;
  }

  heelFromAnkle(f, ankle, q, out) {
    const h = _v4.copy(this.geo[f.s].heel).applyQuaternion(q);
    out.copy(ankle).add(h);
    out.y = this.ground(out.x, out.z);
    return out;
  }

  // --- foot planner ---------------------------------------------------------------
  updateFeet(dt, wantMove, w) {
    const p = this.player, rig = this.rig;
    const rootQ = _yawQ(this.bodyYaw, _q3);
    // pose info
    for (const s of SIDES) {
      const f = this.feet[s], L = LEG[s];
      f.poseA = rig.mpos(L.foot, f.poseA || new THREE.Vector3());
      f.poseQ = rig.mquat(L.foot, f.poseQ || new THREE.Quaternion());
      const hip = this.B[L.up].getWorldPosition(_v1), ank = this.B[L.foot].getWorldPosition(_v2);
      f.len = hip.distanceTo(ank);
      f.zMid = w.wC * this.T.calm.feet[s].zMid + w.wW * this.T.walk.feet[s].zMid + w.wJ * this.T.jog.feet[s].zMid;
    }

    if (this.mode === 'move') {
      const D = this.duty;
      for (const s of SIDES) {
        const f = this.feet[s];
        f.pfPrev = f.pf;
        f.pf = fract(this.phase - f.off);
        const wrapped = f.pf < f.pfPrev - 0.5;
        if (f.planted) {
          if (f.pf >= D && (f.pfPrev < D || wrapped)) {
            const other = this.feet[s === 'L' ? 'R' : 'L'];
            if (!wantMove && p.speed < 0.5 && other.planted) { this.enterStand(); break; }
            this.beginGaitSwing(f, D);
          }
        } else if (f.swing?.kind === 'gait' && wrapped) {
          this.land(f);
          const other = this.feet[s === 'L' ? 'R' : 'L'];
          if (!wantMove && p.speed < 0.3 && other.planted) { this.enterStand(); break; }
        }
      }
      // a swing that outlives the gait (stopped mid-step) is finished as a step
    }
    if (this.mode === 'stand') this.standSteps(dt);

    // targets
    for (const s of SIDES) {
      const f = this.feet[s];
      if (f.planted) this.plantedTarget(f, rootQ);
      else if (f.swing.kind === 'gait') this.gaitSwingTarget(f, rootQ);
      else this.stepTarget(f, dt, rootQ);
    }
  }

  /** Stance foot: pinned heel, roll onto the ball as the pose lifts the heel. */
  plantedTarget(f, rootQ) {
    const g = this.geo[f.s];
    // foot orientation: pose (relative to the body) carried by the planted yaw, tilted to the ground
    const q = f.q.copy(_yawQ(f.yaw, _q1)).multiply(f.poseQ);
    _q2.setFromUnitVectors(UP, f.normal);
    q.premultiply(_q2.slerp(_q1.identity(), 0.3));
    const h = _v1.copy(g.heel).applyQuaternion(q), b = _v2.copy(g.ball).applyQuaternion(q);
    const ball = _v3.copy(this.ballFlat[f.s]).applyAxisAngle(UP, f.yaw).add(f.heel);
    ball.y = this.ground(ball.x, ball.z);
    const aH = _v4.copy(f.heel).sub(h);
    const aB = ball.sub(b);
    const w = smooth((h.y - b.y + 0.006) / 0.012);
    f.ankle.copy(aH).lerp(aB, w);
    f.weight = 1;
  }

  /** Model-space pose ankle scaled to the actual stride, to world. */
  poseAnkleWorld(f, out, rootQ) {
    out.copy(f.poseA);
    out.z = f.zMid + (out.z - f.zMid) * this.stride;
    return out.applyQuaternion(rootQ).add(this.player.pos);
  }

  gaitSwingTarget(f, rootQ) {
    const sw = f.swing, p = this.player;
    const P = this.poseAnkleWorld(f, this._P || (this._P = new THREE.Vector3()), rootQ);
    const D0 = sw.D0;
    sw.s = clamp((f.pf - D0) / (1 - D0), 0, 1);
    if (!sw.A0) { this.plantedTarget(f, rootQ); sw.A0 = f.ankle.clone(); this.poseAnkleWorld(f, P, rootQ); }
    if (!sw.O0) sw.O0 = sw.A0.clone().sub(P);
    // landing: the pose's own landing spot, lifted onto the ground there
    const tRem = (1 - f.pf) / Math.max(0.3, this.cadence);
    const lx = P.x + p.vel.x * tRem * 0.5, lz = P.z + p.vel.z * tRem * 0.5;
    const gy = this.ground(lx, lz);
    const O1y = gy - p.pos.y;
    const k = mj(sw.s);
    f.ankle.set(P.x + sw.O0.x * (1 - k), P.y + lerp(sw.O0.y, O1y, smooth(sw.s * 1.15)), P.z + sw.O0.z * (1 - k));
    // stepping up: extra clearance mid-swing
    const rise = O1y - sw.O0.y;
    if (rise > 0.02) f.ankle.y += rise * 0.6 * Math.sin(Math.PI * clamp(sw.s * 1.1, 0, 1));
    const yawOff = sw.yaw0 * (1 - k);
    f.q.copy(rootQ).multiply(f.poseQ).premultiply(_yawQ(yawOff, _q1));
    f.weight = 0;
  }

  land(f) {
    const p = this.player;
    const heel = this.heelFromAnkle(f, f.ankle, f.q, _v2);
    this.plantAt(f, heel, this.bodyYaw);
    this.footstep(f, p.speed);
  }

  footstep(f, speed) {
    const w = this.game.world;
    const x = f.heel.x, z = f.heel.z;
    let surface = 'grass';
    if (w.outpost?.bridgeHeight(x, z) != null || w.outpost?.porchHeight(x, z) != null) surface = 'wood';
    else { const sp = w.terrain?.splatAt?.(x, z); if (sp && (sp.path > 0.5 || sp.bank > 0.5)) surface = 'dirt'; }
    this.events.push({ who: 'player', x, z, speed: Math.max(0.5, speed), foot: f.s, surface });
    this.lastStep = this.time;
  }

  // --- standing: settle and turn-in-place steps ---------------------------------
  standSteps(dt) {
    const p = this.player;
    this.settleT = (this.settleT || 0) + dt;
    const busy = SIDES.some((s) => this.feet[s].swing);
    if (busy || this.poses.active) return;
    if (this.time - this.lastStepEnd < 0.06) return;
    // predicted facing at the end of a step (turning in place)
    const lookAhead = clamp(this.yawRate * 0.3, -0.7, 0.7);
    const yawT = p.yaw + (Math.abs(angleDiff(p.yaw, p.desiredYaw ?? p.yaw)) > 0.05 ? lookAhead : 0);
    let best = null, bestErr = 0;
    for (const s of SIDES) {
      const f = this.feet[s];
      const ideal = this.stanceHeel(s, p.pos, yawT, _v1);
      const dpos = Math.hypot(ideal.x - f.heel.x, ideal.z - f.heel.z);
      const dyaw = Math.abs(angleDiff(f.yaw, yawT));
      // turning: lead with the foot on the turn side
      const turnSide = Math.sign(this.yawRate) === f.sign && Math.abs(this.yawRate) > 0.4 ? 0.06 : 0;
      const err = dpos + dyaw * 0.35 + turnSide;
      const thr = (!this.settleDone && this.settleT > 0.12) ? 0.09 : 0.2;
      if (err > thr && err > bestErr) { best = s; bestErr = err; }
    }
    if (!best) {
      if (this.settleT > 1.0) this.settleDone = true;
      return;
    }
    const f = this.feet[best];
    const target = this.stanceHeel(best, p.pos, yawT, new THREE.Vector3());
    const dist = Math.hypot(target.x - f.heel.x, target.z - f.heel.z);
    const turning = Math.abs(this.yawRate) > 0.6;
    const dur = (turning ? 0.3 : 0.36 + 0.3 * clamp(dist / 0.5, 0, 1)) * (p.calm ? 1.15 : 1);
    f.planted = false;
    f.swing = { kind: 'step', t: 0, prep: turning ? 0.05 : 0.12, dur, A0: f.ankle.clone(), heel0: f.heel.clone(), heel1: target, yaw0: f.yaw, yaw1: yawT, lift: clamp(0.03 + dist * 0.12, 0.03, 0.07), s: 0 };
    this.settleDone = this.settleDone || !turning;
  }

  stepTarget(f, dt, rootQ) {
    const sw = f.swing, g = this.geo[f.s];
    sw.t += dt;
    const s = clamp((sw.t - sw.prep) / sw.dur, 0, 1);
    sw.s = s;
    const k = mj(s);
    const heel = _v1.copy(sw.heel0).lerp(sw.heel1, k);
    heel.y = lerp(sw.heel0.y, sw.heel1.y, k) + sw.lift * Math.pow(Math.sin(Math.PI * s), 1.3);
    const yaw = sw.yaw0 + angleDiff(sw.yaw0, sw.yaw1) * k;
    // foot slightly toe-down while lifted, flat for contact
    const pitch = -0.16 * Math.sin(Math.PI * Math.min(1, s * 1.25));
    const lat = _v2.set(Math.cos(yaw + g.toeOut), 0, -Math.sin(yaw + g.toeOut));
    f.q.copy(_yawQ(yaw, _q1)).multiply(f.poseQ).premultiply(_q2.setFromAxisAngle(lat, -pitch));
    const h = _v3.copy(g.heel).applyQuaternion(f.q);
    f.ankle.copy(heel).sub(h);
    f.weight = s <= 0 ? 1 : 0;
    if (s >= 1) {
      this.plantAt(f, sw.heel1, sw.yaw1);
      this.footstep(f, 0.55);
      this.lastStepEnd = this.time;
      f.weight = 1;
    }
  }

  // --- pelvis ---------------------------------------------------------------------
  solvePelvis(dt) {
    const p = this.player, B = this.B;
    const fwd = _v3.set(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    const right = _v4.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw)); // character's left (+X)
    // weight shift toward the supporting foot during a standing step (anticipation)
    let shiftT = 0;
    for (const s of SIDES) {
      const f = this.feet[s];
      if (f.swing?.kind === 'step') {
        const sw = f.swing;
        const pre = clamp(sw.t / Math.max(0.01, sw.prep + sw.dur * 0.25), 0, 1);
        const post = 1 - smooth((sw.s - 0.55) / 0.45);
        shiftT += -f.sign * 0.035 * smooth(pre) * post;
      }
    }
    shiftT += this.poses.shift || 0;
    const shift = this.shift.step(shiftT, dt);
    // leaning: acceleration (with follow-through) and banking into turns
    const accTarget = clamp(this.accel * 0.03, -0.1, 0.12) * (this.poses.active ? 0 : 1);
    const lean = this.leanF.step(accTarget, dt);
    const lat = clamp(p.speed * this.yawRate * 0.045, -0.16, 0.16);
    const bank = this.leanS.step(lat, dt);
    this.lean = lean; this.bank = bank;

    // height: keep the pose's leg lengths over the planted feet, never overreach
    const hipsW = B.Hips.getWorldPosition(new THREE.Vector3());
    let dyStance = Infinity, dyMax = Infinity, anyStance = false;
    for (const s of SIDES) {
      const f = this.feet[s];
      const hip = B[LEG[s].up].getWorldPosition(_v1);
      hip.addScaledVector(right, shift);
      const dx = hip.x - f.ankle.x, dz = hip.z - f.ankle.z, hd2 = dx * dx + dz * dz;
      const Lmax = this.legLen * 0.995;
      const reach = Lmax * Lmax > hd2 ? f.ankle.y + Math.sqrt(Lmax * Lmax - hd2) - hip.y : f.ankle.y - hip.y;
      dyMax = Math.min(dyMax, reach);
      if (f.weight > 0.5) {
        const L = Math.min(f.len, Lmax);
        const want = L * L > hd2 ? f.ankle.y + Math.sqrt(L * L - hd2) - hip.y : f.ankle.y - hip.y;
        dyStance = Math.min(dyStance, want);
        anyStance = true;
      }
    }
    let target = anyStance ? clamp(dyStance, -0.16, 0.08) : this.pelvisDy;
    target = Math.min(target, dyMax);
    // interaction poses (kneeling) take over the height: an exact offset that
    // puts the kneeling hip a thigh-length above the knee on the ground
    if (this.poses.pelvisAbs != null) target = lerp(target, this.poses.pelvisAbs, this.poses.drop);
    target = clamp(target, -0.75, 0.12);
    // critically damped follow, fast enough to stay over the feet
    // (substepped: a stiff spring integrated at 30 fps would diverge)
    const w = 26, n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.pelvisDy) - 2 * w * this.pelvisDyV;
      this.pelvisDyV += a * h; this.pelvisDy += this.pelvisDyV * h;
      if (this.pelvisDy > dyMax) { this.pelvisDy = dyMax; this.pelvisDyV = Math.min(0, this.pelvisDyV); }
    }
    const off = new THREE.Vector3(0, this.pelvisDy, 0).addScaledVector(right, shift);
    if (this.poses.pelvisOffset) off.add(this.poses.pelvisOffset);
    translateBoneWorld(B.Hips, off);
    B.Hips.updateWorldMatrix(false, true);
    // pelvis tilt toward the unweighted side when shifting weight
    rotateBoneAxis(B.Hips, fwd, -shift * 1.2);
    B.Hips.updateWorldMatrix(false, true);
    void hipsW;
  }

  // --- legs -----------------------------------------------------------------------
  solveLeg(f) {
    const B = this.B, L = LEG[f.s];
    const fwd = _v3.set(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    solveTwoBone(B[L.up], B[L.knee], B[L.foot], f.ankle, fwd, 1, f.ik || (f.ik = {}));
    // swivel the knee toward the foot's pointing direction (twisted stances)
    const hip = B[L.up].getWorldPosition(_v1), knee = B[L.knee].getWorldPosition(_v2), ank = B[L.foot].getWorldPosition(new THREE.Vector3());
    const axis = ank.clone().sub(hip);
    const al = axis.length();
    if (al > 0.2) {
      axis.divideScalar(al);
      const kd = knee.clone().sub(hip); kd.addScaledVector(axis, -kd.dot(axis));
      const footFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(f.q); footFwd.y = 0;
      const want = footFwd.normalize().lerp(fwd, 0.5); want.addScaledVector(axis, -want.dot(axis));
      if (kd.lengthSq() > 1e-6 && want.lengthSq() > 1e-6) {
        kd.normalize(); want.normalize();
        let ang = Math.acos(clamp(kd.dot(want), -1, 1));
        if (new THREE.Vector3().crossVectors(kd, want).dot(axis) < 0) ang = -ang;
        rotateBoneAxis(B[L.up], axis, clamp(ang, -0.6, 0.6) * 0.8);
        B[L.up].updateWorldMatrix(false, true);
      }
    }
    setBoneWorldQuaternion(B[L.foot], f.q);
    B[L.foot].updateWorldMatrix(false, true);
    this.toeRoll(f);
  }

  /** Bend the toes so the tip never dips below the ground (push-off, kneeling). */
  toeRoll(f) {
    const L = LEG[f.s], B = this.B;
    const tip = B[L.tip].getWorldPosition(_v1);
    const gy = (f.planted || (f.swing && f.swing.s > 0.85)) ? this.ground(tip.x, tip.z) + 0.006 : -Infinity;
    const floorY = Math.max(gy, this.poses.toeFloor?.(f) ?? -Infinity);
    if (tip.y >= floorY) return;
    const toe = B[L.toe];
    const tp = toe.getWorldPosition(_v2);
    const d0 = _v3.copy(tip).sub(tp);
    const len = d0.length();
    const dy = floorY - tp.y;
    if (Math.abs(dy) >= len) return;
    const horiz = Math.sqrt(len * len - dy * dy);
    const hdir = _v4.set(d0.x, 0, d0.z);
    if (hdir.lengthSq() < 1e-8) return;
    hdir.normalize().multiplyScalar(horiz).setY(dy);
    const axis = new THREE.Vector3().crossVectors(d0, hdir);
    if (axis.lengthSq() < 1e-10) return;
    rotateBoneAxis(toe, axis.normalize(), d0.angleTo(hdir));
    toe.updateWorldMatrix(false, true);
  }

  // --- upper body -----------------------------------------------------------------
  upperBody(dt) {
    const p = this.player, B = this.B;
    const fwd = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    const side = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    // lean from acceleration: trunk tips forward from the hips, head stays level
    rotateBoneAxis(B.Spine, side, this.lean * 0.7);
    rotateBoneAxis(B.Spine, fwd, -this.bank * 0.6);
    B.Spine.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Spine1, side, this.lean * 0.3);
    B.Spine1.updateWorldMatrix(false, true);
    // breathing: slow when calm, deeper after running
    const br = this.breath = (this.breath || 0) + dt * TAU * lerp(0.23, 0.55, this.exertion);
    const depth = lerp(0.012, 0.035, this.exertion) * (1 - this.locoW * 0.6);
    rotateBoneAxis(B.Spine2, side, -Math.sin(br) * depth);
    B.Spine2.updateWorldMatrix(false, true);
    for (const s of ['Left', 'Right']) {
      rotateBoneAxis(B[s + 'Shoulder'], fwd, (s === 'Left' ? 1 : -1) * Math.max(0, Math.sin(br)) * depth * 0.6);
    }
    B.Spine2.updateWorldMatrix(false, true);
    this.applyLook(dt);
  }

  applyLook(dt) {
    const p = this.player, B = this.B;
    let ty = 0, tp = 0;
    const lt = p.lookTarget || this.poses.idleLook?.(dt);
    if (lt) {
      const head = B.Head.getWorldPosition(_v1);
      const d = _v2.copy(lt).sub(head);
      const yawTo = Math.atan2(d.x, d.z);
      const rel = angleDiff(this.bodyYaw, yawTo);
      ty = Math.abs(rel) > 2.2 ? 0 : clamp(rel, -1.15, 1.15);
      tp = clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.5, 0.8);
    }
    // the head leads a turn
    const turn = angleDiff(p.yaw, p.desiredYaw ?? p.yaw);
    if (p.moveIntent && Math.abs(turn) > 0.15) ty = clamp(ty * 0.3 + turn * 0.75, -1.0, 1.0);
    const look = this.look || (this.look = { yaw: 0, pitch: 0, vy: 0, vp: 0 });
    // quick start, soft settle (saccade-like head turn)
    const k = 90, c = 2 * Math.sqrt(k) * 0.9;
    look.vy += (k * (ty - look.yaw) - c * look.vy) * dt; look.yaw += look.vy * dt;
    look.vp += (k * (tp - look.pitch) - c * look.vp) * dt; look.pitch += look.vp * dt;
    const right = _v3.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    rotateBoneAxis(B.Spine2, UP, look.yaw * 0.22);
    B.Spine2.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Neck, UP, look.yaw * 0.33);
    rotateBoneAxis(B.Neck, right, look.pitch * 0.4);
    B.Neck.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Head, UP, look.yaw * 0.45);
    rotateBoneAxis(B.Head, right, look.pitch * 0.6);
    const tilt = this.poses.headTilt || 0;
    if (tilt) rotateBoneAxis(B.Head, _v4.set(Math.sin(this.bodyYaw + look.yaw), 0, Math.cos(this.bodyYaw + look.yaw)), tilt);
    B.Head.updateWorldMatrix(false, true);
  }

  get handPosition() { return this.B.RightHand.getWorldPosition(new THREE.Vector3()); }
}

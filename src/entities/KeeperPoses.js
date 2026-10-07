// Interaction poses layered on KeeperMotion: kneeling (or a half crouch for
// bigger animals), offering food with the right hand, stroking, and idle life.
//
// Kneel: the right knee goes down to the ground with the shin lying back and
// the toes tucked; the left foot steps forward and stays flat with the knee
// up; the left forearm rests on that knee. Getting down is staged (the trunk
// leans and the front foot steps before the pelvis drops); standing up drives
// the pelvis first and straightens the trunk last.
//
// Inputs come from the Player: crouchTarget, offerTarget, petTarget,
// armTarget (world point for the stroking hand), lookTarget.
import * as THREE from 'three';
import { solveTwoBone, rotateBoneAxis } from '../util/ik.js';
import { damp, clamp, smoothstep, angleDiff } from '../util/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

// world-space kneel geometry (metres)
const KNEEL = {
  frontStep: 0.24,   // the front (left) foot steps this far forward
  backKnee: 0.04,    // kneeling (right) knee lands just ahead of the hip
  kneeH: 0.05,       // knee joint height above the ground when kneeling
  ankleH: 0.085,     // back ankle height with the toes tucked
};

export class KeeperPoses {
  constructor(motion) {
    this.m = motion;
    this.drop = 0;     // pelvis / legs (0 standing .. 1 kneeling)
    this.bend = 0;     // trunk lean, leads going down, lags coming up
    this.offerW = 0;
    this.petW = 0;
    this.active = false;
    this.shift = 0;
    this.pelvisDy = 0;
    this.pelvisOffset = new THREE.Vector3();
    this.pelvisAbs = null; // pelvis height offset for a full kneel (KeeperMotion lerps by drop)
    this.headTilt = 0;
    this.crouchAmount = 0; this.offerAmount = 0; this.petAmount = 0;
    this.stroke = 0;
    this.ik = { L: {}, R: {}, armR: {}, armL: {} };
    this.glanceT = 4; this.glance = null;
  }

  bodyYaw(yaw) { return yaw; }

  /** Advance pose weights; called before the legs are placed. */
  advance(dt) {
    const p = this.m.player;
    let goal = clamp(p.crouchTarget || 0, 0, 1);
    // face the animal first (stepping round on the spot), then get down
    if (p.faceTarget && this.drop < 0.1) {
      const want = Math.atan2(p.faceTarget.x - p.pos.x, p.faceTarget.z - p.pos.z);
      const feet = this.m.feet;
      const squared = ['L', 'R'].every((k) => !feet[k].swing && Math.abs(angleDiff(feet[k].yaw, p.yaw)) < 0.4);
      if (Math.abs(angleDiff(p.yaw, want)) > 0.3 || !squared) goal = 0;
    }
    const down = goal > this.drop;
    // staged: going down the trunk leads, coming up the pelvis leads
    this.bend = damp(this.bend, goal, down ? 4.2 : 2.2, dt);
    this.drop = damp(this.drop, goal, down ? (this.bend > goal * 0.35 ? 2.8 : 0.9) : 3.2, dt);
    if (Math.abs(this.drop - goal) < 0.002) this.drop = goal;
    const settled = smoothstep(0.55, 0.92, this.drop / Math.max(0.3, goal || 1));
    this.offerW = damp(this.offerW, (p.offerTarget || 0) * (goal > 0 ? settled : 1), 4, dt);
    this.petW = damp(this.petW, (p.petTarget || 0) * (goal > 0 ? settled : 1), 5, dt);
    this.active = this.drop > 0.02 || goal > 0;
    this.pending = (p.crouchTarget || 0) > 0 && goal === 0; // waiting to face the animal
    this.crouchAmount = this.drop; this.offerAmount = this.offerW; this.petAmount = this.petW;
    this.pelvisDy = 0;
    this.headTilt = 0.14 * Math.max(this.offerW, this.petW * 0.6);
  }

  /** Move the feet for the kneel (after the planner, before the pelvis solve). */
  updateLegs(dt) {
    this.advance(dt);
    const k = this.drop;
    const m = this.m, p = m.player;
    const yaw = m.bodyYaw;
    const fwd = _a.set(Math.sin(yaw), 0, Math.cos(yaw));
    const left = _b.set(Math.cos(yaw), 0, -Math.sin(yaw)); // +X model = keeper's left
    // pelvis back a touch so the weight sits between knee and front foot
    this.pelvisOffset.copy(fwd).multiplyScalar(-0.04 * k);
    const L = m.feet.L, R = m.feet.R;
    if (k < 0.002) { this.pelvisAbs = null; R.kneeling = 0; return; }
    // front (left) foot: a small step forward, lifted mid-way
    const lift = 0.07 * Math.sin(Math.PI * clamp(k * 1.6, 0, 1)) * (k < 0.62 ? 1 : 0);
    const stepK = smoothstep(0.0, 0.62, k);
    const above = L.ankle.y - m.ground(L.ankle.x, L.ankle.z);
    L.ankle.addScaledVector(fwd, KNEEL.frontStep * stepK);
    L.ankle.y = m.ground(L.ankle.x, L.ankle.z) + above + lift;
    // back (right) leg: knee on the ground just ahead of the hip, shin lying
    // back along the ground, toes tucked. The hip sits a thigh-length above.
    const B = m.B;
    const hipP = B.RightUpLeg.getWorldPosition(new THREE.Vector3());
    const thigh = hipP.distanceTo(B.RightLeg.getWorldPosition(_c));
    const shin = B.RightLeg.getWorldPosition(_c).distanceTo(B.RightFoot.getWorldPosition(new THREE.Vector3()));
    const knee = p.pos.clone().addScaledVector(left, -0.1).addScaledVector(fwd, KNEEL.backKnee);
    knee.y = m.ground(knee.x, knee.z) + KNEEL.kneeH;
    // full-kneel crouch depth (lighter crouches scale it through drop)
    const depth = clamp(p.crouchTarget || this.drop, 0, 1);
    this.pelvisAbs = (knee.y + Math.sqrt(thigh * thigh - KNEEL.backKnee * KNEEL.backKnee) - hipP.y) * depth;
    const rise = KNEEL.ankleH - KNEEL.kneeH;
    const ankle = knee.clone().addScaledVector(fwd, -Math.sqrt(Math.max(0, shin * shin - rise * rise)) * 0.995);
    ankle.y = m.ground(ankle.x, ankle.z) + KNEEL.ankleH;
    const kk = smoothstep(0.25, 1, k) * depth;
    R.ankle.lerp(ankle, kk);
    // foot pitched toe-down so the ball rests on the ground behind the knee
    _q.setFromAxisAngle(left, 1.25 * kk);
    R.q.premultiply(_q);
    R.kneeling = kk;
  }

  toeFloor(f) {
    if (f.s === 'R' && (f.kneeling || 0) > 0.05) return this.m.ground(f.ankle.x, f.ankle.z) + 0.006;
    return -Infinity;
  }

  /** Trunk, arms and head (after the legs and the base upper body). */
  updateUpper(dt) {
    const m = this.m, p = m.player, B = m.B;
    const yaw = m.bodyYaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const right = left.clone().negate();
    const k = this.bend;
    if (k > 0.002) {
      // lean the trunk over the front knee, then lift the head back up
      rotateBoneAxis(B.Spine, left, 0.3 * k);
      rotateBoneAxis(B.Spine1, left, 0.14 * k);
      B.Spine.updateWorldMatrix(false, true);
      rotateBoneAxis(B.Neck, left, -0.22 * k);
      B.Neck.updateWorldMatrix(false, true);
    }
    // left hand rests on the raised left knee
    const rest = smoothstep(0.5, 0.95, this.drop) * (p.crouchTarget > 0.6 ? 1 : 0.6);
    if (rest > 0.01) {
      const kneeL = B.LeftLeg.getWorldPosition(new THREE.Vector3());
      const hand = B.LeftHand.getWorldPosition(new THREE.Vector3());
      const goal = kneeL.clone().addScaledVector(fwd, 0.03).addScaledVector(right, 0.02).setY(kneeL.y + 0.07);
      solveTwoBone(B.LeftArm, B.LeftForeArm, B.LeftHand, hand.lerp(goal, rest), new THREE.Vector3(0, -1, 0).addScaledVector(left, 0.6), 1, this.ik.armL);
      B.LeftHand.updateWorldMatrix(false, true);
    }
    // right hand: offering palm up, or stroking along the animal's head and back
    const w = Math.max(this.offerW, this.petW);
    if (w > 0.01) {
      let target;
      if (p.armTarget) target = p.armTarget.clone();
      else target = p.pos.clone().addScaledVector(fwd, 0.6).addScaledVector(right, 0.1).setY(p.pos.y + 0.3 + 0.55 * (1 - this.drop));
      const hand = B.RightHand.getWorldPosition(new THREE.Vector3());
      // elbow hangs down and out, never through the body
      const pole = new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.5);
      solveTwoBone(B.RightArm, B.RightForeArm, B.RightHand, hand.lerp(target, w), pole, 1, this.ik.armR);
      B.RightHand.updateWorldMatrix(false, true);
      const fa = B.RightHand.getWorldPosition(_a).sub(B.RightForeArm.getWorldPosition(_b)).normalize();
      if (this.offerW > 0.01) {
        // palm up, fingers relaxed toward the animal
        rotateBoneAxis(B.RightHand, fa, -1.45 * this.offerW);
      } else if (this.petW > 0.01) {
        // wrist follows the stroke: fingers trail slightly behind the hand
        const v = p.armTarget && this.prevArm ? p.armTarget.clone().sub(this.prevArm) : new THREE.Vector3();
        this.stroke = damp(this.stroke, clamp(v.dot(fwd) / Math.max(dt, 1e-3) * 0.6, -0.5, 0.5), 8, dt);
        rotateBoneAxis(B.RightHand, new THREE.Vector3().crossVectors(fa, UP).normalize(), (0.35 + this.stroke) * this.petW);
      }
      B.RightHand.updateWorldMatrix(false, true);
    }
    this.prevArm = p.armTarget ? (this.prevArm || new THREE.Vector3()).copy(p.armTarget) : null;
  }

  /** Idle life: an occasional glance around when standing with nothing to look at. */
  idleLook(dt = 1 / 60) {
    const m = this.m, p = m.player;
    if (m.mode !== 'stand' || this.active) { this.glanceT = 3 + Math.random() * 3; this.glance = null; return null; }
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      if (this.glance) { this.glance = null; this.glanceT = 3 + Math.random() * 5; }
      else {
        const a = p.yaw + (Math.random() - 0.5) * 2.0;
        this.glance = p.pos.clone().add(new THREE.Vector3(Math.sin(a) * 6, 1.2 + Math.random() * 1.2, Math.cos(a) * 6));
        this.glanceT = 1.2 + Math.random() * 1.6;
      }
    }
    return this.glance;
  }
}

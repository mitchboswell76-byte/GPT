// Limb solvers for the quadruped rig. World-space and rig-agnostic: bones are
// rotated about their own pivots with minimal rotations, so the bind pose's
// twist is preserved and nothing accumulates across frames.
import * as THREE from 'three';
import { rotateBoneWorld } from '../util/ik.js';

const _o = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3();
const _u = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const _knee = new THREE.Vector3(), _goal = new THREE.Vector3();

/** Rotate `bone` about its origin so world point `from` swings onto the ray toward `to`. */
export function aimBone(bone, from, to, weight = 1) {
  bone.getWorldPosition(_o);
  _d1.subVectors(from, _o);
  _d2.subVectors(to, _o);
  if (_d1.lengthSq() < 1e-14 || _d2.lengthSq() < 1e-14) return;
  _q.setFromUnitVectors(_d1.normalize(), _d2.normalize());
  if (weight < 1) _q.slerp(IDENT, 1 - weight);
  rotateBoneWorld(bone, _q);
  bone.updateWorldMatrix(false, true);
}
const IDENT = new THREE.Quaternion();

/** World position of a limb tip: a bone, or a point in `lower`'s local space. */
export function tipWorld(lower, tip, out) {
  return tip.isObject3D ? tip.getWorldPosition(out) : lower.localToWorld(out.copy(tip));
}

/**
 * Two-bone limb toward `target` with an explicit hinge. `hinge` is a world
 * axis (the body's lateral axis); the middle joint bends to the side of
 * sign·(hinge × dir) — backward elbows use +1, forward stifles −1. Reach is
 * softened near full extension so the limb never snaps straight; returns the
 * distance by which the target was not reached.
 */
export function solveLimb(upper, lower, tip, target, hinge, sign, soft = 0.04) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_A);
  lower.getWorldPosition(_B);
  tipWorld(lower, tip, _C);
  const a = _A.distanceTo(_B), b = _B.distanceTo(_C);
  _u.subVectors(target, _A);
  const dist = _u.length();
  if (dist < 1e-6) return 0;
  _u.divideScalar(dist);
  const Lm = a + b, sl = Lm * soft, ds = Lm - sl;
  let dd = dist > ds ? ds + sl * (1 - Math.exp(-(dist - ds) / sl)) : dist;
  dd = Math.max(dd, Math.abs(a - b) + 1e-5);
  const cosA = THREE.MathUtils.clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _n.copy(hinge).addScaledVector(_u, -hinge.dot(_u));
  if (_n.lengthSq() < 1e-10) _n.set(1, 0, 0);
  _n.normalize();
  _p.crossVectors(_n, _u).multiplyScalar(sign);
  _knee.copy(_A).addScaledVector(_u, a * cosA).addScaledVector(_p, a * sinA);
  aimBone(upper, _B, _knee);
  tipWorld(lower, tip, _C);
  _goal.copy(_A).addScaledVector(_u, dd);
  aimBone(lower, _C, _goal);
  return dist - dd;
}

/** Distance from the limb root to the target, relative to full reach. */
export function reachRatio(upper, lower, tip, target) {
  upper.getWorldPosition(_A);
  lower.getWorldPosition(_B);
  tipWorld(lower, tip, _C);
  return _A.distanceTo(target) / (_A.distanceTo(_B) + _B.distanceTo(_C));
}

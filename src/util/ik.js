// Rig-agnostic bone helpers. Everything works on world-space vectors so the
// same code drives the Mixamo player and both dog skeletons regardless of
// their bone axis conventions.
import * as THREE from 'three';

const _pq = new THREE.Quaternion();
const _t = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _u = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Apply a world-space rotation to a bone about its own pivot. */
export function rotateBoneWorld(bone, qWorld) {
  bone.parent.getWorldQuaternion(_pq);
  _t.copy(_pq).invert().multiply(qWorld).multiply(_pq);
  bone.quaternion.premultiply(_t);
}

/** Set a bone's world rotation exactly. */
export function setBoneWorldQuaternion(bone, qWorld) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(qWorld));
}

/** Rotate a bone (world space) about `axis` by `angle` radians. */
export function rotateBoneAxis(bone, axis, angle) {
  if (Math.abs(angle) < 1e-6) return;
  _q.setFromAxisAngle(axis, angle);
  rotateBoneWorld(bone, _q);
}

/** Move a bone's origin by a world-space offset (scaled into parent space). */
export function translateBoneWorld(bone, worldDelta) {
  bone.parent.updateWorldMatrix(true, false);
  _m.copy(bone.parent.matrixWorld).invert();
  const start = bone.getWorldPosition(_a);
  const end = _b.copy(start).add(worldDelta);
  bone.position.copy(end.applyMatrix4(_m));
}

export function updateChain(bone) { bone.updateWorldMatrix(false, true); }

/**
 * Two-bone IK. `upper` and `lower` are bones; `tip` is either a bone (child
 * of lower) or a Vector3 in `lower`'s local space marking the end effector.
 * Bends in the plane of the current pose; `hint` (world vector) is used when
 * the limb is nearly straight. Returns the reached world position.
 */
export function solveTwoBone(upper, lower, tip, target, hint = null, weight = 1, state = null) {
  upper.updateWorldMatrix(true, true);
  const a = upper.getWorldPosition(_a.clone());
  const b = lower.getWorldPosition(_b.clone());
  const c = tip.isObject3D ? tip.getWorldPosition(_c.clone()) : lower.localToWorld(_c.copy(tip));
  const lab = a.distanceTo(b), lbc = b.distanceTo(c);
  const t = _d.copy(target).sub(a);
  let dist = t.length();
  if (dist < 1e-5) return c;
  const u = _u.copy(t).divideScalar(dist);
  dist = THREE.MathUtils.clamp(dist, Math.abs(lab - lbc) + 1e-4, lab + lbc - 1e-4);

  // bend plane normal from current pose
  const n = _n.copy(b).sub(a).cross(_e.copy(c).sub(a));
  if (n.lengthSq() < 1e-10 * lab * lab) {
    if (state?.n) n.copy(state.n); else if (hint) n.copy(hint); else n.set(1, 0, 0);
  }
  n.normalize();
  if (state) { state.n = state.n || new THREE.Vector3(); state.n.copy(n); }
  // make n perpendicular to u
  n.addScaledVector(u, -n.dot(u)).normalize();
  if (n.lengthSq() < 0.5) return c;

  const cosA = THREE.MathUtils.clamp((lab * lab + dist * dist - lbc * lbc) / (2 * lab * dist), -1, 1);
  const angA = Math.acos(cosA);
  const kneeDir = u.clone().applyAxisAngle(n, -angA);
  const bTarget = a.clone().addScaledVector(kneeDir, lab);

  // rotate upper so a->b points at bTarget
  _q.setFromUnitVectors(b.clone().sub(a).normalize(), kneeDir);
  if (weight < 1) _q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateBoneWorld(upper, _q);
  upper.updateWorldMatrix(false, true);

  const b2 = lower.getWorldPosition(new THREE.Vector3());
  const c2 = tip.isObject3D ? tip.getWorldPosition(new THREE.Vector3()) : lower.localToWorld(new THREE.Vector3().copy(tip));
  const goal = a.clone().addScaledVector(u, dist);
  _q.setFromUnitVectors(c2.sub(b2).normalize(), goal.sub(b2).normalize());
  if (weight < 1) _q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateBoneWorld(lower, _q);
  lower.updateWorldMatrix(false, true);
  return tip.isObject3D ? tip.getWorldPosition(new THREE.Vector3()) : lower.localToWorld(new THREE.Vector3().copy(tip));
}

/** Rotate `bone` so the direction toward `child` points at `target` (world). */
export function aimBone(bone, childOrLocal, target, weight = 1) {
  bone.updateWorldMatrix(true, true);
  const p = bone.getWorldPosition(new THREE.Vector3());
  const c = childOrLocal.isObject3D ? childOrLocal.getWorldPosition(new THREE.Vector3()) : bone.localToWorld(childOrLocal.clone());
  const q = new THREE.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize());
  if (weight < 1) q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateBoneWorld(bone, q);
  bone.updateWorldMatrix(false, true);
}

/** Place a bone's origin at a world position. */
export function setBoneWorldPosition(bone, worldPos) {
  bone.parent.updateWorldMatrix(true, false);
  bone.position.copy(bone.parent.worldToLocal(worldPos.clone()));
}

// Secondary motion: damped spring chains for tails and ears.
//
// Each bone's tip is a point mass in world space pulled toward where the
// animated pose (bind pose + clip + any kinematic drive applied before the
// update) would put it. Because the masses live in world space, body motion
// — bobbing, turning, a head shake — makes them lag and overshoot by
// themselves; each child is pulled toward its parent's *simulated* frame, so
// motion travels down the chain as a wave.
import * as THREE from 'three';
import { rotateBoneWorld } from '../util/ik.js';

const _O = new THREE.Vector3(), _T = new THREE.Vector3(), _dT = new THREE.Vector3(), _dP = new THREE.Vector3();
const _acc = new THREE.Vector3(), _q = new THREE.Quaternion(), _tmp = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class SpringChain {
  /**
   * bones: parent → child order. opts: { freq (Hz, base), freqFalloff (per
   * link), damping (ratio), gravity (0..1 bias of the rest direction toward
   * world down), maxAngle (rad from the animated direction), tipScale }
   */
  constructor(bones, opts = {}) {
    this.bones = bones;
    this.o = { freq: 4, freqFalloff: 0.85, damping: 0.35, gravity: 0, maxAngle: 1.3, tipScale: 1, ...opts };
    this.links = bones.map((b, i) => {
      const child = bones[i + 1];
      let local;
      if (child) local = child.position.clone();
      else {
        // last bone: extend along the direction of the previous link
        const prev = bones[i - 1] ? bones[i].position.length() : 0.05;
        local = new THREE.Vector3(0, 1, 0).multiplyScalar(prev * this.o.tipScale);
        const kids = b.children.filter((c) => c.isBone);
        if (kids[0]) local.copy(kids[0].position);
      }
      return { local, p: new THREE.Vector3(), v: new THREE.Vector3(), len: 0 };
    });
    this.ready = false;
  }

  reset() { this.ready = false; }

  /**
   * dt: seconds. drive: optional (index, targetDir:Vector3) => void, which
   * may bend the target direction of a link (e.g. a wag or tuck).
   * collide: optional (index, point:Vector3) => void to push a tip out of
   * the body.
   */
  update(dt, { drive = null, collide = null, gravity = this.o.gravity, freqScale = 1, scale = 1 } = {}) {
    const { freq, freqFalloff, damping, maxAngle } = this.o;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i], L = this.links[i];
      b.updateWorldMatrix(true, false);
      b.getWorldPosition(_O);
      b.localToWorld(_T.copy(L.local));
      _dT.subVectors(_T, _O);
      const len = _dT.length();
      if (len < 1e-7) continue;
      _dT.divideScalar(len);
      if (drive) drive(i, _dT);
      if (gravity > 0) _dT.lerp(DOWN, gravity).normalize();
      L.len = len;
      if (!this.ready || dt <= 0) {
        L.p.copy(_O).addScaledVector(_dT, len); L.v.set(0, 0, 0);
      } else {
        const w = 2 * Math.PI * freq * freqScale * Math.pow(freqFalloff, i);
        const k = w * w, c = 2 * damping * w;
        _T.copy(_O).addScaledVector(_dT, len);
        for (let s = 0; s < steps; s++) {
          _acc.subVectors(_T, L.p).multiplyScalar(k).addScaledVector(L.v, -c);
          L.v.addScaledVector(_acc, h);
          L.p.addScaledVector(L.v, h);
        }
        // keep the link length and limit its bend from the animated direction
        _dP.subVectors(L.p, _O);
        const dl = _dP.length();
        if (dl < 1e-8) _dP.copy(_dT); else _dP.divideScalar(dl);
        const ang = Math.acos(THREE.MathUtils.clamp(_dP.dot(_dT), -1, 1));
        if (ang > maxAngle) {
          _q.setFromUnitVectors(_dT, _dP);
          _tmp.copy(_dT).applyQuaternion(_q.slerp(IDENT, 1 - maxAngle / ang));
          _dP.copy(_tmp).normalize();
        }
        L.p.copy(_O).addScaledVector(_dP, len);
        if (collide) { collide(i, L.p); _dP.subVectors(L.p, _O).normalize(); L.p.copy(_O).addScaledVector(_dP, len); }
        // drop velocity along the link (rigid length)
        L.v.addScaledVector(_dP, -L.v.dot(_dP));
      }
      // rotate the bone so its tip points at the simulated mass
      b.localToWorld(_T.copy(L.local));
      _dT.subVectors(_T, _O).normalize();
      _dP.subVectors(L.p, _O).normalize();
      _q.setFromUnitVectors(_dT, _dP);
      rotateBoneWorld(b, _q);
      b.updateWorldMatrix(false, true);
    }
    this.ready = dt > 0 || this.ready;
  }
}
const IDENT = new THREE.Quaternion();

/** Critically-damped scalar spring (value chases target). */
export class Spring {
  constructor(v = 0, freq = 3, damping = 1) { this.v = v; this.vel = 0; this.freq = freq; this.damping = damping; }
  update(target, dt, freq = this.freq, damping = this.damping) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    const w = 2 * Math.PI * freq, k = w * w, c = 2 * damping * w;
    for (let i = 0; i < steps; i++) { this.vel += (k * (target - this.v) - c * this.vel) * h; this.v += this.vel * h; }
    return this.v;
  }
  snap(v) { this.v = v; this.vel = 0; }
}

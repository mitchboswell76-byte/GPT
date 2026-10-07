// Close third-person orbit camera for exploring, and a wider elevated camera
// for construction. Switching blends smoothly between the two.
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { damp, dampAngle, clamp } from '../util/noise.js';

const C = CONFIG.camera;

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.yaw = Math.PI * 0; // camera sits at player + (sin(yaw), , cos(yaw)) * d
    this.pitch = C.pitch;
    this.distance = C.distance; this.distanceTarget = C.distance;
    this.yawTarget = this.yaw; this.pitchTarget = this.pitch;
    this.lastUserInput = -10;
    this.build = { focus: new THREE.Vector3(10, 0, 22), yaw: 0.35, pitch: C.buildPitch, dist: C.buildDistance, distTarget: C.buildDistance };
    this.blend = 0; // 0 = explore, 1 = build
    this.focusOverride = null; // {pos, dist, weight}
    this.currentLook = new THREE.Vector3();
    this.currentPos = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.occluders = [];
    this.first = true;
  }

  snapBehindPlayer() {
    const p = this.game.player;
    this.yaw = this.yawTarget = p.yaw + Math.PI;
    this.first = true;
  }

  update(dt, rawDt) {
    const input = this.game.input;
    const m = input.mouse;
    const ui = this.game.ui;
    const building = this.game.mode === 'build';
    const dragging = (m.buttons.has(2) || (!building && m.buttons.has(0))) && !ui?.pointerCaptured();
    rawDt = rawDt || dt;
    if (!building) {
      if (dragging && (m.dx || m.dy)) {
        this.yawTarget -= m.dx * 0.0052;
        this.pitchTarget = clamp(this.pitchTarget + m.dy * 0.004, C.minPitch, C.maxPitch);
        this.lastUserInput = this.game.time;
      }
      if (m.wheel && !ui?.pointerCaptured()) this.distanceTarget = clamp(this.distanceTarget * (1 + m.wheel * 0.12), C.minDistance, C.maxDistance);
      // Gentle auto-follow when walking and the mouse has been idle.
      const p = this.game.player;
      if (p.speed > 0.4 && this.game.time - this.lastUserInput > 2.5) {
        const behind = p.yaw + Math.PI;
        let d = behind - this.yawTarget; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 2.2) this.yawTarget += d * Math.min(1, rawDt * 0.6);
      }
    } else {
      const b = this.build;
      if (dragging && (m.dx || m.dy)) { b.yaw -= m.dx * 0.005; b.pitch = clamp(b.pitch + m.dy * 0.003, 0.45, 1.35); }
      if (m.wheel && !ui?.pointerCaptured()) b.distTarget = clamp(b.distTarget * (1 + m.wheel * 0.12), C.buildMin, C.buildMax);
      let px = 0, pz = 0;
      if (input.anyDown('KeyW', 'ArrowUp')) pz -= 1;
      if (input.anyDown('KeyS', 'ArrowDown')) pz += 1;
      if (input.anyDown('KeyA', 'ArrowLeft')) px -= 1;
      if (input.anyDown('KeyD', 'ArrowRight')) px += 1;
      if (input.isDown('KeyQ')) b.yaw += rawDt * 1.4;
      if (input.isDown('KeyE')) b.yaw -= rawDt * 1.4;
      const sp = (b.dist * 0.9 + 6) * rawDt * (input.anyDown('ShiftLeft') ? 2 : 1);
      const cy = b.yaw;
      b.focus.x += (Math.cos(cy) * px + Math.sin(cy) * pz) * sp;
      b.focus.z += (-Math.sin(cy) * px + Math.cos(cy) * pz) * sp;
      const A = CONFIG.world.bounds;
      b.focus.x = clamp(b.focus.x, A.minX + 10, A.maxX - 10); b.focus.z = clamp(b.focus.z, A.minZ + 10, A.maxZ - 10);
      b.focus.y = this.game.world.terrain.heightAt(b.focus.x, b.focus.z);
      b.dist = damp(b.dist, b.distTarget, 8, rawDt);
    }

    this.blend = damp(this.blend, building ? 1 : 0, 4.5, rawDt);
    this.yaw = dampAngle(this.yaw, this.yawTarget, 12, rawDt);
    this.pitch = damp(this.pitch, this.pitchTarget, 12, rawDt);
    this.distance = damp(this.distance, this.distanceTarget, 8, rawDt);

    // Explore rig
    const p = this.game.player;
    const crouch = p.crouch;
    let dist = this.distance;
    const look = p.pos.clone();
    look.y += 1.5 - 0.5 * crouch;
    // Observe mode: frame a creature instead of the keeper
    const obs = this.observe;
    this.obsBlend = damp(this.obsBlend || 0, obs ? 1 : 0, 3, rawDt);
    if (obs || this.obsBlend > 0.01) {
      const c = obs || this.lastObserved;
      if (c) {
        this.lastObserved = c;
        const ol = c.pos.clone(); ol.y += c.height * 1.3;
        look.lerp(ol, this.obsBlend);
        dist = THREE.MathUtils.lerp(dist, THREE.MathUtils.clamp(this.distance * 0.6 + c.height * 3, 1.4, 6), this.obsBlend);
      }
    }
    if (this.focusOverride) {
      const f = this.focusOverride;
      f.weight = damp(f.weight, f.target ?? 1, 2.5, rawDt);
      if ((f.target ?? 1) === 0 && f.weight < 0.01) this.focusOverride = null;
      look.lerp(f.pos, f.weight);
      dist = THREE.MathUtils.lerp(dist, f.dist, f.weight);
    }
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shoulder = C.shoulder * clamp((dist - 1.2) / 3, 0.25, 1) * (1 - (this.obsBlend || 0)) * (1 - (this.focusOverride?.weight || 0));
    look.addScaledVector(right, shoulder);
    const pitch = this.pitch - 0.08 * crouch;
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    let ePos = look.clone().addScaledVector(off, dist);
    ePos = this.collide(look, ePos);
    const ground = this.game.world.groundAt(ePos.x, ePos.z) + 0.35;
    if (ePos.y < ground) ePos.y = ground;

    // Build rig
    const b = this.build;
    const bOff = new THREE.Vector3(Math.sin(b.yaw) * Math.cos(b.pitch), Math.sin(b.pitch), Math.cos(b.yaw) * Math.cos(b.pitch));
    const bLook = b.focus.clone();
    const bPos = bLook.clone().addScaledVector(bOff, b.dist);

    const k = this.blend * this.blend * (3 - 2 * this.blend);
    const targetPos = ePos.lerp(bPos, k);
    const targetLook = look.lerp(bLook, k);
    if (this.first) { this.currentPos.copy(targetPos); this.currentLook.copy(targetLook); this.first = false; }
    else {
      // light smoothing so small jitters don't reach the camera
      this.currentPos.lerp(targetPos, 1 - Math.exp(-28 * rawDt));
      this.currentLook.lerp(targetLook, 1 - Math.exp(-28 * rawDt));
    }
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.game.focus = building || k > 0.5 ? b.focus.clone() : (this.obsBlend > 0.5 && this.lastObserved ? this.lastObserved.pos.clone() : p.pos.clone());
  }

  collide(from, to) {
    const dir = to.clone().sub(from); let L = dir.length(); dir.divideScalar(L);
    if (this.occluders.length) {
      this.ray.set(from, dir); this.ray.far = L;
      const hit = this.ray.intersectObjects(this.occluders, true)[0];
      if (hit) L = Math.max(0.6, hit.distance - 0.25);
    }
    L = Math.min(L, this.clearLength(from, dir, L));
    return from.clone().addScaledVector(dir, L);
  }

  /** Distance along a ray before it enters a bush or trunk (vegetation). */
  clearLength(from, dir, L) {
    const veg = this.game.world.vegetation;
    if (!veg?.blocksCamera) return L;
    for (let t = 0.6; t <= L; t += 0.2) {
      if (veg.blocksCamera(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t)) return Math.max(0.6, t - 0.25);
    }
    return L;
  }

  /** Frame a two-subject moment (keeper and animal) from the side. */
  frameMoment(a, b, dist = 3) {
    // centre on the space just in front of the keeper, where the animal ends up
    const toB = b.clone().sub(a).setY(0);
    const mid = a.clone().addScaledVector(toB.normalize(), 0.75);
    mid.y = Math.min(a.y, b.y) + 0.55;
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    // Side-on views first (nearest to the current view), then over the
    // keeper's shoulder; take the first whose line of sight is clear of bushes.
    const d = (x) => Math.abs(Math.atan2(Math.sin(x - this.yaw), Math.cos(x - this.yaw)));
    const s1 = ang + Math.PI / 2 - 0.35, s2 = ang - Math.PI / 2 + 0.35;
    const cands = (d(s1) < d(s2) ? [s1, s2] : [s2, s1]).concat([ang + Math.PI - 0.5, ang + Math.PI + 0.5, ang + Math.PI, ang + Math.PI / 2 - 0.9, ang - Math.PI / 2 + 0.9]);
    const pitch = 0.28;
    let best = cands[0], bestLen = -1;
    for (const y of cands) {
      const dir = new THREE.Vector3(Math.sin(y) * Math.cos(pitch), Math.sin(pitch), Math.cos(y) * Math.cos(pitch));
      const len = this.clearLength(mid, dir, dist);
      if (len >= dist - 0.01) { best = y; bestLen = len; break; }
      if (len > bestLen) { bestLen = len; best = y; }
    }
    this.yawTarget = best;
    this.pitchTarget = pitch;
    this.lastUserInput = this.game.time + 4;
    this.focusOverride = { pos: mid, dist, weight: this.focusOverride?.weight || 0, target: 1 };
  }

  enterBuild() {
    const p = this.game.player.pos;
    this.build.focus.set(p.x, p.y, p.z).add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(8));
    this.build.yaw = this.yaw;
  }
}

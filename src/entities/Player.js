// The keeper: camera-relative movement with collision, turning that a body
// can actually do (rate-limited, turn in place before setting off), and
// KeeperMotion for everything visible (gaits, foot planting, poses).
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { damp, angleDiff, clamp, smoothstep, lerp } from '../util/noise.js';
import { KeeperMotion, GAIT_SPEED } from './KeeperMotion.js';
import { applyHairShading } from './HairShading.js';

const SPEEDS = [CONFIG.player.calmSpeed ?? GAIT_SPEED.calm, CONFIG.player.walkSpeed ?? GAIT_SPEED.walk, GAIT_SPEED.jog];

export class Player {
  constructor(game) {
    this.game = game;
    const inst = game.assets.instantiate('player');
    this.model = inst.scene;
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.root.add(this.model);
    game.scene.add(this.root);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        // the blended scalp edge must draw after the opaque head
        if (o.material?.name === 'HairScalp') { o.renderOrder = 1; }
      }
    });
    applyHairShading(this.model);
    const clip = (n) => inst.animations.find((a) => a.name === n);

    this.pos = new THREE.Vector3(CONFIG.start.playerPos[0], 0, CONFIG.start.playerPos[1]);
    this.yaw = CONFIG.start.playerYaw;
    this.desiredYaw = this.yaw;
    this.yawVel = 0;
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.targetSpeed = 0;
    this.moveIntent = 0;
    this.gaitTarget = 1;
    this.calm = false;
    this.crouch = 0; this.crouchTarget = 0;
    this.offer = 0; this.offerTarget = 0;
    this.pet = 0; this.petTarget = 0;
    this.armTarget = null;
    this.lookTarget = null;
    this.faceTarget = null;
    this.groundY = 0;
    this.trail = [];
    this.controlsEnabled = true;
    this.script = null; // debug harness: (player, dt) => { dx, dz, jog }

    this.motion = new KeeperMotion(this, { idle: clip(inst.def.clips.idle), walk: clip(inst.def.clips.walk) });
    this.bones = this.motion.B;
  }

  setPosition(x, z, yaw = this.yaw) {
    this.pos.set(x, this.game.world.groundAt(x, z), z);
    this.groundY = this.pos.y;
    this.yaw = this.desiredYaw = yaw;
    this.yawVel = 0; this.speed = 0; this.vel.set(0, 0, 0);
    this.trail.length = 0;
    this.motion.snap();
  }

  /** World-space movement intent from the keyboard (camera-relative). */
  readIntent(active) {
    const input = this.game.input;
    let ix = 0, iz = 0;
    if (active) {
      if (input.anyDown('KeyW', 'ArrowUp')) iz += 1;
      if (input.anyDown('KeyS', 'ArrowDown')) iz -= 1;
      if (input.anyDown('KeyA', 'ArrowLeft')) ix -= 1;
      if (input.anyDown('KeyD', 'ArrowRight')) ix += 1;
    }
    const len = Math.hypot(ix, iz);
    if (!len) return { dx: 0, dz: 0, jog: false };
    ix /= len; iz /= len;
    const cy = this.game.cameraRig.yaw;
    // camera-relative direction: forward is away from the camera
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    return { dx: fx * iz + rx * ix, dz: fz * iz + rz * ix, jog: input.anyDown('ShiftLeft', 'ShiftRight') };
  }

  update(dt) {
    const input = this.game.input;
    const active = this.controlsEnabled && !this.game.ui?.blocksMovement() && this.game.mode === 'explore';
    if (active && input.wasPressed('KeyC')) this.calm = !this.calm;
    const intent = this.script ? this.script(this, dt) : this.readIntent(active);
    const len = Math.hypot(intent.dx, intent.dz);
    this.moveIntent = len > 0 ? 1 : 0;
    this.gaitTarget = this.calm ? 0 : intent.jog ? 2 : 1;

    // --- heading -------------------------------------------------------------
    let face = null;
    if (len > 0) face = Math.atan2(intent.dx, intent.dz);
    else if (!this.controlsEnabled && this.faceTarget) face = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
    if (face !== null) this.desiredYaw = face;
    const turn = angleDiff(this.yaw, this.desiredYaw);
    // a body turns at a limited rate: quick pivots in place, gentler arcs at speed
    const maxRate = this.speed < 0.4 ? 4.4 : lerp(4.0, 2.7, clamp((this.speed - 0.4) / 2, 0, 1));
    const wantRate = face !== null ? clamp(turn * (len > 0 ? 8 : 5), -maxRate, maxRate) : 0;
    this.yawVel = damp(this.yawVel, wantRate, 16, dt);
    if (Math.abs(this.yawVel * dt) > Math.abs(turn) && Math.sign(this.yawVel) === Math.sign(turn)) this.yawVel = turn / Math.max(dt, 1e-4);
    this.yaw += this.yawVel * dt;

    // --- speed ----------------------------------------------------------------
    let targetSpeed = 0;
    if (len > 0) {
      targetSpeed = SPEEDS[this.gaitTarget];
      const a = Math.abs(turn);
      // from a standstill, face the way first (turning in place), then set off
      if (this.speed < 0.45 && a > 1.25) targetSpeed = 0;
      else targetSpeed *= 1 - 0.62 * smoothstep(0.45, 1.7, a);
    }
    if (this.motion.poses.active) targetSpeed = 0;
    this.targetSpeed = len > 0 ? Math.max(targetSpeed, 0.001) : 0;
    const accel = targetSpeed > this.speed ? (this.speed < 0.3 ? 3.6 : 4.4) : 6.5;
    this.speed = damp(this.speed, targetSpeed, accel, dt);
    if (this.speed < 0.01 && targetSpeed === 0) this.speed = 0;

    const step = this.speed * dt;
    const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
    const p = this.game.world.moveCircle(this.pos.x, this.pos.z, nx, nz, CONFIG.player.radius, (it) => it.tag !== 'gate-open');
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (dt > 0 && moved < step * 0.35 && step > 0) this.speed *= 0.6; // walking into something
    if (dt > 0) this.vel.set((p.x - this.pos.x) / dt, 0, (p.z - this.pos.z) / dt);
    this.pos.x = p.x; this.pos.z = p.z;
    const gy = this.game.world.groundAt(this.pos.x, this.pos.z);
    this.groundY = damp(this.groundY, gy, 14, dt);
    this.pos.y = this.groundY;

    // breadcrumb trail for followers
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.pos.x, last.z - this.pos.z) > 0.35) {
      this.trail.push({ x: this.pos.x, z: this.pos.z });
      if (this.trail.length > 120) this.trail.shift();
    }
    this.animate(dt);
  }

  animate(dt) {
    this.motion.update(dt);
    const P = this.motion.poses;
    this.crouch = P.crouchAmount ?? 0;
    this.offer = P.offerAmount ?? 0;
    this.pet = P.petAmount ?? 0;
  }

  get handPosition() { return this.bones.RightHand.getWorldPosition(new THREE.Vector3()); }
  get headPosition() { return this.bones.Head.getWorldPosition(new THREE.Vector3()); }
  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  serialize() { return { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3), calm: this.calm }; }
}

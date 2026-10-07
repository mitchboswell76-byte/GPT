// The keeper: movement synced to the Walking clip's ground speed, collision,
// and procedural layers (look-at, crouch with planted feet, offering hand).
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { damp, dampAngle, angleDiff, clamp, smoothstep } from '../util/noise.js';
import { solveTwoBone, rotateBoneAxis, translateBoneWorld, setBoneWorldQuaternion } from '../util/ik.js';
import { applyHairShading } from './HairShading.js';

const UP = new THREE.Vector3(0, 1, 0);
const WALK_CLIP_SPEED = CONFIG.player.walkSpeed;

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

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => inst.animations.find((a) => a.name === n);
    this.idle = this.mixer.clipAction(clip(inst.def.clips.idle));
    this.walk = this.mixer.clipAction(clip(inst.def.clips.walk));
    this.idle.play(); this.walk.play();
    this.walk.setEffectiveWeight(0);

    const B = {};
    this.model.traverse((o) => { if (o.isBone) B[o.name.replace('mixamorig', '')] = o; });
    this.bones = B;

    this.pos = new THREE.Vector3(...[CONFIG.start.playerPos[0], 0, CONFIG.start.playerPos[1]]);
    this.yaw = CONFIG.start.playerYaw;
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.moveIntent = 0;
    this.calm = false;
    this.crouch = 0; this.crouchTarget = 0;
    this.offer = 0; this.offerTarget = 0;
    this.pet = 0; this.petTarget = 0;
    this.lookTarget = null;
    this.look = { yaw: 0, pitch: 0 };
    this.groundY = 0;
    this.walkPhasePrev = 0;
    this.trail = [];
    this.controlsEnabled = true;
    this.ikState = { L: {}, R: {}, arm: {} };
  }

  setPosition(x, z, yaw = this.yaw) {
    this.pos.set(x, this.game.world.groundAt(x, z), z);
    this.groundY = this.pos.y;
    this.yaw = yaw;
    this.trail.length = 0;
  }

  update(dt) {
    const input = this.game.input;
    const cam = this.game.cameraRig;
    let ix = 0, iz = 0;
    const active = this.controlsEnabled && !this.game.ui?.blocksMovement() && this.game.mode === 'explore';
    if (active) {
      if (input.anyDown('KeyW', 'ArrowUp')) iz += 1;
      if (input.anyDown('KeyS', 'ArrowDown')) iz -= 1;
      if (input.anyDown('KeyA', 'ArrowLeft')) ix -= 1;
      if (input.anyDown('KeyD', 'ArrowRight')) ix += 1;
      if (input.wasPressed('KeyC')) this.calm = !this.calm;
    }
    const len = Math.hypot(ix, iz);
    const jog = active && input.anyDown('ShiftLeft', 'ShiftRight');
    let targetSpeed = 0;
    if (len > 0) {
      ix /= len; iz /= len;
      targetSpeed = this.calm ? CONFIG.player.calmSpeed : jog ? WALK_CLIP_SPEED * CONFIG.player.jogScale : WALK_CLIP_SPEED;
      if (this.crouch > 0.3) targetSpeed = Math.min(targetSpeed, 0.6);
      const cy = cam.yaw;
      // camera-relative direction: forward is away from the camera
      const fx = -Math.sin(cy), fz = -Math.cos(cy);
      const rx = Math.cos(cy), rz = -Math.sin(cy);
      const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
      const desiredYaw = Math.atan2(dx, dz);
      const turn = angleDiff(this.yaw, desiredYaw);
      this.yaw = dampAngle(this.yaw, desiredYaw, CONFIG.player.turnRate * (this.speed < 0.3 ? 1.4 : 1), dt);
      // slow down while turning sharply so feet don't skate
      targetSpeed *= 1 - 0.55 * smoothstep(0.6, 2.4, Math.abs(turn));
    }
    if (!this.controlsEnabled && this.faceTarget) {
      const want = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
      this.yaw = dampAngle(this.yaw, want, 5, dt);
    }
    this.speed = damp(this.speed, targetSpeed, targetSpeed > this.speed ? 5.5 : 8, dt);
    if (this.speed < 0.01) this.speed = 0;
    this.moveIntent = len > 0 ? 1 : 0;

    const step = this.speed * dt;
    const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
    const p = this.game.world.moveCircle(this.pos.x, this.pos.z, nx, nz, CONFIG.player.radius, (it) => it.tag !== 'gate-open');
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (dt > 0 && moved < step * 0.35 && step > 0) this.speed *= 0.6; // walking into something
    this.pos.x = p.x; this.pos.z = p.z;
    const gy = this.game.world.groundAt(this.pos.x, this.pos.z);
    this.groundY = damp(this.groundY, gy, 18, dt);
    this.pos.y = this.groundY;

    // breadcrumb trail for followers
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.pos.x, last.z - this.pos.z) > 0.35) {
      this.trail.push({ x: this.pos.x, z: this.pos.z });
      if (this.trail.length > 120) this.trail.shift();
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.animate(dt);
  }

  animate(dt) {
    // Blend idle/walk; walk playback rate tracks ground speed (no sliding).
    const w = smoothstep(0.04, 0.55, this.speed);
    this.walk.setEffectiveWeight(w);
    this.idle.setEffectiveWeight(1 - w);
    this.walk.timeScale = Math.max(0.35, this.speed / WALK_CLIP_SPEED);
    this.mixer.update(dt);

    // footstep events at the clip's heel strikes
    const ph = (this.walk.time / this.walk.getClip().duration) % 1;
    if (w > 0.4) for (const strike of [0.32, 0.81]) {
      if ((this.walkPhasePrev < strike && ph >= strike) || (this.walkPhasePrev > ph && (strike > this.walkPhasePrev || strike <= ph))) {
        this.game.events.emit('footstep', { who: 'player', x: this.pos.x, z: this.pos.z, speed: this.speed });
      }
    }
    this.walkPhasePrev = ph;

    this.crouch = damp(this.crouch, this.crouchTarget, 4, dt);
    this.offer = damp(this.offer, this.offerTarget, 5, dt);
    this.pet = damp(this.pet, this.petTarget, 5, dt);
    this.model.updateMatrixWorld(true);
    this.applyLook(dt);
    if (this.crouch > 0.01) this.applyCrouch();
    if (this.offer > 0.01 || this.pet > 0.01) this.applyArm();
  }

  applyLook(dt) {
    let ty = 0, tp = 0;
    if (this.lookTarget) {
      const head = this.bones.Head.getWorldPosition(new THREE.Vector3());
      const d = this.lookTarget.clone().sub(head);
      const yawTo = Math.atan2(d.x, d.z);
      ty = clamp(angleDiff(this.yaw, yawTo), -1.1, 1.1);
      if (Math.abs(angleDiff(this.yaw, yawTo)) > 2.0) ty = 0;
      tp = clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.5, 0.75);
    }
    this.look.yaw = damp(this.look.yaw, ty, 4, dt);
    this.look.pitch = damp(this.look.pitch, tp, 4, dt);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const B = this.bones;
    rotateBoneAxis(B.Spine2, UP, this.look.yaw * 0.25);
    B.Spine2.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Neck, UP, this.look.yaw * 0.35);
    rotateBoneAxis(B.Neck, right, this.look.pitch * 0.4);
    B.Neck.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Head, UP, this.look.yaw * 0.4);
    rotateBoneAxis(B.Head, right, this.look.pitch * 0.6);
    B.Head.updateWorldMatrix(false, true);
  }

  applyCrouch() {
    const B = this.bones, k = this.crouch;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // capture planted feet before moving the hips
    const feet = ['Left', 'Right'].map((s) => ({
      s, pos: B[s + 'Foot'].getWorldPosition(new THREE.Vector3()), q: B[s + 'Foot'].getWorldQuaternion(new THREE.Quaternion()),
    }));
    // drop the pelvis and shift it back slightly, lean the torso forward
    translateBoneWorld(B.Hips, new THREE.Vector3(0, -0.42 * k, 0).addScaledVector(fwd, -0.1 * k));
    B.Hips.updateWorldMatrix(false, true);
    rotateBoneAxis(B.Spine, right, 0.32 * k);
    rotateBoneAxis(B.Spine1, right, 0.12 * k);
    B.Hips.updateWorldMatrix(false, true);
    for (const f of feet) {
      // knees go forward: hint is the character's right axis
      solveTwoBone(B[f.s + 'UpLeg'], B[f.s + 'Leg'], B[f.s + 'Foot'], f.pos.clone().addScaledVector(fwd, 0.04 * k), right, 1, this.ikState[f.s[0]]);
      setBoneWorldQuaternion(B[f.s + 'Foot'], f.q);
      B[f.s + 'Foot'].updateWorldMatrix(false, true);
    }
    // counter-rotate the head to keep looking ahead
    rotateBoneAxis(B.Neck, right, -0.25 * k);
    B.Neck.updateWorldMatrix(false, true);
  }

  applyArm() {
    const B = this.bones;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const k = Math.max(this.offer, this.pet);
    let target;
    if (this.armTarget) target = this.armTarget.clone();
    else target = this.pos.clone().addScaledVector(fwd, 0.62).addScaledVector(right, -0.12).setY(this.pos.y + 0.55 + 0.4 * (1 - this.crouch));
    // rest hand position from the animated pose, blended toward the target
    const hand = B.RightHand.getWorldPosition(new THREE.Vector3());
    const goal = hand.lerp(target, k);
    solveTwoBone(B.RightArm, B.RightForeArm, B.RightHand, goal, new THREE.Vector3(0, -1, 0), 1, this.ikState.arm);
    // palm up when offering food
    if (this.offer > 0.01) {
      const fa = B.RightHand.getWorldPosition(new THREE.Vector3()).sub(B.RightForeArm.getWorldPosition(new THREE.Vector3())).normalize();
      rotateBoneAxis(B.RightHand, fa, -1.4 * this.offer);
      B.RightHand.updateWorldMatrix(false, true);
    }
  }

  get handPosition() { return this.bones.RightHand.getWorldPosition(new THREE.Vector3()); }
  get headPosition() { return this.bones.Head.getWorldPosition(new THREE.Vector3()); }
  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  serialize() { return { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3), calm: this.calm }; }
}

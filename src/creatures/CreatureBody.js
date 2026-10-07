// One rendered body of a creature: a model instance, its idle clip and its
// procedural rig. A creature normally has one body; during the puppy -> adult
// transition two bodies cross-fade while sharing the same root motion.
import * as THREE from 'three';
import { QuadrupedRig } from './QuadrupedRig.js';

export class CreatureBody {
  constructor(game, modelId, parent) {
    const inst = game.assets.instantiate(modelId);
    this.modelId = modelId;
    this.def = inst.def;
    this.model = inst.scene;
    this.holder = new THREE.Group();
    this.holder.name = 'holder:' + modelId;
    this.holder.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = inst.animations.find((a) => a.name === inst.def.clips.idle) || inst.animations[0];
    this.idle = this.mixer.clipAction(clip);
    this.idle.play();
    this.idle.time = Math.random() * clip.duration;

    // Bind-pose snapshot so procedural edits never accumulate across frames.
    this.bones = [];
    this.model.traverse((o) => {
      if (o.isBone) this.bones.push({ b: o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material = o.material.clone();
      }
    });

    this.rig = new QuadrupedRig(this.model, inst.def.rig);
    this.mixer.setTime(0);
    this.idle.time = 0;
    this.mixer.update(0);
    this.holder.updateMatrixWorld(true);
    this.rig.captureRest();
    parent.add(this.holder);
    this.opacity = 1;
    this.clipWeight = 1;
  }

  setOpacity(a) {
    const fading = a < 0.999;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.alphaHash !== fading) { m.alphaHash = fading; m.needsUpdate = true; }
      m.opacity = fading ? a : 1;
      o.castShadow = a > 0.5;
    });
    this.holder.visible = a > 0.01;
    this.opacity = a;
  }

  resetPose() {
    for (const r of this.bones) { r.b.position.copy(r.p); r.b.quaternion.copy(r.q); r.b.scale.copy(r.s); }
  }

  update(ctx) {
    this.resetPose();
    const cw = this.rig.def.clipWeight;
    const moving = Math.min(1, ctx.speed / 0.4);
    const posing = Math.max(ctx.pose.lie, ctx.pose.sleep, ctx.pose.sit, ctx.pose.eat);
    const target = THREE.MathUtils.lerp(cw.still, cw.moving, Math.max(moving, posing * 0.7));
    this.clipWeight += (target - this.clipWeight) * Math.min(1, ctx.dt * 4);
    this.idle.setEffectiveWeight(this.clipWeight);
    this.mixer.update(ctx.dt);
    this.rig.update({ ...ctx, holder: this.holder });
  }

  dispose() {
    this.holder.parent?.remove(this.holder);
    this.mixer.stopAllAction();
  }
}

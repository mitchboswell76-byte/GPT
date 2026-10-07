// Debug scene for the procedural rig: ?rigtest=dog_puppy&speed=1&pose=lie
import * as THREE from 'three';
import { CreatureBody } from './CreatureBody.js';
import { urlParam } from '../data/config.js';

export function startRigTest(game) {
  const id = urlParam('rigtest');
  const speed = +urlParam('speed', '0');
  const scale = +urlParam('scale', id === 'dog_adult' ? '0.28' : '1.15');
  const pose = { sit: 0, lie: 0, sleep: 0, eat: 0, bow: 0 };
  const pn = urlParam('pose'); if (pn) pose[pn] = 1;
  const root = new THREE.Group();
  game.scene.add(root);
  const body = new CreatureBody(game, id, root);
  const centre = new THREE.Vector3(9, 0, 12);
  const R = +urlParam('radius', '2.2');
  let th = 0;
  const camDist = +urlParam('cd', '2.2');
  const camYaw = +urlParam('cy', '90') * Math.PI / 180;
  const camH = +urlParam('ch', '0.5');
  const state = { pos: new THREE.Vector3(), yaw: 0 };
  const ground = (x, z) => game.world.groundAt(x, z);
  game.add({
    update(dt) {
      const prev = state.pos.clone();
      if (speed > 0) th += (speed / R) * dt;
      state.pos.set(centre.x + Math.sin(th) * R, 0, centre.z + Math.cos(th) * R);
      state.pos.y = ground(state.pos.x, state.pos.z);
      const vel = state.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-4)); vel.y = 0;
      state.yaw = speed > 0 ? th + Math.PI / 2 : 0;
      root.position.copy(state.pos); root.rotation.y = state.yaw;
      body.update({
        dt, time: game.time, rootObj: root, position: state.pos, yaw: state.yaw, yawRate: speed > 0 ? speed / R : 0,
        velocity: speed > 0 ? vel : new THREE.Vector3(), speed, scale, ground, pose,
        look: { target: null, weight: 0 }, tail: { wag: 0.35, freq: 2.5, height: 0.15 }, pant: speed > 1 ? 0.6 : 0, blink: 0, breath: 0.5,
      });
      const look = state.pos.clone().add(new THREE.Vector3(0, camH * 0.7, 0));
      game.camera.position.set(look.x + Math.sin(state.yaw + camYaw) * camDist, look.y + camH * 0.6, look.z + Math.cos(state.yaw + camYaw) * camDist);
      game.camera.lookAt(look);
      game.focus = state.pos.clone();
    },
  });
  window.__rig = body;
}

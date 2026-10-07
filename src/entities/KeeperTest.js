// Debug harness for the keeper's motion: ?keepertest=<scenario>
// Drives the real Player with scripted intent (no Session) and frames it with
// a fixed camera that follows at a set angle.
//   walk      straight line; &gait=calm|walk|jog
//   startstop walk 2.2 s, stop 1.8 s, repeat (&gait=)
//   turns     stand, turn 90 left, walk, stop, turn 180, walk, curve
//   circle    continuous curve (&r=radius)
//   idle      stand still (idle life)
//   offer     kneel and offer food to a dummy puppy
//   stroke    kneel and stroke a dummy puppy (&adult=1 for a half crouch)
//   terrain   walk over the porch step / bridge (&x=&z=&yaw=)
// Camera: &cd= distance, &cy= degrees around the keeper (90 = his left side,
// 0 = in front, 180 = behind), &ch= look height, &cf=1 camera fixed in the world.
import * as THREE from 'three';
import { Player } from './Player.js';
import { urlParam } from '../data/config.js';
import { CreatureBody } from '../creatures/CreatureBody.js';

export function startKeeperTest(game) {
  const scen = urlParam('keepertest', 'walk');
  game.mode = 'explore';
  game.ui = { blocksMovement: () => false };
  game.cameraRig = { yaw: Math.PI };
  const player = game.add(new Player(game));
  game.player = player;
  const x0 = +urlParam('x', '9'), z0 = +urlParam('z', '20'), yaw0 = +urlParam('yaw', '0') * Math.PI / 180;
  player.setPosition(x0, z0, yaw0);
  const gait = urlParam('gait', 'walk');
  const jog = gait === 'jog';
  player.calm = gait === 'calm';
  const camDist = +urlParam('cd', '3.4');
  const camYaw = +urlParam('cy', '90') * Math.PI / 180;
  const camH = +urlParam('ch', '0.95');
  const camFixed = urlParam('cf') === '1';
  let t = 0;
  const dirOf = (deg) => ({ dx: Math.sin(deg), dz: Math.cos(deg), jog });
  const none = { dx: 0, dz: 0, jog: false };
  // timeline helpers: [duration, intent | fn]
  const timeline = (segs) => () => {
    let acc = 0;
    for (const [d, v] of segs) { if (t < acc + d) return typeof v === 'function' ? v(t - acc) : v; acc += d; }
    return none;
  };
  let script = null;
  let dummy = null;
  if (scen === 'walk') script = () => dirOf(yaw0);
  else if (scen === 'startstop') script = timeline([[0.6, none], [2.2, dirOf(yaw0)], [1.8, none], [2.2, dirOf(yaw0)], [2.5, none], [2.0, dirOf(yaw0)], [99, none]]);
  else if (scen === 'turns') script = timeline([[0.8, none], [1.2, dirOf(yaw0 + Math.PI / 2)], [1.0, none], [1.6, dirOf(yaw0 + Math.PI)], [1.5, none], [2.0, dirOf(yaw0)], [2.5, (s) => dirOf(yaw0 + s * 1.1)], [99, none]]);
  else if (scen === 'turnwalk') script = timeline([[0.6, none], [1.6, dirOf(yaw0)], [1.6, dirOf(yaw0 + Math.PI / 2)], [1.6, dirOf(yaw0 - Math.PI / 2)], [99, none]]);
  else if (scen === 'circle') { const r = +urlParam('r', '3'); script = () => dirOf(yaw0 + t * ((jog ? 2.5 : player.calm ? 0.95 : 1.65) / r)); }
  else if (scen === 'idle') script = () => none;
  else if (scen === 'terrain') script = () => dirOf(yaw0);
  else if (scen === 'offer' || scen === 'stroke') {
    // a dummy puppy standing 1.2 m in front of the keeper
    const adult = urlParam('adult') === '1';
    const root = new THREE.Group(); game.scene.add(root);
    const body = new CreatureBody(game, adult ? 'dog_adult' : 'dog_puppy', root);
    const dd = +urlParam('dd', '1.15');
    const dp = new THREE.Vector3(x0 + Math.sin(yaw0) * dd, 0, z0 + Math.cos(yaw0) * dd);
    dp.y = game.world.groundAt(dp.x, dp.z);
    const dyaw = yaw0 + Math.PI;
    const height = adult ? 0.55 : 0.36;
    dummy = { root, body, pos: dp, yaw: dyaw, height };
    const head = () => dp.clone().add(new THREE.Vector3(Math.sin(dyaw) * height * 0.55, height * 0.95, Math.cos(dyaw) * height * 0.55));
    game.add({
      update(dt) {
        root.position.copy(dp); root.rotation.y = dyaw;
        body.update({ dt, time: game.time, rootObj: root, position: dp, yaw: dyaw, yawRate: 0, velocity: new THREE.Vector3(), speed: 0,
          scale: adult ? 0.27 : 1.3, ground: (x, z) => game.world.groundAt(x, z), pose: { sit: 0, lie: 0, sleep: 0, eat: 0, bow: 0 },
          look: { target: player.handPosition, weight: 0.8 }, tail: { wag: 0.5, freq: 3, height: 0.2 }, pant: 0.3, blink: 0, breath: 0.5 });
        // drive the keeper like CreatureSystem does
        const tIn = 0.6, tOut = +urlParam('hold', '6');
        const on = t > tIn && t < tIn + tOut;
        player.controlsEnabled = !on;
        if (scen === 'offer') {
          player.crouchTarget = on ? 1 : 0; player.offerTarget = on ? 1 : 0; player.armTarget = null;
          player.faceTarget = on ? dp.clone() : null; player.lookTarget = on ? head() : null;
        } else {
          player.crouchTarget = on ? (adult ? 0.45 : 0.85) : 0; player.faceTarget = on ? dp.clone() : null; player.lookTarget = on ? head() : null;
          const arrived = t > tIn + 1.2;
          if (on && arrived) {
            const back = new THREE.Vector3(-Math.sin(dyaw), 0, -Math.cos(dyaw));
            const k = 0.5 + 0.5 * Math.sin((t - tIn - 1.2) * 3.2);
            player.petTarget = 1;
            player.armTarget = head().add(new THREE.Vector3(0, height * 0.35 + 0.04, 0)).addScaledVector(back, height * (0.15 + 0.55 * k));
          } else { player.petTarget = on ? 0.25 : 0; player.armTarget = null; }
        }
      },
    });
    script = () => none;
  }
  player.script = (p, dt) => { t += dt; return script ? script() : none; };
  window.__ktT = () => t;
  const fixed = new THREE.Vector3(x0, 0, z0);
  game.add({
    lateUpdate() {
      const base = camFixed ? fixed : player.pos;
      const look = base.clone(); look.y = player.pos.y + camH;
      const ang = (camFixed ? yaw0 : player.yaw) + camYaw;
      game.camera.position.set(look.x + Math.sin(ang) * camDist, look.y + 0.12, look.z + Math.cos(ang) * camDist);
      game.camera.lookAt(look);
      game.focus = player.pos.clone();
    },
  });
  window.__keeper = player;
  window.__dummy = dummy;
}

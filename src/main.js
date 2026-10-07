import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/work-sans/400.css';
import '@fontsource/work-sans/500.css';
import '@fontsource/work-sans/600.css';
import './ui/styles.css';
import * as THREE from 'three';
import { Game } from './core/Game.js';
import { Session } from './core/Session.js';
import { urlParam } from './data/config.js';
import { startRigTest } from './creatures/RigTest.js';

const game = new Game(document.getElementById('viewport'));
window.__game = game;
window.__THREE = THREE; // debugging and playtest probes

if (urlParam('keepertest')) {
  // Debug: keeper motion harness (?keepertest=walk&speed=1.65&cy=90)
  await game.loadWorld(() => {}); await game.assets.loadModels(['player', 'dog_puppy']);
  (await import('./entities/KeeperTest.js')).startKeeperTest(game); game.start(); window.__ready = true;
} else if (urlParam('rigtest')) {
  // Debug: procedural rig viewer (?rigtest=dog_puppy&speed=1&pose=lie)
  await game.loadWorld(() => {});
  await game.assets.loadModels(['dog_puppy', 'dog_adult']);
  startRigTest(game);
  game.start();
  window.__ready = true;
} else {
  const session = new Session(game);
  window.__session = session;
  await session.init();
  const cam = urlParam('cam');
  if (cam) {
    // cam=x,y,z,tx,ty,tz in world space, or cam=head,dx,dy,dz,ty: offset from the
    // keeper's head in his own frame (dz forward), looking at the head + ty
    const v = cam.split(',').map(Number);
    const head = cam.startsWith('head');
    game.cameraRig.update = () => {
      if (head) {
        const p = game.player, h = p.headPosition, s = Math.sin(p.yaw), c = Math.cos(p.yaw);
        game.camera.position.set(h.x + v[1] * c + v[3] * s, h.y + v[2], h.z - v[1] * s + v[3] * c);
        game.camera.lookAt(h.x, h.y + (v[4] || 0), h.z);
      } else { game.camera.position.set(v[0], v[1], v[2]); game.camera.lookAt(v[3], v[4], v[5]); }
      game.focus = game.camera.position.clone();
    };
  }
}

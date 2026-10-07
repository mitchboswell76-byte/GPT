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

if (urlParam('rigtest')) {
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
    const v = cam.split(',').map(Number);
    game.cameraRig.update = () => { game.camera.position.set(v[0], v[1], v[2]); game.camera.lookAt(v[3], v[4], v[5]); game.focus = new THREE.Vector3(v[0], v[1], v[2]); };
  }
}

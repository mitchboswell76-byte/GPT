import * as THREE from 'three';
import { Game } from './core/Game.js';
import { urlParam } from './data/config.js';
import { Player } from './entities/Player.js';
import { CameraRig } from './entities/CameraRig.js';

const game = new Game(document.getElementById('viewport'));
window.__game = game;
await game.loadWorld((p, label) => console.log('load', p, label));
await game.assets.loadModels(['player', 'dog_puppy', 'dog_adult']);
game.mode = 'explore';
game.player = game.add(new Player(game));
game.player.setPosition(0.6, -2.6, Math.PI);
game.cameraRig = game.add(new CameraRig(game));
game.cameraRig.occluders = [game.world.outpost.cabin, game.world.outpost.shed];
game.cameraRig.snapBehindPlayer();
const cam = urlParam('cam');
if (cam) {
  const v = cam.split(',').map(Number);
  game.cameraRig.update = () => { game.camera.position.set(v[0], v[1], v[2]); game.camera.lookAt(v[3], v[4], v[5]); game.focus = new THREE.Vector3(v[0], v[1], v[2]); };
}
game.start();
window.__ready = true;

// Asset inspection harness: renders a model at chosen clip/time/view for screenshots.
// Query params:
//   m=<url> clip=<i|-1> t=<sec> yaw pitch fit ty scale w h   view / pose
//   env=game      game lighting: sky IBL (0.5), low sun (0xffe2bd, 3.1) from the
//                 game's sun direction, hemisphere fill, ACES tone mapping, shadows
//   sun=az,el     override sun direction (degrees; az 0 = +Z, 90 = +X)
//   cam=x,y,z,tx,ty,tz   explicit camera position and target
//   fov=<deg>     camera field of view (default 35)
//   hair=0        skip the runtime hair shading (src/entities/HairShading.js)
//   alpha hide only tint measure dump   (debug helpers, see below)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 800), H = +(q.get('h') || 600);
const game = q.get('env') === 'game';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa4a8);
const sunDir = new THREE.Vector3(-0.62, 0.43, 0.66).normalize();
if (q.get('sun')) {
  const [az, el] = q.get('sun').split(',').map(x => +x * Math.PI / 180);
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
let sun;
if (game) {
  // Mirrors src/world/Environment.js + Game.js renderer settings.
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(4500);
  const u = envSky.material.uniforms;
  u.turbidity.value = 3.2; u.rayleigh.value = 1.35; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  if (u.showSunDisc) u.showSunDisc.value = 0;
  u.sunPosition.value.copy(new THREE.Vector3(-0.62, 0.43, 0.66).normalize()).multiplyScalar(4000);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2c3a1e }));
  ground.position.y = -10; envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture; scene.environmentIntensity = 0.5;
  scene.background = new THREE.Color(0x8fa3ad);
  sun = new THREE.DirectionalLight(0xffe2bd, 3.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -1.2; sc.right = 1.2; sc.top = 1.2; sc.bottom = -1.2; sc.near = 0.5; sc.far = 20;
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; sun.shadow.radius = 2.5;
  sun.position.copy(sunDir).multiplyScalar(8); scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xe6ece8, 0x6e6838, 0.5));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5d6a45, roughness: 1 }));
  floor.receiveShadow = true; scene.add(floor);
} else {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.6));
  sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); if (q.get('sun')) sun.position.copy(sunDir).multiplyScalar(5); scene.add(sun);
  const grid = new THREE.GridHelper(4, 40, 0x333333, 0x666666); scene.add(grid);
}
const cam = new THREE.PerspectiveCamera(+(q.get('fov') || 35), W / H, 0.01, 100);
window.info = {};
const gl = new GLTFLoader(); gl.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
const gltf = await gl.loadAsync(q.get('m'));
const root = gltf.scene; scene.add(root);
root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
if (q.get('hair') !== '0') {
  const mod = '/src/entities/HairShading.js'; // optional; resolved at runtime
  try { const { applyHairShading } = await import(/* @vite-ignore */ mod); window.info.hair = applyHairShading(root); }
  catch (e) { window.info.hairErr = String(e); }
}
if (q.get('alpha')) root.traverse(o => { if (o.material && /Beard|Moustache|Body/.test(o.material.name)) { o.material.alphaTest = 0.5; } });
if (q.get('hide')) root.traverse(o => { if (o.isMesh && new RegExp(q.get('hide')).test(o.name)) o.visible = false; });
if (q.get('only')) root.traverse(o => { if (o.isMesh && !new RegExp(q.get('only')).test(o.name)) o.visible = false; });
if (q.get('tint')) root.traverse(o => { if (o.isMesh && new RegExp(q.get('tint')).test(o.name)) { o.material = o.material.clone(); o.material.color.set(0xff3030); } });
window.info.meshes = []; root.traverse(o => { if (o.isMesh) window.info.meshes.push(o.name); });
const mixer = new THREE.AnimationMixer(root);
const clips = gltf.animations; window.info.clips = clips.map(c => [c.name, c.duration, c.tracks.length]);
const ci = +(q.get('clip') || 0);
if (clips[ci] && q.get('clip') !== '-1') { const a = mixer.clipAction(clips[ci]); a.play(); mixer.setTime(+(q.get('t') || 0)); }
root.updateMatrixWorld(true);
// skinned-aware bounds
const box = new THREE.Box3(); const v = new THREE.Vector3();
root.traverse(o => { if (o.isSkinnedMesh || o.isMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i); if (o.isSkinnedMesh) o.applyBoneTransform(i, v); o.localToWorld(v); box.expandByPoint(v); } } });
window.info.box = [box.min.toArray().map(x => +x.toFixed(3)), box.max.toArray().map(x => +x.toFixed(3))];
const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
const fit = +(q.get('fit') || 1);
const s = q.get('scale') ? +q.get('scale') : 1; root.scale.setScalar(s);
const R = Math.max(size.x, size.y, size.z) * s * 1.3 / fit;
const yaw = +(q.get('yaw') || 30) * Math.PI / 180, pitch = +(q.get('pitch') || 10) * Math.PI / 180;
const tgt = c.clone().multiplyScalar(s); if (q.get('ty')) tgt.y = +q.get('ty');
if (q.get('tx')) tgt.x = +q.get('tx'); if (q.get('tz')) tgt.z = +q.get('tz');
cam.position.set(tgt.x + R * Math.sin(yaw) * Math.cos(pitch), tgt.y + R * Math.sin(pitch), tgt.z + R * Math.cos(yaw) * Math.cos(pitch));
if (q.get('cam')) { const k = q.get('cam').split(',').map(Number); cam.position.set(k[0], k[1], k[2]); tgt.set(k[3], k[4], k[5]); }
cam.lookAt(tgt);
const bones = []; root.traverse(o => { if (o.isBone) bones.push(o.name); }); window.info.bones = bones.length;
let tris = 0; root.traverse(o => { if (o.isMesh && /Hair/i.test(o.name)) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
window.info.hairTris = tris;
renderer.render(scene, cam); window.done = true;
if (q.get('measure')) {
  const names = q.get('measure').split(',');
  const bonesBy = {}; root.traverse(o => { if (o.isBone && names.some(n => o.name.endsWith(n))) bonesBy[o.name] = o; });
  const clip = clips[ci]; const out = {};
  const N = 48;
  for (const [n, b] of Object.entries(bonesBy)) out[n] = [];
  for (let i = 0; i <= N; i++) {
    const t = clip.duration * i / N; mixer.setTime(t); root.updateMatrixWorld(true);
    for (const [n, b] of Object.entries(bonesBy)) { const p = b.getWorldPosition(new THREE.Vector3()); out[n].push([+t.toFixed(3), +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]); }
  }
  window.info.measure = out;
}
if (q.get('dump')) {
  const re = new RegExp(q.get('dump')); const out = [];
  root.traverse(o => { if (o.isBone && re.test(o.name)) { const p = o.getWorldPosition(new THREE.Vector3()); out.push([o.name, o.parent?.name, ...p.toArray().map(x => +x.toFixed(4))]); } });
  window.info.dump = out;
}

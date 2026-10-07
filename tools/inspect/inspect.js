// Asset inspection harness: renders a model at chosen clip/time/view for screenshots.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 800), H = +(q.get('h') || 600);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa4a8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
const grid = new THREE.GridHelper(4, 40, 0x333333, 0x666666); scene.add(grid);
const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 100);
window.info = {};
const gl = new GLTFLoader(); gl.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
const gltf = await gl.loadAsync(q.get('m'));
const root = gltf.scene; scene.add(root);
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
cam.position.set(tgt.x + R * Math.sin(yaw) * Math.cos(pitch), tgt.y + R * Math.sin(pitch), tgt.z + R * Math.cos(yaw) * Math.cos(pitch));
cam.lookAt(tgt); grid.scale.setScalar(Math.max(0.25, size.x * s, size.z * s) / 2);
const bones = []; root.traverse(o => { if (o.isBone) bones.push(o.name); }); window.info.bones = bones.length;
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

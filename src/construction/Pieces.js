// Procedural meshes for buildable pieces. Each builder returns a Group whose
// local +Z is the piece's front; userData holds parts that gameplay animates
// (gate leaf, bowl contents, water level).
import * as THREE from 'three';
import { boxGeo, cylGeo, place, meshesFrom } from '../util/geo.js';
import { fbm } from '../util/noise.js';
import { getBarkTexture } from '../vendor/ez-tree/textures.js';

let netMat = null;
function netting() {
  if (netMat) return netMat;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(150,152,150,1)'; x.lineWidth = 3;
  for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); }
  for (let j = 0; j <= 128; j += 32) { x.beginPath(); x.moveTo(0, j); x.lineTo(128, j); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  netMat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, color: 0xd8dad6 });
  return netMat;
}

function netPanel(w, h, y0) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 6.5, uv.getY(i) * h * 6.5);
  g.translate(0, y0 + h / 2, 0);
  const m = new THREE.Mesh(g, netting());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildFence(mats) {
  const parts = { fence: [], fenceNew: [] };
  for (const sx of [-1, 1]) parts.fence.push(place(boxGeo(0.12, 1.2, 0.12, 0.9, true), sx * 1.0, 0.55, 0));
  for (const y of [0.42, 0.96]) parts.fenceNew.push(place(boxGeo(2.0, 0.11, 0.06, 0.8), 0, y, 0.06));
  parts.fence.push(place(boxGeo(0.16, 0.04, 0.16, 0.9), -1.0, 1.16, 0, 0, 0.785, 0));
  const g = meshesFrom(parts, mats);
  g.add(netPanel(2.0, 0.86, 0.04).translateZ(0.025));
  return g;
}

export function buildGate(mats) {
  const parts = { fence: [] };
  for (const sx of [-1, 1]) parts.fence.push(place(boxGeo(0.16, 1.3, 0.16, 0.9, true), sx * 1.0, 0.6, 0));
  const g = meshesFrom(parts, mats);
  const leaf = new THREE.Group();
  const lp = { fenceNew: [], iron: [] };
  const W = 1.8, H = 1.02;
  for (const y of [0.12, 0.38, 0.62, 0.86, 1.08]) lp.fenceNew.push(place(boxGeo(W, 0.08, 0.045, 0.8), W / 2 + 0.05, y, 0));
  lp.fenceNew.push(place(boxGeo(0.1, H + 0.12, 0.06, 0.8, true), 0.08, 0.6, 0));
  lp.fenceNew.push(place(boxGeo(0.1, H + 0.12, 0.06, 0.8, true), W, 0.6, 0));
  const diag = Math.hypot(W - 0.1, H - 0.1);
  lp.fenceNew.push(place(boxGeo(diag, 0.075, 0.04, 0.8), W / 2 + 0.05, 0.6, 0.02, 0, 0, Math.atan2(H - 0.1, W - 0.1)));
  for (const y of [0.25, 0.95]) lp.iron.push(place(boxGeo(0.3, 0.04, 0.05), 0.12, y, 0.04));
  lp.iron.push(place(boxGeo(0.12, 0.05, 0.08), W + 0.02, 0.86, 0.03));
  const lm = meshesFrom(lp, mats);
  leaf.add(lm);
  leaf.add(netPanel(W - 0.1, 0.9, 0.08).translateX(W / 2 + 0.05).translateZ(-0.03));
  leaf.position.set(-0.95, 0, 0);
  g.add(leaf);
  g.userData.leaf = leaf;
  return g;
}

export function buildKennel(mats) {
  const W = 1.6, D = 1.3, H = 0.92, P = 0.12;
  const parts = { planks: [], planksDark: [], slate: [], straw: [] };
  parts.planksDark.push(place(boxGeo(W + 0.06, P, D + 0.06, 0.8), 0, P / 2, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.planksDark.push(place(boxGeo(0.08, 0.1, 0.08), x * (W / 2 - 0.05), 0.05, z * (D / 2 - 0.05)));
  // back and sides
  parts.planks.push(place(boxGeo(W, H, 0.05, 0.9), 0, P + H / 2, -D / 2 + 0.025));
  for (const sx of [-1, 1]) parts.planks.push(place(boxGeo(0.05, H, D, 0.9), sx * (W / 2 - 0.025), P + H / 2, 0));
  // front with a doorway (0.56 wide, 0.62 high)
  const dw = 0.66, dh = 0.74;
  const side = (W - dw) / 2;
  for (const sx of [-1, 1]) parts.planks.push(place(boxGeo(side, H, 0.05, 0.9), sx * (dw / 2 + side / 2), P + H / 2, D / 2 - 0.025));
  parts.planks.push(place(boxGeo(dw, H - dh, 0.05, 0.9), 0, P + dh + (H - dh) / 2, D / 2 - 0.025));
  // gables
  const rise = 0.5;
  for (const sz of [-1, 1]) {
    const s = new THREE.Shape(); s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(0, rise); s.lineTo(-W / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }); g.translate(0, 0, -0.025);
    parts.planks.push(place(g, 0, P + H, sz * (D / 2 - 0.025)));
  }
  const pitch = Math.atan2(rise, W / 2);
  const sl = Math.hypot(W / 2, rise) + 0.14;
  for (const sx of [-1, 1]) parts.slate.push(place(boxGeo(sl, 0.05, D + 0.24, 0.9), sx * (W / 4 + 0.02), P + H + rise / 2 + 0.04, 0, 0, 0, -sx * pitch));
  parts.planksDark.push(place(boxGeo(0.08, 0.08, D + 0.26), 0, P + H + rise + 0.05, 0));
  // door trim
  parts.planksDark.push(place(boxGeo(dw + 0.1, 0.06, 0.07), 0, P + dh + 0.03, D / 2));
  for (const sx of [-1, 1]) parts.planksDark.push(place(boxGeo(0.06, dh, 0.07), sx * (dw / 2 + 0.03), P + dh / 2, D / 2));
  // straw bed
  const straw = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.4, 0.16, 1.1);
  parts.straw.push(place(straw, 0, P, -0.05));
  const g = meshesFrom(parts, mats);
  g.userData.inside = new THREE.Vector3(0, P + 0.02, -0.08);
  g.userData.walls = [[-W / 2, -D / 2, W / 2, -D / 2], [-W / 2, -D / 2, -W / 2, D / 2], [W / 2, -D / 2, W / 2, D / 2],
    [-W / 2, D / 2, -dw / 2, D / 2], [dw / 2, D / 2, W / 2, D / 2]];
  return g;
}

function lathe(points, seg = 28) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

export function buildFoodBowl(mats) {
  const parts = { planksDark: [], galv: [] };
  parts.planksDark.push(place(boxGeo(0.44, 0.08, 0.44, 0.9), 0, 0.04, 0));
  const bowl = lathe([[0.0, 0.0], [0.11, 0.0], [0.14, 0.02], [0.17, 0.085], [0.175, 0.09], [0.165, 0.09], [0.13, 0.03], [0.0, 0.025]]);
  parts.galv.push(place(bowl, 0, 0.08, 0));
  const g = meshesFrom(parts, mats);
  const kib = new THREE.CylinderGeometry(0.135, 0.11, 0.05, 20, 1);
  const p = kib.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + 0.012 * fbm(p.getX(i) * 40, p.getZ(i) * 40, 2) + 0.01);
  kib.computeVertexNormals();
  const kibble = new THREE.Mesh(kib, mats.kibble);
  kibble.position.y = 0.13;
  kibble.castShadow = true;
  g.add(kibble);
  g.userData.setFill = (f) => { kibble.visible = f > 0.02; kibble.scale.set(0.7 + 0.3 * f, Math.max(0.05, f), 0.7 + 0.3 * f); kibble.position.y = 0.105 + 0.025 * f; };
  g.userData.setFill(0);
  g.userData.mouth = new THREE.Vector3(0, 0.16, 0);
  return g;
}

export function buildTrough(mats) {
  const L = 0.95, W = 0.48, H = 0.3, t = 0.02;
  const parts = { galv: [], iron: [] };
  parts.galv.push(place(boxGeo(L, t, W), 0, 0.05, 0));
  for (const sz of [-1, 1]) parts.galv.push(place(boxGeo(L, H, t), 0, 0.05 + H / 2, sz * (W / 2 - t / 2)));
  for (const sx of [-1, 1]) parts.galv.push(place(boxGeo(t, H, W), sx * (L / 2 - t / 2), 0.05 + H / 2, 0));
  for (const sz of [-1, 1]) parts.galv.push(place(new THREE.CylinderGeometry(0.014, 0.014, L + 0.02, 8).rotateZ(Math.PI / 2), 0, 0.05 + H, sz * (W / 2)));
  for (const sx of [-1, 1]) parts.iron.push(place(boxGeo(0.05, 0.05, W + 0.06), sx * (L / 2 - 0.12), 0.025, 0));
  const g = meshesFrom(parts, mats);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(L - 2 * t, W - 2 * t).rotateX(-Math.PI / 2), mats.water);
  g.add(water);
  g.userData.setFill = (f) => { water.visible = f > 0.02; water.position.y = 0.07 + (H - 0.06) * f; };
  g.userData.setFill(0);
  g.userData.mouth = new THREE.Vector3(0, 0.3, 0);
  return g;
}

export function buildTugPost(mats) {
  const parts = { planksDark: [], rope: [], iron: [] };
  parts.planksDark.push(place(cylGeo(0.06, 0.07, 1.05, 10, 0.9), 0, 0.52, 0));
  parts.iron.push(place(new THREE.TorusGeometry(0.05, 0.012, 6, 14), 0.06, 0.95, 0, 0, Math.PI / 2, 0));
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 0.95, 0), new THREE.Vector3(0.2, 0.7, 0.06), new THREE.Vector3(0.24, 0.45, 0.1), new THREE.Vector3(0.22, 0.3, 0.12)]);
  parts.rope.push(new THREE.TubeGeometry(curve, 24, 0.022, 8));
  parts.rope.push(place(new THREE.SphereGeometry(0.05, 10, 8), 0.22, 0.28, 0.12));
  const g = meshesFrom(parts, mats);
  g.userData.rope = new THREE.Vector3(0.22, 0.3, 0.12);
  return g;
}

export function buildBall(mats) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), mats.rubberRed);
  m.position.y = 0.075; m.castShadow = true;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.004, 6, 32), mats.paintCream);
  m.add(seam);
  g.add(m);
  g.userData.ball = m;
  return g;
}

export function buildHollowLog(mats) {
  const L = 1.8, R = 0.34, r = 0.24;
  const outer = new THREE.CylinderGeometry(R, R * 1.05, L, 20, 4, true);
  const p = outer.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + 0.06 * fbm(v.y * 2, Math.atan2(v.z, v.x) * 1.5, 2);
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  outer.computeVertexNormals();
  const inner = new THREE.CylinderGeometry(r, r, L, 18, 1, true);
  const ring = new THREE.RingGeometry(r, R, 20, 1);
  const bark = new THREE.MeshStandardMaterial({ map: getBarkTexture('oak', 'color', { x: 2, y: 1.5 }), normalMap: getBarkTexture('oak', 'normal', { x: 2, y: 1.5 }), roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95, side: THREE.BackSide });
  const end = new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.9, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const o = new THREE.Mesh(outer, bark), i = new THREE.Mesh(inner, wood);
  const e1 = new THREE.Mesh(ring, end), e2 = new THREE.Mesh(ring, end);
  e1.position.y = L / 2; e1.rotation.x = -Math.PI / 2; e2.position.y = -L / 2; e2.rotation.x = Math.PI / 2;
  const tube = new THREE.Group(); tube.add(o, i, e1, e2);
  tube.rotation.z = Math.PI / 2; tube.position.y = R * 0.92;
  tube.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.add(tube);
  g.userData.walls = [[-L / 2, -R, L / 2, -R], [-L / 2, R, L / 2, R]];
  return g;
}

export const BUILDERS = {
  fence: buildFence, gate: buildGate, kennel: buildKennel, food_bowl: buildFoodBowl, water_trough: buildTrough,
  ball: buildBall, tug_post: buildTugPost, hollow_log: buildHollowLog,
};

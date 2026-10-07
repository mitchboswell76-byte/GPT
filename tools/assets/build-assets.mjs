// Asset pipeline: turns the untouched source models in assets-src/ into the
// runtime GLBs in public/assets/models/. Re-run after replacing a source file:
//   npm run assets
// Every repair here is deliberate and documented in docs/ASSETS.md.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public/assets/models');
fs.mkdirSync(OUT, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'sharp': sharp });

const only = process.argv[2];

async function compress(doc, { maxColor = 2048, maxData = 1024, quality = 86 } = {}) {
  // Colour textures keep more resolution than normal / roughness data.
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality, resize: [maxColor, maxColor], slots: /^(baseColor|emissive)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [maxData, maxData], slots: /^(normal|metallicRoughness|occlusion)/ }),
  );
}

function findNode(doc, name) { return doc.getRoot().listNodes().find(n => n.getName() === name); }
function findMesh(doc, name) { return doc.getRoot().listMeshes().find(m => m.getName() === name); }

// ---------------------------------------------------------------------------
// Player: "the sound guy"
// ---------------------------------------------------------------------------
async function buildPlayer() {
  const doc = await io.read(path.join(SRC, 'the-sound-guy-fixed-head.glb'));
  const root = doc.getRoot();

  // 1. Hair-card materials were exported OPAQUE, so beard, moustache and
  //    eyelash cards rendered as solid blocks. Their textures carry alpha.
  for (const m of root.listMaterials()) {
    if (['Beard', 'Moustache', 'Body'].includes(m.getName())) { m.setAlphaMode('MASK'); m.setAlphaCutoff(0.45); }
  }

  // 2. Remove the earlier crude "RepairedScalp" patch (jagged dark cap plus a
  //    stray band at eye level) and replace it with a fitted scalp cap.
  const oldNode = findNode(doc, 'RepairedScalp');
  if (oldNode) { const m = oldNode.getMesh(); oldNode.dispose(); if (m) m.dispose(); }

  const bodyNode = findNode(doc, 'Body');
  const skin = bodyNode.getSkin();
  const joints = skin.listJoints();
  const headJoint = joints.findIndex(j => j.getName() === 'mixamorig:Head');
  const prim = bodyNode.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const jnt = prim.getAttribute('JOINTS_0').getArray();
  const wgt = prim.getAttribute('WEIGHTS_0').getArray();

  const cap = buildScalpCap(pos, idx, jnt, wgt, headJoint);
  await addScalpToDoc(doc, cap, skin, headJoint);

  // 3. The T-Pose clip is the bind pose only; drop it.
  for (const a of root.listAnimations()) if (a.getName() === 'T-Pose') a.dispose();

  await compress(doc, { maxColor: 1024, maxData: 1024 });
  await doc.transform(prune(), dedup());
  await io.write(path.join(OUT, 'player.glb'), doc);
  console.log('player.glb written', cap.stats);
}

// Fits a cap to the actual head shape by casting rays out from the skull
// centre against the Body mesh, then fills the open crown smoothly.
function buildScalpCap(pos, idx, jnt, wgt, headJoint) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);

  // Head vertices: dominated by the Head joint and above the jaw line.
  const hb = new THREE.Box3(); const v = new THREE.Vector3();
  for (let i = 0; i < pos.length / 3; i++) {
    let best = 0, bj = -1; for (let k = 0; k < 4; k++) if (wgt[i * 4 + k] > best) { best = wgt[i * 4 + k]; bj = jnt[i * 4 + k]; }
    if (bj === headJoint && pos[i * 3 + 1] > 1.62) hb.expandByPoint(v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  const c = hb.getCenter(new THREE.Vector3());
  c.y = 1.705; c.z -= 0.012; // ear/eye level, a little behind the face centre
  const ray = new THREE.Raycaster(); ray.far = 0.22;

  const NA = 144, NE = 56; // azimuth / elevation grid
  const E0 = THREE.MathUtils.degToRad(-35), E1 = THREE.MathUtils.degToRad(90);
  const dirOf = (a, e) => new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const R = [];
  for (let ie = 0; ie <= NE; ie++) {
    const row = []; const e = E0 + (E1 - E0) * ie / NE;
    for (let ia = 0; ia < NA; ia++) {
      const a = 2 * Math.PI * ia / NA; const d = dirOf(a, e);
      ray.set(c, d); const hit = ray.intersectObject(mesh, false)[0];
      row.push(hit ? hit.distance : null);
    }
    R.push(row);
  }
  // Least-squares ellipsoid (axis aligned, centred at c) from known samples.
  // r(d) = 1/sqrt(dx²/A² + dy²/B² + dz²/C²)  ->  1/r² = dx²·p + dy²·q + dz²·s
  // The crown is open, so the vertical semi-axis is fixed from proportions:
  // top of head ~11.5 cm above eye level (eyes at y≈1.693). Width and depth
  // are fitted to the skin that exists.
  const B = 1.808 - c.y; const q = 1 / (B * B);
  const M = [[0, 0], [0, 0]], bvec = [0, 0];
  for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
    const r = R[ie][ia]; if (r == null) continue;
    const e = E0 + (E1 - E0) * ie / NE, a = 2 * Math.PI * ia / NA; const d = dirOf(a, e);
    if (e < THREE.MathUtils.degToRad(-5)) continue; // ignore face/jaw below the ears
    const f = [d.x * d.x, d.z * d.z]; const y = 1 / (r * r) - d.y * d.y * q;
    for (let i = 0; i < 2; i++) { bvec[i] += f[i] * y; for (let j = 0; j < 2; j++) M[i][j] += f[i] * f[j]; }
  }
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const P = new THREE.Vector3((bvec[0] * M[1][1] - bvec[1] * M[0][1]) / det, q, (M[0][0] * bvec[1] - M[1][0] * bvec[0]) / det);
  const rEll = (d) => 1 / Math.sqrt(d.x * d.x * P.x + d.y * d.y * P.y + d.z * d.z * P.z);

  // Residual relative to the ellipsoid, filled by relaxation where unknown.
  const res = R.map((row, ie) => row.map((r, ia) => {
    if (r == null) return null; const e = E0 + (E1 - E0) * ie / NE, a = 2 * Math.PI * ia / NA; return r - rEll(dirOf(a, e));
  }));
  const known = res.map(row => row.map(x => x != null));
  const fill = res.map(row => row.map(x => x ?? 0));
  for (let it = 0; it < 600; it++) {
    for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
      if (known[ie][ia]) continue;
      const up = ie < NE ? fill[ie + 1][ia] : fill[ie][(ia + NA / 2) % NA];
      const dn = ie > 0 ? fill[ie - 1][ia] : fill[ie][ia];
      fill[ie][ia] = (up + dn + fill[ie][(ia + 1) % NA] + fill[ie][(ia + NA - 1) % NA]) / 4;
    }
  }
  // Pole: average of the top row so the crown closes cleanly.
  const poleRes = fill[NE].reduce((s, x) => s + x, 0) / NA;
  for (let ia = 0; ia < NA; ia++) fill[NE][ia] = poleRes;

  // Hairline: per azimuth, the lowest elevation that is open (no skin), then a
  // margin below it. Smoothed so the line reads as a natural hairline.
  const holeLow = new Array(NA).fill(null);
  for (let ia = 0; ia < NA; ia++) for (let ie = 0; ie <= NE; ie++) if (!known[ie][ia]) { holeLow[ia] = ie; break; }
  let line = holeLow.map(h => (h == null ? NE : h));
  // widen: min within ±8 samples (covers jagged teeth between rays)
  line = line.map((_, ia) => { let m = NE; for (let k = -8; k <= 8; k++) m = Math.min(m, line[(ia + k + NA) % NA]); return m; });
  for (let pass = 0; pass < 6; pass++) line = line.map((_, ia) => (line[(ia + NA - 1) % NA] + 2 * line[ia] + line[(ia + 1) % NA]) / 4);
  const marginRows = 4.0;     // cover distance beyond the hole edge
  const fadeRows = 5.0;       // soft alpha blend into skin / painted hair
  const lowRow = line.map(l => Math.max(0, l - marginRows - fadeRows));

  // Build cap geometry rows from per-azimuth low row to the pole.
  const ROWS = 28; const positions = [], uvs = [], colors = [], indices = [];
  const hairT = 0.0045, edgeT = 0.0012;
  const sample = (ie, ia) => { // bilinear in elevation, wrap in azimuth
    const i0 = Math.floor(ie), i1 = Math.min(NE, i0 + 1), f = ie - i0;
    return fill[i0][ia] * (1 - f) + fill[i1][ia] * f;
  };
  for (let r = 0; r <= ROWS; r++) {
    for (let ia = 0; ia <= NA; ia++) {
      const a = ia % NA; const lo = lowRow[a];
      const ie = lo + (NE - lo) * (r / ROWS);
      const e = E0 + (E1 - E0) * ie / NE; const az = 2 * Math.PI * ia / NA;
      const d = dirOf(az, e);
      const fromEdge = (ie - lo); // rows above the cap edge
      const t = THREE.MathUtils.smoothstep(fromEdge, 0, fadeRows + 0.5);
      const rr = rEll(d) + sample(ie, a) + THREE.MathUtils.lerp(edgeT, hairT, t);
      positions.push(c.x + d.x * rr, c.y + d.y * rr, c.z + d.z * rr);
      uvs.push(ia / NA * 9, (NE - ie) / NE * 6);
      colors.push(1, 1, 1, t);
    }
  }
  const W = NA + 1;
  for (let r = 0; r < ROWS; r++) for (let ia = 0; ia < NA; ia++) {
    const a = r * W + ia, b = a + 1, c2 = a + W, d2 = c2 + 1;
    indices.push(a, c2, b, b, c2, d2);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cg.setIndex(indices); cg.computeVertexNormals();
  // ensure outward-facing normals
  const n0 = new THREE.Vector3().fromBufferAttribute(cg.attributes.normal, W * 10);
  const p0 = new THREE.Vector3().fromBufferAttribute(cg.attributes.position, W * 10).sub(c);
  if (n0.dot(p0) < 0) { for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; } cg.setIndex(indices); cg.computeVertexNormals(); }
  const unknownCount = known.flat().filter(k => !k).length;
  return {
    positions: new Float32Array(cg.attributes.position.array), normals: new Float32Array(cg.attributes.normal.array),
    uvs: new Float32Array(uvs), colors: new Float32Array(colors), indices: new Uint16Array(cg.index.array),
    stats: { centre: c.toArray().map(x => +x.toFixed(3)), unknownRays: unknownCount, ellipsoid: [1 / Math.sqrt(P.x), 1 / Math.sqrt(P.y), 1 / Math.sqrt(P.z)].map(x => +x.toFixed(3)) },
  };
}

async function hairTextures() {
  // Short cropped hair: fine strands running crown -> hairline (along v).
  const N = 512; const col = Buffer.alloc(N * N * 3); const nrm = Buffer.alloc(N * N * 3);
  const h = new Float32Array(N * N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strands = 2600;
  for (let s = 0; s < strands; s++) {
    const x0 = rnd() * N, y0 = rnd() * N, len = 18 + rnd() * 30, tilt = (rnd() - 0.5) * 0.35, b = 0.4 + rnd() * 0.6;
    for (let k = 0; k < len; k++) {
      const x = Math.floor(x0 + tilt * k + N) % N, y = Math.floor(y0 + k) % N;
      h[y * N + x] = Math.max(h[y * N + x], b * (1 - k / len * 0.5));
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; const v = h[i];
    const base = [44, 33, 25], tip = [78, 58, 42];
    for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.round(base[k] * (1 - v) + tip[k] * v * 0.9 + base[k] * v * 0.1);
    const hx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N];
    const hy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nn = new THREE.Vector3(-hx * 1.6, -hy * 0.6, 1).normalize();
    nrm[i * 3] = Math.round((nn.x * 0.5 + 0.5) * 255); nrm[i * 3 + 1] = Math.round((nn.y * 0.5 + 0.5) * 255); nrm[i * 3 + 2] = Math.round((nn.z * 0.5 + 0.5) * 255);
  }
  const colPng = await sharp(col, { raw: { width: N, height: N, channels: 3 } }).blur(0.5).png().toBuffer();
  const nrmPng = await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer();
  return { colPng, nrmPng };
}

async function addScalpToDoc(doc, cap, skin, headJoint) {
  const buf = doc.getRoot().listBuffers()[0];
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const n = cap.positions.length / 3;
  const joints = new Uint8Array(n * 4); const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { joints[i * 4] = headJoint; weights[i * 4] = 1; }
  const { colPng, nrmPng } = await hairTextures();
  const tex = doc.createTexture('HairCap_diffuse').setImage(colPng).setMimeType('image/png');
  const ntex = doc.createTexture('HairCap_normal').setImage(nrmPng).setMimeType('image/png');
  const mat = doc.createMaterial('HairCap').setBaseColorTexture(tex).setNormalTexture(ntex)
    .setMetallicFactor(0).setRoughnessFactor(0.78).setAlphaMode('BLEND').setDoubleSided(false);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', cap.positions))
    .setAttribute('NORMAL', acc('VEC3', cap.normals))
    .setAttribute('TEXCOORD_0', acc('VEC2', cap.uvs))
    .setAttribute('COLOR_0', acc('VEC4', cap.colors))
    .setAttribute('JOINTS_0', acc('VEC4', joints))
    .setAttribute('WEIGHTS_0', acc('VEC4', weights))
    .setIndices(acc('SCALAR', cap.indices)).setMaterial(mat);
  const mesh = doc.createMesh('HairCapmesh').addPrimitive(prim);
  const node = doc.createNode('HairCap').setMesh(mesh).setSkin(skin);
  doc.getRoot().listScenes()[0].addChild(node);
}

// ---------------------------------------------------------------------------
// Puppy
// ---------------------------------------------------------------------------
async function buildPuppy() {
  const doc = await io.read(path.join(SRC, 'dog-puppy.glb'));
  for (const m of doc.getRoot().listMaterials()) {
    // Emissive slot held a 1x1 black image with factor 1: no visual effect.
    m.setEmissiveTexture(null); m.setEmissiveFactor([0, 0, 0]);
  }
  await compress(doc, { maxColor: 1024, maxData: 1024 });
  await doc.transform(prune(), dedup());
  await io.write(path.join(OUT, 'dog_puppy.glb'), doc);
  console.log('dog_puppy.glb written');
}

// ---------------------------------------------------------------------------
// Adult Labrador (Sketchfab, kenchoo, CC-BY-4.0)
// ---------------------------------------------------------------------------
async function buildAdultDog() {
  const doc = await io.read(path.join(SRC, 'labrador_dog.glb'));
  const node = doc.getRoot().listNodes().find(n => n.getSkin());
  const skin = node.getSkin(); const joints = skin.listJoints();
  const J = (name) => joints.findIndex(j => j.getName() === name);
  const neutral = J('neutral_bone_52');
  const footL = J('FFB.L_44'), footR = J('FFB.R_48');
  // Hind toe vertices were bound to "neutral_bone", a static bone at the rig
  // root. Once the paws move they would stretch back to the origin, so they
  // are rebound to the hind foot bones on their own side.
  let moved = 0;
  for (const p of node.getMesh().listPrimitives()) {
    const P = p.getAttribute('POSITION'), JA = p.getAttribute('JOINTS_0');
    const pa = P.getArray(), ja = JA.getArray();
    for (let i = 0; i < P.getCount(); i++) for (let k = 0; k < 4; k++) {
      if (ja[i * 4 + k] === neutral) { ja[i * 4 + k] = pa[i * 3] >= 0 ? footL : footR; moved++; }
    }
    JA.setArray(ja);
  }
  // Morph targets are unnamed and unused by the clip at rest; keep them.
  await compress(doc, { maxColor: 2048, maxData: 1024 });
  await doc.transform(prune({ keepAttributes: true }), dedup());
  await io.write(path.join(OUT, 'dog_adult.glb'), doc);
  console.log('dog_adult.glb written; rebound joint refs:', moved);
}

if (!only || only === 'player') await buildPlayer();
if (!only || only === 'puppy') await buildPuppy();
if (!only || only === 'adult') await buildAdultDog();

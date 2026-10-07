// Debug: writes an equirectangular map of the measured head field.
//   node tools/assets/hair/debug-field.mjs out.png
// Columns: azimuth -180..180 (face in the middle, +X/left to the right).
// Rows: elevation 90 (top) .. -40. Blue = hole, brown = painted hair, skin.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import path from 'node:path';
import * as THREE from 'three';
import { buildHeadField, NA, NE, elevOfRow } from './scalp.mjs';
import { loadBody } from './keeper.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(ROOT, 'assets-src/the-sound-guy-fixed-head.glb'));
const { body, headJoint, tex } = await loadBody(doc);
const F = buildHeadField(body, headJoint, tex);
const S = 4; const W = NA * S, H = (NE + 1) * S;
const img = Buffer.alloc(W * H * 3);
for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
  const col = (ia + NA / 2) % NA; // azimuth -180.. so face (0) is centred
  const row = NE - ie;
  let rgb;
  if (!F.known[ie][ia]) rgb = [60, 90, 200];
  else rgb = F.skinRGB[ie][ia].map(Math.round);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = ((row * S + y) * W + col * S + x) * 3; img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
  }
}
// grid lines every 30 deg azimuth / 15 deg elevation
for (let ia = 0; ia < NA; ia += NA / 12) for (let y = 0; y < H; y++) { const o = (y * W + ((ia + NA / 2) % NA) * S) * 3; img[o] = 255; img[o + 1] = 255; img[o + 2] = 0; }
for (let ie = 0; ie <= NE; ie++) {
  const e = THREE.MathUtils.radToDeg(elevOfRow(ie));
  if (Math.abs(e / 15 - Math.round(e / 15)) < 0.5 * 130 / NE / 15) for (let x = 0; x < W; x++) { const o = ((NE - ie) * S * W + x) * 3; img[o] = 255; img[o + 1] = 255; img[o + 2] = 0; }
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).resize(W * 2, H * 2, { kernel: 'nearest' }).png().toFile(process.argv[2]);
const holeDeg = F.holeLow.map(h => h == null ? null : +THREE.MathUtils.radToDeg(elevOfRow(h)).toFixed(0));
const out = [];
for (let ia = 0; ia < NA; ia += 4) out.push(`${Math.round(ia * 360 / NA)}:${holeDeg[ia]}`);
console.log('holeLow (az:elevDeg)', out.join(' '));
console.log(F.stats);
// Some reference heights
for (const [n, a, e] of [['front e30', 0, 30], ['front e45', 0, 45], ['side e30', 90, 30], ['back e0', 180, 0], ['top', 0, 89]]) {
  const p = F.point(THREE.MathUtils.degToRad(a), THREE.MathUtils.degToRad(e));
  console.log(n, p.toArray().map(x => +x.toFixed(3)), 'r', +F.radius(THREE.MathUtils.degToRad(a), THREE.MathUtils.degToRad(e)).toFixed(3));
}

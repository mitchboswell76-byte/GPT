// Debug: which joints drive the Body vertices around the head, by elevation.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import path from 'node:path';
import { loadBody } from './keeper.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(ROOT, 'assets-src/the-sound-guy-fixed-head.glb'));
const { body, skin, headJoint } = await loadBody(doc);
const names = skin.listJoints().map(j => j.getName().replace('mixamorig:', ''));
const c = [0, 1.705, 0.017];
const buckets = {};
for (let i = 0; i < body.pos.length / 3; i++) {
  const x = body.pos[i * 3] - c[0], y = body.pos[i * 3 + 1] - c[1], z = body.pos[i * 3 + 2] - c[2];
  const r = Math.hypot(x, y, z); if (r > 0.14) continue;
  const e = Math.round(Math.asin(y / r) * 180 / Math.PI / 10) * 10;
  const a = Math.abs(Math.atan2(x, z) * 180 / Math.PI) > 100 ? 'back' : 'front/side';
  const k = `${a} e${e}`;
  let s = ''; for (let j = 0; j < 4; j++) if (body.wgt[i * 4 + j] > 0.05) s += names[body.jnt[i * 4 + j]] + ':' + body.wgt[i * 4 + j].toFixed(2) + ' ';
  (buckets[k] ||= new Map()).set(s, ((buckets[k].get(s)) || 0) + 1);
}
for (const k of Object.keys(buckets).sort()) console.log(k, [...buckets[k].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3));

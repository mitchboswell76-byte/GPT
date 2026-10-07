// Geometry helpers for procedural props: UVs scaled to world metres so
// tiling textures keep a consistent texel density across pieces.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Box with UVs in metres * `uvScale` on every face. */
export function boxGeo(w, h, d, uvScale = 1, grainAlongY = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    let su, sv;
    if (ax > 0.5) { su = d; sv = h; } else if (ay > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    let u = uv.getX(i) * su * uvScale, v = uv.getY(i) * sv * uvScale;
    if (grainAlongY) { const t = u; u = v; v = t; }
    uv.setXY(i, u, v);
  }
  return g;
}

export function cylGeo(rt, rb, h, seg = 12, uvScale = 1) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * uvScale, uv.getY(i) * h * uvScale);
  return g;
}

/** Place a geometry: returns a transformed clone. */
export function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

export function merge(list) {
  const clean = list.map((g) => {
    const c = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
    return c;
  });
  return mergeGeometries(clean);
}

/** Group of meshes keyed by material from a {materialKey: [geometries]} map. */
export function meshesFrom(parts, mats, { cast = true, receive = true } = {}) {
  const group = new THREE.Group();
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(merge(list), mats[k]);
    m.castShadow = cast; m.receiveShadow = receive; m.name = k;
    group.add(m);
  }
  return group;
}

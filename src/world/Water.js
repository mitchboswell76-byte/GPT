// The stream surface: a ribbon following the stream curve at the local water
// level, with scrolling ripples, sky reflections and soft shallow edges.
import * as THREE from 'three';
import { STREAM_PTS, STREAM, STREAM_HALF_WIDTH } from './WorldLayout.js';
import { streamLevels } from './Terrain.js';
import { fbm } from '../util/noise.js';

export class Water {
  constructor() {
    const pts = STREAM_PTS;
    const across = 6;
    const pos = [], uv = [], col = [], idx = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      if (i > 0) s += Math.hypot(p.x - o.x, p.z - o.z);
      let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz, nz = tx;
      const u = i / (pts.length - 1);
      const hw = STREAM_HALF_WIDTH(u) + 0.75;
      const y = streamLevels(u).water;
      for (let k = 0; k <= across; k++) {
        const a = k / across * 2 - 1;
        pos.push(p.x + nx * a * hw, y, p.z + nz * a * hw);
        uv.push(a * hw * 0.25, s * 0.25);
        const edge = 1 - Math.abs(a);
        col.push(1, 1, 1, 0.42 + 0.5 * Math.min(1, edge * 2.2));
      }
    }
    const W = across + 1;
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < across; k++) {
      const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(W) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }

    this.normalTex = makeRippleNormal();
    this.normalTex.repeat.set(1, 1);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x3d4b3f, roughness: 0.06, metalness: 0.0, transparent: true, vertexColors: true,
      normalMap: this.normalTex, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.25, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'stream';
  }

  update(dt) {
    this.normalTex.offset.y -= dt * 0.16;
    this.normalTex.offset.x = Math.sin(performance.now() * 0.00021) * 0.03;
  }
}

function makeRippleNormal() {
  const S = 256; const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    h[y * S + x] = fbm(Math.cos(a) * 2 + Math.cos(b) * 0.6, Math.sin(a) * 2 + Math.sin(b) * 3.5, 4)
      + 0.4 * fbm(Math.cos(b) * 5 + 3, Math.sin(b) * 5 + Math.cos(a) * 1.5, 3);
  }
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = h[y * S + (x + 1) % S] - h[y * S + (x + S - 1) % S];
    const hy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
    const v = new THREE.Vector3(-hx * 6, -hy * 6, 1).normalize();
    const k = (y * S + x) * 4;
    d[k] = (v.x * 0.5 + 0.5) * 255; d[k + 1] = (v.y * 0.5 + 0.5) * 255; d[k + 2] = (v.z * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export { STREAM };

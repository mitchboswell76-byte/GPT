// Trees, bushes, ferns, reeds, rocks and the distant tree line. Trees are
// generated with the vendored ez-tree generator, then rendered as instanced
// variants with PBR materials and a shared wind uniform.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tree } from '../vendor/ez-tree/index.js';
import { getBarkTexture, getLeafTexture } from '../vendor/ez-tree/textures.js';
import { mulberry32, fbm, smoothstep } from '../util/noise.js';
import { forestDensity } from './Terrain.js';
import { PATH_INDEX, BRIDGE, PUPPY_SPAWN, FALLEN_LOG, OUTPOST } from './WorldLayout.js';

const VARIANTS = [
  { id: 'oakA', preset: 'Oak Medium', seed: 1203, height: 15, leafTint: 0x9fb27a },
  { id: 'oakB', preset: 'Oak Medium', seed: 77, height: 13, leafTint: 0x95ad70 },
  { id: 'oakL', preset: 'Oak Large', seed: 4242, height: 19, leafTint: 0x9cb076 },
  { id: 'ash', preset: 'Ash Medium', seed: 902, height: 16, leafTint: 0xa3b67e },
  { id: 'birch', preset: 'Aspen Medium', seed: 51, height: 13, leafTint: 0xb2bf80, bark: 'birch' },
  { id: 'bushA', preset: 'Bush 1', seed: 11, height: 2.3, leafTint: 0x8fa86a },
  { id: 'bushB', preset: 'Bush 2', seed: 23, height: 2.0, leafTint: 0x88a266 },
  { id: 'bushC', preset: 'Bush 3', seed: 35, height: 1.6, leafTint: 0x94ac70 },
];

export class Vegetation {
  constructor(terrain, colliders, quality, assets) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.quality = quality;
    this.assets = assets;
    this.group = new THREE.Group();
    this.windUniforms = { uTime: { value: 0 } };
    this.rng = mulberry32(2024);
    this.protos = new Map();
    this.placements = new Map();
  }

  build() {
    for (const v of VARIANTS) this.protos.set(v.id, this.makeProto(v));
    this.scatter();
    for (const [id, list] of this.placements) this.instance(id, list);
    this.buildFerns();
    this.buildReeds();
    this.buildFarTrees();
    this.buildLog();
  }

  makeProto(v) {
    const t = new Tree();
    t.loadPreset(v.preset);
    t.options.seed = v.seed;
    if (v.bark) t.options.bark.type = v.bark;
    t.generate();
    const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
    bg.computeBoundingBox();
    const bb = bg.boundingBox.clone().union(lg.boundingBox || (lg.computeBoundingBox(), lg.boundingBox));
    const s = v.height / (bb.max.y - bb.min.y);
    bg.scale(s, s, s); lg.scale(s, s, s);
    // Canopy-shaped normals give leaf cards a soft, volumetric shading.
    lg.computeBoundingBox();
    const centre = lg.boundingBox.getCenter(new THREE.Vector3());
    centre.y -= (lg.boundingBox.max.y - lg.boundingBox.min.y) * 0.15;
    const p = lg.attributes.position, n = lg.attributes.normal;
    const tmp = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i).sub(centre).normalize();
      nn.fromBufferAttribute(n, i);
      if (nn.dot(tmp) < 0) nn.negate();
      nn.lerp(tmp, 0.75).normalize();
      n.setXYZ(i, nn.x, nn.y, nn.z);
    }
    const o = t.options;
    const barkType = o.bark.type;
    const bark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(o.bark.tint).multiplyScalar(0.92),
      map: getBarkTexture(barkType, 'color', o.bark.textureScale),
      normalMap: getBarkTexture(barkType, 'normal', o.bark.textureScale),
      roughnessMap: getBarkTexture(barkType, 'roughness', o.bark.textureScale),
      aoMap: getBarkTexture(barkType, 'ao', o.bark.textureScale),
      roughness: 1, metalness: 0,
    });
    const leaves = new THREE.MeshStandardMaterial({
      map: getLeafTexture(o.leaves.type), color: new THREE.Color(v.leafTint), alphaTest: 0.5,
      side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.25,
    });
    const wind = this.windUniforms;
    leaves.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 ip = vec3(0.0);
            #ifdef USE_INSTANCING
              ip = instanceMatrix[3].xyz;
            #endif
            float ph = dot(ip, vec3(0.13, 0.0, 0.17));
            float k = smoothstep(0.0, 1.0, uv.y) * 0.06 + transformed.y * 0.004;
            transformed.x += sin(uTime * 1.6 + ph + transformed.y * 0.35) * k + sin(uTime * 3.7 + transformed.z) * k * 0.4;
            transformed.z += cos(uTime * 1.3 + ph * 1.3 + transformed.x * 0.3) * k * 0.8;
            transformed.y += sin(uTime * 2.9 + transformed.x * 2.0 + ph) * k * 0.3;
          }`);
    };
    leaves.customProgramCacheKey = () => 'leaves-wind';
    bb.min.multiplyScalar(s); bb.max.multiplyScalar(s);
    const trunkR = Math.max(0.12, o.branch.radius[0] * s * 0.9);
    return { v, branches: bg, leaves: lg, bark, leafMat: leaves, trunkR, isBush: v.id.startsWith('bush') };
  }

  add(id, x, z, scale = 1, yaw = this.rng() * Math.PI * 2) {
    if (!this.placements.has(id)) this.placements.set(id, []);
    const y = this.terrain.heightAt(x, z) - 0.15 * scale;
    this.placements.get(id).push({ x, y, z, scale, yaw });
  }

  clearOf(x, z, r) {
    for (const p of PATH_INDEX) { const n = p.index.nearest(x, z); if (n && n.d < p.width + r) return false; }
    if (this.terrain.waterDist(x, z) < 1.2 + r * 0.5) return false;
    if (Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < 7 + r) return false;
    if (Math.hypot(x - OUTPOST.centre.x, z - OUTPOST.centre.z) < 18 + r) return false;
    return true;
  }

  scatter() {
    const r = this.rng, Q = this.quality.treeScale;
    const trees = ['oakA', 'oakB', 'oakL', 'ash', 'birch'];
    const taken = [];
    const free = (x, z, d) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > (d + t.d) ** 2);
    // Woodland west of the stream and along the north.
    let tries = 0, placed = 0;
    const target = Math.round(150 * Q);
    while (placed < target && tries++ < 9000) {
      const x = -150 + r() * 125, z = -150 + r() * 300;
      const d = forestDensity(x, z);
      if (r() > d * d) continue;
      if (Math.hypot(x, z) > 158) continue;
      const kind = trees[Math.floor(r() * trees.length)];
      const sp = kind === 'oakL' ? 7.5 : 5.2;
      if (!free(x, z, sp) || !this.clearOf(x, z, 2.5)) continue;
      if (Math.hypot(x - PUPPY_SPAWN.x, z - PUPPY_SPAWN.z) < 6.5) continue;
      const sc = 0.8 + r() * 0.45;
      this.add(kind, x, z, sc);
      taken.push({ x, z, d: sp * 0.5 });
      this.colliders.addCircle(x, z, this.protos.get(kind).trunkR * sc + 0.15, 'tree');
      placed++;
    }
    // Field oaks and hedgerows framing the meadow.
    const field = [[44, 66, 'oakL', 1.05], [70, -14, 'oakA', 1.1], [-14, 63, 'oakB', 1.0], [30, -30, 'ash', 0.95], [86, 40, 'oakL', 1.0], [20, 88, 'oakA', 1.0]];
    for (const [x, z, k, s] of field) { this.add(k, x, z, s); this.colliders.addCircle(x, z, this.protos.get(k).trunkR * s + 0.15, 'tree'); taken.push({ x, z, d: 4 }); }
    const hedge = (x0, z0, x1, z1, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = x0 + (x1 - x0) * t + (r() - 0.5) * 1.6, z = z0 + (z1 - z0) * t + (r() - 0.5) * 1.6;
        if (!this.clearOf(x, z, 0.5)) continue;
        const k = ['bushA', 'bushB', 'bushC'][Math.floor(r() * 3)];
        this.add(k, x, z, 1.1 + r() * 0.7);
        if (r() < 0.12 * Q) { this.add(r() < 0.5 ? 'oakB' : 'ash', x + 1, z + 1, 0.75 + r() * 0.3); this.colliders.addCircle(x + 1, z + 1, 0.5, 'tree'); }
      }
      this.colliders.addSegment(x0, z0, x1, z1, 0.9, 'hedge');
    };
    hedge(76, -60, 76, 98, Math.round(80 * Q));
    hedge(-20, 100, 76, 100, Math.round(60 * Q));
    hedge(14, -46, 76, -46, Math.round(36 * Q));
    // Understorey bushes along the woodland edge and around the stray's hiding spot.
    for (let i = 0; i < 160 * Q; i++) {
      const z = -110 + r() * 220;
      const x = -44 - r() * 26 + 5 * fbm(z * 0.03 + 9, 1.3, 2);
      if (!this.clearOf(x, z, 0.8)) continue;
      this.add(['bushA', 'bushB', 'bushC'][Math.floor(r() * 3)], x, z, 0.8 + r() * 0.8);
    }
    for (const [dx, dz, k, s] of [[3.0, 2.6, 'bushA', 1.2], [-2.6, 3.4, 'bushB', 1.4], [-3.2, -1.5, 'bushC', 1.1], [1.8, 5.2, 'bushB', 0.9]]) {
      this.add(k, PUPPY_SPAWN.x + dx, PUPPY_SPAWN.z + dz, s);
    }
  }

  instance(id, list) {
    const P = this.protos.get(id);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const mk = (geo, mat, shadow) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw); s.setScalar(p.scale); pos.set(p.x, p.y, p.z);
        im.setMatrixAt(i, m.compose(pos, q, s));
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      return im;
    };
    mk(P.branches, P.bark, true);
    mk(P.leaves, P.leafMat, true);
  }

  buildFerns() {
    // Woodland-floor ferns: arching fronds with a pinnate canvas texture.
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.strokeStyle = '#3c5a1c'; x.lineWidth = 5; x.beginPath(); x.moveTo(64, 512); x.lineTo(64, 0); x.stroke();
    for (let i = 0; i < 26; i++) {
      const y = 500 - i * 19, w = 58 * Math.sin((i / 26) * Math.PI * 0.9 + 0.15);
      x.fillStyle = `hsl(${88 + Math.random() * 10}, 45%, ${26 + Math.random() * 8}%)`;
      x.beginPath(); x.ellipse(64 - w / 2, y, w / 2, 7, -0.3, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(64 + w / 2, y, w / 2, 7, 0.3, 0, Math.PI * 2); x.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const parts = [];
    for (let k = 0; k < 7; k++) {
      const g = new THREE.PlaneGeometry(0.28, 1.0, 1, 6);
      g.translate(0, 0.5, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i);
        p.setZ(i, t * 0.55 * t); p.setY(i, t * 0.75 - t * t * 0.25);
      }
      g.rotateY((k / 7) * Math.PI * 2 + 0.3);
      parts.push(g);
    }
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xd8e6c0 });
    const pts = [];
    const r = this.rng;
    for (let i = 0; i < 900 * this.quality.treeScale; i++) {
      const px = -150 + r() * 125, pz = -140 + r() * 280;
      if (forestDensity(px, pz) < 0.55 || !this.clearOf(px, pz, 0.2) || Math.hypot(px, pz) > 155) continue;
      pts.push([px, pz]);
    }
    for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = 2 + r() * 4; pts.push([PUPPY_SPAWN.x + Math.cos(a) * d, PUPPY_SPAWN.z + Math.sin(a) * d]); }
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    pts.forEach(([px, pz], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); s.setScalar(0.7 + r() * 0.7);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(px, this.terrain.heightAt(px, pz) - 0.05, pz), q, s));
    });
    im.receiveShadow = true; im.castShadow = true;
    this.group.add(im);
  }

  buildReeds() {
    const parts = [];
    for (let k = 0; k < 9; k++) {
      const g = new THREE.PlaneGeometry(0.03, 1, 1, 4); g.translate(0, 0.5, 0);
      const p = g.attributes.position;
      const lean = (Math.random() - 0.5) * 0.4;
      for (let i = 0; i < p.count; i++) { const t = p.getY(i); p.setX(i, p.getX(i) * (1 - t * 0.8) + lean * t * t); }
      g.rotateY(Math.random() * Math.PI); g.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
      g.scale(1, 0.9 + Math.random() * 0.8, 1);
      parts.push(g);
    }
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5e6e33, side: THREE.DoubleSide, roughness: 0.85 });
    const pts = [];
    const r = this.rng;
    for (let i = 0; i < 6000; i++) {
      const px = -70 + r() * 60, pz = -150 + r() * 300;
      const wd = this.terrain.waterDist(px, pz);
      if (wd < -0.5 || wd > 1.4) continue;
      if (Math.hypot(px - BRIDGE.x, pz - BRIDGE.z) < 5.5) continue;
      if (fbm(px * 0.12, pz * 0.12, 2) < -0.05) continue;
      pts.push([px, pz]);
      if (pts.length > 700 * this.quality.treeScale) break;
    }
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    pts.forEach(([px, pz], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); s.set(1, 0.7 + r() * 0.8, 1);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(px, this.terrain.heightAt(px, pz) - 0.05, pz), q, s));
    });
    im.receiveShadow = true;
    this.group.add(im);
  }

  buildFarTrees() {
    // Cheap rounded canopies on the surrounding hills; fog turns them into a
    // soft tree line that frames the reserve.
    const canopy = new THREE.IcosahedronGeometry(1, 1);
    const p = canopy.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 1 + 0.32 * fbm(v.x * 2.6 + v.y, v.z * 2.6 - v.y, 3);
      p.setXYZ(i, v.x * k, v.y * k * 1.15 + 0.25, v.z * k);
    }
    canopy.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.08, 0.12, 1.4, 5).translate(0, -0.6, 0);
    const geo = mergeGeometries([canopy.toNonIndexed(), trunk.toNonIndexed()]);
    geo.scale(4, 5, 4); geo.translate(0, 5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, envMapIntensity: 0.3 });
    const r = this.rng; const pts = [];
    for (let i = 0; i < 9000 && pts.length < 1400; i++) {
      const a = r() * Math.PI * 2, d = 165 + Math.pow(r(), 0.7) * 520;
      const x = Math.cos(a) * d, z = Math.sin(a) * d + 15;
      const dens = 0.35 + 0.5 * smoothstep(-0.1, 0.4, fbm(x * 0.006, z * 0.006, 3));
      if (r() > dens) continue;
      pts.push([x, z]);
    }
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const col = new THREE.Color();
    pts.forEach(([x, z], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); const w = 0.6 + r() * 0.9; s.set(w, w * (0.9 + r() * 0.9), w * (0.8 + r() * 0.4));
      im.setMatrixAt(i, m.compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.5, z), q, s));
      im.setColorAt(i, col.setHSL(0.2 + r() * 0.08, 0.25 + r() * 0.15, 0.13 + r() * 0.07));
    });
    im.receiveShadow = false;
    this.group.add(im);
  }

  buildLog() {
    // Moss-covered fallen log where the stray shelters.
    const L = 4.6, R = 0.34;
    const g = new THREE.CylinderGeometry(R * 0.9, R, L, 18, 6, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 1 + 0.07 * fbm(v.y * 1.4, Math.atan2(v.z, v.x) * 2, 2);
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    g.computeVertexNormals();
    g.rotateZ(Math.PI / 2);
    const bark = new THREE.MeshStandardMaterial({
      map: getBarkTexture('oak', 'color', { x: 2, y: 2 }), normalMap: getBarkTexture('oak', 'normal', { x: 2, y: 2 }),
      roughness: 1, color: 0x8f9a72,
    });
    const log = new THREE.Mesh(g, bark);
    const { x, z, yaw } = FALLEN_LOG;
    log.position.set(x, this.terrain.heightAt(x, z) + R * 0.7, z);
    log.rotation.y = yaw;
    log.rotation.z = 0.04;
    log.castShadow = log.receiveShadow = true;
    this.group.add(log);
    const dx = Math.cos(yaw) * L * 0.5, dz = -Math.sin(yaw) * L * 0.5;
    this.colliders.addSegment(x - dx, z - dz, x + dx, z + dz, R + 0.1, 'log');
  }

  update(dt) { this.windUniforms.uTime.value += dt; }
}

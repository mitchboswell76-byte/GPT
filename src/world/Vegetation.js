// Trees, bushes, ferns, reeds, rocks and the distant tree line. Trees are
// generated with the vendored ez-tree generator, then rendered as instanced
// variants with PBR materials and a shared wind uniform.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tree } from '../vendor/ez-tree/index.js';
import { getBarkTexture, getLeafTexture, whenTexturesLoaded } from '../vendor/ez-tree/textures.js';
import { mulberry32, fbm, smoothstep } from '../util/noise.js';
import { forestDensity } from './Terrain.js';
import { PATH_INDEX, BRIDGE, PUPPY_SPAWN, FALLEN_LOG, OUTPOST } from './WorldLayout.js';

const VARIANTS = [
  { id: 'oakA', preset: 'Oak Medium', seed: 1203, height: 15, leafTint: 0x93ad62 },
  { id: 'oakB', preset: 'Oak Medium', seed: 77, height: 13, leafTint: 0x8aa65a },
  { id: 'oakL', preset: 'Oak Large', seed: 4242, height: 19, leafTint: 0x91aa5e },
  { id: 'ash', preset: 'Ash Medium', seed: 902, height: 16, leafTint: 0x9ab466 },
  { id: 'birch', preset: 'Aspen Medium', seed: 51, height: 13, leafTint: 0xa9bc6a, bark: 'birch' },
  { id: 'bushA', preset: 'Bush 1', seed: 11, height: 2.3, leafTint: 0x86a25a },
  { id: 'bushB', preset: 'Bush 2', seed: 23, height: 2.0, leafTint: 0x7e9c54 },
  { id: 'bushC', preset: 'Bush 3', seed: 35, height: 1.6, leafTint: 0x8ca85c },
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
    this.blockGrid = new Map(); // camera clearance: bushes and trunks
  }

  addBlocker(x, y, z, r, h) {
    const b = { x, y, z, r, h };
    for (let i = Math.floor((x - r) / 4); i <= Math.floor((x + r) / 4); i++) for (let j = Math.floor((z - r) / 4); j <= Math.floor((z + r) / 4); j++) {
      const k = i * 7919 + j;
      if (!this.blockGrid.has(k)) this.blockGrid.set(k, []);
      this.blockGrid.get(k).push(b);
    }
  }

  /** Is a camera at (x, y, z) inside a bush or a trunk? */
  blocksCamera(x, y, z) {
    const list = this.blockGrid.get(Math.floor(x / 4) * 7919 + Math.floor(z / 4));
    if (!list) return false;
    for (const b of list) if (y < b.y + b.h && (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return true;
    return false;
  }

  build() {
    for (const v of VARIANTS) this.protos.set(v.id, this.makeProto(v));
    this.scatter();
    for (const [id, list] of this.placements) this.instance(id, list);
    this.buildFerns();
    this.buildReeds();
    this.buildLog();
  }

  makeProto(v) {
    const t = new Tree();
    t.loadPreset(v.preset);
    t.options.seed = v.seed;
    if (v.bark) t.options.bark.type = v.bark;
    // Trim tessellation: radial segments and length sections per branch level.
    const bush = v.id.startsWith('bush');
    const segs = bush ? [4, 3, 3, 3] : [7, 4, 3, 3];
    const secs = bush ? [3, 3, 2, 1] : [7, 4, 3, 2];
    for (let l = 0; l < 4; l++) {
      if (t.options.branch.segments[l] !== undefined) t.options.branch.segments[l] = Math.min(t.options.branch.segments[l], segs[l]);
      if (t.options.branch.sections[l] !== undefined) t.options.branch.sections[l] = Math.min(t.options.branch.sections[l], secs[l]);
    }
    if (bush) t.options.leaves.count = Math.min(t.options.leaves.count, 10);
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
      side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.14, emissive: 0x1a2408,
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
    const P = this.protos.get(id);
    if (P?.isBush) this.addBlocker(x, y, z, 1.05 * scale, 2.1 * scale);
    else if (P) this.addBlocker(x, y, z, P.trunkR * scale + 0.3, 8);
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
    // One InstancedMesh per variant per 48 m tile, so the camera and the sun's
    // shadow pass can cull whole tiles.
    const P = this.protos.get(id);
    const tiles = new Map();
    for (const p of list) {
      const k = Math.floor(p.x / 48) + ',' + Math.floor(p.z / 48);
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(p);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const items of tiles.values()) {
      const mk = (geo, mat, shadow) => {
        const im = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((p, i) => {
          q.setFromAxisAngle(up, p.yaw); s.setScalar(p.scale); pos.set(p.x, p.y, p.z);
          im.setMatrixAt(i, m.compose(pos, q, s));
        });
        im.castShadow = shadow; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
        return im;
      };
      mk(P.branches, P.bark, !P.isBush);
      mk(P.leaves, P.leafMat, true);
    }
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

  /**
   * Distant tree line from impostors: each generated tree variant is rendered
   * once into a transparent texture and drawn as crossed quads on the hills.
   */
  buildFarTrees(renderer) {
    const ids = ['oakA', 'oakL', 'ash', 'birch', 'oakB'];
    const S = 512;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe8eef0, 0x50502a, 1.2));
    const sun = new THREE.DirectionalLight(0xffe6c4, 2.6); sun.position.set(-0.6, 0.5, 0.65); scene.add(sun);
    const cards = [];
    for (const id of ids) {
      const P = this.protos.get(id);
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(P.branches, P.bark), new THREE.Mesh(P.leaves, P.leafMat));
      scene.add(grp);
      grp.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(grp);
      const size = box.getSize(new THREE.Vector3());
      const half = Math.max(size.y, size.x, size.z) / 2 * 1.04;
      const cy = box.min.y + half;
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 200);
      cam.position.set(0, cy, 60); cam.lookAt(0, cy, 0);
      const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const prev = { t: renderer.getRenderTarget(), c: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha(), tm: renderer.toneMapping };
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x46542e, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(prev.t);
      renderer.setClearColor(prev.c, prev.a);
      renderer.toneMapping = prev.tm;
      scene.remove(grp);
      cards.push({ tex: rt.texture, size: half * 2, lift: cy - half - box.min.y });
    }
    const r = this.rng;
    const pts = [];
    for (let i = 0; i < 12000 && pts.length < 1500; i++) {
      const a = r() * Math.PI * 2, d = 150 + Math.pow(r(), 0.8) * 520;
      const x = Math.cos(a) * d, z = Math.sin(a) * d + 15;
      const dens = 0.3 + 0.55 * smoothstep(-0.1, 0.4, fbm(x * 0.006, z * 0.006, 3)) + 0.3 * forestDensity(x, z);
      if (r() > dens) continue;
      pts.push([x, z]);
    }
    const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
    const cross = mergeGeometries([quad.clone(), quad.clone().rotateY(Math.PI / 2)]);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    cards.forEach((card, ci) => {
      const mine = pts.filter((_, i) => i % cards.length === ci);
      const mat = new THREE.MeshBasicMaterial({ map: card.tex, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xd6dccb });
      const im = new THREE.InstancedMesh(cross, mat, mine.length);
      mine.forEach(([x, z], i) => {
        const sc = card.size * (0.75 + r() * 0.5);
        q.setFromAxisAngle(up, r() * Math.PI);
        s.set(sc, sc, sc);
        im.setMatrixAt(i, m.compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.6 - card.lift * sc / card.size, z), q, s));
      });
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  buildLog() {
    // Moss-covered fallen oak where the stray shelters: open bark shell with
    // pale sawn ends, part-sunk into the leaf litter.
    const L = 6.2, R = 0.38;
    const g = new THREE.CylinderGeometry(R * 0.82, R, L, 22, 8, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 1 + 0.09 * fbm(v.y * 1.2, Math.atan2(v.z, v.x) * 2, 2) + 0.05 * Math.sin(v.y * 3.1);
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    g.computeVertexNormals();
    const bark = new THREE.MeshStandardMaterial({
      map: getBarkTexture('oak', 'color', { x: 2, y: 2.5 }), normalMap: getBarkTexture('oak', 'normal', { x: 2, y: 2.5 }),
      roughness: 1, color: 0x9aa47c,
    });
    const endMat = new THREE.MeshStandardMaterial({ color: 0x6a5a42, roughness: 1 });
    const log = new THREE.Group();
    const shell = new THREE.Mesh(g, bark);
    const capA = new THREE.Mesh(new THREE.CircleGeometry(R * 0.8, 20), endMat); capA.position.y = L / 2; capA.rotation.x = -Math.PI / 2;
    const capB = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 20), endMat); capB.position.y = -L / 2; capB.rotation.x = Math.PI / 2;
    log.add(shell, capA, capB);
    // a broken branch stub
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.8, 8), bark);
    stub.position.set(0.25, 0.6, 0.1); stub.rotation.z = -0.9;
    log.add(stub);
    log.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    const holder = new THREE.Group();
    log.rotation.z = Math.PI / 2;
    holder.add(log);
    const { x, z, yaw } = FALLEN_LOG;
    holder.position.set(x, this.terrain.heightAt(x, z) + R * 0.55, z);
    holder.rotation.set(0, yaw, 0.035);
    this.group.add(holder);
    const dx = Math.cos(yaw) * L * 0.5, dz = -Math.sin(yaw) * L * 0.5;
    this.colliders.addSegment(x - dx, z - dz, x + dx, z + dz, R + 0.1, 'log');
  }

  update(dt) { this.windUniforms.uTime.value += dt; }
}

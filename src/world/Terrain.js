// Terrain synthesis, sampling and rendering. Heights are computed once from an
// analytic function into a 1 m grid; gameplay queries sample that grid.
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { fbm, noise2, clamp, lerp, smoothstep } from '../util/noise.js';
import { STREAM, STREAM_PTS, STREAM_HALF_WIDTH, PATH_INDEX, OUTPOST } from './WorldLayout.js';

const H = CONFIG.world.half;
const A = CONFIG.world.buildArea;

function rectMask(x, z, r, soft) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return smoothstep(soft, 0, Math.hypot(dx, dz));
}

function lowHeight(x, z) {
  return 0.55 * noise2(x * 0.009 + 3.1, z * 0.009 - 1.7) + clamp((x + 34) / 100, -0.2, 1) * 1.6;
}

function rawHeight(x, z) {
  let h = 1.5 * fbm(x * 0.011 + 3.1, z * 0.011 - 1.7, 4);
  h += 0.28 * fbm(x * 0.06 + 11, z * 0.06 + 5, 3);
  h += clamp((x + 34) / 100, -0.2, 1) * 1.6;
  const west = smoothstep(-40, -125, x);
  h += west * (5.5 + 4 * fbm(x * 0.02, z * 0.02, 3));
  h += smoothstep(-35, -150, z) * 4.5;
  const r = Math.hypot(x * 0.9, z - 15);
  h += smoothstep(150, 520, r) * (20 + 34 * (0.5 + 0.5 * fbm(x * 0.0032 + 2, z * 0.0032 - 4, 4)));
  return h;
}

const YARD_H = lowHeight(OUTPOST.centre.x, OUTPOST.centre.z - 1);

// Bank level along the stream: smoothed land height, never rising downstream.
const BANK = (() => {
  const raw = STREAM_PTS.map((p) => {
    let h = rawHeight(p.x, p.z);
    const m = rectMask(p.x, p.z, A, 10);
    h = lerp(h, lowHeight(p.x, p.z), m * 0.85);
    return h;
  });
  const sm = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -18; k <= 18; k++) { const j = clamp(i + k, 0, raw.length - 1); s += raw[j]; n++; }
    return s / n;
  });
  for (let i = 1; i < sm.length; i++) sm[i] = Math.min(sm[i], sm[i - 1] - 0.004);
  return sm;
})();

export function streamLevels(u) {
  const f = clamp(u, 0, 1) * (BANK.length - 1);
  const i = Math.floor(f), t = f - i;
  const bank = lerp(BANK[i], BANK[Math.min(i + 1, BANK.length - 1)], t);
  return { bank, water: bank - 0.52, bed: bank - 1.15 };
}

export function forestDensity(x, z) {
  const edge = -44 + 5 * fbm(z * 0.03 + 9, 1.3, 2);
  let d = smoothstep(edge + 3, edge - 9, x);
  d = Math.max(d, smoothstep(-58, -76, z + 6 * fbm(x * 0.03, 4.4, 2)) * 0.85);
  return d;
}

/** Analytic height with stream, yard, build area and path shaping. */
export function heightFn(x, z) {
  let h = rawHeight(x, z);
  const m = rectMask(x, z, A, 10);
  if (m > 0) h = lerp(h, lowHeight(x, z), m * 0.85);
  const yd = Math.hypot(x - OUTPOST.centre.x, (z - OUTPOST.centre.z) * 0.9);
  h = lerp(h, YARD_H, smoothstep(19, 10, yd));

  const sn = STREAM.nearest(x, z);
  if (sn && sn.d < 12) {
    const L = streamLevels(sn.u);
    const hw = STREAM_HALF_WIDTH(sn.u);
    h = lerp(h, Math.max(h, L.bank + 0.08), smoothstep(hw + 9, hw + 3, sn.d));
    const prof = L.bed + (L.bank - L.bed) * Math.pow(smoothstep(0, hw + 1.6, sn.d), 1.3);
    h = lerp(prof, h, smoothstep(hw + 0.9, hw + 3.2, sn.d));
  }
  return h;
}

export class Terrain {
  constructor(assets, quality) {
    this.quality = quality;
    this.N = H * 2 + 1; // samples per axis at 1 m
    const N = this.N;
    this.heights = new Float32Array(N * N);
    this.streamD = new Float32Array(N * N).fill(99);
    this.splat = new Float32Array(N * N * 4);
    this.grassMask = new Uint8Array(N * N * 4);

    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i - H, z = j - H, k = j * N + i;
      this.heights[k] = heightFn(x, z);
      const sn = STREAM.nearest(x, z);
      const hw = sn ? STREAM_HALF_WIDTH(sn.u) : 2;
      if (sn) this.streamD[k] = sn.d - hw;
      let path = 0;
      for (const p of PATH_INDEX) {
        const n = p.index.nearest(x, z);
        if (n) {
          const w = p.width * (1 + 0.25 * noise2(x * 0.4, z * 0.4));
          path = Math.max(path, smoothstep(w, w * 0.3, n.d) * (p.id === 'yard' ? 0.75 : 0.9));
        }
      }
      const yd = Math.hypot(x - OUTPOST.centre.x, (z - OUTPOST.centre.z) * 1.1);
      path = Math.max(path, smoothstep(9, 4, yd + 3 * noise2(x * 0.15, z * 0.15)) * 0.55);
      const bank = sn ? smoothstep(hw + 2.4, hw + 0.4, sn.d) : 0;
      const forest = forestDensity(x, z);
      const dry = smoothstep(-0.1, 0.6, fbm(x * 0.018 + 40, z * 0.018 - 7, 3)) * (1 - forest);
      this.splat.set([path, bank, forest * 0.85, dry], k * 4);
      let dens = (1 - path * 1.1) * (1 - bank) * (1 - 0.7 * forest);
      dens = clamp(dens, 0, 1);
      const flowers = clamp(smoothstep(0.1, 0.55, fbm(x * 0.05 - 3, z * 0.05 + 8, 2)) * (1 - forest) * (1 - path), 0, 1);
      this.grassMask.set([dens * 255, dry * 255, flowers * 255, 255], k * 4);
    }

    this.heightTex = new THREE.DataTexture(
      Uint16Array.from(this.heights, (v) => THREE.DataUtils.toHalfFloat(v)), N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    this.maskTex = new THREE.DataTexture(this.grassMask, N, N, THREE.RGBAFormat);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;

    this.mesh = this.buildMesh(assets);
  }

  /** Bilinear height; analytic outside the detailed grid. */
  heightAt(x, z) {
    const fx = x + H, fz = z + H;
    if (fx < 0 || fz < 0 || fx >= this.N - 1 || fz >= this.N - 1) return heightFn(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, N = this.N, h = this.heights;
    const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** Distance from the water's edge (negative inside the stream). */
  waterDist(x, z) {
    const fx = Math.round(x + H), fz = Math.round(z + H);
    if (fx < 0 || fz < 0 || fx >= this.N || fz >= this.N) return 99;
    return this.streamD[fz * this.N + fx];
  }

  splatAt(x, z) {
    const fx = clamp(Math.round(x + H), 0, this.N - 1), fz = clamp(Math.round(z + H), 0, this.N - 1);
    const k = (fz * this.N + fx) * 4;
    return { path: this.splat[k], bank: this.splat[k + 1], forest: this.splat[k + 2], dry: this.splat[k + 3] };
  }

  /** Flatten grass under a placed object (footprint in world units). */
  trampleRect(cx, cz, hx, hz, yaw, amount = 1) {
    const r = Math.hypot(hx, hz) + 1;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dz = z - cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const out = Math.max(Math.abs(lx) - hx, Math.abs(lz) - hz);
      if (out > 0.9) continue;
      const i = x + H, j = z + H;
      if (i < 0 || j < 0 || i >= this.N || j >= this.N) continue;
      const k = (j * this.N + i) * 4;
      const f = 1 - amount * smoothstep(0.9, -0.3, out);
      this.grassMask[k] = Math.min(this.grassMask[k], this.grassMask[k] * f);
      this.grassMask[k + 2] = Math.min(this.grassMask[k + 2], this.grassMask[k + 2] * f);
    }
    this.maskTex.needsUpdate = true;
  }

  axisCoords(step) {
    const c = [];
    const far = 1500, outer = 26;
    for (let k = outer; k >= 1; k--) c.push(-(H + (far - H) * Math.pow(k / outer, 2.2)));
    for (let x = -H; x <= H + 1e-6; x += step) c.push(x);
    for (let k = 1; k <= outer; k++) c.push(H + (far - H) * Math.pow(k / outer, 2.2));
    return c;
  }

  buildMesh(assets) {
    const coords = this.axisCoords(this.quality.terrainStep);
    const n = coords.length;
    const pos = new Float32Array(n * n * 3);
    const spl = new Float32Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = coords[i], z = coords[j], k = j * n + i;
      const inside = Math.abs(x) <= H && Math.abs(z) <= H;
      pos[k * 3] = x; pos[k * 3 + 1] = inside ? this.heightAt(x, z) : heightFn(x, z); pos[k * 3 + 2] = z;
      if (inside) {
        const s = this.splatAt(x, z); spl.set([s.path, s.bank, s.forest, s.dry], k * 4);
      } else {
        const f = clamp(forestDensity(x, z) + smoothstep(0.1, 0.5, fbm(x * 0.01, z * 0.01, 2)) * 0.6, 0, 1);
        spl.set([0, 0, f * 0.8, 0.4], k * 4);
      }
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
    g.setIndex(idx);
    g.computeVertexNormals();

    const grass = assets.texture('assets/vendor/ez-tree/grass.jpg');
    const dirt = assets.texture('assets/vendor/ez-tree/dirt_color.jpg');
    const dirtN = assets.texture('assets/vendor/ez-tree/dirt_normal.jpg', { srgb: false });
    const macro = makeMacroNoise();
    const mat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.97, metalness: 0, envMapIntensity: 0.55 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = { value: dirt };
      sh.uniforms.uDirtN = { value: dirtN };
      sh.uniforms.uMacro = { value: macro };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDirt;\nuniform sampler2D uDirtN;\nuniform sampler2D uMacro;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', `
          vec2 wuv = vWPos.xz;
          vec3 gA = texture2D(map, wuv * 0.23).rgb;
          vec3 gB = texture2D(map, wuv * 0.051 + vec2(0.31, 0.17)).rgb;
          vec4 mac = texture2D(uMacro, wuv * 0.0042);
          vec4 mac2 = texture2D(uMacro, wuv * 0.031 + 0.5);
          vec3 grassCol = mix(gA, gB, 0.42 + 0.25 * (mac2.r - 0.5));
          grassCol *= mix(vec3(0.74, 1.2, 0.46), vec3(1.0, 1.14, 0.44), mac.g);
          grassCol = mix(grassCol, grassCol * vec3(1.25, 1.0, 0.8), vSplat.w * 0.5);
          vec3 dirtCol = texture2D(uDirt, wuv * 0.31).rgb;
          vec3 litter = dirtCol * vec3(0.9, 0.82, 0.55) + vec3(0.012, 0.01, 0.0);
          litter = mix(litter, grassCol * 0.75, smoothstep(0.35, 0.8, mac2.g) * 0.5);
          vec3 mud = dirtCol * vec3(0.7, 0.74, 0.7);
          vec3 tcol = grassCol;
          tcol = mix(tcol, litter, smoothstep(0.0, 1.0, vSplat.z));
          float pathEdge = smoothstep(0.15, 0.65, vSplat.x + (mac2.b - 0.5) * 0.35);
          tcol = mix(tcol, dirtCol * vec3(1.45, 1.55, 1.3), pathEdge);
          tcol = mix(tcol, mud, smoothstep(0.1, 0.9, vSplat.y));
          diffuseColor.rgb *= tcol;
        `)
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          {
            float dirtAmt = max(smoothstep(0.15, 0.65, vSplat.x), vSplat.y * 0.8);
            if (dirtAmt > 0.01) {
              vec3 dn = texture2D(uDirtN, vWPos.xz * 0.31).xyz * 2.0 - 1.0;
              vec3 wn = normalize(vec3(dn.x, dn.z, -dn.y));
              vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
              normal = normalize(mix(normal, normalize(normal + (vn - (viewMatrix * vec4(0.0,1.0,0.0,0.0)).xyz) * 0.6), dirtAmt));
            }
          }
        `);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}

function makeMacroNoise() {
  const S = 256; const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // periodic noise via torus mapping
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6, nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
    const f = (o) => 0.5 + 0.5 * fbm(nx + nz * 0.7 + o, ny + nw * 0.7 - o, 4);
    const k = (y * S + x) * 4;
    data[k] = f(0) * 255; data[k + 1] = f(3.7) * 255; data[k + 2] = f(9.1) * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

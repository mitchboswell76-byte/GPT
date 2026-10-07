// Instanced grass and wildflowers rendered around the camera. Each instance is
// pinned to a world grid cell, so blades stay put as the window moves. Heights
// and density come from the terrain's height and mask textures.
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';

const COMMON = /* glsl */`
uniform sampler2D uHeight;
uniform sampler2D uMask;
uniform vec3 uCenter;
uniform float uSpacing;
uniform float uRadius;
uniform float uTime;
uniform float uHalf;
uniform vec4 uPush[4];
uniform vec2 uWind;
attribute vec2 aGrid;
float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 terrUV(vec2 w){ return (w + uHalf + 0.5) / (2.0 * uHalf + 1.0); }
vec2 windAt(vec2 wp, float t){
  float g = sin(dot(wp, vec2(0.13, 0.09)) - t * 1.3) * 0.5 + 0.5;
  float g2 = sin(dot(wp, vec2(-0.05, 0.21)) - t * 0.83 + 1.7) * 0.5 + 0.5;
  float flutter = sin(t * 3.1 + wp.x * 1.7 + wp.y * 1.3) * 0.12;
  return uWind * (0.25 + 0.9 * g * g + 0.35 * g2 + flutter);
}
vec3 pushAt(vec2 wp){
  vec3 o = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = wp - uPush[i].xy; float l = length(d);
    float f = (1.0 - smoothstep(0.0, uPush[i].z, l)) * uPush[i].w;
    o.xy += d / max(l, 0.001) * f; o.z = max(o.z, f);
  }
  return o;
}
`;

function bladeGeometry(segments = 4, clump = 1) {
  const pos = [], uv = [], idx = [];
  for (let c = 0; c < clump; c++) {
    const base = pos.length / 3;
    const a = (c / clump) * Math.PI * 0.9 + 0.3;
    const off = clump > 1 ? 0.35 : 0;
    const ox = Math.cos(a * 2.3) * off, oz = Math.sin(a * 2.3) * off;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const w = (1 - t * 0.92) * 0.5;
      pos.push(-w, t, c + 0.0001 * ox, w, t, c + 0.0001 * oz);
      uv.push(0, t, 1, t);
    }
    for (let i = 0; i < segments; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function gridAttr(n) {
  const a = new Float32Array(n * n * 2);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { a[k++] = i - n / 2; a[k++] = j - n / 2; }
  return new THREE.InstancedBufferAttribute(a, 2);
}

class GrassLayer {
  constructor(terrain, shared, { count, radius, height, width, clump, dark = 1 }) {
    const g = bladeGeometry(4, clump);
    g.setAttribute('aGrid', gridAttr(count));
    g.instanceCount = count * count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.spacing = (radius * 2) / count;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    const u = {
      ...shared,
      uSpacing: { value: this.spacing }, uRadius: { value: radius },
      uBladeH: { value: height }, uBladeW: { value: width }, uDark: { value: dark },
    };
    this.uniforms = u;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${COMMON}\nuniform float uBladeH; uniform float uBladeW; uniform float uDark;\nvarying vec3 vGC;`)
        .replace('#include <beginnormal_vertex>', `
          vec2 cell = floor(uCenter.xz / uSpacing) + aGrid;
          float r1 = gh(cell), r2 = gh(cell + 17.3), r3 = gh(cell + 9.7), r4 = gh(cell + 3.3), r5 = gh(cell + 8.8);
          vec2 wp = (cell + vec2(r1, r2)) * uSpacing;
          vec2 tuv = terrUV(wp);
          float ground = texture2D(uHeight, tuv).r;
          vec4 mask = texture2D(uMask, tuv);
          float dist = length(wp - uCenter.xz);
          float keep = step(gh(cell + 5.1), mask.r * 1.08);
          float fade = smoothstep(uRadius, uRadius * 0.62, dist);
          float bh = (0.45 + 0.95 * r3 * r3 + 0.25 * r1) * uBladeH * mix(0.55, 1.0, mask.r) * keep * fade;
          float ang = r4 * 6.2831853;
          vec2 across = vec2(cos(ang), sin(ang));
          vec2 lean = vec2(-across.y, across.x) * (0.12 + 0.3 * r5);
          vec2 wind = windAt(wp, uTime);
          vec3 push = pushAt(wp);
          vec3 objectNormal = normalize(vec3(lean.x * 0.6 + wind.x * 0.3, 1.0, lean.y * 0.6 + wind.y * 0.3));
        `)
        .replace('#include <begin_vertex>', `
          float t = position.y;
          float sideOff = position.z;  // clump index (0..n)
          float ca = sideOff * 2.1 + ang;
          vec2 acr = vec2(cos(ca), sin(ca));
          vec2 clumpOff = vec2(cos(sideOff * 2.7 + r1 * 6.0), sin(sideOff * 2.7 + r1 * 6.0)) * step(0.5, sideOff) * 0.05 * uBladeW * 10.0;
          vec2 bend = (lean + wind + push.xy * 1.4) * t * t;
          float droop = 1.0 - 0.35 * dot(bend, bend) - 0.55 * push.z;
          vec3 transformed = vec3(
            wp.x + clumpOff.x + acr.x * position.x * uBladeW * (0.7 + 0.6 * r2) + bend.x * bh,
            ground + t * bh * max(droop, 0.25) - 0.02,
            wp.y + clumpOff.y + acr.y * position.x * uBladeW * (0.7 + 0.6 * r2) + bend.y * bh);
          float dry = mask.g / 1.0;
          vec3 baseC = vec3(0.030, 0.062, 0.014);
          vec3 tipC = mix(vec3(0.16, 0.26, 0.055), vec3(0.34, 0.33, 0.12), dry * 0.85 + r5 * 0.15);
          vGC = mix(baseC, tipC, smoothstep(0.0, 1.0, t)) * (0.78 + 0.44 * r3) * uDark;
        `);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGC;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGC;');
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }
}

function flowerAtlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const petal = (cx, cy, n, len, wid, col, centre, cr) => {
    x.save(); x.translate(cx, cy);
    for (let i = 0; i < n; i++) {
      x.rotate((Math.PI * 2) / n);
      const g = x.createLinearGradient(0, 0, 0, -len);
      g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
      x.fillStyle = g; x.beginPath(); x.ellipse(0, -len * 0.55, wid, len * 0.52, 0, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = centre; x.beginPath(); x.arc(0, 0, cr, 0, Math.PI * 2); x.fill();
    x.restore();
  };
  x.clearRect(0, 0, S, S);
  petal(64, 64, 5, 52, 22, ['#e9b80c', '#ffe25a'], '#c89a10', 12);                 // buttercup
  petal(192, 64, 18, 56, 7, ['#f1ece0', '#ffffff'], '#f0c419', 14);                // ox-eye daisy
  for (let i = 0; i < 70; i++) {                                                   // red clover
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 46;
    x.fillStyle = `hsl(${325 + Math.random() * 15}, ${45 + Math.random() * 20}%, ${58 + Math.random() * 18}%)`;
    x.beginPath(); x.ellipse(64 + Math.cos(a) * r, 192 + Math.sin(a) * r, 6, 11, a, 0, Math.PI * 2); x.fill();
  }
  petal(192, 192, 4, 44, 22, ['#4f6fd6', '#9db4ff'], '#f4f4f4', 7);               // speedwell
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class FlowerLayer {
  constructor(shared, count, radius) {
    const pos = [], uv = [], part = [], idx = [];
    // stem: thin vertical quad; head: horizontal quad
    pos.push(-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0); uv.push(0, 0, 1, 0, 0, 1, 1, 1); part.push(0, 0, 0, 0);
    pos.push(-0.5, 1, -0.5, 0.5, 1, -0.5, -0.5, 1, 0.5, 0.5, 1, 0.5); uv.push(0, 0, 1, 0, 0, 1, 1, 1); part.push(1, 1, 1, 1);
    idx.push(0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    g.setAttribute('aGrid', gridAttr(count));
    g.instanceCount = count * count;
    const u = { ...shared, uSpacing: { value: (radius * 2) / count }, uRadius: { value: radius } };
    const mat = new THREE.MeshStandardMaterial({ map: flowerAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${COMMON}\nattribute float aPart;\nvarying float vPart;\nvarying vec2 vAt;`)
        .replace('#include <begin_vertex>', `
          vec2 cell = floor(uCenter.xz / uSpacing) + aGrid;
          float r1 = gh(cell + 2.2), r2 = gh(cell + 31.7), r3 = gh(cell + 13.1), r4 = gh(cell + 6.6);
          vec2 wp = (cell + vec2(r1, r2)) * uSpacing;
          vec2 tuv = terrUV(wp);
          float ground = texture2D(uHeight, tuv).r;
          vec4 mask = texture2D(uMask, tuv);
          float keep = step(r3, mask.b * 0.85) * smoothstep(uRadius, uRadius * 0.55, length(wp - uCenter.xz));
          float kind = floor(r4 * 4.0);
          float hgt = (0.16 + 0.22 * gh(cell + 4.0)) * keep * (kind == 2.0 ? 0.6 : 1.0);
          float headS = (kind == 0.0 ? 0.035 : kind == 1.0 ? 0.05 : kind == 2.0 ? 0.03 : 0.022) * keep;
          vec2 wind = windAt(wp, uTime) * 0.8 + pushAt(wp).xy * 1.2;
          float ang = r1 * 6.283;
          vec3 p = position;
          vec3 transformed;
          if (aPart < 0.5) {
            transformed = vec3(p.x * 0.006 * keep, p.y * hgt, 0.0);
          } else {
            transformed = vec3(p.x * headS, hgt, p.z * headS);
          }
          float ca = cos(ang), sa = sin(ang);
          transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz;
          float tt = transformed.y / max(hgt, 0.001);
          transformed.xz += wind * tt * tt * hgt;
          transformed += vec3(wp.x, ground - 0.01, wp.y);
          vPart = aPart;
          vAt = vec2(mod(kind, 2.0), floor(kind / 2.0)) * 0.5;
        `)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying vec2 vAt;')
        .replace('#include <map_fragment>', `
          if (vPart < 0.5) { diffuseColor.rgb *= vec3(0.05, 0.11, 0.025); }
          else { vec4 tc = texture2D(map, vAt + vMapUv * 0.5); diffuseColor *= tc; }
        `);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }
}

export class Grass {
  constructor(terrain, quality) {
    this.shared = {
      uHeight: { value: terrain.heightTex },
      uMask: { value: terrain.maskTex },
      uCenter: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uHalf: { value: CONFIG.world.half },
      uPush: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0.01, 0)) },
      uWind: { value: new THREE.Vector2(0.32, 0.18) },
    };
    this.group = new THREE.Group();
    this.near = new GrassLayer(terrain, this.shared, { count: quality.grassNear, radius: 13, height: 0.2, width: 0.024, clump: 1 });
    this.far = new GrassLayer(terrain, this.shared, { count: quality.grassFar, radius: 48, height: 0.24, width: 0.045, clump: 3, dark: 0.95 });
    this.flowers = new FlowerLayer(this.shared, quality.flowers, 24);
    this.group.add(this.near.mesh, this.far.mesh, this.flowers.mesh);
  }

  /** pushers: up to four {x, z, r, s} that bend grass away (player, dog). */
  update(dt, center, pushers = []) {
    this.shared.uTime.value += dt;
    this.shared.uCenter.value.copy(center);
    for (let i = 0; i < 4; i++) {
      const p = pushers[i];
      this.shared.uPush.value[i].set(p ? p.x : 0, p ? p.z : 0, p ? p.r : 0.01, p ? p.s : 0);
    }
  }
}

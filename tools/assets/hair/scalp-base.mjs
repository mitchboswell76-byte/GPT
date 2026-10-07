// Scalp base under the hair cards: closes the skull hole and gives the hair
// its dark root colour, so gaps between cards read as depth, not skin.
//
// Texture space is an azimuthal-equidistant projection around the top of the
// head (no seam or pole pinch where the hair is):
//   theta = 90deg - elevation; (u, v) = 0.5 + 0.5 * theta / THETA_MAX * (sin a, cos a)
// The texture is baked per texel: hair root colour with combed streaks that
// follow the groom flow (line-integral convolution of noise), a broken
// strand-like hairline, and reconstructed forehead skin where the original
// mesh hole reaches below the new hairline. Alpha fades it into the Body.
import * as THREE from 'three';
import sharp from 'sharp';
import { rng } from './groom.mjs';

const D2R = Math.PI / 180;
export const THETA_MAX = 128 * D2R;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const uvOf = (a, e) => { const th = Math.PI / 2 - e; const k = 0.5 * th / THETA_MAX; return [0.5 + k * Math.sin(a), 0.5 + k * Math.cos(a)]; };
const aeOfUV = (u, v) => { const x = u - 0.5, y = v - 0.5; const th = Math.sqrt(x * x + y * y) * 2 * THETA_MAX; return { a: Math.atan2(x, y), e: Math.PI / 2 - th, th }; };

/** Skin colour field: Body texture colour where measured, diffused into the hole. */
function skinField(F) {
  const NE = F.skinRGB.length - 1, NA = F.skinRGB[0].length;
  const known = F.skinRGB.map(row => row.map(x => x != null));
  let f = F.skinRGB.map(row => row.map(x => (x ? x.slice() : [150, 110, 95])));
  for (let it = 0; it < 500; it++) {
    for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
      if (known[ie][ia]) continue;
      const up = ie < NE ? f[ie + 1][ia] : f[ie][(ia + NA / 2) % NA], dn = ie > 0 ? f[ie - 1][ia] : f[ie][ia];
      const l = f[ie][(ia + NA - 1) % NA], r = f[ie][(ia + 1) % NA];
      // forehead skin should not pick up the painted temple hair: weight light neighbours more
      const ws = [up, dn, l, r].map(cc => 0.25 + Math.max(0, (0.3 * cc[0] + 0.59 * cc[1] + 0.11 * cc[2]) - 60) / 40);
      const W = ws.reduce((s, x) => s + x, 0);
      f[ie][ia] = [0, 1, 2].map(k => (up[k] * ws[0] + dn[k] * ws[1] + l[k] * ws[2] + r[k] * ws[3]) / W);
    }
  }
  const E0 = -40 * D2R, E1 = 90 * D2R;
  return (a, e) => {
    const fa = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NA; const ia0 = Math.floor(fa) % NA, ia1 = (ia0 + 1) % NA, ta = fa - Math.floor(fa);
    const fe = THREE.MathUtils.clamp((e - E0) / (E1 - E0) * NE, 0, NE); const ie0 = Math.min(NE - 1, Math.floor(fe)), te = fe - ie0;
    return [0, 1, 2].map(k => (f[ie0][ia0][k] * (1 - ta) + f[ie0][ia1][k] * ta) * (1 - te) + (f[ie0 + 1][ia0][k] * (1 - ta) + f[ie0 + 1][ia1][k] * ta) * te);
  };
}

export async function bakeScalpTextures(F, G, { N = 1024, seed = 3 } = {}) {
  const R = rng(seed);
  const skin = skinField(F);
  // 1. flow direction in texture space on a coarse grid
  const C = 128; const fdir = new Float32Array(C * C * 2);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const u = (x + 0.5) / C, v = (y + 0.5) / C; const { a, e, th } = aeOfUV(u, v);
    if (th > THETA_MAX) continue;
    const p = G.surf(a, e); const n = G.dirOf(a, e);
    const t = G.flow(p, n);
    const q = G.toAE(p.clone().addScaledVector(t, 0.002));
    const [u2, v2] = uvOf(q.a, q.e); let dx = u2 - u, dy = v2 - v; const l = Math.hypot(dx, dy) || 1;
    fdir[(y * C + x) * 2] = dx / l; fdir[(y * C + x) * 2 + 1] = dy / l;
  }
  const dirAt = (px, py) => { // bilinear on the coarse grid (pixel coords)
    const gx = px / N * C - 0.5, gy = py / N * C - 0.5;
    const x0 = Math.max(0, Math.min(C - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(C - 2, Math.floor(gy)));
    const tx = Math.min(1, Math.max(0, gx - x0)), ty = Math.min(1, Math.max(0, gy - y0));
    let dx = 0, dy = 0;
    for (const [ox, oy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const i = ((y0 + oy) * C + x0 + ox) * 2; dx += fdir[i] * w; dy += fdir[i + 1] * w;
    }
    const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l];
  };
  // 2. LIC of white noise along the flow -> combed streaks
  const noise = new Float32Array(N * N); for (let i = 0; i < N * N; i++) noise[i] = R();
  const lic = new Float32Array(N * N);
  const STEPS = 14;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, n = 0;
    for (const sgn of [1, -1]) {
      let px = x + 0.5, py = y + 0.5;
      for (let k = 0; k < STEPS; k++) {
        const [dx, dy] = dirAt(px, py); px += sgn * dx; py += sgn * dy;
        const ix = Math.floor(px), iy = Math.floor(py); if (ix < 0 || iy < 0 || ix >= N || iy >= N) break;
        const w = 1 - k / STEPS; s += noise[iy * N + ix] * w; n += w;
      }
    }
    s += noise[y * N + x]; n += 1;
    lic[y * N + x] = s / n;
  }
  // normalise contrast
  let mean = 0; for (let i = 0; i < N * N; i++) mean += lic[i]; mean /= N * N;
  let vv = 0; for (let i = 0; i < N * N; i++) vv += (lic[i] - mean) ** 2; const sd = Math.sqrt(vv / (N * N));
  for (let i = 0; i < N * N; i++) lic[i] = Math.min(1, Math.max(0, 0.5 + (lic[i] - mean) / sd * 0.2));

  // 3. colour + alpha
  const col = Buffer.alloc(N * N * 4), nrm = Buffer.alloc(N * N * 3), mr = Buffer.alloc(N * N * 3);
  const hairMask = new Float32Array(N * N);
  const ROOT = [30, 21, 15], MID = [56, 39, 26];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; const u = (x + 0.5) / N, v = (y + 0.5) / N;
    const { a, e, th } = aeOfUV(u, v);
    const o = i * 4;
    if (th > THETA_MAX) { col[o] = ROOT[0]; col[o + 1] = ROOT[1]; col[o + 2] = ROOT[2]; col[o + 3] = 0; continue; }
    const L = lic[i];
    const d = G.density(a, e);
    // strand-broken hair coverage at the edges
    const h = smooth(0.32, 0.62, d + (L - 0.5) * 0.9 * (1 - d) + (L - 0.5) * 0.3);
    const hole = G.holeAt(a, e);
    const alpha = Math.max(h, hole);
    const sk = skin(a, e);
    const k = 0.35 + 1.3 * (L - 0.5);
    const hair = [0, 1, 2].map(j => ROOT[j] + (MID[j] - ROOT[j]) * Math.min(1, Math.max(0, k)));
    const c3 = alpha > 0 ? [0, 1, 2].map(j => (hair[j] * h + sk[j] * (alpha - h)) / alpha) : hair;
    col[o] = Math.round(c3[0]); col[o + 1] = Math.round(c3[1]); col[o + 2] = Math.round(c3[2]); col[o + 3] = Math.round(alpha * 255);
    hairMask[i] = alpha > 0 ? h / alpha : 0;
  }
  // 4. normal map from LIC height, only in hair (strands as small ridges across the flow)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const hx = lic[y * N + Math.min(N - 1, x + 1)] - lic[y * N + Math.max(0, x - 1)];
    const hy = lic[Math.min(N - 1, y + 1) * N + x] - lic[Math.max(0, y - 1) * N + x];
    const hairK = hairMask[i] * 1.2;
    const nx = -hx * 2.2 * hairK, ny = -hy * 2.2 * hairK; const l = Math.hypot(nx, ny, 1);
    nrm[i * 3] = Math.round((nx / l * 0.5 + 0.5) * 255); nrm[i * 3 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); nrm[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
  }
  // roughness (G): matte skin (Body uses 1.0), slightly glossier hair roots
  for (let i = 0; i < N * N; i++) { mr[i * 3] = 255; mr[i * 3 + 1] = Math.round((1.0 - 0.35 * hairMask[i]) * 255); mr[i * 3 + 2] = 0; }
  const colPng = await sharp(col, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();
  const nrmPng = await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer();
  const mrPng = await sharp(mr, { raw: { width: N, height: N, channels: 3 } }).resize(256, 256).png().toBuffer();
  return { colPng, nrmPng, mrPng, alphaAt: (a, e) => { const [u, v] = uvOf(a, e); const x = Math.min(N - 1, Math.floor(u * N)), y = Math.min(N - 1, Math.floor(v * N)); return col[(y * N + x) * 4 + 3] / 255; } };
}

/**
 * Scalp mesh on an (azimuth, elevation) grid with a fan at the crown pole.
 * Cells whose texture alpha is zero everywhere are dropped.
 */
export function buildScalpMesh(F, alphaAt, { NAz = 120, eMin = -36 * D2R, eMax = 87 * D2R, rows = 52, lift = 0.0009 } = {}) {
  const positions = [], normals = [], uvs = [], index = [];
  const vert = (a, e) => {
    const known = F.isKnown(a, e);
    const p = F.point(a, e, known ? lift : 0.0003);
    const n = F.normal(a, e);
    positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z);
    const [u, v] = uvOf(a, e); uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const W = NAz + 1; const ids = [];
  for (let r = 0; r <= rows; r++) {
    const e = eMin + (eMax - eMin) * r / rows;
    for (let ia = 0; ia <= NAz; ia++) ids.push(vert(2 * Math.PI * ia / NAz, e));
  }
  const pole = vert(0, Math.PI / 2);
  const cellAlpha = (a0, a1, e0, e1) => {
    let m = 0; for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) m = Math.max(m, alphaAt(a0 + (a1 - a0) * i / 3, e0 + (e1 - e0) * j / 3));
    return m;
  };
  for (let r = 0; r < rows; r++) for (let ia = 0; ia < NAz; ia++) {
    const a0 = 2 * Math.PI * ia / NAz, a1 = 2 * Math.PI * (ia + 1) / NAz;
    const e0 = eMin + (eMax - eMin) * r / rows, e1 = eMin + (eMax - eMin) * (r + 1) / rows;
    if (cellAlpha(a0, a1, e0, e1) < 0.004) continue;
    const A = ids[r * W + ia], B = ids[r * W + ia + 1], Cc = ids[(r + 1) * W + ia], D = ids[(r + 1) * W + ia + 1];
    index.push(A, B, Cc, B, D, Cc);
  }
  for (let ia = 0; ia < NAz; ia++) index.push(ids[rows * W + ia], ids[rows * W + ia + 1], pole);
  // outward winding check on one triangle
  const P = positions; const t0 = index.slice(0, 3);
  const va = new THREE.Vector3(P[t0[0] * 3], P[t0[0] * 3 + 1], P[t0[0] * 3 + 2]), vb = new THREE.Vector3(P[t0[1] * 3], P[t0[1] * 3 + 1], P[t0[1] * 3 + 2]), vc = new THREE.Vector3(P[t0[2] * 3], P[t0[2] * 3 + 1], P[t0[2] * 3 + 2]);
  const fn = new THREE.Vector3().crossVectors(vb.clone().sub(va), vc.clone().sub(va));
  if (fn.dot(va.clone().sub(F.c)) < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
  // compact unused vertices
  const used = new Map(); const pos2 = [], nrm2 = [], uv2 = [];
  const idx2 = index.map(i => { if (!used.has(i)) { used.set(i, used.size); pos2.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); nrm2.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]); uv2.push(uvs[i * 2], uvs[i * 2 + 1]); } return used.get(i); });
  return { positions: new Float32Array(pos2), normals: new Float32Array(nrm2), uvs: new Float32Array(uv2), indices: idx2 };
}

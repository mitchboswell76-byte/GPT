// Groom for the keeper: where hair grows, which way it lies and how long it
// is, plus the hair-card geometry built from it.
//
// Haircut: natural short men's cut. ~4 cm on top with some lift, swept gently
// forward and a little to the keeper's left from a crown whorl; tapering to
// 1-1.5 cm on the sides and back; irregular hairline with slight temple
// recession; sideburns running down into the beard.
import * as THREE from 'three';
import { TILES, TILE_ROLES } from './atlas.mjs';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrapDeg = (d) => ((d + 180) % 360 + 360) % 360 - 180;

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

// Smooth 3D value noise in [-1, 1].
function hash(x, y, z) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1; }
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

// Front hairline: elevation (deg) of the hairline by |azimuth| (deg).
// Rounded centre, slight recession at the temple corners (~34 deg), then the
// temple hair drops toward the sideburns.
const HAIRLINE = [[0, 21.5], [8, 21], [16, 22], [24, 24.5], [31, 27.5], [36, 27.5], [41, 25], [46, 20], [51, 13.5], [56, 7], [62, 0]];
function hairlineDeg(absAz) {
  if (absAz <= HAIRLINE[0][0]) return HAIRLINE[0][1];
  for (let i = 1; i < HAIRLINE.length; i++) {
    if (absAz <= HAIRLINE[i][0]) {
      const [a0, e0] = HAIRLINE[i - 1], [a1, e1] = HAIRLINE[i];
      const t = (absAz - a0) / (a1 - a0); const s = t * t * (3 - 2 * t);
      return lerp(e0, e1, s);
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

export function makeGroom(F) {
  const c = F.c;
  const v3 = () => new THREE.Vector3();
  const toAE = (p) => { const d = v3().subVectors(p, c); const r = d.length(); return { a: Math.atan2(d.x, d.z), e: Math.asin(THREE.MathUtils.clamp(d.y / r, -1, 1)), r }; };

  // Painted-hair mask, smoothed over neighbours (null = hole = hair).
  const NA = F.paint[0].length, NE = F.paint.length - 1;
  let pm = F.paint.map(row => row.map(x => (x == null ? 1 : x)));
  for (let it = 0; it < 2; it++) {
    pm = pm.map((row, ie) => row.map((x, ia) => {
      let s = 0, n = 0;
      for (let de = -1; de <= 1; de++) for (let da = -1; da <= 1; da++) {
        const je = ie + de; if (je < 0 || je > NE) continue; s += pm[je][(ia + da + NA) % NA]; n++;
      }
      return s / n;
    }));
  }
  const E0 = -40 * D2R, E1 = 90 * D2R;
  const paintAt = (a, e) => {
    const fa = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NA; const ia0 = Math.floor(fa) % NA, ia1 = (ia0 + 1) % NA, ta = fa - Math.floor(fa);
    const fe = THREE.MathUtils.clamp((e - E0) / (E1 - E0) * NE, 0, NE); const ie0 = Math.min(NE - 1, Math.floor(fe)), te = fe - ie0;
    return (pm[ie0][ia0] * (1 - ta) + pm[ie0][ia1] * ta) * (1 - te) + (pm[ie0 + 1][ia0] * (1 - ta) + pm[ie0 + 1][ia1] * ta) * te;
  };
  // Hole proximity: 1 inside the open crown, fading over ~3 rows outside it.
  const holeAt = (a, e) => {
    const fa = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NA; const ia = Math.round(fa) % NA;
    const fe = (e - E0) / (E1 - E0) * NE;
    let best = 99;
    for (let da = -3; da <= 3; da++) {
      const h = F.holeLow[(ia + da + NA) % NA]; if (h == null) continue;
      best = Math.min(best, Math.max(0, h - fe) + Math.abs(da) * 0.5);
    }
    return 1 - smooth(0.5, 3.5, best);
  };

  // Smoothed radius (ears and other protrusions blurred out) for laying cards.
  const NAs = 96, NEs = 48; const sm = [];
  for (let ie = 0; ie <= NEs; ie++) { const row = []; const e = E0 + (E1 - E0) * ie / NEs; for (let ia = 0; ia < NAs; ia++) row.push(F.radius(2 * Math.PI * ia / NAs, e)); sm.push(row); }
  let smr = sm;
  for (let it = 0; it < 6; it++) smr = smr.map((row, ie) => row.map((x, ia) => {
    let s = 0, n = 0; for (let de = -1; de <= 1; de++) for (let da = -1; da <= 1; da++) { const je = ie + de; if (je < 0 || je > NEs) continue; s += smr[je][(ia + da + NAs) % NAs]; n++; } return s / n;
  }));
  const smoothRadius = (a, e) => {
    const fa = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NAs; const ia0 = Math.floor(fa) % NAs, ia1 = (ia0 + 1) % NAs, ta = fa - Math.floor(fa);
    const fe = THREE.MathUtils.clamp((e - E0) / (E1 - E0) * NEs, 0, NEs); const ie0 = Math.min(NEs - 1, Math.floor(fe)), te = fe - ie0;
    return (smr[ie0][ia0] * (1 - ta) + smr[ie0][ia1] * ta) * (1 - te) + (smr[ie0 + 1][ia0] * (1 - ta) + smr[ie0 + 1][ia1] * ta) * te;
  };
  const hairRadius = (a, e) => Math.min(F.radius(a, e), smoothRadius(a, e) + 0.003);
  const dirOf = (a, e) => v3().set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const surf = (a, e, lift = 0) => v3().copy(c).addScaledVector(dirOf(a, e), hairRadius(a, e) + lift);

  /** Hair density 0..1 at (a, e). */
  const density = (a, e) => {
    const ad = Math.abs(wrapDeg(a * R2D)), ed = e * R2D;
    const p = dirOf(a, e);
    const n1 = noise3(p.x * 9, p.y * 9, p.z * 9), n2 = noise3(p.x * 23 + 5, p.y * 23, p.z * 23);
    const eh = hairlineDeg(ad) + n1 * 1.6 + n2 * 0.8;
    const front = smooth(eh - 0.8, eh + 3.2, ed);
    const back = Math.max(smooth(0.35, 0.7, paintAt(a, e)), holeAt(a, e) > 0.5 ? 1 : 0);
    const wF = 1 - smooth(52, 64, ad);
    let d = lerp(back, front, wF);
    // keep the face clear: below the hairline in front only sideburns grow
    d *= smooth(-33, -27, ed);
    return d;
  };

  // Crown whorl: back of the crown, slightly to the keeper's right.
  const whorl = surf(196 * D2R, 60 * D2R);
  const UP = new THREE.Vector3(0, 1, 0);
  const tangentOf = (v, n) => v.clone().addScaledVector(n, -v.dot(n));

  /** Unit tangent direction the hair lies in at point p (normal n). */
  const flow = (p, n) => {
    const { a, e } = toAE(p);
    const ed = e * R2D, ad = wrapDeg(a * R2D), aad = Math.abs(ad);
    // away from the whorl, with a clockwise swirl near it
    const away = tangentOf(v3().subVectors(p, whorl), n); const dist = away.length(); away.normalize();
    const swirl = v3().crossVectors(n, away).multiplyScalar(-1);
    const ws = Math.exp(-dist / 0.028);
    const vw = away.multiplyScalar(1 - 0.6 * ws).addScaledVector(swirl, 0.95 * ws).normalize();
    // gravity / combing on the sides and back: down, a little back above the
    // ears and a little forward at the temples
    const frontness = 1 - smooth(45, 100, aad);
    const g = tangentOf(v3().set(0, -1, lerp(-0.35, 0.3, frontness)), n).normalize();
    const wg = smooth(42, 12, ed) * (1 - 0.3 * smooth(30, 0, aad));
    const dir = vw.multiplyScalar(1 - wg).addScaledVector(g, wg);
    // top-front: swept gently forward and to the keeper's left (+X)
    const top = smooth(25, 55, ed) * smooth(110, 30, aad);
    const fwd = tangentOf(v3().set(0.42, 0.0, 1), n).normalize();
    dir.addScaledVector(fwd, 0.55 * top);
    // sideburns: straight down
    const sb = smooth(18, 2, ed) * smooth(48, 58, aad) * smooth(82, 70, aad);
    dir.addScaledVector(tangentOf(v3().set(0, -1, 0.05), n).normalize(), 2.0 * sb);
    // gentle low-frequency variation so the flow is not mechanically smooth
    const nr = noise3(p.x * 14 + 3, p.y * 14, p.z * 14) * 0.22;
    dir.normalize();
    return dir.applyAxisAngle(n, nr).normalize();
  };

  /** Hair length (m) at (a, e) before per-card variation. */
  const lengthAt = (a, e) => {
    const ed = e * R2D, aad = Math.abs(wrapDeg(a * R2D));
    // taper: sides/back short, top long; the long region reaches lower at the back (crown)
    const topT = smooth(lerp(16, 26, smooth(60, 20, aad)), lerp(48, 56, smooth(60, 20, aad)), ed);
    let L = lerp(0.012, 0.042, topT);
    // shorter right at the front hairline so the fringe does not hang over the brow
    const eh = hairlineDeg(aad);
    if (aad < 60) L *= lerp(0.5, 1, smooth(eh, eh + 14, ed));
    if (ed < 0) L *= lerp(0.8, 1, smooth(-25, 0, ed)); // nape / sideburns: shortest
    return L;
  };
  const liftAt = (a, e) => {
    const ed = e * R2D;
    const dW = surf(a, e).distanceTo(whorl);
    return lerp(0.0016, 0.0088, smooth(18, 55, ed)) * lerp(0.35, 1, smooth(0.008, 0.035, dW));
  };

  return { toAE, density, flow, lengthAt, liftAt, surf, hairRadius, dirOf, whorl, paintAt, holeAt };
}

// ---------------------------------------------------------------------------
// Card generation
// ---------------------------------------------------------------------------
const LAYERS = [
  // coverage = target overlap; width (m) on top / sides; root height; lift scale; tiles; tint range
  { name: 'under', coverage: 1.5, wTop: 0.013, wSide: 0.008, h0: 0.0010, lift: [0.25, 0.45], tiles: TILE_ROLES.dense, tint: [0.68, 0.82], lenK: [0.85, 1.0] },
  { name: 'mid', coverage: 1.4, wTop: 0.011, wSide: 0.0068, h0: 0.0016, lift: [0.6, 1.0], tiles: [...TILE_ROLES.dense, ...TILE_ROLES.clump], tint: [0.82, 0.96], lenK: [0.85, 1.12] },
  { name: 'top', coverage: 0.75, wTop: 0.0075, wSide: 0.005, h0: 0.0022, lift: [0.9, 1.3], tiles: [...TILE_ROLES.clump, ...TILE_ROLES.wisp], tint: [0.9, 1.0], lenK: [0.8, 1.15] },
];

/**
 * Builds hair-card geometry.
 * Returns flat arrays: positions, normals, tangents, uvs, colors, indices, roots (per-vertex root position for skin weights).
 */
export function buildCards(F, G, { seed = 5 } = {}) {
  const R = rng(seed);
  const out = { positions: [], normals: [], tangents: [], uvs: [], colors: [], indices: [], rootOf: [], cards: 0 };
  const cards = [];

  // Variable-radius Poisson-disk sampling on the head, per layer.
  for (const [li, L] of LAYERS.entries()) {
    const accepted = []; const cell = 0.004; const grid = new Map();
    const key = (p) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
    const candidates = 90000;
    for (let k = 0; k < candidates; k++) {
      // uniform direction
      const z = R() * 2 - 1, t = R() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      const dx = s * Math.cos(t), dy = z, dz = s * Math.sin(t);
      const az = Math.atan2(dx, dz), el = Math.asin(dy);
      if (el < -36 * D2R) continue;
      const d = G.density(az, el);
      if (d < 0.02 || R() > Math.pow(d, 1.3)) continue;
      const len = G.lengthAt(az, el);
      const topK = THREE.MathUtils.clamp((len - 0.012) / 0.03, 0, 1);
      const w = lerp(L.wSide, L.wTop, topK);
      // spacing so that (card area / disc area) ~ coverage
      // (dart-throwing packs ~1 point per 1.7 r^2)
      const r = Math.sqrt((w * len) / (1.7 * L.coverage));
      const p = G.surf(az, el);
      // neighbourhood check
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
      const span = Math.ceil(r / cell); let ok = true;
      for (let ix = -span; ix <= span && ok; ix++) for (let iy = -span; iy <= span && ok; iy++) for (let iz = -span; iz <= span && ok; iz++) {
        const list = grid.get(`${cx + ix},${cy + iy},${cz + iz}`); if (!list) continue;
        for (const q of list) if (q.p.distanceTo(p) < Math.max(r, q.r) * 0.9) { ok = false; break; }
      }
      if (!ok) continue;
      const item = { p, r, a: az, e: el, d, len, w, layer: li };
      accepted.push(item);
      const kk = key(p); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(item);
    }
    cards.push(...accepted);
  }

  // Fine hairline / sideburn fuzz: small cards right at the hairline edge.
  {
    let n = 0;
    for (let k = 0; k < 40000 && n < 260; k++) {
      const z = R() * 2 - 1, t = R() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      const dx = s * Math.cos(t), dy = z, dz = s * Math.sin(t);
      const az = Math.atan2(dx, dz), el = Math.asin(dy);
      if (Math.abs(az) > 75 * D2R || el < -20 * D2R) continue;
      const d = G.density(az, el);
      if (d < 0.08 || d > 0.85 || R() > 0.6) continue;
      cards.push({ p: G.surf(az, el), r: 0, a: az, e: el, d, len: lerp(0.008, 0.014, R()), w: lerp(0.0035, 0.005, R()), layer: 3 });
      n++;
    }
  }

  const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (const C of cards) {
    const L = C.layer < 3 ? LAYERS[C.layer] : null;
    const fine = C.layer === 3;
    const lenK = fine ? 1 : lerp(L.lenK[0], L.lenK[1], R());
    const len = C.len * lenK * (C.layer < 3 ? lerp(0.7, 1, Math.min(1, C.d * 1.3)) : 1);
    const segs = len < 0.016 ? 2 : len < 0.03 ? 3 : 4;
    const liftMax = fine ? 0.0012 : G.liftAt(C.a, C.e) * lerp(L.lift[0], L.lift[1], R());
    const h0 = fine ? 0.0007 : L.h0 * lerp(0.8, 1.2, R());
    const tile = fine ? TILE_ROLES.fine[0] : L.tiles[Math.floor(R() * L.tiles.length)];
    const flip = R() < 0.5;
    const tilt = (R() - 0.5) * (C.layer === 2 ? 0.6 : 0.4);          // roll around the strand axis
    const curl = (R() - 0.5) * (fine ? 18 : 9);                        // bend (rad / m) around the normal
    const tint = fine ? lerp(0.75, 0.9, R()) : lerp(L.tint[0], L.tint[1], R());
    const warm = 1 + (R() - 0.5) * 0.08;
    // walk the streamline
    let { a, e } = C;
    const pts = [], nrms = [], dirs = [];
    let ang = (R() - 0.5) * 0.25;
    for (let sI = 0; sI <= segs; sI++) {
      const f = sI / segs;
      const prof = 1 - (1 - f) * (1 - f);                  // rises quickly, then flattens
      const h = h0 + liftMax * prof;
      const p = G.surf(a, e, h);
      n.copy(G.dirOf(a, e)); // approximate normal by radial direction, refined below
      const pa = G.surf(a + 0.02, e), pb = G.surf(a - 0.02, e), pc = G.surf(a, Math.min(e + 0.02, 1.55)), pd = G.surf(a, e - 0.02);
      const nn = tmp.crossVectors(pa.sub(pb), pc.sub(pd)); if (nn.lengthSq() > 1e-12) { nn.normalize(); if (nn.dot(n) > 0.2) n.copy(nn); }
      t.copy(G.flow(p, n)).applyAxisAngle(n, ang);
      pts.push(p); nrms.push(n.clone()); dirs.push(t.clone());
      ang += curl * len / segs;
      // advance along the surface
      const q = p.clone().addScaledVector(t, len / segs);
      const ae = G.toAE(q); a = ae.a; e = Math.min(ae.e, 89.5 * D2R);
    }
    // tangent along the polyline (central differences) for a smooth ribbon
    const base = out.positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const p = pts[i]; const nm = nrms[i];
      const dir = (i < segs ? tmp.subVectors(pts[i + 1], p) : tmp.subVectors(p, pts[i - 1])).normalize().clone();
      b.crossVectors(nm, dir).normalize().applyAxisAngle(dir, tilt);
      const f = i / segs; const w = C.w * (1 - 0.3 * f) * 0.5;
      const cardN = v3c().crossVectors(dir, b).normalize(); if (cardN.dot(nm) < 0) cardN.negate();
      const shadeN = nm.clone().multiplyScalar(0.7).addScaledVector(cardN, 0.3).normalize();
      for (const side of [-1, 1]) {
        const q = p.clone().addScaledVector(b, side * w);
        out.positions.push(q.x, q.y, q.z);
        out.normals.push(shadeN.x, shadeN.y, shadeN.z);
        // glTF tangent: direction of increasing u; bitangent (along v = root->tip) = cross(N, T) * w
        const uLocal = side < 0 ? 0 : 1; const u = flip ? 1 - uLocal : uLocal;
        const T = flip ? b.clone().negate() : b.clone();
        const bit = v3c().crossVectors(shadeN, T); const hand = bit.dot(dir) >= 0 ? 1 : -1;
        out.tangents.push(T.x, T.y, T.z, hand);
        out.uvs.push((tile + 0.02 + u * 0.96) / TILES, Math.min(0.995, 0.004 + f * 0.99));
        out.colors.push(tint * warm, tint, tint / warm, 1);
        out.rootOf.push(pts[0].x, pts[0].y, pts[0].z);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2, b0 = a0 + 1, c0 = a0 + 2, d0 = a0 + 3;
      out.indices.push(a0, c0, b0, b0, c0, d0);
    }
    out.cards++;
  }
  // make sure triangles face outward (front face = away from the head)
  const P = out.positions, I = out.indices;
  for (let i = 0; i < I.length; i += 3) {
    const A = new THREE.Vector3(P[I[i] * 3], P[I[i] * 3 + 1], P[I[i] * 3 + 2]);
    const B = new THREE.Vector3(P[I[i + 1] * 3], P[I[i + 1] * 3 + 1], P[I[i + 1] * 3 + 2]);
    const Cc = new THREE.Vector3(P[I[i + 2] * 3], P[I[i + 2] * 3 + 1], P[I[i + 2] * 3 + 2]);
    const fn = new THREE.Vector3().crossVectors(B.clone().sub(A), Cc.clone().sub(A));
    const nN = new THREE.Vector3(out.normals[I[i] * 3], out.normals[I[i] * 3 + 1], out.normals[I[i] * 3 + 2]);
    if (fn.dot(nN) < 0) { const tt = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = tt; }
  }
  out.counts = LAYERS.map((L, i) => [L.name, cards.filter(cc => cc.layer === i).length]).concat([['fine', cards.filter(cc => cc.layer === 3).length]]);
  return out;
}
function v3c() { return new THREE.Vector3(); }

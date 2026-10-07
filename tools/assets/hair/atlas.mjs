// Strand atlas for the keeper's hair cards.
//
// TILES tiles side by side; each tile is one clump variant with strands
// running root (v = 0, bottom of the tile in UV space) to tip (v = 1).
// Output: RGBA colour (alpha = strand coverage) and a tangent-space normal map
// in which every strand is a small cylinder (normal tilts across the strand),
// so light breaks up into individual strands up close.
import sharp from 'sharp';

export const TILES = 8;
export const TILE_W = 128, TILE_H = 512;
// What each tile is for (the groom picks tiles by role).
export const TILE_ROLES = {
  dense: [0, 1, 4],      // body of the haircut
  clump: [2, 3, 7],      // separated, lifted clumps on top
  wisp: [5],             // sparse flyaways
  fine: [6],             // hairline / sideburn fuzz
};

// Dark brown palette (sRGB), matched to the painted hair at the back of the
// head (~47,33,22) and harmonised with the warmer beard (~62,36,19).
const PALETTE = [
  [50, 36, 26], [58, 42, 30], [64, 46, 32], [44, 32, 23], [72, 52, 36], [54, 39, 28],
];
const HIGHLIGHT = [96, 72, 52];

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const VARIANTS = [
  // n strands, root spread (std-dev, tile fractions), convergence toward tip,
  // length range, width px, wave, split, share of lighter strands
  { n: 70, spread: 0.2, conv: 0.5, len: [0.7, 1.0], w: [1.1, 1.9], wave: 0.02, split: 0 },       // 0 dense, pointed
  { n: 64, spread: 0.21, conv: 0.2, len: [0.55, 1.0], w: [1.1, 1.8], wave: 0.03, split: 0 },     // 1 dense, fringed tips
  { n: 46, spread: 0.15, conv: 0.6, len: [0.7, 1.0], w: [1.0, 1.7], wave: 0.04, split: 0 },      // 2 clump, pointed
  { n: 50, spread: 0.12, conv: 0.5, len: [0.65, 0.97], w: [1.0, 1.7], wave: 0.03, split: 1 },    // 3 split clump
  { n: 84, spread: 0.22, conv: 0.12, len: [0.75, 1.0], w: [1.2, 2.0], wave: 0.02, split: 0 },    // 4 wide sheet
  { n: 16, spread: 0.18, conv: 0.3, len: [0.55, 1.0], w: [0.8, 1.3], wave: 0.06, split: 0 },     // 5 wisps
  { n: 26, spread: 0.24, conv: 0.05, len: [0.35, 1.0], w: [0.7, 1.15], wave: 0.05, split: 0 },   // 6 fine hairline hairs
  { n: 56, spread: 0.17, conv: 0.45, len: [0.65, 1.0], w: [1.1, 1.9], wave: 0.035, split: 0, light: 0.16 }, // 7 coarse, lighter strands
];
const gauss = (R) => { let s = 0; for (let i = 0; i < 4; i++) s += R(); return (s - 2) / 0.577; };

export async function strandAtlas(seed = 11) {
  const W = TILE_W * TILES, H = TILE_H;
  const acc = new Float32Array(W * H * 3);   // colour (premultiplied)
  const cov = new Float32Array(W * H);       // coverage
  const nrm = new Float32Array(W * H * 2);   // top strand normal xy
  const R = rng(seed);
  for (let t = 0; t < TILES; t++) {
    const V = VARIANTS[t];
    const x0t = t * TILE_W;
    // Strands are drawn back-to-front: earlier strands sit under later ones.
    const centres = V.split ? [0.32 + R() * 0.06, 0.62 + R() * 0.06] : [0.5 + (R() - 0.5) * 0.12];
    for (let s = 0; s < V.n; s++) {
      const cc = centres[s % centres.length];
      const xr = Math.min(0.9, Math.max(0.1, cc + gauss(R) * V.spread * (V.split ? 0.8 : 1) + (V.split ? 0 : 0.5 - cc))); // root x
      const len = V.len[0] + R() * (V.len[1] - V.len[0]);
      const vs = R() * R() * 0.22;                            // root start (staggered)
      const xt = xr + (cc - xr) * V.conv + (R() - 0.5) * 0.12; // tip x
      const bend = (R() - 0.5) * 0.12, wave = V.wave * (R() + 0.3), wph = R() * 6.28;
      const w0 = V.w[0] + R() * (V.w[1] - V.w[0]);
      const base = PALETTE[Math.floor(R() * PALETTE.length)];
      const bright = 0.85 + R() * 0.3;
      const lightStrand = V.light && R() < V.light;
      const col = lightStrand ? HIGHLIGHT : base;
      const ny = (R() - 0.5) * 0.35;                          // out-of-plane tilt of this strand
      const steps = Math.ceil((len - vs) * H * 2.2);
      let px = null, py = null;
      for (let k = 0; k <= steps; k++) {
        const f = k / steps; const v = vs + (len - vs) * f;
        const x = xr + (xt - xr) * f + bend * Math.sin(Math.PI * f) + wave * Math.sin(wph + f * 9);
        if (x < 0.015 || x > 0.985) break;
        const cx = x0t + x * TILE_W, cy = v * H;
        // fade strands toward the tile's side edges so card borders never show
        const edge = smooth(0.0, 0.2, x) * smooth(1.0, 0.8, x);
        if (px !== null && Math.hypot(cx - px, cy - py) < 0.45) continue;
        px = cx; py = cy;
        const tip = smooth(0.62, 1.0, f);
        const width = w0 * (1 - 0.6 * tip);
        const alpha = (1 - 0.9 * tip * tip) * (0.35 + 0.65 * edge);
        const r = width / 2 + 0.75;
        // root darkening: hair is darker near the scalp (less light reaches)
        const shade = bright * (0.78 + 0.22 * smooth(0, 0.4, v));
        for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
          if (yy < 0 || yy >= H) continue;
          for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
            if (xx < x0t || xx >= x0t + TILE_W) continue;
            const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
            const d = Math.sqrt(dx * dx + dy * dy * 0.15); // mostly horizontal distance (strand runs along y)
            const a = Math.min(1, Math.max(0, width / 2 + 0.5 - d)) * alpha;
            if (a <= 0) continue;
            const i = yy * W + xx;
            // keep the max coverage along this strand (no self-accumulation)
            const prev = cov[i];
            const na = prev + (1 - prev) * a;
            const ka = na - prev; // added coverage
            if (ka > 0) {
              acc[i * 3] = acc[i * 3] * (1 - a) + col[0] * shade * a;
              acc[i * 3 + 1] = acc[i * 3 + 1] * (1 - a) + col[1] * shade * a;
              acc[i * 3 + 2] = acc[i * 3 + 2] * (1 - a) + col[2] * shade * a;
              cov[i] = na;
            }
            if (a > 0.35) { const sx = Math.max(-1, Math.min(1, dx / (width / 2 + 0.5))); nrm[i * 2] = sx * 0.75; nrm[i * 2 + 1] = ny; }
          }
        }
      }
    }
  }
  // Resolve: colour = premultiplied / coverage; transparent texels get the
  // tile's mean hair colour so mip-maps do not bleed dark or light fringes.
  const col = Buffer.alloc(W * H * 4); const nb = Buffer.alloc(W * H * 3);
  for (let t = 0; t < TILES; t++) {
    let mr = 0, mg = 0, mb = 0, mn = 0;
    for (let y = 0; y < H; y++) for (let x = t * TILE_W; x < (t + 1) * TILE_W; x++) {
      const i = y * W + x; if (cov[i] > 0.5) { mr += acc[i * 3] / cov[i]; mg += acc[i * 3 + 1] / cov[i]; mb += acc[i * 3 + 2] / cov[i]; mn++; }
    }
    mr /= mn; mg /= mn; mb /= mn;
    for (let y = 0; y < H; y++) for (let x = t * TILE_W; x < (t + 1) * TILE_W; x++) {
      const i = y * W + x; const c = cov[i];
      const k = smooth(0.0, 0.5, c);
      const r = c > 0 ? acc[i * 3] / c : mr, g = c > 0 ? acc[i * 3 + 1] / c : mg, b = c > 0 ? acc[i * 3 + 2] / c : mb;
      // image row 0 = UV v 0 (glTF convention), so root is at the top of the PNG
      const o = i * 4;
      col[o] = Math.round(mr + (r - mr) * k); col[o + 1] = Math.round(mg + (g - mg) * k); col[o + 2] = Math.round(mb + (b - mb) * k);
      col[o + 3] = Math.round(Math.min(1, c) * 255);
      const nx = nrm[i * 2] * k, ny = nrm[i * 2 + 1] * k, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      nb[i * 3] = Math.round((nx * 0.5 + 0.5) * 255); nb[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255); nb[i * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  const colPng = await sharp(col, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const nrmPng = await sharp(nb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return { colPng, nrmPng, width: W, height: H };
}

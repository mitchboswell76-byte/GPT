// Head field for the keeper's haircut.
//
// The Body mesh has the top of the skull missing, so the head shape is
// measured by casting rays out from a point inside the skull (ear/eye level)
// against the Body mesh on an azimuth x elevation grid:
//   azimuth a: 0 = +Z (face), +pi/2 = +X (the keeper's left)
//   elevation e: 0 = horizontal, pi/2 = straight up
// Where rays escape through the hole the radius comes from an ellipsoid fitted
// to the skin that exists (crown height fixed from proportions) plus relaxed
// residuals, so the filled skull blends into the real one.
//
// Every sample also records whether the Body texture there is painted hair
// (the dark region over the back and sides of the head), which is where the
// short back-and-sides cards grow.
import * as THREE from 'three';

export const NA = 144, NE = 64;
export const E0 = THREE.MathUtils.degToRad(-40), E1 = THREE.MathUtils.degToRad(90);

export const dirOf = (a, e, out = new THREE.Vector3()) => out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
export const elevOfRow = (ie) => E0 + (E1 - E0) * ie / NE;
export const rowOfElev = (e) => (e - E0) / (E1 - E0) * NE;

/**
 * @param {object} body  { pos, idx, uv, jnt, wgt } typed arrays of the Body primitive
 * @param {number} headJoint index of mixamorig:Head in the skin's joints
 * @param {object} tex  { data, width, height, channels } raw Body diffuse
 */
export function buildHeadField(body, headJoint, tex) {
  const { pos, idx, uv, jnt, wgt } = body;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);

  // Head vertices: dominated by the Head joint and above the jaw line.
  const hb = new THREE.Box3(); const v = new THREE.Vector3();
  for (let i = 0; i < pos.length / 3; i++) {
    let best = 0, bj = -1; for (let k = 0; k < 4; k++) if (wgt[i * 4 + k] > best) { best = wgt[i * 4 + k]; bj = jnt[i * 4 + k]; }
    if (bj === headJoint && pos[i * 3 + 1] > 1.62) hb.expandByPoint(v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  const c = hb.getCenter(new THREE.Vector3());
  c.y = 1.705; c.z -= 0.012; // ear/eye level, a little behind the face centre
  const ray = new THREE.Raycaster(); ray.far = 0.22;

  const texAt = (u, vv) => {
    const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
    const y = Math.min(tex.height - 1, Math.max(0, Math.floor(vv * tex.height)));
    const o = (y * tex.width + x) * tex.channels;
    return [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
  };
  // Painted hair is dark brown (~47,33,22); skin is much lighter.
  const hairiness = (rgb) => {
    const l = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
    return THREE.MathUtils.clamp((80 - l) / 30, 0, 1);
  };

  const R = [], paint = [], skinRGB = [];
  const d = new THREE.Vector3();
  for (let ie = 0; ie <= NE; ie++) {
    const row = [], prow = [], srow = []; const e = elevOfRow(ie);
    for (let ia = 0; ia < NA; ia++) {
      const a = 2 * Math.PI * ia / NA; dirOf(a, e, d);
      ray.set(c, d); const hit = ray.intersectObject(mesh, false)[0];
      row.push(hit ? hit.distance : null);
      if (hit && hit.uv) {
        // average a few texels around the hit so strand paint reads as a mask
        let h = 0; const rgb = [0, 0, 0];
        for (let k = -2; k <= 2; k++) for (let m = -2; m <= 2; m++) {
          const t = texAt(hit.uv.x + k / tex.width, hit.uv.y + m / tex.height);
          h += hairiness(t); rgb[0] += t[0]; rgb[1] += t[1]; rgb[2] += t[2];
        }
        prow.push(h / 25); srow.push(rgb.map(x => x / 25));
      } else { prow.push(null); srow.push(null); }
    }
    R.push(row); paint.push(prow); skinRGB.push(srow);
  }

  // Least-squares ellipsoid (axis aligned, centred at c) from known samples.
  // 1/r^2 = dx^2 p + dy^2 q + dz^2 s ; the vertical axis is fixed (crown open):
  // top of head ~11.5 cm above eye level.
  const B = 1.808 - c.y; const q = 1 / (B * B);
  const M = [[0, 0], [0, 0]], bvec = [0, 0];
  for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
    const r = R[ie][ia]; if (r == null) continue;
    const e = elevOfRow(ie), a = 2 * Math.PI * ia / NA; dirOf(a, e, d);
    if (e < THREE.MathUtils.degToRad(-5)) continue; // ignore face/jaw below the ears
    const f = [d.x * d.x, d.z * d.z]; const y = 1 / (r * r) - d.y * d.y * q;
    for (let i = 0; i < 2; i++) { bvec[i] += f[i] * y; for (let j = 0; j < 2; j++) M[i][j] += f[i] * f[j]; }
  }
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const P = new THREE.Vector3((bvec[0] * M[1][1] - bvec[1] * M[0][1]) / det, q, (M[0][0] * bvec[1] - M[1][0] * bvec[0]) / det);
  const rEll = (dd) => 1 / Math.sqrt(dd.x * dd.x * P.x + dd.y * dd.y * P.y + dd.z * dd.z * P.z);

  const known = R.map(row => row.map(x => x != null));
  const fill = R.map((row, ie) => row.map((r, ia) => (r == null ? 0 : r - rEll(dirOf(2 * Math.PI * ia / NA, elevOfRow(ie), d)))));
  for (let it = 0; it < 800; it++) {
    for (let ie = 0; ie <= NE; ie++) for (let ia = 0; ia < NA; ia++) {
      if (known[ie][ia]) continue;
      const up = ie < NE ? fill[ie + 1][ia] : fill[ie][(ia + NA / 2) % NA];
      const dn = ie > 0 ? fill[ie - 1][ia] : fill[ie][ia];
      fill[ie][ia] = (up + dn + fill[ie][(ia + 1) % NA] + fill[ie][(ia + NA - 1) % NA]) / 4;
    }
  }
  const poleRes = fill[NE].reduce((s, x) => s + x, 0) / NA;
  for (let ia = 0; ia < NA; ia++) fill[NE][ia] = poleRes;

  // Lowest open (hole) row per azimuth.
  const holeLow = new Array(NA).fill(null);
  for (let ia = 0; ia < NA; ia++) for (let ie = 0; ie <= NE; ie++) if (!known[ie][ia]) { holeLow[ia] = ie; break; }

  // Smooth radius field: bilinear in (row, azimuth).
  const radius = (a, e) => {
    const fa = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NA; const ia0 = Math.floor(fa) % NA, ia1 = (ia0 + 1) % NA, ta = fa - Math.floor(fa);
    const fe = THREE.MathUtils.clamp(rowOfElev(e), 0, NE); const ie0 = Math.min(NE - 1, Math.floor(fe)), te = fe - ie0;
    const res = (fill[ie0][ia0] * (1 - ta) + fill[ie0][ia1] * ta) * (1 - te) + (fill[ie0 + 1][ia0] * (1 - ta) + fill[ie0 + 1][ia1] * ta) * te;
    return rEll(dirOf(a, e, new THREE.Vector3())) + res;
  };
  const point = (a, e, lift = 0, out = new THREE.Vector3()) => {
    const dd = dirOf(a, e, new THREE.Vector3()); const r = radius(a, e) + lift;
    return out.copy(c).addScaledVector(dd, r);
  };
  // Surface normal by finite differences of the radius field.
  const normal = (a, e, out = new THREE.Vector3()) => {
    const h = 0.012;
    const ce = Math.min(e, Math.PI / 2 - h * 1.01);
    const pa = point(a + h / Math.max(0.2, Math.cos(ce)), ce), pb = point(a - h / Math.max(0.2, Math.cos(ce)), ce);
    const pc = point(a, ce + h), pd = point(a, ce - h);
    const ta = pa.sub(pb), te = pc.sub(pd);
    out.crossVectors(ta, te).normalize();
    if (out.dot(dirOf(a, e, new THREE.Vector3())) < 0) out.negate();
    return out;
  };
  const paintAt = (a, e) => {
    const ia = Math.round(((a / (2 * Math.PI)) % 1 + 1) % 1 * NA) % NA;
    const ie = Math.round(THREE.MathUtils.clamp(rowOfElev(e), 0, NE));
    return paint[ie][ia];
  };
  const isKnown = (a, e) => {
    const ia = Math.round(((a / (2 * Math.PI)) % 1 + 1) % 1 * NA) % NA;
    const ie = Math.round(THREE.MathUtils.clamp(rowOfElev(e), 0, NE));
    return known[ie][ia];
  };

  return {
    c, R, known, paint, skinRGB, holeLow, radius, point, normal, paintAt, isKnown, ellipsoid: P,
    stats: { centre: c.toArray().map(x => +x.toFixed(3)), ellipsoid: [1 / Math.sqrt(P.x), 1 / Math.sqrt(P.y), 1 / Math.sqrt(P.z)].map(x => +x.toFixed(3)) },
  };
}

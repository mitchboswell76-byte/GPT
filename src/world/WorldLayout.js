// Fixed map layout for the opening region: stream course, footpaths, the
// outpost and points of interest. +X is east, -Z is north.
import * as THREE from 'three';

/** Nearest-segment queries on a polyline using a coarse bucket grid. */
export class PolylineIndex {
  constructor(points, cell = 8) {
    this.p = points; // [{x,z}]
    this.cell = cell;
    this.buckets = new Map();
    this.len = [0];
    for (let i = 1; i < points.length; i++) {
      this.len.push(this.len[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    }
    this.total = this.len[this.len.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const x0 = Math.floor(Math.min(a.x, b.x) / cell) - 2, x1 = Math.floor(Math.max(a.x, b.x) / cell) + 2;
      const z0 = Math.floor(Math.min(a.z, b.z) / cell) - 2, z1 = Math.floor(Math.max(a.z, b.z) / cell) + 2;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z;
        if (!this.buckets.has(k)) this.buckets.set(k, []);
        this.buckets.get(k).push(i);
      }
    }
  }
  /** {d, s (arc length), u (0..1), i, tx, tz} or null beyond ~2 cells. */
  nearest(x, z) {
    const k = Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell);
    const list = this.buckets.get(k);
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const a = this.p[i], b = this.p[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1e-9;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t, pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) {
        const L = Math.sqrt(l2);
        best = { d, i, s: this.len[i] + L * t, tx: abx / L, tz: abz / L, px, pz };
      }
    }
    if (best) best.u = best.s / this.total;
    return best;
  }
  /** Signed side of the polyline (left positive) at the nearest point. */
  side(x, z, near = this.nearest(x, z)) {
    if (!near) return 0;
    return Math.sign(near.tx * (z - near.pz) - near.tz * (x - near.px));
  }
}

const v = (x, z) => new THREE.Vector3(x, 0, z);

// Stream runs north -> south along the west side of the meadow.
export const STREAM_CURVE = new THREE.CatmullRomCurve3([
  v(-20, -190), v(-23, -120), v(-30, -70), v(-37, -38), v(-31, -6), v(-33, 20), v(-43, 52), v(-40, 92), v(-49, 135), v(-58, 200),
], false, 'centripetal');
export const STREAM_PTS = STREAM_CURVE.getSpacedPoints(520).map((p) => ({ x: p.x, z: p.z }));
export const STREAM = new PolylineIndex(STREAM_PTS, 8);
export const STREAM_HALF_WIDTH = (u) => 1.55 + 0.45 * Math.sin(u * 37.0) * Math.sin(u * 11.0 + 1.0);

// Footbridge: the stream point nearest the meadow path, oriented across it.
export const BRIDGE = (() => {
  const n = STREAM.nearest(-33.5, 21);
  const nx = -n.tz, nz = n.tx; // normal (points west/east)
  const sgn = nx < 0 ? 1 : -1; // make (nx,nz) point west
  return { x: n.px, z: n.pz, nx: nx * sgn, nz: nz * sgn, yaw: Math.atan2(nx * sgn, nz * sgn), halfLength: 4.2, halfWidth: 0.85 };
})();

const bp = (k) => ({ x: BRIDGE.x + BRIDGE.nx * k, z: BRIDGE.z + BRIDGE.nz * k });

export const PATHS = [
  {
    id: 'woodland',
    width: 1.35,
    pts: [{ x: 0.5, z: 0.5 }, { x: -4, z: 4.5 }, { x: -10, z: 9.5 }, { x: -17, z: 14.5 }, { x: -22.5, z: 18.5 }, bp(-6.5), bp(-4.6), bp(4.6), bp(6.5),
      { x: bp(6.5).x - 4, z: bp(6.5).z + 4.5 }, { x: -48, z: 33 }, { x: -53.5, z: 36.5 }],
  },
  { id: 'meadow', width: 1.2, pts: [{ x: 1.5, z: 0.5 }, { x: 5, z: 6 }, { x: 8.5, z: 12.5 }, { x: 10, z: 17 }] },
  { id: 'yard', width: 2.6, pts: [{ x: -9, z: -2 }, { x: -2, z: -1.2 }, { x: 5, z: -1.6 }] },
];
export const PATH_INDEX = PATHS.map((p) => {
  const dense = [];
  const curve = new THREE.CatmullRomCurve3(p.pts.map((q) => v(q.x, q.z)), false, 'centripetal');
  for (const q of curve.getSpacedPoints(Math.ceil(curve.getLength() * 1.5))) dense.push({ x: q.x, z: q.z });
  return { ...p, index: new PolylineIndex(dense, 6) };
});

export const OUTPOST = {
  centre: { x: 0, z: -3 },
  cabin: { x: 0.2, z: -8.4, yaw: 0 },
  shed: { x: -10.2, z: -5.6, yaw: 0.12 },
  noticeboard: { x: 6.4, z: 0.4, yaw: -0.65 },
  supplies: { x: 6.2, z: -5.4 },
  pump: { x: -4.2, z: -3.6 },
};

export const PUPPY_SPAWN = { x: -58.5, z: 39.5 };
export const FALLEN_LOG = { x: -60.2, z: 42.2, yaw: -1.1 };
export const WOODLAND_EDGE_X = -45;

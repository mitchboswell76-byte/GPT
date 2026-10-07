// 2D collision world on the ground plane: circles, oriented boxes and
// capsules (segments with radius). Used for character movement and for
// construction placement checks.

export class Colliders {
  constructor() {
    this.items = [];
    this.nextId = 1;
  }

  addCircle(x, z, r, tag, data) { return this._add({ type: 'circle', x, z, r, tag, data }); }
  addBox(x, z, hx, hz, yaw, tag, data) { return this._add({ type: 'box', x, z, hx, hz, yaw, c: Math.cos(yaw), s: Math.sin(yaw), tag, data }); }
  addSegment(x0, z0, x1, z1, r, tag, data) { return this._add({ type: 'seg', x0, z0, x1, z1, r, tag, data, x: (x0 + x1) / 2, z: (z0 + z1) / 2 }); }

  _add(it) { it.id = this.nextId++; it.enabled = true; this.items.push(it); return it; }
  remove(it) { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }

  /**
   * Penetration of a circle (x, z, r) into one item.
   * Returns {d, nx, nz} where d>0 is overlap depth along normal (nx, nz), or null.
   */
  static penetration(it, x, z, r) {
    if (it.type === 'circle') {
      const dx = x - it.x, dz = z - it.z, l = Math.hypot(dx, dz);
      const d = it.r + r - l;
      if (d <= 0) return null;
      return { d, nx: l > 1e-6 ? dx / l : 1, nz: l > 1e-6 ? dz / l : 0 };
    }
    if (it.type === 'box') {
      // into box local space (yaw rotates local +Z toward world)
      const dx = x - it.x, dz = z - it.z;
      const lx = dx * it.c - dz * it.s, lz = dx * it.s + dz * it.c;
      const qx = Math.max(-it.hx, Math.min(it.hx, lx)), qz = Math.max(-it.hz, Math.min(it.hz, lz));
      let ex = lx - qx, ez = lz - qz, l = Math.hypot(ex, ez), d, nlx, nlz;
      if (l > 1e-6) {
        d = r - l; if (d <= 0) return null; nlx = ex / l; nlz = ez / l;
      } else {
        // centre inside: push out along the shallowest axis
        const px = it.hx - Math.abs(lx), pz = it.hz - Math.abs(lz);
        if (px < pz) { d = px + r; nlx = Math.sign(lx) || 1; nlz = 0; } else { d = pz + r; nlx = 0; nlz = Math.sign(lz) || 1; }
      }
      return { d, nx: nlx * it.c + nlz * it.s, nz: -nlx * it.s + nlz * it.c };
    }
    if (it.type === 'seg') {
      const abx = it.x1 - it.x0, abz = it.z1 - it.z0, l2 = abx * abx + abz * abz || 1e-9;
      let t = ((x - it.x0) * abx + (z - it.z0) * abz) / l2; t = Math.max(0, Math.min(1, t));
      const px = it.x0 + abx * t, pz = it.z0 + abz * t;
      const dx = x - px, dz = z - pz, l = Math.hypot(dx, dz);
      const d = it.r + r - l; if (d <= 0) return null;
      return { d, nx: l > 1e-6 ? dx / l : -abz / Math.sqrt(l2), nz: l > 1e-6 ? dz / l : abx / Math.sqrt(l2) };
    }
    return null;
  }

  /** Resolve a moving circle against all enabled items; returns corrected pos. */
  resolve(x, z, r, filter) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const it of this.items) {
        if (!it.enabled || (filter && !filter(it))) continue;
        if (Math.abs(it.x - x) > 12 && it.type !== 'seg') continue;
        if (it.type === 'seg' && Math.min(Math.hypot(x - it.x0, z - it.z0), Math.hypot(x - it.x1, z - it.z1)) > Math.hypot(it.x1 - it.x0, it.z1 - it.z0) + it.r + r + 1) continue;
        const p = Colliders.penetration(it, x, z, r);
        if (p) { x += p.nx * p.d; z += p.nz * p.d; moved = true; }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** Items overlapping a circle. */
  query(x, z, r, filter) {
    const out = [];
    for (const it of this.items) {
      if (!it.enabled || (filter && !filter(it))) continue;
      if (Colliders.penetration(it, x, z, r)) out.push(it);
    }
    return out;
  }

  /** Does an oriented box overlap anything? Approximated by sampling circles. */
  boxBlocked(x, z, hx, hz, yaw, filter) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rr = Math.min(hx, hz);
    const nx = Math.max(1, Math.ceil(hx / rr)), nz = Math.max(1, Math.ceil(hz / rr));
    const hits = new Set();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = -hx + rr + (nx > 1 ? (2 * (hx - rr) * i) / (nx - 1) : hx - rr);
      const lz = -hz + rr + (nz > 1 ? (2 * (hz - rr) * j) / (nz - 1) : hz - rr);
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      for (const it of this.query(wx, wz, rr * 0.98, filter)) hits.add(it);
    }
    return [...hits];
  }

  /** Line-of-travel check: first item hit by a swept point (coarse). */
  segmentBlocked(x0, z0, x1, z1, r, filter) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / (r * 0.8)));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (this.query(x, z, r, filter).length) return true;
    }
    return false;
  }
}

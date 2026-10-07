// Runtime for everything the player builds: meshes, colliders, fill levels,
// gates, the toy ball, and enclosure detection on the 2 m fence grid.
import * as THREE from 'three';
import { BUILDABLES } from '../data/buildables.js';
import { SPECIES } from '../data/species.js';
import { BUILDERS } from './Pieces.js';
import { CONFIG } from '../data/config.js';
import { damp } from '../util/noise.js';

const GS = CONFIG.world.buildGrid;

export function edgeEnds(key) {
  const [axis, si, sj] = key.split(':'); const i = +si, j = +sj;
  const a = { x: i * GS, z: j * GS };
  const b = axis === 'x' ? { x: (i + 1) * GS, z: j * GS } : { x: i * GS, z: (j + 1) * GS };
  return { axis, i, j, a, b, cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2 };
}
export const cellOf = (x, z) => [Math.floor(x / GS), Math.floor(z / GS)];
const ck = (i, j) => i + ',' + j;

export class Structures {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'structures';
    game.scene.add(this.group);
    this.items = new Map();   // uid -> {data, obj, colliders, def}
    this.edges = new Map();   // key -> {data, obj, colliders}
    this.enclosures = [];
    this.nextUid = 1;
    this.balls = [];
  }

  get mats() { return this.game.world.mats; }
  get state() { return this.game.state; }

  // ---- objects -----------------------------------------------------------
  addObject(data, { silent = false } = {}) {
    const def = BUILDABLES[data.type];
    if (!data.uid) data.uid = 's' + (this.nextUid++);
    else this.nextUid = Math.max(this.nextUid, parseInt(data.uid.slice(1), 10) + 1);
    const obj = BUILDERS[data.type](this.mats);
    obj.name = data.uid;
    this.group.add(obj);
    const it = { data, def, obj, colliders: [] };
    this.items.set(data.uid, it);
    this.placeObject(it);
    if (def.fill && data.fill === undefined) data.fill = 0;
    obj.userData.setFill?.(data.fill || 0);
    if (def.toy === 'ball') {
      it.ball = { x: data.x, z: data.z, vx: 0, vz: 0, spin: new THREE.Quaternion() };
      this.balls.push(it);
    }
    if (!silent) this.changed({ added: data.uid });
    return it;
  }

  placeObject(it) {
    const { data, def, obj } = it;
    const w = this.game.world;
    for (const c of it.colliders) w.colliders.remove(c);
    it.colliders = [];
    // Sit on the lowest footprint corner so nothing floats on slopes.
    let h = Infinity;
    const c = Math.cos(data.yaw), s = Math.sin(data.yaw);
    for (const [lx, lz] of [[-def.hx, -def.hz], [def.hx, -def.hz], [-def.hx, def.hz], [def.hx, def.hz], [0, 0]]) {
      h = Math.min(h, w.terrain.heightAt(data.x + lx * c + lz * s, data.z - lx * s + lz * c));
    }
    obj.position.set(data.x, h - 0.02, data.z);
    obj.rotation.y = data.yaw;
    const C = w.colliders;
    it.colliders.push(C.addBox(data.x, data.z, def.hx, def.hz, data.yaw, 'footprint', data.uid));
    const walls = obj.userData.walls;
    if (walls) {
      for (const [x0, z0, x1, z1] of walls) {
        const p0 = this.toWorld(data, x0, z0), p1 = this.toWorld(data, x1, z1);
        it.colliders.push(C.addSegment(p0.x, p0.z, p1.x, p1.z, 0.05, 'structure', data.uid));
      }
      if (def.toy === 'log') it.colliders.push(C.addBox(data.x, data.z, def.hx, def.hz, data.yaw, 'structure-player', data.uid));
    } else if (def.toy !== 'ball') {
      it.colliders.push(C.addBox(data.x, data.z, def.hx * 0.9, def.hz * 0.9, data.yaw, 'structure', data.uid));
    }
    w.terrain.trampleRect(data.x, data.z, def.hx, def.hz, data.yaw, def.toy === 'ball' ? 0 : 0.85);
    if (it.ball) { it.ball.x = data.x; it.ball.z = data.z; }
  }

  toWorld(data, lx, lz) {
    const c = Math.cos(data.yaw), s = Math.sin(data.yaw);
    return { x: data.x + lx * c + lz * s, z: data.z - lx * s + lz * c };
  }

  removeObject(uid) {
    const it = this.items.get(uid); if (!it) return null;
    for (const c of it.colliders) this.game.world.colliders.remove(c);
    this.group.remove(it.obj);
    this.items.delete(uid);
    this.balls = this.balls.filter((b) => b !== it);
    this.changed({ removed: uid });
    return it;
  }

  moveObject(uid, x, z, yaw) {
    const it = this.items.get(uid); if (!it) return;
    it.data.x = x; it.data.z = z; it.data.yaw = yaw;
    this.placeObject(it);
    this.changed({ moved: uid });
  }

  // ---- fence edges ------------------------------------------------------
  addEdge(key, type, { silent = false, open = false } = {}) {
    if (this.edges.has(key)) this.removeEdge(key, { silent: true });
    const e = edgeEnds(key);
    const obj = BUILDERS[type](this.mats);
    const w = this.game.world;
    const h0 = w.terrain.heightAt(e.a.x, e.a.z), h1 = w.terrain.heightAt(e.b.x, e.b.z);
    obj.position.set(e.cx, (h0 + h1) / 2 - 0.03, e.cz);
    obj.rotation.set(0, e.axis === 'x' ? 0 : Math.PI / 2, 0);
    const tilt = new THREE.Group();
    tilt.rotation.z = Math.atan2(h1 - h0, GS) * (e.axis === 'x' ? 1 : -1);
    tilt.add(...obj.children.slice());
    obj.add(tilt);
    obj.userData.leaf = obj.userData.leaf; // keep reference
    this.group.add(obj);
    const data = { type, open };
    const tag = type === 'gate' ? 'gate' : 'fence';
    const col = w.colliders.addSegment(e.a.x, e.a.z, e.b.x, e.b.z, 0.07, tag, key);
    const ed = { key, data, obj, colliders: [col], e, leafAngle: open ? -1.75 : 0 };
    this.edges.set(key, ed);
    if (type === 'gate') this.setGate(key, open, true);
    if (!silent) this.changed({ edge: key });
    return ed;
  }

  removeEdge(key, { silent = false } = {}) {
    const ed = this.edges.get(key); if (!ed) return null;
    for (const c of ed.colliders) this.game.world.colliders.remove(c);
    this.group.remove(ed.obj);
    this.edges.delete(key);
    if (!silent) this.changed({ edge: key });
    return ed;
  }

  setGate(key, open, instant = false) {
    const ed = this.edges.get(key); if (!ed || ed.data.type !== 'gate') return;
    ed.data.open = open;
    ed.colliders[0].enabled = !open;
    if (instant) ed.leafAngle = open ? -1.75 : 0;
    this.game.events.emit('gate', { key, open });
  }

  /** Recompute enclosures, then tell listeners (UI, saves, build overlay). */
  changed(info) {
    this.computeEnclosures();
    this.game.events.emit('structures:changed', info);
  }

  // ---- enclosures --------------------------------------------------------
  computeEnclosures() {
    const A = CONFIG.world.buildArea;
    const i0 = Math.floor(A.minX / GS) - 1, i1 = Math.ceil(A.maxX / GS) + 1;
    const j0 = Math.floor(A.minZ / GS) - 1, j1 = Math.ceil(A.maxZ / GS) + 1;
    const wall = (k) => this.edges.has(k);
    const outside = new Set();
    const q = [];
    for (let i = i0; i < i1; i++) for (const j of [j0, j1 - 1]) { q.push([i, j]); outside.add(ck(i, j)); }
    for (let j = j0; j < j1; j++) for (const i of [i0, i1 - 1]) { if (!outside.has(ck(i, j))) { q.push([i, j]); outside.add(ck(i, j)); } }
    const nbrs = (i, j) => [
      [i + 1, j, `z:${i + 1}:${j}`], [i - 1, j, `z:${i}:${j}`], [i, j + 1, `x:${i}:${j + 1}`], [i, j - 1, `x:${i}:${j}`],
    ];
    while (q.length) {
      const [i, j] = q.pop();
      for (const [ni, nj, k] of nbrs(i, j)) {
        if (ni < i0 || nj < j0 || ni >= i1 || nj >= j1) continue;
        if (wall(k) || outside.has(ck(ni, nj))) continue;
        outside.add(ck(ni, nj)); q.push([ni, nj]);
      }
    }
    const seen = new Set(); const encs = [];
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
      const key = ck(i, j);
      if (outside.has(key) || seen.has(key)) continue;
      const cells = []; const st = [[i, j]]; seen.add(key);
      while (st.length) {
        const [a, b] = st.pop(); cells.push([a, b]);
        for (const [ni, nj, k] of nbrs(a, b)) {
          const nk = ck(ni, nj);
          if (wall(k) || seen.has(nk) || outside.has(nk)) continue;
          seen.add(nk); st.push([ni, nj]);
        }
      }
      encs.push(this.describeEnclosure(cells));
    }
    // keep stable ids for enclosures that persist
    this.enclosures = encs;
    return encs;
  }

  describeEnclosure(cells) {
    const set = new Set(cells.map(([i, j]) => ck(i, j)));
    let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity, cx = 0, cz = 0;
    for (const [i, j] of cells) { minI = Math.min(minI, i); minJ = Math.min(minJ, j); maxI = Math.max(maxI, i); maxJ = Math.max(maxJ, j); cx += (i + 0.5) * GS; cz += (j + 0.5) * GS; }
    cx /= cells.length; cz /= cells.length;
    const id = 'e' + cells.map(([i, j]) => ck(i, j)).sort()[0];
    const gates = [];
    for (const [k, ed] of this.edges) {
      if (ed.data.type !== 'gate') continue;
      const e = ed.e;
      // gate bounds a cell of this enclosure on one side only
      const sides = e.axis === 'x' ? [[e.i, e.j - 1], [e.i, e.j]] : [[e.i - 1, e.j], [e.i, e.j]];
      const inside = sides.filter(([a, b]) => set.has(ck(a, b))).length;
      if (inside === 1) gates.push(k);
    }
    const contents = { shelter: [], food: [], water: [], enrichment: [] };
    for (const it of this.items.values()) {
      const [i, j] = cellOf(it.data.x, it.data.z);
      if (!set.has(ck(i, j))) continue;
      for (const p of it.def.provides) if (contents[p]) contents[p].push(it.data.uid);
    }
    const area = cells.length * GS * GS;
    const need = SPECIES.dog.habitat;
    const checks = [
      { id: 'fence', label: 'Fully fenced', ok: true },
      { id: 'gate', label: 'Gate for access', ok: gates.length > 0 },
      { id: 'space', label: `Space (${area} m² of ${need.minArea} m²)`, ok: area >= need.minArea },
      { id: 'shelter', label: 'Shelter', ok: contents.shelter.length > 0 },
      { id: 'food', label: 'Food', ok: contents.food.length > 0 },
      { id: 'water', label: 'Water', ok: contents.water.length > 0 },
      { id: 'enrichment', label: 'Enrichment', ok: contents.enrichment.length > 0 },
    ];
    return { id, cells, set, area, centre: { x: cx, z: cz }, bounds: { minX: minI * GS, maxX: (maxI + 1) * GS, minZ: minJ * GS, maxZ: (maxJ + 1) * GS }, gates, contents, checks, suitable: checks.every((c) => c.ok) };
  }

  enclosureAt(x, z) {
    const [i, j] = cellOf(x, z);
    return this.enclosures.find((e) => e.set.has(ck(i, j))) || null;
  }

  randomPointIn(enc, rnd = Math.random, margin = 0.5) {
    for (let k = 0; k < 20; k++) {
      const [i, j] = enc.cells[Math.floor(rnd() * enc.cells.length)];
      const x = i * GS + margin + rnd() * (GS - 2 * margin), z = j * GS + margin + rnd() * (GS - 2 * margin);
      if (!this.game.world.colliders.query(x, z, 0.3, (it) => it.tag !== 'footprint' && it.tag !== 'structure-player').length) return { x, z };
    }
    return { ...enc.centre };
  }

  bestSuitable() { return this.enclosures.find((e) => e.suitable) || null; }

  // ---- interactions -------------------------------------------------------
  interactionsNear(px, pz) {
    const out = [];
    for (const [k, ed] of this.edges) {
      if (ed.data.type !== 'gate') continue;
      const d = Math.hypot(ed.e.cx - px, ed.e.cz - pz);
      if (d < 2.2) out.push({ id: 'gate:' + k, x: ed.e.cx, z: ed.e.cz, d, priority: 1, label: ed.data.open ? 'Close gate' : 'Open gate', run: () => this.setGate(k, !ed.data.open) });
    }
    for (const it of this.items.values()) {
      const d = Math.hypot(it.data.x - px, it.data.z - pz);
      if (d > 1.7 + Math.max(it.def.hx, it.def.hz)) continue;
      const res = this.state.resources;
      if (it.def.fill === 'food') {
        const full = (it.data.fill || 0) > 0.85;
        out.push({ id: 'fill:' + it.data.uid, x: it.data.x, z: it.data.z, d, label: full ? 'Bowl is full' : res.rations > 0 ? 'Fill bowl (1 ration)' : 'No rations left', disabled: full || res.rations <= 0,
          run: () => { res.rations--; it.data.fill = 1; it.obj.userData.setFill(1); this.game.events.emit('care', { type: 'fill-food', uid: it.data.uid }); } });
      } else if (it.def.fill === 'water') {
        const full = (it.data.fill || 0) > 0.9;
        out.push({ id: 'fill:' + it.data.uid, x: it.data.x, z: it.data.z, d, label: full ? 'Trough is full' : 'Top up water', disabled: full,
          run: () => { it.data.fill = 1; it.obj.userData.setFill(1); this.game.events.emit('care', { type: 'fill-water', uid: it.data.uid }); } });
      } else if (it.def.toy === 'ball') {
        out.push({ id: 'ball:' + it.data.uid, x: it.ball.x, z: it.ball.z, d: Math.hypot(it.ball.x - px, it.ball.z - pz), label: 'Roll the ball',
          run: () => this.kickBall(it, it.ball.x - px, it.ball.z - pz, 4.2, 'player') });
      }
    }
    return out;
  }

  setFill(uid, f) {
    const it = this.items.get(uid); if (!it) return;
    it.data.fill = Math.max(0, Math.min(1, f));
    it.obj.userData.setFill?.(it.data.fill);
  }

  kickBall(it, dx, dz, speed, by) {
    const l = Math.hypot(dx, dz) || 1;
    it.ball.vx = (dx / l) * speed; it.ball.vz = (dz / l) * speed;
    this.game.events.emit('ball', { uid: it.data.uid, by });
  }

  update(dt) {
    for (const ed of this.edges.values()) {
      if (ed.data.type !== 'gate') continue;
      const target = ed.data.open ? -1.75 : 0;
      ed.leafAngle = damp(ed.leafAngle, target, 5, dt);
      const leaf = ed.obj.userData.leaf;
      if (leaf) leaf.rotation.y = ed.leafAngle;
    }
    const w = this.game.world;
    for (const it of this.balls) {
      const b = it.ball;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp < 0.02) { b.vx = b.vz = 0; } else {
        let nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
        const p = w.colliders.resolve(nx, nz, 0.075, (c) => ['fence', 'gate', 'structure', 'building', 'tree', 'props', 'post'].includes(c.tag));
        if (Math.abs(p.x - nx) > 1e-4) b.vx *= -0.55;
        if (Math.abs(p.z - nz) > 1e-4) b.vz *= -0.55;
        if (!w.walkable(p.x, p.z, 0.3)) { b.vx *= -0.5; b.vz *= -0.5; p.x = b.x; p.z = b.z; }
        const moved = Math.hypot(p.x - b.x, p.z - b.z);
        if (moved > 1e-5) {
          const axis = new THREE.Vector3(b.vz, 0, -b.vx).normalize();
          b.spin.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, moved / 0.075));
        }
        b.x = p.x; b.z = p.z;
        const decay = Math.exp(-1.1 * dt);
        b.vx *= decay; b.vz *= decay;
      }
      it.data.x = b.x; it.data.z = b.z;
      it.obj.position.set(b.x, w.terrain.heightAt(b.x, b.z) - 0.005, b.z);
      it.obj.rotation.set(0, 0, 0);
      it.obj.userData.ball.quaternion.copy(b.spin);
    }
  }

  // ---- persistence ----------------------------------------------------------
  serialize() {
    return {
      objects: [...this.items.values()].map((it) => ({ ...it.data })),
      edges: [...this.edges.values()].map((ed) => ({ key: ed.key, type: ed.data.type, open: !!ed.data.open })),
    };
  }

  load(data) {
    for (const e of data?.edges || []) this.addEdge(e.key, e.type, { silent: true, open: e.open });
    for (const o of data?.objects || []) this.addObject({ ...o }, { silent: true });
    this.computeEnclosures();
  }
}

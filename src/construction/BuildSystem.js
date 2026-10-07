// Construction mode: catalogue tools, ghost previews, placement validation,
// fence runs on the grid, gates, selection, moving and removal.
import * as THREE from 'three';
import { BUILDABLES } from '../data/buildables.js';
import { CONFIG } from '../data/config.js';
import { BUILDERS } from './Pieces.js';
import { edgeEnds } from './Structures.js';

const GS = CONFIG.world.buildGrid;
const BLOCKERS = new Set(['tree', 'building', 'props', 'post', 'rock', 'log', 'hedge', 'bridge', 'fence', 'gate', 'footprint']);

export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.tool = null;         // {kind:'place', id} | {kind:'move', uid}
    this.rot = 0;
    this.fenceStart = null;
    this.hover = null;
    this.selected = null;     // {type:'object', uid} | {type:'edge', key}
    this.message = '';
    this.ghost = null;
    this.ghostRun = [];
    this.overlay = new THREE.Group(); this.overlay.visible = false;
    game.scene.add(this.overlay);
    this.encGroup = new THREE.Group(); this.overlay.add(this.encGroup);
    this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf3ead2, transparent: true, opacity: 0.35, depthWrite: false }));
    this.grid.renderOrder = 3; this.overlay.add(this.grid);
    this.nodeMarker = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 10), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.8, depthWrite: false }));
    this.overlay.add(this.nodeMarker);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.selRing.visible = false; this.selRing.renderOrder = 4; this.overlay.add(this.selRing);
    this.ray = new THREE.Raycaster();
    game.events.on('structures:changed', () => this.refreshOverlay());
  }

  get S() { return this.game.structures; }
  get res() { return this.game.state.resources; }

  enter() {
    if (this.game.mode === 'build') return;
    this.game.mode = 'build';
    this.game.cameraRig.enterBuild();
    this.overlay.visible = true;
    this.refreshOverlay();
    this.game.events.emit('build:enter');
  }

  exit() {
    if (this.game.mode !== 'build') return;
    this.cancelTool();
    this.selected = null;
    this.game.mode = 'explore';
    this.overlay.visible = false;
    this.game.events.emit('build:exit');
  }

  selectTool(id) {
    this.cancelTool();
    this.selected = null;
    if (!id) return;
    this.tool = { kind: 'place', id };
    if (BUILDABLES[id].kind === 'object') this.makeGhost(id);
    this.game.events.emit('build:tool', { id });
  }

  cancelTool() {
    if (this.tool?.kind === 'move') {
      const it = this.S.items.get(this.tool.uid);
      if (it) { it.obj.visible = true; this.S.placeObject(it); }
    }
    this.tool = null; this.fenceStart = null;
    this.clearGhosts();
    this.game.events.emit('build:tool', { id: null });
  }

  clearGhosts() {
    if (this.ghost) { this.overlay.remove(this.ghost); this.ghost = null; }
    for (const g of this.ghostRun) this.overlay.remove(g);
    this.ghostRun = [];
  }

  ghostify(obj, ok) {
    const m = ok ? this.game.world.mats.ghostOk : this.game.world.mats.ghostBad;
    obj.traverse((o) => { if (o.isMesh) { o.material = m; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; } });
    obj.userData.ok = ok;
  }

  makeGhost(id) {
    this.clearGhosts();
    this.ghost = BUILDERS[id](this.game.world.mats);
    this.ghostify(this.ghost, true);
    this.overlay.add(this.ghost);
  }

  pointer() {
    const m = this.game.input.mouse;
    if (!m.overCanvas || this.game.ui?.pointerCaptured()) return null;
    this.ray.setFromCamera(new THREE.Vector2(m.nx, m.ny), this.game.camera);
    return this.game.world.terrain.raycast(this.ray.ray.origin, this.ray.ray.direction, 300);
  }

  // ---- validation ----------------------------------------------------------
  inArea(x, z, pad = 0) {
    const A = CONFIG.world.buildArea;
    return x >= A.minX + pad && x <= A.maxX - pad && z >= A.minZ + pad && z <= A.maxZ - pad;
  }

  validateObject(def, x, z, yaw, ignoreUid = null) {
    if (!this.inArea(x, z, Math.max(def.hx, def.hz))) return { ok: false, reason: 'Outside the reserve’s building land' };
    const w = this.game.world;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let hmin = Infinity, hmax = -Infinity;
    for (const [lx, lz] of [[-def.hx, -def.hz], [def.hx, -def.hz], [-def.hx, def.hz], [def.hx, def.hz], [0, 0]]) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      if (w.terrain.waterDist(px, pz) < 0.7) return { ok: false, reason: 'Too close to the stream' };
      if (w.outpost.bridgeHeight(px, pz) !== null) return { ok: false, reason: 'On the footbridge' };
      const h = w.terrain.heightAt(px, pz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    }
    if (hmax - hmin > 0.35 + Math.max(def.hx, def.hz) * 0.25) return { ok: false, reason: 'Ground too steep' };
    const hits = w.colliders.boxBlocked(x, z, def.hx, def.hz, yaw, (it) => BLOCKERS.has(it.tag) && it.data !== ignoreUid);
    if (hits.length) {
      const t = hits[0].tag;
      const names = { tree: 'a tree', building: 'a building', props: 'outpost supplies', post: 'a post', rock: 'a rock', log: 'a fallen log', hedge: 'the hedgerow', bridge: 'the bridge', fence: 'a fence', gate: 'a gate', footprint: 'another structure' };
      return { ok: false, reason: `Blocked by ${names[t] || 'something'}` };
    }
    if (!ignoreUid && this.res.materials < def.cost) return { ok: false, reason: 'Not enough materials' };
    return { ok: true };
  }

  validateEdge(key, type) {
    const e = edgeEnds(key);
    if (!this.inArea(e.a.x, e.a.z) || !this.inArea(e.b.x, e.b.z)) return { ok: false, reason: 'Outside the reserve’s building land' };
    const existing = this.S.edges.get(key);
    if (existing && existing.data.type === type) return { ok: false, reason: 'Already built', existing: true };
    if (type === 'fence' && existing) return { ok: false, reason: 'A gate is already here', existing: true };
    const w = this.game.world;
    for (let t = 0; t <= 1.0001; t += 0.125) {
      const x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t;
      if (w.terrain.waterDist(x, z) < 0.5) return { ok: false, reason: 'Too close to the stream' };
      if (w.outpost.bridgeHeight(x, z) !== null) return { ok: false, reason: 'On the footbridge' };
      const r = t === 0 || t > 0.99 ? 0.1 : 0.14;
      const hits = w.colliders.query(x, z, r, (it) => BLOCKERS.has(it.tag) && it.tag !== 'fence' && it.tag !== 'gate');
      if (hits.length) return { ok: false, reason: hits[0].tag === 'footprint' ? 'Blocked by a structure' : `Blocked by ${hits[0].tag === 'tree' ? 'a tree' : 'an obstacle'}` };
    }
    const cost = BUILDABLES[type].cost - (existing ? BUILDABLES[existing.data.type].cost : 0);
    return { ok: true, cost };
  }

  // ---- per-frame -------------------------------------------------------------
  update(dt, rawDt) {
    if (this.game.mode !== 'build') return;
    const input = this.game.input;
    const m = input.mouse;
    const hit = this.pointer();
    this.hover = hit;
    const clickL = input.mouseReleased(0) && m.dragDist < 6 && hit;
    const clickR = input.mouseReleased(2) && m.dragDist < 6;

    if (input.wasPressed('Escape')) { if (this.tool || this.selected) { this.cancelTool(); this.selected = null; } else this.exit(); return; }
    if (input.wasPressed('KeyR') && !input.isDown('ControlLeft')) this.rot += (input.anyDown('ShiftLeft', 'ShiftRight') ? 1 : -1) * Math.PI / 4;
    if (clickR) { if (this.tool) this.cancelTool(); else this.selected = null; }

    this.updateGrid(hit);
    this.message = '';
    const tool = this.tool;
    if (tool?.kind === 'place' && BUILDABLES[tool.id].kind === 'object') this.updatePlaceObject(hit, BUILDABLES[tool.id], clickL);
    else if (tool?.kind === 'move') this.updateMove(hit, clickL);
    else if (tool?.kind === 'place' && tool.id === 'fence') this.updateFence(hit, clickL);
    else if (tool?.kind === 'place' && tool.id === 'gate') this.updateGate(hit, clickL);
    else this.updateSelect(hit, clickL);

    if (this.selected && (input.wasPressed('Delete') || input.wasPressed('Backspace') || input.wasPressed('KeyX'))) this.removeSelected();
    if (this.selected?.type === 'object' && input.wasPressed('KeyM')) this.startMove(this.selected.uid);
    if (this.selected?.type === 'object' && input.wasPressed('KeyR')) this.rotateSelected();
    this.updateSelRing();
  }

  updatePlaceObject(hit, def, click) {
    if (!this.ghost || !hit) { if (this.ghost) this.ghost.visible = false; return; }
    const x = Math.round(hit.x * 4) / 4, z = Math.round(hit.z * 4) / 4;
    const v = this.validateObject(def, x, z, this.rot);
    this.placeGhost(this.ghost, x, z, this.rot, v.ok);
    this.message = v.ok ? `${def.name} · ${def.cost} materials` : v.reason;
    if (click && v.ok) {
      this.res.materials -= def.cost;
      this.S.addObject({ type: def.id, x, z, yaw: this.rot });
      this.game.events.emit('build:placed', { id: def.id, x, z });
    } else if (click) this.game.events.emit('build:denied', { reason: v.reason });
  }

  placeGhost(g, x, z, yaw, ok) {
    g.visible = true;
    g.position.set(x, this.game.world.terrain.heightAt(x, z) + 0.01, z);
    g.rotation.set(0, yaw, 0);
    if (g.userData.ok !== ok) this.ghostify(g, ok);
  }

  updateMove(hit, click) {
    const it = this.S.items.get(this.tool.uid);
    if (!it || !hit) return;
    const x = Math.round(hit.x * 4) / 4, z = Math.round(hit.z * 4) / 4;
    const v = this.validateObject(it.def, x, z, this.rot, it.data.uid);
    this.placeGhost(this.ghost, x, z, this.rot, v.ok);
    this.message = v.ok ? `Move ${it.def.name}` : v.reason;
    if (click && v.ok) {
      it.obj.visible = true;
      this.S.moveObject(it.data.uid, x, z, this.rot);
      this.tool = null; this.clearGhosts();
      this.selected = { type: 'object', uid: it.data.uid };
      this.game.events.emit('build:placed', { id: it.def.id, moved: true });
    }
  }

  startMove(uid) {
    const it = this.S.items.get(uid); if (!it) return;
    this.cancelTool();
    this.tool = { kind: 'move', uid };
    this.rot = it.data.yaw;
    this.makeGhost(it.def.id);
    it.obj.visible = false;
    for (const c of it.colliders) c.enabled = false;
  }

  rotateSelected() {
    const it = this.S.items.get(this.selected.uid); if (!it) return;
    const yaw = it.data.yaw - Math.PI / 4;
    const v = this.validateObject(it.def, it.data.x, it.data.z, yaw, it.data.uid);
    if (v.ok) this.S.moveObject(it.data.uid, it.data.x, it.data.z, yaw);
    else this.game.events.emit('build:denied', { reason: v.reason });
  }

  removeSelected() {
    const sel = this.selected; if (!sel) return;
    if (sel.type === 'object') {
      const it = this.S.removeObject(sel.uid);
      if (it) this.res.materials += it.def.cost;
    } else {
      const ed = this.S.removeEdge(sel.key);
      if (ed) this.res.materials += BUILDABLES[ed.data.type].cost;
    }
    this.selected = null;
    this.game.events.emit('build:removed', sel);
  }

  nearestNode(hit) { return { i: Math.round(hit.x / GS), j: Math.round(hit.z / GS) }; }

  runEdges(a, b) {
    const keys = [];
    if (Math.abs(b.i - a.i) >= Math.abs(b.j - a.j)) {
      const [s, e] = a.i <= b.i ? [a.i, b.i] : [b.i, a.i];
      for (let i = s; i < e; i++) keys.push(`x:${i}:${a.j}`);
    } else {
      const [s, e] = a.j <= b.j ? [a.j, b.j] : [b.j, a.j];
      for (let j = s; j < e; j++) keys.push(`z:${a.i}:${j}`);
    }
    return keys;
  }

  updateFence(hit, click) {
    if (!hit) return;
    const n = this.nearestNode(hit);
    this.nodeMarker.visible = true;
    this.nodeMarker.position.set(n.i * GS, this.game.world.terrain.heightAt(n.i * GS, n.j * GS) + 0.6, n.j * GS);
    for (const g of this.ghostRun) this.overlay.remove(g);
    this.ghostRun = [];
    if (!this.fenceStart) {
      this.message = 'Click a post point to start a fence line';
      if (click) this.fenceStart = n;
      return;
    }
    const keys = this.runEdges(this.fenceStart, n);
    let cost = 0, okCount = 0, reason = '';
    const results = keys.map((k) => { const v = this.validateEdge(k, 'fence'); if (v.ok) { cost += v.cost; okCount++; } else if (!v.existing) reason = v.reason; return { k, v }; });
    const afford = cost <= this.res.materials;
    for (const { k, v } of results) {
      if (v.existing) continue;
      const e = edgeEnds(k);
      const g = BUILDERS.fence(this.game.world.mats);
      this.ghostify(g, v.ok && afford);
      g.position.set(e.cx, (this.game.world.terrain.heightAt(e.a.x, e.a.z) + this.game.world.terrain.heightAt(e.b.x, e.b.z)) / 2, e.cz);
      g.rotation.y = e.axis === 'x' ? 0 : Math.PI / 2;
      this.overlay.add(g); this.ghostRun.push(g);
    }
    this.message = !afford ? `Not enough materials (${cost} needed)` : okCount ? `${okCount} bay${okCount > 1 ? 's' : ''} · ${cost} materials${reason ? ' · some blocked: ' + reason : ''}` : (reason || 'Drag out a line of fence');
    if (click) {
      if (n.i === this.fenceStart.i && n.j === this.fenceStart.j) { this.fenceStart = null; return; }
      if (afford && okCount) {
        for (const { k, v } of results) if (v.ok) this.S.addEdge(k, 'fence', { silent: true });
        this.res.materials -= cost;
        this.S.changed({ fence: okCount });
        this.game.events.emit('build:placed', { id: 'fence', count: okCount });
        this.fenceStart = n; // continue the line from here
      } else this.game.events.emit('build:denied', { reason: this.message });
    }
  }

  nearestEdge(hit) {
    const fx = hit.x / GS, fz = hit.z / GS;
    const i = Math.floor(fx), j = Math.floor(fz);
    const dx = fx - i, dz = fz - j;
    const cands = [
      { k: `x:${i}:${j}`, d: dz }, { k: `x:${i}:${j + 1}`, d: 1 - dz },
      { k: `z:${i}:${j}`, d: dx }, { k: `z:${i + 1}:${j}`, d: 1 - dx },
    ];
    cands.sort((a, b) => a.d - b.d);
    // prefer an existing fence bay within reach
    const ex = cands.find((c) => c.d < 0.4 && this.S.edges.has(c.k) && this.S.edges.get(c.k).data.type === 'fence');
    return (ex || cands[0]).k;
  }

  updateGate(hit, click) {
    for (const g of this.ghostRun) this.overlay.remove(g);
    this.ghostRun = [];
    this.nodeMarker.visible = false;
    if (!hit) return;
    const k = this.nearestEdge(hit);
    const v = this.validateEdge(k, 'gate');
    const afford = v.ok && v.cost <= this.res.materials;
    const e = edgeEnds(k);
    const g = BUILDERS.gate(this.game.world.mats);
    this.ghostify(g, v.ok && afford);
    g.position.set(e.cx, this.game.world.terrain.heightAt(e.cx, e.cz), e.cz);
    g.rotation.y = e.axis === 'x' ? 0 : Math.PI / 2;
    this.overlay.add(g); this.ghostRun.push(g);
    this.message = !v.ok ? v.reason : !afford ? 'Not enough materials' : `Field gate · ${v.cost} materials${this.S.edges.has(k) ? ' (replaces fence bay)' : ''}`;
    if (click && v.ok && afford) {
      this.res.materials -= v.cost;
      this.S.addEdge(k, 'gate');
      this.game.events.emit('build:placed', { id: 'gate' });
    } else if (click) this.game.events.emit('build:denied', { reason: this.message });
  }

  pick(hit) {
    if (!hit) return null;
    let best = null, bd = 0.6;
    for (const it of this.S.items.values()) {
      const dx = hit.x - it.data.x, dz = hit.z - it.data.z;
      const c = Math.cos(it.data.yaw), s = Math.sin(it.data.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const d = Math.max(Math.abs(lx) - it.def.hx, Math.abs(lz) - it.def.hz);
      if (d < bd) { bd = d; best = { type: 'object', uid: it.data.uid }; }
    }
    if (best) return best;
    for (const [k, ed] of this.S.edges) {
      const { a, b } = ed.e;
      const t = Math.max(0, Math.min(1, ((hit.x - a.x) * (b.x - a.x) + (hit.z - a.z) * (b.z - a.z)) / (GS * GS)));
      const d = Math.hypot(hit.x - (a.x + (b.x - a.x) * t), hit.z - (a.z + (b.z - a.z) * t));
      if (d < 0.45 && d < bd) { bd = d; best = { type: 'edge', key: k }; }
    }
    return best;
  }

  updateSelect(hit, click) {
    this.nodeMarker.visible = false;
    const p = this.pick(hit);
    this.hoverPick = p;
    if (click) this.selected = p;
  }

  updateSelRing() {
    const sel = this.selected || this.hoverPick;
    if (!sel || this.tool) { this.selRing.visible = false; return; }
    let x, z, r;
    if (sel.type === 'object') { const it = this.S.items.get(sel.uid); if (!it) { this.selRing.visible = false; return; } x = it.data.x; z = it.data.z; r = Math.hypot(it.def.hx, it.def.hz) + 0.25; }
    else { const ed = this.S.edges.get(sel.key); if (!ed) { this.selRing.visible = false; return; } x = ed.e.cx; z = ed.e.cz; r = 1.2; }
    this.selRing.visible = true;
    this.selRing.position.set(x, this.game.world.terrain.heightAt(x, z) + 0.06, z);
    this.selRing.scale.setScalar(r);
    this.selRing.material.opacity = this.selected ? 0.9 : 0.45;
  }

  updateGrid(hit) {
    if (!hit) return;
    const ci = Math.round(hit.x / GS), cj = Math.round(hit.z / GS);
    if (this.gridCentre && this.gridCentre[0] === ci && this.gridCentre[1] === cj) return;
    this.gridCentre = [ci, cj];
    const pts = []; const R = 5; const t = this.game.world.terrain;
    const add = (x0, z0, x1, z1) => { pts.push(x0, t.heightAt(x0, z0) + 0.05, z0, x1, t.heightAt(x1, z1) + 0.05, z1); };
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j < cj + R; j++) {
      if (!this.inArea(i * GS, j * GS) || !this.inArea(i * GS, (j + 1) * GS)) continue;
      for (let s = 0; s < 4; s++) add(i * GS, j * GS + s * 0.5, i * GS, j * GS + (s + 1) * 0.5);
    }
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i < ci + R; i++) {
      if (!this.inArea(i * GS, j * GS) || !this.inArea((i + 1) * GS, j * GS)) continue;
      for (let s = 0; s < 4; s++) add(i * GS + s * 0.5, j * GS, i * GS + (s + 1) * 0.5, j * GS);
    }
    this.grid.geometry.dispose();
    this.grid.geometry = new THREE.BufferGeometry();
    this.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  refreshOverlay() {
    for (const c of [...this.encGroup.children]) { this.encGroup.remove(c); c.geometry.dispose(); }
    const t = this.game.world.terrain;
    for (const enc of this.S.enclosures) {
      const pos = [];
      for (const [i, j] of enc.cells) {
        const x0 = i * GS, z0 = j * GS, x1 = x0 + GS, z1 = z0 + GS;
        const v = (x, z) => [x, t.heightAt(x, z) + 0.07, z];
        pos.push(...v(x0, z0), ...v(x0, z1), ...v(x1, z0), ...v(x1, z0), ...v(x0, z1), ...v(x1, z1));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: enc.suitable ? 0x7fd18a : 0xe8b45a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 2;
      this.encGroup.add(m);
    }
  }
}

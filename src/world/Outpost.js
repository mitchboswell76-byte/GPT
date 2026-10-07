// The starting outpost (cabin, storage shed, supplies, noticeboard, pump) and
// the footbridge over the stream. Built procedurally from shared materials.
import * as THREE from 'three';
import { boxGeo, cylGeo, place, meshesFrom } from '../util/geo.js';
import { OUTPOST, BRIDGE } from './WorldLayout.js';
import { streamLevels } from './Terrain.js';
import { STREAM } from './WorldLayout.js';

/** Wall pieces around rectangular openings, in wall-local space. */
function wallPieces(len, h, t, openings, uv = 0.6) {
  const xs = new Set([-len / 2, len / 2]);
  for (const o of openings) { xs.add(o.x0); xs.add(o.x1); }
  const bx = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < bx.length - 1; i++) {
    const a = bx[i], b = bx[i + 1], mid = (a + b) / 2, w = b - a;
    if (w < 1e-4) continue;
    const holes = openings.filter((o) => o.x0 <= mid && o.x1 >= mid).sort((p, q) => p.y0 - q.y0);
    let y = 0;
    for (const o of holes) { if (o.y0 > y) out.push(place(boxGeo(w, o.y0 - y, t, uv), mid, (y + o.y0) / 2, 0)); y = Math.max(y, o.y1); }
    if (y < h) out.push(place(boxGeo(w, h - y, t, uv), mid, (y + h) / 2, 0));
  }
  return out;
}

function gable(width, rise, t) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0); s.lineTo(width / 2, 0); s.lineTo(0, rise); s.lineTo(-width / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
  return g;
}

function signTexture(lines, w = 1024, h = 256, bg = '#2f3d33', fg = '#efe6cf') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(239,230,207,0.5)'; x.lineWidth = 6; x.strokeRect(14, 14, w - 28, h - 28);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => { x.font = l.font; x.fillText(l.text, w / 2, h * l.y); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function notesTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 384;
  const x = c.getContext('2d');
  x.fillStyle = '#5a4630'; x.fillRect(0, 0, 512, 384);
  const notes = [[30, 30, 200, 150, '#efe7d3', -0.04], [250, 22, 220, 130, '#f3eedd', 0.03], [60, 200, 170, 160, '#e9dfc4', 0.05], [260, 175, 210, 180, '#f2ead6', -0.02]];
  for (const [nx, ny, nw, nh, col, rot] of notes) {
    x.save(); x.translate(nx + nw / 2, ny + nh / 2); x.rotate(rot);
    x.fillStyle = col; x.fillRect(-nw / 2, -nh / 2, nw, nh);
    x.strokeStyle = 'rgba(40,40,60,0.55)'; x.lineWidth = 2;
    for (let l = 0; l < 7; l++) {
      x.beginPath(); const yy = -nh / 2 + 22 + l * 18;
      x.moveTo(-nw / 2 + 14, yy);
      for (let s = 0; s < 12; s++) x.lineTo(-nw / 2 + 14 + s * (nw - 30) / 12, yy + Math.sin(s * 2.1 + l) * 2);
      x.stroke();
    }
    x.fillStyle = '#9b2d20'; x.beginPath(); x.arc(0, -nh / 2 + 8, 5, 0, 7); x.fill();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Outpost {
  constructor(terrain, colliders, mats) {
    this.terrain = terrain; this.colliders = colliders; this.mats = mats;
    this.group = new THREE.Group();
    this.lights = [];
    this.interactables = [];
    this.smoke = null;
    this.buildCabin();
    this.buildShed();
    this.buildSupplies();
    this.buildNoticeboard();
    this.buildPump();
    this.buildBridge();
  }

  put(obj, x, z, yaw, yOff = 0) {
    obj.position.set(x, this.terrain.heightAt(x, z) + yOff, z);
    obj.rotation.y = yaw;
    this.group.add(obj);
    return obj;
  }

  buildCabin() {
    const { x, z, yaw } = OUTPOST.cabin;
    const W = 6.4, D = 4.8, P = 0.5, WH = 2.5, T = 0.16, pitch = 0.66;
    const parts = { stone: [], planks: [], planksDark: [], slate: [], paintGreen: [], paintCream: [], glass: [], iron: [], brass: [] };
    // Stone plinth, slightly wider than the walls.
    parts.stone.push(place(boxGeo(W + 0.12, P, D + 0.12, 0.45), 0, P / 2, 0));
    // Walls
    const frontOpen = [{ x0: -0.5, x1: 0.5, y0: 0, y1: 2.08 }, { x0: -2.4, x1: -1.45, y0: 0.9, y1: 1.98 }, { x0: 1.45, x1: 2.4, y0: 0.9, y1: 1.98 }];
    for (const g of wallPieces(W, WH, T, frontOpen)) parts.planks.push(place(g, 0, P, D / 2 - T / 2));
    for (const g of wallPieces(W, WH, T, [])) parts.planks.push(place(g, 0, P, -D / 2 + T / 2));
    const sideOpen = [{ x0: -0.5, x1: 0.5, y0: 0.95, y1: 1.85 }];
    for (const g of wallPieces(D - 2 * T, WH, T, sideOpen)) parts.planks.push(place(g, -W / 2 + T / 2, P, 0, 0, Math.PI / 2, 0));
    for (const g of wallPieces(D - 2 * T, WH, T, [])) parts.planks.push(place(g, W / 2 - T / 2, P, 0, 0, Math.PI / 2, 0));
    // Corner boards
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.planksDark.push(place(boxGeo(0.14, WH, 0.14, 0.6, true), sx * (W / 2 - 0.02), P + WH / 2, sz * (D / 2 - 0.02)));
    // Gables
    const rise = Math.tan(pitch) * (D / 2 + 0.05);
    parts.planks.push(place(gable(D, rise, T), -W / 2 + T / 2, P + WH, 0, 0, Math.PI / 2, 0));
    parts.planks.push(place(gable(D, rise, T), W / 2 - T / 2, P + WH, 0, 0, Math.PI / 2, 0));
    // Roof
    const over = 0.42, slopeLen = (D / 2 + over) / Math.cos(pitch) + 0.05, rl = W + 2 * over;
    for (const s of [-1, 1]) {
      const cz = s * (D / 2 + over) / 2, cy = P + WH + rise - Math.tan(pitch) * Math.abs(cz) + 0.1;
      parts.slate.push(place(boxGeo(rl, 0.1, slopeLen, 0.42), 0, cy, cz, s * pitch, 0, 0));
      parts.planksDark.push(place(boxGeo(rl, 0.18, 0.04, 0.6), 0, cy - Math.sin(pitch) * slopeLen / 2 - 0.02, s * (D / 2 + over + 0.01)));
    }
    parts.planksDark.push(place(boxGeo(rl + 0.04, 0.12, 0.26, 0.6), 0, P + WH + rise + 0.17, 0));
    // Barge boards along the gable ends
    for (const sx of [-1, 1]) for (const s of [-1, 1]) {
      parts.planksDark.push(place(boxGeo(0.05, 0.2, slopeLen, 0.6), sx * (rl / 2), P + WH + rise / 2 + 0.05, s * (D / 2 + over) / 2, s * pitch, 0, 0));
    }
    // Door and windows
    parts.paintGreen.push(place(boxGeo(0.96, 2.04, 0.06), 0, P + 1.02, D / 2 - 0.05));
    for (const dy of [0.55, 1.45]) parts.paintGreen.push(place(boxGeo(0.7, 0.62, 0.03), 0, P + dy, D / 2 - 0.005));
    parts.brass.push(place(new THREE.SphereGeometry(0.035, 10, 8), 0.36, P + 1.0, D / 2 + 0.01));
    const frame = (cx, cy, w, h, zf, rotY = 0, xf = 0) => {
      const fz = (g, ax, ay) => place(g, xf + (rotY ? 0 : ax), cy + ay, zf + (rotY ? ax : 0), 0, rotY, 0);
      parts.paintCream.push(fz(boxGeo(w + 0.12, 0.08, 0.1), cx, h / 2 + 0.02));
      parts.paintCream.push(fz(boxGeo(w + 0.12, 0.08, 0.1), cx, -h / 2 - 0.02));
      parts.paintCream.push(fz(boxGeo(0.07, h, 0.1), cx - w / 2 - 0.02, 0));
      parts.paintCream.push(fz(boxGeo(0.07, h, 0.1), cx + w / 2 + 0.02, 0));
      parts.paintCream.push(fz(boxGeo(0.04, h, 0.06), cx, 0));
      parts.paintCream.push(fz(boxGeo(w, 0.04, 0.06), cx, 0.08));
      parts.glass.push(fz(boxGeo(w, h, 0.02), cx, 0));
      parts.planksDark.push(fz(boxGeo(w + 0.2, 0.05, 0.22), cx, -h / 2 - 0.08));
    };
    frame(-1.925, P + 1.44, 0.95, 1.08, D / 2 - 0.04);
    frame(1.925, P + 1.44, 0.95, 1.08, D / 2 - 0.04);
    frame(0, P + 1.4, 1.0, 0.9, 0, Math.PI / 2, -W / 2 + 0.04);
    // Porch deck, posts and lean-to roof
    const PD = 1.9;
    parts.planksDark.push(place(boxGeo(W + 0.2, 0.12, PD, 0.7, true), 0, P - 0.08, D / 2 + PD / 2));
    for (const sx of [-1, 0, 1]) {
      if (sx === 0) continue;
      parts.planksDark.push(place(boxGeo(0.14, 2.3, 0.14, 0.6, true), sx * (W / 2 - 0.1), P + 1.07, D / 2 + PD - 0.12));
    }
    const pr = 0.22; // porch roof pitch
    const pLen = PD / Math.cos(pr) + 0.25;
    parts.slate.push(place(boxGeo(W + 0.4, 0.08, pLen, 0.42), 0, P + 2.36 + Math.sin(pr) * pLen / 2 - 0.12, D / 2 + PD / 2 + 0.05, pr, 0, 0));
    parts.planksDark.push(place(boxGeo(W + 0.2, 0.14, 0.12, 0.6), 0, P + 2.3, D / 2 + PD - 0.12));
    // Steps
    for (let i = 0; i < 2; i++) parts.stone.push(place(boxGeo(1.4, 0.18, 0.36, 0.5), 0, 0.09 + i * 0.18 - 0.06, D / 2 + PD + 0.36 - i * 0.3));
    // Chimney on the east gable
    parts.stone.push(place(boxGeo(0.85, P + WH + rise + 0.9, 0.7, 0.5), W / 2 + 0.38, (P + WH + rise + 0.9) / 2, -0.4));
    parts.iron.push(place(cylGeo(0.12, 0.12, 0.4, 10), W / 2 + 0.38, P + WH + rise + 1.08, -0.4));
    // Bench on the porch
    parts.planksDark.push(place(boxGeo(1.5, 0.06, 0.4, 0.8), -1.9, P + 0.45, D / 2 + 0.45));
    for (const bx of [-2.5, -1.3]) parts.planksDark.push(place(boxGeo(0.06, 0.45, 0.36, 0.8), bx, P + 0.22, D / 2 + 0.45));

    const g = meshesFrom(parts, this.mats);
    // Station sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.55), new THREE.MeshStandardMaterial({ map: signTexture([
      { text: 'HOLLIN VALE RESERVE', font: '600 74px Georgia, serif', y: 0.42 },
      { text: 'FIELD STATION · EST. 2026', font: '400 40px Georgia, serif', y: 0.74 },
    ]), roughness: 0.7 }));
    sign.position.set(0, P + 2.62, D / 2 + 0.02); sign.castShadow = true;
    g.add(sign);
    // Wall lantern
    const lamp = new THREE.Group();
    const housing = new THREE.Mesh(boxGeo(0.16, 0.24, 0.16), this.mats.iron);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.11), this.mats.lampGlow);
    lamp.add(housing, glow); lamp.position.set(0.85, P + 2.0, D / 2 + 0.14);
    g.add(lamp);
    const light = new THREE.PointLight(0xffb36a, 4, 7, 2); light.position.set(0.85, P + 1.9, D / 2 + 0.45);
    g.add(light); this.lights.push(light);
    this.put(g, x, z, yaw);
    g.position.y = this.terrain.heightAt(x, z + D / 2) - 0.05;
    this.cabinTop = new THREE.Vector3(x + W / 2 + 0.38, g.position.y + P + WH + rise + 1.3, z - 0.4);
    this.colliders.addBox(x, z, W / 2 + 0.05, D / 2 + 0.05, yaw, 'building');
    this.colliders.addBox(x + W / 2 + 0.38, z - 0.4, 0.45, 0.4, 0, 'building');
    for (const sx of [-1, 1]) this.colliders.addCircle(x + sx * (W / 2 - 0.1), z + D / 2 + PD - 0.12, 0.12, 'post');
    this.porchDeck = { x, z: z + D / 2 + PD / 2, hx: W / 2 + 0.1, hz: PD / 2, y: g.position.y + P - 0.02 };
    this.cabin = g;
    this.buildSmoke();
  }

  buildSmoke() {
    // Soft chimney smoke: a handful of billboards rising and fading.
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(235,235,235,0.5)'); gr.addColorStop(1, 'rgba(235,235,235,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const puffs = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      s.userData.t = i / 14; this.group.add(s); puffs.push(s);
    }
    this.smoke = puffs;
  }

  buildShed() {
    const { x, z, yaw } = OUTPOST.shed;
    const W = 3.4, D = 2.6, HF = 2.3, HB = 1.95;
    const parts = { planks: [], planksDark: [], canvas: [], straw: [], stone: [], iron: [], paintGreen: [] };
    parts.stone.push(place(boxGeo(W + 0.1, 0.18, D + 0.1, 0.5), 0, 0.09, 0));
    // pent walls: build front with a wide doorway, back lower
    for (const g of wallPieces(W, HF, 0.12, [{ x0: -1.05, x1: 1.05, y0: 0, y1: 1.95 }])) parts.planks.push(place(g, 0, 0.18, D / 2 - 0.06));
    for (const g of wallPieces(W, HB, 0.12, [])) parts.planks.push(place(g, 0, 0.18, -D / 2 + 0.06));
    for (const sx of [-1, 1]) {
      const s = new THREE.Shape(); s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(D / 2, HF); s.lineTo(-D / 2, HB); s.lineTo(-D / 2, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }); g.translate(0, 0, -0.06);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
      parts.planks.push(place(g, sx * (W / 2 - 0.06), 0.18, 0, 0, -Math.PI / 2, 0));
    }
    const rp = Math.atan2(HF - HB, D);
    parts.canvas.push(place(boxGeo(W + 0.5, 0.06, D / Math.cos(rp) + 0.5, 0.5), 0, 0.18 + (HF + HB) / 2 + 0.06, 0, -rp, 0, 0));
    // Open doors
    for (const sx of [-1, 1]) {
      const door = place(boxGeo(1.02, 1.92, 0.05, 0.6), 0, 0, 0);
      door.translate(sx * 0.51, 0.96 + 0.2, 0);
      door.applyMatrix4(new THREE.Matrix4().makeRotationY(sx * 1.9));
      door.translate(sx * 1.05, 0, D / 2 + 0.02);
      parts.paintGreen.push(door);
    }
    // Interior: shelves, sacks, crates
    parts.planksDark.push(place(boxGeo(W - 0.4, 0.05, 0.5, 0.6), 0, 1.2, -D / 2 + 0.4));
    parts.planksDark.push(place(boxGeo(W - 0.4, 0.05, 0.5, 0.6), 0, 0.7, -D / 2 + 0.4));
    for (let i = 0; i < 3; i++) parts.canvas.push(place(new THREE.SphereGeometry(0.3, 12, 8).scale(1, 0.8, 0.75), -0.9 + i * 0.6, 0.45, 0.2));
    parts.straw.push(place(boxGeo(1.0, 0.45, 0.5, 1), 1.1, 0.42, -0.1));
    const g = meshesFrom(parts, this.mats);
    this.put(g, x, z, yaw, -0.04);
    this.colliders.addBox(x, z, W / 2 + 0.05, D / 2 + 0.05, yaw, 'building');
    this.shed = g;
  }

  buildSupplies() {
    const { x, z } = OUTPOST.supplies;
    const parts = { planks: [], planksDark: [], fenceNew: [], iron: [], canvas: [], straw: [], galv: [] };
    const crate = (cx, cy, cz, s = 0.62, ry = 0) => {
      parts.planks.push(place(boxGeo(s, s, s, 0.9), cx, cy + s / 2, cz, 0, ry, 0));
      for (const e of [-1, 1]) parts.planksDark.push(place(boxGeo(s + 0.02, 0.07, 0.07, 0.9), cx, cy + s / 2 + e * (s / 2 - 0.04), cz + 0, 0, ry, 0));
    };
    crate(0, 0, 0); crate(0.7, 0, 0.1, 0.62, 0.2); crate(0.32, 0.62, 0.04, 0.55, 0.4); crate(-0.8, 0, 0.6, 0.5, -0.3);
    // Timber stack (construction materials)
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3 - (i > 2 ? 1 : 0); j++) parts.fenceNew.push(place(boxGeo(2.4, 0.09, 0.16, 0.8), -0.4, 0.06 + i * 0.1, 1.4 + j * 0.2 - (i % 2) * 0.05));
    for (let i = 0; i < 6; i++) parts.fenceNew.push(place(cylGeo(0.06, 0.06, 1.6, 7, 0.8), 1.6 + (i % 3) * 0.13, 0.07 + Math.floor(i / 3) * 0.12, 1.5, Math.PI / 2, 0, 0));
    // Barrels
    for (const [bx, bz] of [[1.5, -0.4], [2.1, -0.1]]) {
      parts.planks.push(place(cylGeo(0.3, 0.3, 0.86, 16, 0.9), bx, 0.43, bz));
      for (const hy of [0.15, 0.71]) parts.iron.push(place(cylGeo(0.305, 0.305, 0.05, 16), bx, hy, bz));
    }
    // Feed sacks (rations)
    for (let i = 0; i < 3; i++) parts.canvas.push(place(new THREE.SphereGeometry(0.28, 12, 8).scale(1.1, 0.75, 0.7), -1.4 + i * 0.05, 0.22 + i * 0.32, -0.3 + i * 0.12, 0, i * 0.6, 0));
    // Galvanised feed bin
    parts.galv.push(place(cylGeo(0.35, 0.33, 0.7, 18, 0.8), -2.3, 0.35, 0.4));
    const g = meshesFrom(parts, this.mats);
    this.put(g, x, z, -0.35);
    this.colliders.addBox(x + 0.2, z + 0.1, 1.6, 0.6, -0.35, 'props');
    this.colliders.addBox(x - 0.2, z + 1.5, 1.4, 0.4, -0.35, 'props');
    this.supplies = g;
  }

  buildNoticeboard() {
    const { x, z, yaw } = OUTPOST.noticeboard;
    const parts = { planksDark: [], slate: [] };
    for (const sx of [-1, 1]) parts.planksDark.push(place(boxGeo(0.1, 2.1, 0.1, 0.8, true), sx * 0.75, 1.05, 0));
    parts.planksDark.push(place(boxGeo(1.6, 1.0, 0.06, 0.8), 0, 1.35, 0));
    parts.slate.push(place(boxGeo(1.9, 0.05, 0.5, 0.5), 0, 2.13, 0.03, 0.25, 0, 0));
    const g = meshesFrom(parts, this.mats);
    const notes = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.88), new THREE.MeshStandardMaterial({ map: notesTexture(), roughness: 0.9 }));
    notes.position.set(0, 1.35, 0.035); g.add(notes);
    this.put(g, x, z, yaw);
    this.colliders.addBox(x, z, 0.85, 0.12, yaw, 'props');
    this.noticeboard = g;
    this.interactables.push({ id: 'noticeboard', x, z, r: 2.0, label: 'Read field notes' });
  }

  buildPump() {
    const { x, z } = OUTPOST.pump;
    const parts = { stone: [], iron: [], galv: [] };
    parts.stone.push(place(boxGeo(1.1, 0.12, 0.8, 0.6), 0, 0.06, 0));
    parts.iron.push(place(cylGeo(0.07, 0.09, 1.1, 12), 0, 0.65, -0.2));
    parts.iron.push(place(cylGeo(0.02, 0.02, 0.32, 6), 0, 1.0, -0.06, Math.PI / 2.4, 0, 0));
    parts.iron.push(place(boxGeo(0.06, 0.06, 0.5), 0, 1.25, -0.3, -0.5, 0, 0));
    parts.galv.push(place(cylGeo(0.17, 0.14, 0.3, 14), 0.15, 0.27, 0.15));
    const g = meshesFrom(parts, this.mats);
    this.put(g, x, z, 0.4);
    this.colliders.addCircle(x, z - 0.1, 0.35, 'props');
  }

  buildBridge() {
    const B = BRIDGE;
    const n = STREAM.nearest(B.x, B.z);
    const L = streamLevels(n.u);
    const deckY = L.bank + 0.32;
    const len = B.halfLength * 2, w = B.halfWidth * 2;
    const parts = { planksDark: [], planks: [], stone: [] };
    for (let i = 0; i < Math.floor(len / 0.24); i++) {
      const zz = -len / 2 + 0.12 + i * 0.24;
      parts.planks.push(place(boxGeo(w + (i % 3 === 0 ? 0.1 : 0), 0.06, 0.21, 0.9), (Math.sin(i * 7.1) * 0.03), 0, zz, 0, Math.sin(i * 3.3) * 0.02, 0));
    }
    for (const sx of [-1, 1]) {
      parts.planksDark.push(place(boxGeo(0.12, 0.2, len + 0.3, 0.8), sx * (w / 2 - 0.08), -0.13, 0));
      for (let k = 0; k <= 4; k++) parts.planksDark.push(place(boxGeo(0.09, 0.95, 0.09, 0.8, true), sx * (w / 2 + 0.02), 0.45, -len / 2 + 0.2 + k * (len - 0.4) / 4));
      parts.planksDark.push(place(boxGeo(0.07, 0.1, len - 0.2, 0.8), sx * (w / 2 + 0.02), 0.92, 0));
      parts.planksDark.push(place(boxGeo(0.05, 0.07, len - 0.2, 0.8), sx * (w / 2 + 0.02), 0.5, 0));
    }
    for (const sz of [-1, 1]) parts.stone.push(place(boxGeo(w + 0.6, 0.9, 0.9, 0.5), 0, -0.55, sz * (len / 2 - 0.2)));
    const g = meshesFrom(parts, this.mats);
    g.position.set(B.x, deckY, B.z);
    g.rotation.y = B.yaw;
    this.group.add(g);
    this.bridge = { ...B, deckY };
    // Rails as colliders
    const ax = Math.sin(B.yaw), az = Math.cos(B.yaw); // along deck
    const sxv = Math.cos(B.yaw), szv = -Math.sin(B.yaw); // across deck (local +X)
    for (const sx of [-1, 1]) {
      const ox = B.x + sxv * sx * (w / 2 + 0.1), oz = B.z + szv * sx * (w / 2 + 0.1);
      this.colliders.addSegment(ox - ax * len / 2, oz - az * len / 2, ox + ax * len / 2, oz + az * len / 2, 0.08, 'bridge');
    }
  }

  /** Is (x, z) on the bridge deck? Returns deck height or null. */
  bridgeHeight(x, z) {
    const B = this.bridge; if (!B) return null;
    const dx = x - B.x, dz = z - B.z;
    const lx = dx * Math.cos(B.yaw) - dz * Math.sin(B.yaw);
    const lz = dx * Math.sin(B.yaw) + dz * Math.cos(B.yaw);
    if (Math.abs(lx) > B.halfWidth + 0.05 || Math.abs(lz) > B.halfLength + 0.4) return null;
    const ground = this.terrain.heightAt(x, z);
    const ramp = Math.abs(lz) > B.halfLength - 0.3 ? Math.max(ground, B.deckY - (Math.abs(lz) - B.halfLength + 0.3) * 0.25) : B.deckY;
    return Math.max(ground, ramp) + 0.03;
  }

  porchHeight(x, z) {
    const p = this.porchDeck; if (!p) return null;
    if (Math.abs(x - p.x) < p.hx && Math.abs(z - p.z) < p.hz + 0.05) return p.y + 0.06;
    if (Math.abs(x - p.x) < 0.7 && z > p.z + p.hz && z < p.z + p.hz + 0.75) return p.y - 0.22 - (z - p.z - p.hz) * 0.25;
    return null;
  }

  update(dt) {
    if (this.smoke) {
      for (const s of this.smoke) {
        s.userData.t = (s.userData.t + dt * 0.055) % 1;
        const t = s.userData.t;
        s.position.set(this.cabinTop.x + Math.sin(t * 4 + s.id) * 0.2 + t * 2.6, this.cabinTop.y + t * 6.5, this.cabinTop.z + t * 1.4);
        const sc = 0.5 + t * 3.2; s.scale.set(sc, sc, 1);
        s.material.opacity = Math.sin(t * Math.PI) * 0.28;
      }
    }
  }
}

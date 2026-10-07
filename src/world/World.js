// Assembles the static world and answers ground / walkability queries.
import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { Environment } from './Environment.js';
import { Water } from './Water.js';
import { Grass } from './Grass.js';
import { Vegetation } from './Vegetation.js';
import { whenTexturesLoaded } from '../vendor/ez-tree/textures.js';
import { Outpost } from './Outpost.js';
import { Colliders } from './Colliders.js';
import { createMaterials } from './Materials.js';
import { CONFIG } from '../data/config.js';
import { mulberry32 } from '../util/noise.js';
import { STREAM, BRIDGE } from './WorldLayout.js';

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.quality = game.quality;
  }

  async build(progress) {
    const { scene, quality, assets } = this.game;
    this.colliders = new Colliders();
    this.mats = createMaterials(assets);
    progress?.(0.05, 'Shaping the land');
    await tick();
    this.terrain = new Terrain(assets, quality);
    scene.add(this.terrain.mesh);
    this.env = new Environment(this.game.renderer, scene, quality);
    progress?.(0.2, 'Filling the stream');
    await tick();
    this.water = new Water();
    scene.add(this.water.mesh);
    this.grass = new Grass(this.terrain, quality);
    scene.add(this.grass.group);
    progress?.(0.3, 'Growing the woodland');
    await tick();
    this.vegetation = new Vegetation(this.terrain, this.colliders, quality, assets);
    this.vegetation.build();
    scene.add(this.vegetation.group);
    progress?.(0.4, 'Filling in the distant woods');
    await whenTexturesLoaded();
    this.vegetation.buildFarTrees(this.game.renderer);
    progress?.(0.45, 'Raising the field station');
    await tick();
    this.outpost = new Outpost(this.terrain, this.colliders, this.mats);
    scene.add(this.outpost.group);
    this.scatterRocks();
  }

  scatterRocks() {
    const r = mulberry32(99);
    const protos = ['rock1', 'rock2', 'rock3'].map((id) => this.game.assets.models.get(id)?.gltf.scene).filter(Boolean);
    if (!protos.length) return;
    const place = (x, z, s, collide) => {
      const p = protos[Math.floor(r() * protos.length)].clone();
      p.scale.setScalar(s); p.rotation.set(r() * 0.3, r() * 6.28, r() * 0.3);
      p.position.set(x, this.terrain.heightAt(x, z) - s * 0.35, z);
      p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(p);
      if (collide) this.colliders.addCircle(x, z, s * 1.6, 'rock');
    };
    // Along the stream banks
    for (let i = 0; i < 26; i++) {
      const s = STREAM.p[Math.floor(60 + r() * 380)];
      const side = r() < 0.5 ? -1 : 1;
      const n = STREAM.nearest(s.x, s.z);
      const x = s.x - n.tz * side * (1.6 + r() * 1.2), z = s.z + n.tx * side * (1.6 + r() * 1.2);
      if (Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < 6) continue;
      place(x, z, 0.08 + r() * 0.12, false);
    }
    // A few boulders in the woodland and field margins
    for (const [x, z, s] of [[-52, 18, 0.35], [-66, -12, 0.45], [-49, 47, 0.28], [58, 70, 0.4], [68, -30, 0.32], [-75, 60, 0.5]]) place(x, z, s, true);
  }

  /** Walking surface height including the bridge and porch. */
  groundAt(x, z) {
    const b = this.outpost.bridgeHeight(x, z);
    if (b !== null) return b;
    const p = this.outpost.porchHeight(x, z);
    if (p !== null) return Math.max(p, this.terrain.heightAt(x, z));
    return this.terrain.heightAt(x, z);
  }

  /** Can a character stand here? Water (off the bridge) and map bounds block. */
  walkable(x, z, margin = 0.15) {
    const B = CONFIG.world.bounds;
    if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return false;
    if (this.terrain.waterDist(x, z) < margin && this.outpost.bridgeHeight(x, z) === null) return false;
    return true;
  }

  /** Move a ground character with collision and sliding. */
  moveCircle(x, z, nx, nz, r, filter) {
    let p = this.colliders.resolve(nx, nz, r, filter);
    if (!this.walkable(p.x, p.z)) {
      if (this.walkable(p.x, z)) p = { x: p.x, z };
      else if (this.walkable(x, p.z)) p = { x, z: p.z };
      else p = { x, z };
    }
    return p;
  }

  update(dt, focus, time, pushers) {
    this.env.update(dt, focus, time);
    this.water.update(dt);
    this.grass.update(dt, focus, pushers);
    this.vegetation.update(dt);
    this.outpost.update(dt);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
export { THREE };

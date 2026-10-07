// Loads and caches models and textures. Model metadata lives in
// src/data/assets.js so replacing a model means editing one entry.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS } from '../data/assets.js';

export class Assets {
  constructor(renderer) {
    this.gltf = new GLTFLoader();
    this.gltf.setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));
    this.tex = new THREE.TextureLoader();
    this.models = new Map();
    this.textures = new Map();
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  async loadModels(ids, onProgress) {
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      const def = MODELS[id];
      const g = await this.gltf.loadAsync(def.url);
      g.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      this.models.set(id, { def, gltf: g });
      done++; onProgress?.(done / ids.length, id);
    }));
  }

  /** Independent copy of a skinned model with its own skeleton. */
  instantiate(id) {
    const m = this.models.get(id);
    if (!m) throw new Error(`Model not loaded: ${id}`);
    const scene = SkeletonUtils.clone(m.gltf.scene);
    return { def: m.def, scene, animations: m.gltf.animations };
  }

  texture(url, { srgb = true, repeat = null, aniso = 8 } = {}) {
    const key = url + (srgb ? '|s' : '|l');
    if (this.textures.has(key)) {
      const base = this.textures.get(key);
      if (!repeat) return base;
      const t = base.clone(); t.repeat.set(...repeat); t.needsUpdate = true; return t;
    }
    const t = this.tex.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(aniso, this.maxAniso);
    this.textures.set(key, t);
    if (repeat) { const c = t.clone(); c.repeat.set(...repeat); return c; }
    return t;
  }
}

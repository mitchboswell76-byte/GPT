// Vendored from @dgreenheck/ez-tree (MIT) and changed to load textures lazily
// from public/assets/vendor/ez-tree so only the bark/leaf types in use are
// downloaded. Signatures match the original module.
import * as THREE from 'three';

const BASE = 'assets/vendor/ez-tree/';
const loader = new THREE.TextureLoader();
const cache = new Map();
const pending = [];

/** Resolves once every texture requested so far has loaded. */
export function whenTexturesLoaded() { return Promise.all(pending); }

function load(file, srgb) {
  if (!cache.has(file)) {
    let done;
    pending.push(new Promise((r) => { done = r; }));
    const t = loader.load(BASE + file, () => done(), undefined, () => done());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(file, t);
  }
  return cache.get(file);
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const t = load(`${barkType}_${fileType}_1k.jpg`, fileType === 'color').clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.x = scale.x;
  t.repeat.y = 1 / scale.y;
  return t;
}

export function getLeafTexture(leafType) {
  const t = load(`${leafType}_color.png`, true);
  t.premultiplyAlpha = true; // avoids pale fringes from transparent texels
  return t;
}

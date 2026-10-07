// Keeper haircut: scalp base + groomed hair cards, added to the player GLB.
//   HairScalp  closes the skull hole; dark root colour, combed streaks, soft
//              hairline, reconstructed forehead skin; alpha-blended into Body.
//   HairCards  narrow curved strip cards following the groom flow, textured
//              from a generated strand atlas (alpha MASK, double sided,
//              KHR_materials_anisotropy for a soft strand-aligned sheen).
// Both are skinned with the weights of the nearest Body vertex (Head ~100 %).
import { KHRMaterialsAnisotropy, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { loadBody } from './keeper.mjs';
import { buildHeadField } from './scalp.mjs';
import { makeGroom, buildCards } from './groom.mjs';
import { strandAtlas } from './atlas.mjs';
import { bakeScalpTextures, buildScalpMesh } from './scalp-base.mjs';

function nearestWeights(body, points) {
  // brute force over head-region body vertices (few thousand) is fine here
  const cand = [];
  for (let i = 0; i < body.pos.length / 3; i++) if (body.pos[i * 3 + 1] > 1.55) cand.push(i);
  const n = points.length / 3; const J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  const cache = new Map();
  for (let v = 0; v < n; v++) {
    const x = points[v * 3], y = points[v * 3 + 1], z = points[v * 3 + 2];
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let best = cache.get(key);
    if (best === undefined) {
      let bd = Infinity; best = -1;
      for (const i of cand) { const dx = body.pos[i * 3] - x, dy = body.pos[i * 3 + 1] - y, dz = body.pos[i * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
      cache.set(key, best);
    }
    let s = 0; for (let k = 0; k < 4; k++) s += body.wgt[best * 4 + k];
    for (let k = 0; k < 4; k++) { J[v * 4 + k] = body.jnt[best * 4 + k]; Wt[v * 4 + k] = body.wgt[best * 4 + k] / s; }
  }
  return { J, Wt };
}

export async function addKeeperHair(doc) {
  const root = doc.getRoot();
  const { skin, headJoint, body, tex } = await loadBody(doc);
  const F = buildHeadField(body, headJoint, tex);
  const G = makeGroom(F);

  const buf = root.listBuffers()[0];
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const jointArray = (J) => (skin.listJoints().length > 255 ? J : Uint8Array.from(J));
  const scene = root.listScenes()[0];

  // --- scalp base -----------------------------------------------------------
  const scalpTex = await bakeScalpTextures(F, G);
  const S = buildScalpMesh(F, scalpTex.alphaAt);
  const sw = nearestWeights(body, S.positions);
  const sMat = doc.createMaterial('HairScalp')
    .setBaseColorTexture(doc.createTexture('HairScalp_diffuse').setImage(scalpTex.colPng).setMimeType('image/png'))
    .setNormalTexture(doc.createTexture('HairScalp_normal').setImage(scalpTex.nrmPng).setMimeType('image/png'))
    .setMetallicRoughnessTexture(doc.createTexture('HairScalp_mr').setImage(scalpTex.mrPng).setMimeType('image/png'))
    .setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('BLEND').setDoubleSided(false);
  const sPrim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', S.positions))
    .setAttribute('NORMAL', acc('VEC3', S.normals))
    .setAttribute('TEXCOORD_0', acc('VEC2', S.uvs))
    .setAttribute('JOINTS_0', acc('VEC4', jointArray(sw.J)))
    .setAttribute('WEIGHTS_0', acc('VEC4', sw.Wt))
    .setIndices(acc('SCALAR', new Uint16Array(S.indices))).setMaterial(sMat);
  scene.addChild(doc.createNode('HairScalp').setMesh(doc.createMesh('HairScalp').addPrimitive(sPrim)).setSkin(skin));

  // --- hair cards -----------------------------------------------------------
  const atlas = await strandAtlas();
  const Cd = buildCards(F, G);
  const cw = nearestWeights(body, new Float32Array(Cd.rootOf));
  const anisoExt = doc.createExtension(KHRMaterialsAnisotropy);
  const specExt = doc.createExtension(KHRMaterialsSpecular);
  const cMat = doc.createMaterial('HairCards')
    .setBaseColorTexture(doc.createTexture('HairCards_diffuse').setImage(atlas.colPng).setMimeType('image/png'))
    .setNormalTexture(doc.createTexture('HairCards_normal').setImage(atlas.nrmPng).setMimeType('image/png'))
    .setNormalScale(0.55)
    .setMetallicFactor(0).setRoughnessFactor(0.6).setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true);
  // Strand sheen: roughness stretched across the strands (tangent = card u).
  cMat.setExtension('KHR_materials_anisotropy', anisoExt.createAnisotropy().setAnisotropyStrength(0.75).setAnisotropyRotation(0));
  cMat.setExtension('KHR_materials_specular', specExt.createSpecular().setSpecularFactor(0.32).setSpecularColorFactor([1.0, 0.86, 0.7]));
  const nV = Cd.positions.length / 3;
  const cPrim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(Cd.positions)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(Cd.normals)))
    .setAttribute('TANGENT', acc('VEC4', new Float32Array(Cd.tangents)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(Cd.uvs)))
    .setAttribute('COLOR_0', acc('VEC4', Uint8Array.from(Cd.colors, x => Math.round(Math.min(1, x) * 255))).setNormalized(true))
    .setAttribute('JOINTS_0', acc('VEC4', jointArray(cw.J)))
    .setAttribute('WEIGHTS_0', acc('VEC4', cw.Wt))
    .setIndices(acc('SCALAR', nV > 65535 ? new Uint32Array(Cd.indices) : new Uint16Array(Cd.indices))).setMaterial(cMat);
  scene.addChild(doc.createNode('HairCards').setMesh(doc.createMesh('HairCards').addPrimitive(cPrim)).setSkin(skin));

  const stats = {
    ...F.stats,
    scalpTris: S.indices.length / 3,
    cardTris: Cd.indices.length / 3,
    cards: Cd.cards,
    layers: Object.fromEntries(Cd.counts),
  };
  return stats;
}

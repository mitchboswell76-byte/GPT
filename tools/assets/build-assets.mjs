// Asset pipeline: turns the untouched source models in assets-src/ into the
// runtime GLBs in public/assets/models/. Re-run after replacing a source file:
//   npm run assets
// Every repair here is deliberate and documented in docs/ASSETS.md.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { addKeeperHair } from './hair/index.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public/assets/models');
fs.mkdirSync(OUT, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'sharp': sharp });

const only = process.argv[2];

async function compress(doc, { maxColor = 2048, maxData = 1024, quality = 86 } = {}) {
  // Colour textures keep more resolution than normal / roughness data.
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality, resize: [maxColor, maxColor], slots: /^(baseColor|emissive)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [maxData, maxData], slots: /^(normal|metallicRoughness|occlusion)/ }),
  );
}

function findNode(doc, name) { return doc.getRoot().listNodes().find(n => n.getName() === name); }
function findMesh(doc, name) { return doc.getRoot().listMeshes().find(m => m.getName() === name); }

// ---------------------------------------------------------------------------
// Player: "the sound guy"
// ---------------------------------------------------------------------------
async function buildPlayer() {
  const doc = await io.read(path.join(SRC, 'the-sound-guy-fixed-head.glb'));
  const root = doc.getRoot();

  // 1. Hair-card materials were exported OPAQUE, so beard, moustache and
  //    eyelash cards rendered as solid blocks. Their textures carry alpha.
  for (const m of root.listMaterials()) {
    if (['Beard', 'Moustache', 'Body'].includes(m.getName())) { m.setAlphaMode('MASK'); m.setAlphaCutoff(0.45); }
  }

  // 2. Remove the earlier crude "RepairedScalp" patch (jagged dark cap plus a
  //    stray band at eye level) and replace the missing top of the skull with
  //    a groomed short haircut: a scalp base plus hair cards (tools/assets/hair).
  const oldNode = findNode(doc, 'RepairedScalp');
  if (oldNode) { const m = oldNode.getMesh(); oldNode.dispose(); if (m) m.dispose(); }
  const hairStats = await addKeeperHair(doc);

  // 3. The T-Pose clip is the bind pose only; drop it.
  for (const a of root.listAnimations()) if (a.getName() === 'T-Pose') a.dispose();

  await compress(doc, { maxColor: 1024, maxData: 1024 });
  await doc.transform(prune(), dedup());
  await io.write(path.join(OUT, 'player.glb'), doc);
  console.log('player.glb written', hairStats);
}

// ---------------------------------------------------------------------------
// Puppy
// ---------------------------------------------------------------------------
async function buildPuppy() {
  const doc = await io.read(path.join(SRC, 'dog-puppy.glb'));
  for (const m of doc.getRoot().listMaterials()) {
    // Emissive slot held a 1x1 black image with factor 1: no visual effect.
    m.setEmissiveTexture(null); m.setEmissiveFactor([0, 0, 0]);
  }
  await compress(doc, { maxColor: 1024, maxData: 1024 });
  await doc.transform(prune(), dedup());
  await io.write(path.join(OUT, 'dog_puppy.glb'), doc);
  console.log('dog_puppy.glb written');
}

// ---------------------------------------------------------------------------
// Adult Labrador (Sketchfab, kenchoo, CC-BY-4.0)
// ---------------------------------------------------------------------------
async function buildAdultDog() {
  const doc = await io.read(path.join(SRC, 'labrador_dog.glb'));
  const node = doc.getRoot().listNodes().find(n => n.getSkin());
  const skin = node.getSkin(); const joints = skin.listJoints();
  const J = (name) => joints.findIndex(j => j.getName() === name);
  const neutral = J('neutral_bone_52');
  const footL = J('FFB.L_44'), footR = J('FFB.R_48');
  // Hind toe vertices were bound to "neutral_bone", a static bone at the rig
  // root. Once the paws move they would stretch back to the origin, so they
  // are rebound to the hind foot bones on their own side.
  let moved = 0;
  for (const p of node.getMesh().listPrimitives()) {
    const P = p.getAttribute('POSITION'), JA = p.getAttribute('JOINTS_0');
    const pa = P.getArray(), ja = JA.getArray();
    for (let i = 0; i < P.getCount(); i++) for (let k = 0; k < 4; k++) {
      if (ja[i * 4 + k] === neutral) { ja[i * 4 + k] = pa[i * 3] >= 0 ? footL : footR; moved++; }
    }
    JA.setArray(ja);
  }
  // Morph targets are unnamed and unused by the clip at rest; keep them.
  await compress(doc, { maxColor: 2048, maxData: 1024 });
  await doc.transform(prune({ keepAttributes: true }), dedup());
  await io.write(path.join(OUT, 'dog_adult.glb'), doc);
  console.log('dog_adult.glb written; rebound joint refs:', moved);
}

if (!only || only === 'player') await buildPlayer();
if (!only || only === 'puppy') await buildPuppy();
if (!only || only === 'adult') await buildAdultDog();

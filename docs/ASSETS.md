# Asset record

Source files live untouched in `assets-src/`. The runtime GLBs in
`public/assets/models/` are produced by `npm run assets` (`tools/assets/build-assets.mjs`).
To replace a model: drop the new source in `assets-src/`, adjust the build step
if it needs repairs, rebuild, and update `src/data/assets.js` (and a bone map in
`src/creatures/rigs.js` for a new quadruped).

## Supplied models

### Keeper — `the-sound-guy-fixed-head.glb` → `player.glb`

| | |
|---|---|
| Rig | Mixamo, 65 joints (`mixamorig:*`), armature scale 0.01 |
| Size | 1.80 m tall, faces +Z |
| Meshes | Body (head/neck/arms), Tops, Bottoms, Gloves, Shoes, Beards, Moustaches, Eyes, Eyelashes, RepairedScalp |
| Clips | `Idle` (8.4 s), `Walking` (1.07 s, in place), `T-Pose` (bind pose) |
| Walk speed | measured from planted-foot travel: **1.65 m/s** at timeScale 1 (stride 1.76 m) |

Inspection findings and repairs (all in the build script; rig and UVs untouched):

1. **Hair cards rendered as solid blocks.** Beard, moustache and eyelash textures
   carry alpha but the materials were exported OPAQUE. Set to alpha MASK (0.45).
   The Body texture's alpha is only used by the eyelash patch, so masking it is safe.
2. **Broken scalp.** The Body mesh has the top of the skull missing (jagged hole
   from forehead to crown). The earlier `RepairedScalp` patch was a dark cap with
   a jagged hairline and a stray band at eye level. It is removed and replaced by
   a generated **HairCap** mesh: rays cast from the skull centre against the
   Body mesh give the real head shape; an ellipsoid (crown height fixed from
   proportions, ~11.5 cm above eye level) fills the open top; residuals blend the
   two. It is skinned 100 % to `mixamorig:Head`, textured with a generated
   short-crop hair texture and fades into the skin at the hairline.
   *If you have the original hair mesh, that would be preferable — swap it in
   the build script.*
3. `T-Pose` clip removed. Textures converted to WebP (1024 px).

Missing for a fuller keeper: run, crouch/kneel, reach/offer, petting, carrying
and tool-use clips. Crouch, offering and stroking are currently IK overlays on
the idle clip (`Player.js`).

### Puppy — `dog-puppy.glb` → `dog_puppy.glb`

| | |
|---|---|
| Rig | 45 joints (`Dog_*SHJnt`, a few `Wolf_*`), full leg chains with hock and paw joints |
| Size | 0.31 m to top of head at scale 1 (≈ 8–9 week Labrador puppy); faces +Z |
| Materials | baseColor, normal, roughness (1024 px); emissive slot held a 1×1 black image (removed) |
| Morph targets | `breath`, `blink` (driven procedurally as well as by the clip) |
| Clips | one `Animation` (8.7 s): **standing idle only** (head looks around, tail moves) |

No walk, trot, sit, lie, eat or play clips. All locomotion and poses come from
`QuadrupedRig`. In-game scale grows from 1.12 to 2.15 (`scaleRange`).

### Adult Labrador — `labrador_dog.glb` → `dog_adult.glb`

| | |
|---|---|
| Source | "Labrador Dog" by **kenchoo**, Sketchfab, **CC-BY-4.0** — credit shown on the title screen |
| Rig | 53 joints. Paws are weighted to IK-control bones (`IKFrontLeg*`, `FF*`, `IKBackLeg*`, `FFB*`) parented to the rig root, not to the leg chains |
| Size | raw units ≈ 2.76 to top of head; in-game scale 0.235 → 0.28 (≈ 57 cm at the withers) |
| Materials | one material, three 2048 px PNG maps on separate UV sets |
| Clips | one `Animation` (13 s): standing idle with a head-down sniff segment |

Repairs: 440 hind-toe vertices were bound to a static `neutral_bone` at the rig
root (they would stretch back to the origin once the paws move); they are
rebound to the hind foot bones on their own side. Textures converted to WebP
(2048 colour, 1024 data). The rig's thigh bones carry most of the hindquarter
weights, so lying uses rig-specific pose tweaks (`rigs.js#poseTweaks`).

The puppy and adult are different artists' models, so the coat colour and face
change slightly at the hand-over; the cross-fade happens while the record
stays the same. A matched puppy/adult pair would make this seamless.

## Third-party assets used for scenery

| Asset | Source | Licence |
|---|---|---|
| Tree generator (`src/vendor/ez-tree`) | `@dgreenheck/ez-tree` 1.1.0 | MIT |
| Bark textures (oak, willow: Poly Haven; birch, pine: TextureCan) | via ez-tree | CC0 per ez-tree's bark README |
| Leaf textures (oak, ash, aspen, pine) | via ez-tree | MIT package; original source not stated |
| `grass.jpg`, `dirt_color.jpg`, `dirt_normal.jpg`, rocks (`rock1-3.glb`) | ez-tree demo assets | MIT package; original source not stated |
| `ambience.mp3` (birdsong bed) | ez-tree demo assets | MIT package; original source not stated — **verify or replace before any commercial release** |
| Fonts: Fraunces, Work Sans | @fontsource | SIL OFL 1.1 |
| Draco decoder | three.js | MIT |

Generated in-repo (`tools/assets/gen_textures.py`): timber cladding, fence
timber, slate, stone, straw, galvanised metal, soil. Canvas-generated at
runtime: wildflower atlas, fern frond, stock netting, signs, notice papers,
smoke puff, water ripple normals.

## Assets that would most improve the next build

1. Dog clips for the existing rigs: walk, trot, gallop, sit, lie-down transition,
   sleep curl, eat/drink, play bow, shake, scratch — or a matched puppy/adult pair
   that ships with them.
2. Keeper clips: jog/run, crouch idle, kneel, reach/offer, stroke, carry, hammer.
3. Dog vocalisations (whine, yip, bark, pant) and foley (lapping, footsteps on
   timber/grass) as real recordings.
4. Hair mesh for the keeper if the original exists.

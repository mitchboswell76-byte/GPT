# Creature Reserve — project brief

Working title. A keeper-and-researcher game: explore on foot, build homes for
creatures, earn their trust, raise them and record them in the **Life Atlas**.
The long-term roster spans real, prehistoric, mythical and speculative
creatures, with breeding, genetic engineering and evolution later.

This build is **the dog opening**: one region (Hollin Vale), one species, one
complete loop.

## Pillars

1. **Attachment to individuals** — each animal is a named record with a history,
   not a resource.
2. **Homes that matter** — construction choices (space, shelter, food, water,
   enrichment) are assessed and visibly change behaviour and wellbeing.
3. **Curiosity and research** — observing behaviour unlocks knowledge.
4. **Believable presentation** — realistic animals and scenery at consistent
   scale, a close third-person camera, restrained field-notebook UI.

## The opening loop (implemented)

| Step | What happens | Where in code |
|---|---|---|
| 1 | Read the field brief at the noticeboard, open construction (B) | `core/Guidance.js`, `ui/UI.js` |
| 2 | Fence an enclosure on the 2 m grid, hang a gate, place kennel, bowl, trough and a toy; the assessment panel ticks off needs | `construction/*` |
| 3 | A radio report places a stray puppy by the fallen oak across the footbridge | `core/Session.js#onHabitatReady` |
| 4 | Approach calmly (C toggles a slow pace; jogging startles it); offer food (E) — the keeper crouches, the puppy approaches and eats from the hand; ~3 offers earn trust | `creatures/Creature.js#thinkStray/runOffer` |
| 5 | Name the puppy; it follows the keeper's breadcrumb trail home; walk in together, step out, close the gate → it settles | `Creature.js#thinkFollow/checkSettle` |
| 6 | Fill bowl and trough, stroke it (it comes to your hand), observe it eat, drink, rest in the kennel and play (V frames it) | `Creature.js#thinkResident`, `CreatureSystem.js` |
| 7 | It grows with age and adequate care; at 78 % growth the adult Labrador model cross-fades in, same record | `CreatureSystem.js#simulate`, `Creature.js#syncBodies` |
| 8 | The Life Atlas shows a rotating animated 3D preview, species notes (unlocked by research), the individual's record and history | `ui/Atlas.js` |

Progress autosaves (localStorage) and survives reloads.

## Controls

WASD move (camera-relative) · Shift jog · C calm pace · drag to orbit, wheel to zoom ·
E interact · F call / stay · V observe nearest animal · T treat · B construction · L Life Atlas ·
Tab pin creature card · Esc menu · ` (backtick) prototype tools (growth speed, resources).

Construction: LMB place/select · R rotate (Shift+R reverse) · RMB/Esc cancel · WASD pan ·
Q/E turn view · wheel zoom · M move · Del remove (full refund).

## Running

```
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/
```

URL options: `?q=low|medium|high` quality · `?fresh=1` ignore the save ·
`?growth=12` growth speed multiplier · `?rigtest=dog_puppy&speed=1.2&pose=lie` rig viewer.

## Architecture

Vanilla ES modules, three.js r186, Vite. No framework; DOM UI over a WebGL canvas.

```
src/
  main.js                 entry: fonts, CSS, Session (or rig test)
  core/  Game.js          renderer, post (grade/vignette), frame loop, step() for tests
         Session.js       wires systems; key routing; interactions; story beats
         Input.js         keyboard/mouse state (canvas-only mouse capture)
         Assets.js        GLTF/texture loading; SkeletonUtils clones
         Save.js          versioned JSON in localStorage + autosave
         Guidance.js      objective steps derived from game state
         Audio.js         ambience bed, positional stream, footsteps/foley (recorded, synth fallback)
         SoundBank.js     recorded samples: variants, jitter, HRTF positioning, looping voices
         CreatureAudio.js dog vocals and chewing driven by creature state and events
         Events.js        tiny event bus
  data/  config.js        all tunables (rates, growth timing, camera, quality presets)
         sounds.js        sound ids and playback settings; soundFiles.js is generated
         assets.js        model manifest (paths, rig ids, scale ranges)
         species.js       species definitions, research, Atlas placeholders
         buildables.js    construction catalogue
  world/ Terrain.js       analytic height + 1 m grid; masks; splat shader
         Grass.js         GPU grass/flowers pinned to world cells around the camera
         Vegetation.js    ez-tree trees/bushes (tiled instancing), ferns, reeds, impostor far tree line,
                          fallen log, camera clearance grid for bushes/trunks
         Water.js         stream ribbon; Outpost.js cabin/shed/supplies/bridge
         Environment.js   sky, sun, shadows, fog, IBL; Colliders.js 2D collision world
         WorldLayout.js   stream course, paths, bridge, points of interest
  entities/ Player.js     keeper movement: camera-relative intent, rate-limited turning, gaits
            KeeperClips.js pose tables from the Idle/Walking clips; careful walk and jog synthesised
            KeeperMotion.js foot planner (planted heels, stepping turns), pelvis, leg IK, upper body
            KeeperPoses.js  staged kneel, offering and stroking hands, idle glances
            KeeperTest.js  ?keepertest= harness (gaits, turns, offer/stroke with a dummy dog)
            HairShading.js runtime shading for the generated haircut
            CameraRig.js  close orbit camera, build camera, moment framing (picks a side
                          with a clear view), observe mode, collision with buildings/kennels/bushes
  creatures/ rigs.js      bone maps per quadruped rig
             QuadrupedRig.js  procedural gait + IK + postures (see below)
             Gait.js / LegIK.js / Posture.js / Secondary.js  gait timing, limb solver,
                              staged postures and actions, spring tails and ears
             CreatureBody.js  one model instance + idle clip + rig
             Creature.js      record + motion + behaviour brain
             CreatureSystem.js care simulation, growth, research, interactions
  construction/ Structures.js placed pieces, gates, ball physics, enclosure flood fill
                BuildSystem.js tools, ghosts, validation, selection
                Pieces.js      procedural meshes for buildables
  ui/    UI.js, Atlas.js, icons.js, styles.css
  vendor/ez-tree/         vendored tree generator (MIT)
```

### Procedural animation (no clips were supplied)

**Dogs.** The models contain only idle clips. `QuadrupedRig` builds everything
else each frame from the bind pose:

- Gaits (`Gait.js`): lateral-sequence walk, diagonal trot with a short
  suspension, and a rotary gallop with spine flexion and extension. Stride and
  cadence scale with leg length, so the puppy takes quick short steps.
- Paws are planted in world space and swung on arcs to landing points predicted
  from velocity and turning, so they never slide; standing still, a leg only
  steps when its paw is out of place (turning on the spot, squaring up).
- Body heights come from the planted legs; pelvis and shoulders roll and pitch
  with their own legs, the trunk leans into acceleration and turns, the head
  leads turns, nods at the walk and stabilises at the trot.
- Legs (`LegIK.js`) roll over the digits, flex the carpus and hock in swing
  and never hyper-extend. The Labrador's paws are separate IK-control bones.
- Postures (`Posture.js`) are staged, not blended: a dog sits rear first, lies
  down front first, rises front first. One-shot actions: waking stretch,
  shake-off, ear scratch, yawn. `Creature` asks for a posture with `want()`
  and plays actions with `play()`.
- Tail and ears are damped spring chains (`Secondary.js`); jaw for panting
  and yawning; breathing and blinking morphs.

**Keeper.** Only Idle and an in-place Walking clip exist. `KeeperClips` turns
them into phase tables and synthesises a careful walk (calm pace) and a jog
(Shift). `KeeperMotion` plants the feet in the world (heel then ball), steps
to turn on the spot and to settle after stopping, keeps the pelvis over the
feet on slopes, porch and bridge, and adds lean, banking, breathing and a
head that leads turns. `KeeperPoses` stages a one-knee kneel (the keeper turns
to face the animal first), the offering hand and the stroking hand.

Add a new quadruped by adding a bone map to `rigs.js` and a manifest entry.

### State model

Saved document (`core/Save.js#newState`): calendar, resources, player, build
(objects + fence edges), creatures (records), atlas research, objectives, settings.
Creature records keep **species**, **affinity** (null) and inherited **traits**
separate, plus lineage (sire/dam null) for breeding later.

## Testing

`tools/playtest/` drives the real game in headless Chromium with keyboard and
mouse events, stepping frames explicitly:

- `stage1_build.mjs` — brief, construction of a full enclosure
- `stage2_puppy.mjs` — route to the stray, calm approach, hand-feeding, naming, leading home
- `stage3_care.mjs` — feeding, water, stroking, observing, Atlas, growth to adult, reload check

Run with the dev server up: `node tools/playtest/stage1_build.mjs <outDir> <profileDir>`
(set `Q=medium` for prettier screenshots). Stages share the browser profile so the
save carries forward.

`tools/playtest/shot.mjs` and `strip.mjs` capture single frames / frame strips (use
`?rigtest=` for dog animation, `?keepertest=` for the keeper, and `cam=head,dx,dy,dz,ty`
for close-ups of the keeper's head). `audio_check.mjs` checks that every recording
decodes and that footsteps and vocals fire.

## Known limitations (this build)

- All motion is procedural (see above); it is convincing at gameplay distance but
  a motion-captured or hand-keyed set would still look better close up.
- Lighting is a fixed late afternoon; the calendar only drives age.
- Real recordings cover barks, yips, footsteps, paws and most foley; there are
  no whine, panting, lapping or shake-off recordings yet (see `ASSETS.md`).
- Performance was checked by triangle/draw-call counts only (headless software
  renderer); use the quality setting in the pause menu if needed.

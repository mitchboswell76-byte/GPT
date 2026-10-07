// Model manifest. To replace or improve a model, rebuild it with
// tools/assets/build-assets.mjs (or drop a new GLB in public/assets/models)
// and update the entry here. `rig` names a bone map in src/creatures/rigs.js.
export const MODELS = {
  player: {
    url: 'assets/models/player.glb',
    scale: 1,
    clips: { idle: 'Idle', walk: 'Walking' },
    note: 'The Sound Guy (Mixamo rig). Scalp rebuilt by the asset pipeline.',
  },
  dog_puppy: {
    url: 'assets/models/dog_puppy.glb',
    rig: 'puppy',
    clips: { idle: 'Animation' },
    // Raw model: 0.31 m to the top of the head; scale 1 ≈ 8-week puppy.
    scaleRange: [1.12, 2.15],
    morphs: { breath: 'breath', blink: 'blink' },
  },
  dog_adult: {
    url: 'assets/models/dog_adult.glb',
    rig: 'labrador',
    clips: { idle: 'Animation' },
    // Raw model: 2.76 units to the top of the head. 0.28 ≈ 0.57 m at withers.
    scaleRange: [0.235, 0.28],
    credit: '"Labrador Dog" by kenchoo (Sketchfab), CC-BY-4.0',
  },
  rock1: { url: 'assets/vendor/rock1.glb' },
  rock2: { url: 'assets/vendor/rock2.glb' },
  rock3: { url: 'assets/vendor/rock3.glb' },
};

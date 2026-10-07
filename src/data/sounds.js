// Recorded sound manifest. Files live in public/assets/audio/ and are listed
// with their source and licence in docs/ASSETS.md. Each id may have several
// variants; SoundBank picks one at random without immediate repeats.
// volume: base gain, pitch: ± playback-rate jitter, trim: [start, end] seconds.
const A = (p) => 'assets/audio/' + p;

export const SOUNDS = {
  // keeper footsteps by surface
  step_grass: { files: [], volume: 0.55, pitch: 0.08 },
  step_dirt: { files: [], volume: 0.6, pitch: 0.07 },
  step_wood: { files: [], volume: 0.55, pitch: 0.05 },
  // dog paws
  paw_soft: { files: [], volume: 0.35, pitch: 0.1 },
  paw_wood: { files: [], volume: 0.4, pitch: 0.08 },
  // dog vocalisations
  puppy_whine: { files: [], volume: 0.7, pitch: 0.06 },
  puppy_yip: { files: [], volume: 0.65, pitch: 0.07 },
  puppy_bark: { files: [], volume: 0.7, pitch: 0.06 },
  adult_bark: { files: [], volume: 0.8, pitch: 0.05 },
  adult_whine: { files: [], volume: 0.7, pitch: 0.05 },
  dog_pant: { files: [], volume: 0.5, pitch: 0 },
  dog_lap: { files: [], volume: 0.55, pitch: 0 },
  dog_eat: { files: [], volume: 0.55, pitch: 0 },
  dog_sniff: { files: [], volume: 0.45, pitch: 0.08 },
  dog_shake: { files: [], volume: 0.6, pitch: 0.05 },
  // foley
  gate_open: { files: [], volume: 0.6, pitch: 0.04 },
  gate_close: { files: [], volume: 0.6, pitch: 0.04 },
  kibble_pour: { files: [], volume: 0.6, pitch: 0.04 },
  water_pour: { files: [], volume: 0.55, pitch: 0.04 },
  build_place: { files: [], volume: 0.5, pitch: 0.08 },
};

export { A as audioPath };

// Central tunables. Anything a designer may want to tweak lives here rather
// than inside systems. Values are in metres, seconds and 0–100 stat units.

export const CONFIG = {
  title: 'Creature Reserve',
  reserveName: 'Hollin Vale Reserve',
  saveKey: 'creature-reserve.save.v1',
  saveVersion: 1,
  autosaveSeconds: 12,

  // Calendar: one in-game day passes every `dayLengthSeconds` of play.
  // Lighting is a fixed late-afternoon for this build; the calendar drives age.
  time: { dayLengthSeconds: 90 },

  // Compressed growth for the prototype. With adequate care a stray puppy
  // reaches adulthood after roughly `secondsToAdult` of play time. The debug
  // panel (backtick key) and ?growth=N in the URL multiply this speed.
  growth: {
    secondsToAdult: 16 * 60,
    adultSwapAt: 0.78, // growth fraction where the adult model takes over
    startAgeWeeks: 9,
    adultAgeWeeks: 56,
  },

  // Rates are per real second at growth speed 1.
  care: {
    hungerDrain: 100 / (7 * 60),    // satiety 100 -> 0 in ~7 minutes
    thirstDrain: 100 / (5 * 60),
    happinessEase: 0.035,           // how quickly happiness approaches its target
    healthRecover: 0.06,
    healthLoss: 0.12,
    trustDecay: 0.0015,
    mealSatiety: 45,
    drinkHydration: 60,
    treatSatiety: 8,
  },

  start: {
    resources: { materials: 240, rations: 24 },
    playerPos: [0.6, -2.6],
    playerYaw: Math.PI, // facing south toward the meadow
  },

  player: {
    walkSpeed: 1.65,   // natural ground speed of the Walking clip at timeScale 1
    calmSpeed: 0.95,
    jogScale: 1.38,    // walk clip timeScale cap; no run clip is supplied
    radius: 0.32,
    turnRate: 10,
  },

  camera: {
    fov: 50,
    distance: 3.1, minDistance: 1.5, maxDistance: 9,
    pitch: 0.2, minPitch: -0.35, maxPitch: 1.05,
    shoulder: 0.42,
    buildDistance: 26, buildMin: 9, buildMax: 55,
    buildPitch: 0.95,
  },

  world: {
    half: 160,          // detailed terrain half-size
    bounds: { minX: -112, maxX: 112, minZ: -112, maxZ: 122 },
    buildGrid: 2,       // fence grid spacing
    buildArea: { minX: -26, maxX: 64, minZ: -16, maxZ: 72 },
  },

  quality: {
    low: { pixelRatio: 1, shadowSize: 1024, grassNear: 90, grassFar: 110, flowers: 60, treeScale: 0.55, post: false, terrainStep: 2, msaa: 0 },
    medium: { pixelRatio: 1, shadowSize: 2048, grassNear: 170, grassFar: 170, flowers: 90, treeScale: 0.85, post: true, terrainStep: 1, msaa: 4 },
    high: { pixelRatio: 1.5, shadowSize: 3072, grassNear: 230, grassFar: 220, flowers: 120, treeScale: 1, post: true, terrainStep: 1, msaa: 4 },
  },
};

export function urlParam(name, fallback = null) {
  const v = new URLSearchParams(location.search).get(name);
  return v === null ? fallback : v;
}

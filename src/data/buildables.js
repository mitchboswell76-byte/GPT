// Construction catalogue. Costs are in materials. `kind: 'edge'` pieces sit
// on the 2 m fence grid; `kind: 'object'` pieces are placed freely.
// `provides` feeds the habitat assessment; `hx`/`hz` are footprint half sizes.

export const CATEGORIES = [
  { id: 'fencing', name: 'Fencing' },
  { id: 'shelter', name: 'Shelter' },
  { id: 'care', name: 'Food & water' },
  { id: 'enrichment', name: 'Enrichment' },
];

export const BUILDABLES = {
  fence: {
    id: 'fence', name: 'Post-and-rail fence', category: 'fencing', kind: 'edge', cost: 4,
    provides: ['fence'], desc: 'Oak posts and sawn rails in 2 m bays. Click a post point, then click again to run a line.',
  },
  gate: {
    id: 'gate', name: 'Field gate', category: 'fencing', kind: 'edge', cost: 10,
    provides: ['gate'], desc: 'A hung timber gate. Place it on a fence bay; open and close it with E.',
  },
  kennel: {
    id: 'kennel', name: 'Timber kennel', category: 'shelter', kind: 'object', cost: 30, hx: 0.85, hz: 0.75,
    provides: ['shelter'], desc: 'Raised floor, slate-style roof and a deep straw bed. Keeps a dog dry and warm.',
  },
  food_bowl: {
    id: 'food_bowl', name: 'Feeding bowl', category: 'care', kind: 'object', cost: 6, hx: 0.24, hz: 0.24,
    provides: ['food'], fill: 'food', desc: 'Steel bowl on a low stand. Fill it from your rations.',
  },
  water_trough: {
    id: 'water_trough', name: 'Water trough', category: 'care', kind: 'object', cost: 8, hx: 0.5, hz: 0.28,
    provides: ['water'], fill: 'water', desc: 'Galvanised trough. Top it up from the outpost pump line.',
  },
  ball: {
    id: 'ball', name: 'Rubber ball', category: 'enrichment', kind: 'object', cost: 4, hx: 0.12, hz: 0.12,
    provides: ['enrichment'], toy: 'ball', desc: 'Tough natural rubber. Roll it and watch the chase.',
  },
  tug_post: {
    id: 'tug_post', name: 'Rope tug post', category: 'enrichment', kind: 'object', cost: 12, hx: 0.22, hz: 0.22,
    provides: ['enrichment'], toy: 'tug', desc: 'A braided cotton rope on a sprung post for tugging games.',
  },
  hollow_log: {
    id: 'hollow_log', name: 'Hollow log', category: 'enrichment', kind: 'object', cost: 8, hx: 0.95, hz: 0.38,
    provides: ['enrichment'], toy: 'log', desc: 'A seasoned oak log, hollowed into a tunnel to explore.',
  },
};

// Species definitions for the Life Atlas and creature systems.
//
// Three concepts stay separate so later systems can combine them:
//   species  – what the creature is (this file): anatomy, needs, growth forms.
//   affinity – an optional elemental alignment on the individual (none for now).
//   traits   – inherited, per-individual values (coat, build, temperament).
// Breeding will mix traits; engineering will edit them deliberately;
// evolution will move an individual to another `forms` entry.

export const SPECIES = {
  dog: {
    id: 'dog',
    commonName: 'Domestic Dog',
    scientificName: 'Canis familiaris',
    category: 'real',              // real | prehistoric | mythical | scifi
    family: 'Canidae',
    blurb: 'A social, adaptable canid that has lived alongside people for at least 15,000 years. Dogs read human gestures unusually well and form strong bonds with their keepers.',
    diet: { type: 'Omnivore (carnivore-leaning)', detail: 'Meat-based kibble with some grain and vegetable matter. Puppies eat little and often; adults twice a day.' },
    habitat: {
      summary: 'Fenced paddock with shade, shelter, fresh water and room to run.',
      minArea: 32, // m²
      needs: ['fence', 'gate', 'shelter', 'food', 'water', 'enrichment'],
    },
    behaviour: [
      'Explores by scent; sniffs new objects before engaging with them.',
      'Strays are wary: approach slowly and crouch to appear less threatening.',
      'Wags its tail broadly when relaxed and excited; a low, still tail signals caution.',
      'Rests often — puppies sleep up to 18 hours a day.',
      'Plays in short bursts, often inviting play with a bow.',
    ],
    lifespan: '10–13 years',
    adultSize: 'Labrador type: 55–62 cm at the shoulder, 25–36 kg',
    forms: [
      { id: 'young', name: 'Young puppy', from: 0, model: 'dog_puppy' },
      { id: 'puppy', name: 'Puppy', from: 0.22, model: 'dog_puppy' },
      { id: 'juvenile', name: 'Juvenile', from: 0.5, model: 'dog_puppy' },
      { id: 'adult', name: 'Adult', from: 0.78, model: 'dog_adult' },
    ],
    // Inheritable trait loci (used for individuals now; breeding later).
    traits: {
      coat: { label: 'Coat', values: ['Golden', 'Fox red', 'Cream'] },
      build: { label: 'Build', range: [0.94, 1.06] },
      temperament: { label: 'Temperament', values: ['Curious', 'Gentle', 'Bold', 'Shy'] },
    },
    affinity: null,
    research: [
      { id: 'first_contact', label: 'First contact', points: 10, text: 'Encountered a stray in the woodland edge.' },
      { id: 'hand_fed', label: 'Hand-fed', points: 10, text: 'Accepted food from a keeper\'s hand.' },
      { id: 'befriended', label: 'Trust earned', points: 15, text: 'Chose to follow a keeper.' },
      { id: 'home', label: 'Settled in', points: 10, text: 'Took up residence in a suitable enclosure.' },
      { id: 'eating', label: 'Feeding', points: 5, text: 'Observed eating from a bowl.' },
      { id: 'drinking', label: 'Drinking', points: 5, text: 'Observed drinking.' },
      { id: 'resting', label: 'Resting', points: 5, text: 'Observed resting in its shelter.' },
      { id: 'playing', label: 'Play', points: 10, text: 'Observed playing with enrichment.' },
      { id: 'petted', label: 'Affection', points: 5, text: 'Enjoyed being stroked.' },
      { id: 'juvenile', label: 'Juvenile growth', points: 10, text: 'Reached the juvenile stage.' },
      { id: 'adult', label: 'Adulthood', points: 20, text: 'Grew into an adult.' },
    ],
    // Sections of the Atlas entry unlock as research points accumulate.
    unlocks: { diet: 10, habitat: 20, behaviour: 35, growth: 55 },
  },
};

// Placeholder roster shown as undiscovered entries (roadmap visibility).
export const ATLAS_SILHOUETTES = [
  { id: 'fox', name: 'Red Fox', category: 'real' },
  { id: 'otter', name: 'Eurasian Otter', category: 'real' },
  { id: 'eohippus', name: 'Eohippus', category: 'prehistoric' },
  { id: 'gryphon', name: 'Gryphon', category: 'mythical' },
  { id: 'lumen_moth', name: 'Lumen Moth', category: 'scifi' },
];

export const PUPPY_NAMES = ['Biscuit', 'Bramble', 'Hazel', 'Pip', 'Juniper', 'Rowan', 'Maple', 'Barley', 'Toffee', 'Fern', 'Clover', 'Sorrel'];

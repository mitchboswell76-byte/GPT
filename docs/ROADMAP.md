# Roadmap

The dog opening is built so these features slot in without rewrites. Each item
notes where it attaches.

## Near term

- **More species and regions.** Add a `species.js` entry, a model in
  `assets.js`, a bone map in `rigs.js` (quadrupeds) or a new rig class (birds,
  reptiles). Regions become new `WorldLayout` modules sharing the terrain,
  vegetation and water systems.
- **Habitat types.** Enclosure assessment already reads needs from the species
  definition (`habitat.needs`, `minArea`). Add needs such as water bodies,
  temperature, cover or perches, and catalogue items that provide them.
- **Research facilities.** A lab building unlocks genetic sampling; the Atlas
  already shows locked "Samples" and "Genetics" sections.
- **Day/night and weather.** The calendar exists; `Environment.js` would animate
  the sun, sky and fog, and behaviour would add sleep cycles.
- **Keeper carrying and tool use**, and recorded dog whines, panting and lapping
  (see `ASSETS.md`).

## Collection and breeding

- **Collecting creatures, eggs and samples.** Records already include `origin`
  and `lineage`. Eggs become records with `status: 'egg'` and an incubation timer.
- **Breeding, incubation, hatching, ancestry.** Pairs in one enclosure produce
  offspring whose `traits` are inherited per locus (`species.traits`), with
  `lineage.sire/dam` set; the Atlas gains a family tree.

## Engineering, mutation and transformation

Three separate mechanics on three separate concepts:

| Mechanic | Changes | Mechanism |
|---|---|---|
| Breeding | inherited **traits** | parents → offspring, chance-based |
| Genetic engineering / synthesis | **traits** deliberately, or creates hybrids | lab tools, costs research |
| Evolution / transformation | the individual's **form** within or across species | conditions met over time (`species.forms`, like the puppy→adult hand-over) |

Mutations are random trait changes during breeding or engineering. Hybrids are
new species entries whose models and rigs come from both parents.

## Elemental affinities

Kept separate from species and traits (`record.affinity`, currently null).
An affinity alters appearance (material tints, particles), adds habitat needs
(e.g. heat source) and grants exploration abilities (e.g. lighting dark caves).

## Personalities, companions, riding

`traits.temperament` already seeds behaviour weights. Companions extend the
`follow` state into expeditions; riding needs mount clips and a rider rig.

## Expeditions, danger, and battles (last)

Expeditions leave the reserve for new regions with occasional danger. Combat
and battles come last, built on the companion, ability and affinity systems.

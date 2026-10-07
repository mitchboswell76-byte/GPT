// The opening's objectives. Each step describes itself for the HUD and
// decides when it is complete from game state, so loading a save resumes at
// the right point.
import { CONFIG } from '../data/config.js';
import { PUPPY_SPAWN } from '../world/WorldLayout.js';

export class Guidance {
  constructor(game) {
    this.game = game;
    const nm = () => this.dog()?.r.name || 'the puppy';
    const flags = () => this.game.state.objectives.flags;
    this.steps = [
      {
        id: 'notes', title: 'Read the field notes',
        detail: () => 'Your brief is pinned to the noticeboard beside the cabin. Walk over and press E.',
        marker: () => ({ x: 6.4, z: 0.4, label: 'Noticeboard' }),
        done: () => flags().notesRead,
      },
      {
        id: 'build_mode', title: 'Open construction mode',
        detail: () => 'Press B to plan a dog enclosure on the open meadow south of the cabin.',
        done: () => flags().buildOpened,
      },
      {
        id: 'habitat', title: 'Build a dog enclosure',
        detail: () => 'Fence at least 32 m², hang a gate, then add a kennel, feeding bowl, water trough and a toy inside.',
        checklist: () => {
          const enc = this.bestEnclosure();
          const base = [['fence', 'Fenced area'], ['gate', 'Gate'], ['space', 'Space ≥ 32 m²'], ['shelter', 'Shelter'], ['food', 'Food bowl'], ['water', 'Water'], ['enrichment', 'Enrichment']];
          return base.map(([id, label]) => ({ label: id === 'space' && enc ? `Space (${enc.area} m²)` : label, ok: enc ? enc.checks.find((c) => c.id === id)?.ok : false }));
        },
        done: () => !!this.game.structures.bestSuitable(),
      },
      {
        id: 'find', title: 'Find the stray puppy',
        detail: () => 'A walker saw a stray by the fallen oak at the woodland edge, across the footbridge to the west.',
        marker: () => { const d = this.dog(); return d ? { x: d.pos.x, z: d.pos.z, label: 'Stray sighting', fuzzy: true } : { x: PUPPY_SPAWN.x, z: PUPPY_SPAWN.z, label: 'Stray sighting', fuzzy: true }; },
        done: () => this.dog()?.r.seenPlayer,
      },
      {
        id: 'trust', title: 'Earn the puppy’s trust',
        detail: () => 'Approach calmly: walk, don’t run (C toggles a slow pace). When you are close, offer food with E.',
        progress: () => ({ label: 'Trust', value: (this.dog()?.r.stats.trust || 0) / 55 }),
        done: () => this.dog() && this.dog().r.status !== 'wild',
      },
      {
        id: 'lead', title: () => `Lead ${nm()} home`,
        detail: () => `${nm()} will follow you. Walk into the enclosure together, step back out and close the gate. Press F if ${nm()} falls behind.`,
        marker: () => { const e = this.bestEnclosure(); return e ? { x: e.centre.x, z: e.centre.z, label: 'Enclosure' } : null; },
        done: () => this.dog()?.r.status === 'resident',
      },
      {
        id: 'care', title: () => `Settle ${nm()} in`,
        checklist: () => [
          { label: 'Fill the feeding bowl', ok: !!flags().filledFood },
          { label: 'Top up the water trough', ok: !!flags().filledWater },
          { label: `Stroke ${nm()}`, ok: !!flags().petted },
        ],
        done: () => flags().filledFood && flags().filledWater && flags().petted,
      },
      {
        id: 'atlas', title: 'Open the Life Atlas',
        detail: () => `Press L. ${nm()} now has an entry that records care, growth and field notes.`,
        done: () => flags().atlasOpened,
      },
      {
        id: 'observe', title: () => `Observe ${nm()}`,
        detail: () => 'Stay nearby. Field notes are recorded as the dog uses its new home.',
        checklist: () => {
          const o = this.dog()?.r.observations || {};
          return [['eating', 'Eating'], ['drinking', 'Drinking'], ['resting', 'Resting in the kennel'], ['playing', 'Playing']].map(([k, l]) => ({ label: l, ok: !!o[k] }));
        },
        done: () => { const o = this.dog()?.r.observations || {}; return ['eating', 'drinking', 'resting', 'playing'].filter((k) => o[k]).length >= 3; },
      },
      {
        id: 'grow', title: () => `Raise ${nm()} to adulthood`,
        detail: () => `Keep the bowl and trough filled and visit often. Growth slows when ${nm()} is hungry, thirsty or unhappy.`,
        progress: () => ({ label: 'Growth', value: (this.dog()?.r.growth || 0) / CONFIG.growth.adultSwapAt }),
        done: () => (this.dog()?.r.growth || 0) >= CONFIG.growth.adultSwapAt,
      },
      {
        id: 'review', title: () => `Review ${nm()}’s record`,
        detail: () => `Open the Life Atlas (L) to see how ${nm()} has developed.`,
        done: () => flags().atlasAfterAdult,
      },
      {
        id: 'complete', title: 'Opening complete',
        detail: () => 'The reserve is ready for new arrivals. Further species, regions and research facilities are planned.',
        done: () => false,
      },
    ];
  }

  dog() { return this.game.creatures.list[0]; }
  bestEnclosure() {
    const encs = this.game.structures.enclosures;
    if (!encs.length) return null;
    return encs.slice().sort((a, b) => b.checks.filter((c) => c.ok).length - a.checks.filter((c) => c.ok).length)[0];
  }

  get index() { return this.game.state.objectives.step; }
  get current() { return this.steps[Math.min(this.index, this.steps.length - 1)]; }

  update() {
    const st = this.game.state.objectives;
    let guard = 0;
    while (st.step < this.steps.length - 1 && this.steps[st.step].done() && guard++ < 12) {
      const finished = this.steps[st.step];
      st.done.push(finished.id);
      st.step++;
      this.game.events.emit('objective', { completed: finished.id, next: this.steps[st.step].id });
    }
  }

  view() {
    const s = this.current;
    const t = (v) => (typeof v === 'function' ? v() : v);
    return {
      id: s.id, index: this.index, total: this.steps.length - 1,
      title: t(s.title), detail: s.detail ? s.detail() : '',
      checklist: s.checklist ? s.checklist() : null,
      progress: s.progress ? s.progress() : null,
      marker: s.marker ? s.marker() : null,
    };
  }
}

// Drives recorded dog sounds from creature state and events: vocalisations
// with cooldowns, looping pant / lap / eat voices, sniffs and shakes.
// Kept outside the creature code so behaviour and sound stay decoupled.
import { CONFIG } from '../data/config.js';

const now = () => performance.now() / 1000;

export class CreatureAudio {
  constructor(game, bank) {
    this.game = game;
    this.bank = bank;
    this.state = new Map(); // uid -> {nextVocal, lastAct, ...}
    const E = game.events;
    const voice = (uid, kind, delay = 0) => this.vocal(this.c(uid), kind, delay);
    E.on('creature:noticed', (e) => voice(e.uid, 'whine', 0.4));
    E.on('creature:startled', (e) => voice(e.uid, 'bark'));
    E.on('creature:befriended', (e) => { voice(e.uid, 'yip'); voice(e.uid, 'yip', 0.45); });
    E.on('creature:recalled', (e) => voice(e.uid, 'yip', 0.2));
    E.on('creature:treat', (e) => voice(e.uid, 'yip', 0.3));
    E.on('creature:settled', (e) => voice(e.uid, 'bark', 0.6));
  }

  c(uid) { return this.game.creatures?.byUid(uid); }

  st(c) {
    if (!this.state.has(c.r.uid)) this.state.set(c.r.uid, { nextVocal: now() + 4, nextIdle: now() + 10, lastAct: null });
    return this.state.get(c.r.uid);
  }

  isAdult(c) { return c.r.growth >= CONFIG.growth.adultSwapAt; }

  posOf(c, dy = 0.4) {
    const h = c.headPosition?.() || c.pos;
    return { x: h.x, y: h.y + dy * 0, z: h.z };
  }

  /** kind: whine | yip | bark */
  vocal(c, kind, delay = 0, force = false) {
    if (!c) return;
    const s = this.st(c);
    const t = now();
    if (!force && t < s.nextVocal && !delay) return;
    const adult = this.isAdult(c);
    const id = adult ? (kind === 'whine' ? 'adult_whine' : 'adult_bark') : (kind === 'whine' ? 'puppy_whine' : kind === 'yip' ? 'puppy_yip' : 'puppy_bark');
    const fallback = { adult_whine: 'puppy_whine', adult_bark: 'puppy_bark', puppy_bark: 'puppy_yip', puppy_yip: 'puppy_bark' };
    const use = this.bank.has(id) ? id : fallback[id];
    if (!use || !this.bank.has(use)) return;
    // growing puppies drop in pitch toward adulthood
    const rate = adult ? 1 : 1.12 - 0.18 * Math.min(1, c.r.growth / CONFIG.growth.adultSwapAt);
    this.bank.play(use, { pos: this.posOf(c), rate, delay });
    s.nextVocal = t + delay + 3 + Math.random() * 3;
  }

  update(dt) {
    const g = this.game;
    if (!g.creatures) return;
    const p = g.player;
    const t = now();
    for (const c of g.creatures.list) {
      const s = this.st(c);
      const pos = this.posOf(c);
      const d = c.distToPlayer();
      const act = c.act?.type || null;
      const eating = c.pose?.eat > 0.6;
      // looping voices
      this.bank.loop(c.r.uid + ':pant', 'dog_pant', { pos, volume: d < 30 ? Math.max(0, (c.pant || 0) - 0.15) * 0.9 : 0, rate: this.isAdult(c) ? 0.92 : 1.12 });
      this.bank.loop(c.r.uid + ':lap', 'dog_lap', { pos, volume: act === 'drink' && eating ? 1 : 0 });
      this.bank.loop(c.r.uid + ':eat', 'dog_eat', { pos, volume: (act === 'eat' && eating) || c.offerSession?.phase === 'eat' ? 1 : 0 });
      // one-shots on activity changes
      if (act !== s.lastAct) {
        if (act === 'sniff') this.bank.play('dog_sniff', { pos });
        if (act === 'shake') this.bank.play('dog_shake', { pos });
        if (act === 'play' && Math.random() < 0.6) this.vocal(c, 'yip', 0.3);
        if (act === 'greet' && c.r.stats.trust > 50) this.vocal(c, Math.random() < 0.6 ? 'yip' : 'bark', 0.2);
        s.lastAct = act;
      }
      // idle vocal life
      if (t > s.nextIdle) {
        s.nextIdle = t + 7 + Math.random() * 9;
        if (c.r.status === 'wild' && d < 12 && !c.offerSession && Math.random() < 0.55) this.vocal(c, 'whine');
        else if (c.state === 'follow' && d > 12) this.vocal(c, 'whine');
        else if (c.r.status === 'resident' && c.r.stats.hunger < 30 && d < 10 && Math.random() < 0.6) this.vocal(c, 'whine');
        else if (act === 'play' && Math.random() < 0.5) this.vocal(c, Math.random() < 0.5 ? 'yip' : 'bark');
      }
      if (c.pose?.sleep > 0.6) s.nextVocal = Math.max(s.nextVocal, t + 2);
    }
  }
}

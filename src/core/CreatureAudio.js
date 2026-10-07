// Drives recorded dog sounds from creature state and events: vocalisations
// with cooldowns, chewing, sniffs, and looping pant / lap voices when those
// recordings exist.
// Kept outside the creature code so behaviour and sound stay decoupled.
import { CONFIG } from '../data/config.js';

const now = () => performance.now() / 1000;
// id -> [fallback id, gain]; adults have no whine recording, so they stay quiet
const FALLBACK = { puppy_whine: ['puppy_yip', 0.45], puppy_yip: ['puppy_bark', 0.8], puppy_bark: ['puppy_yip', 1], adult_whine: null };

export class CreatureAudio {
  constructor(game, bank) {
    this.game = game;
    this.bank = bank;
    this.state = new Map(); // uid -> {nextVocal, lastAct, ...}
    const E = game.events;
    const voice = (uid, kind, delay = 0) => this.vocal(this.c(uid), kind, delay);
    // a stray that notices the keeper gives a soft alert bark
    E.on('creature:noticed', (e) => this.vocal(this.c(e.uid), 'bark', 0.4, false, 0.55));
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

  posOf(c) {
    const h = c.headPosition?.() || c.pos;
    return { x: h.x, y: h.y, z: h.z };
  }

  /**
   * kind: whine | yip | bark. Missing recordings fall back along FALLBACK
   * (a puppy without whines yips softly instead); returns false when nothing
   * suitable exists.
   */
  vocal(c, kind, delay = 0, force = false, volume = 1) {
    if (!c) return false;
    const s = this.st(c);
    const t = now();
    if (!force && t < s.nextVocal && !delay) return false;
    const adult = this.isAdult(c);
    let id = adult ? (kind === 'whine' ? 'adult_whine' : 'adult_bark') : `puppy_${kind}`;
    let gain = volume * (adult && kind === 'yip' ? 0.6 : 1);
    for (let hops = 0; id && !this.bank.has(id); hops++) {
      if (hops > 3) return false;
      gain *= FALLBACK[id]?.[1] ?? 1; id = FALLBACK[id]?.[0];
    }
    if (!id) return false;
    // growing puppies drop in pitch toward adulthood
    const rate = adult ? 1 : 1.12 - 0.18 * Math.min(1, c.r.growth / CONFIG.growth.adultSwapAt);
    this.bank.play(id, { pos: this.posOf(c), rate, delay, volume: gain });
    s.nextVocal = t + delay + 3 + Math.random() * 3;
    return true;
  }

  update(dt) {
    const g = this.game;
    if (!g.creatures) return;
    // paused: no chewing or idle vocals behind the menu (loops fade out)
    if (g.paused || dt <= 0) { for (const c of g.creatures.list) for (const k of [':pant', ':lap']) this.bank.loop(c.r.uid + k, k === ':pant' ? 'dog_pant' : 'dog_lap', { volume: 0 }); return; }
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
      // chewing: separate recorded chews at an irregular rhythm
      if (((act === 'eat' && eating) || c.offerSession?.phase === 'eat') && t > (s.nextChew || 0)) {
        this.bank.play('dog_eat', { pos, volume: this.isAdult(c) ? 1 : 0.75, rate: this.isAdult(c) ? 0.92 : 1.08 });
        s.nextChew = t + 0.42 + Math.random() * 0.35;
      }
      // body actions (shake-off) come from the posture system
      const pa = c.posture?.action || null;
      if (pa !== s.lastPosAct) { if (pa === 'shake') this.bank.play('dog_shake', { pos }); s.lastPosAct = pa; }
      // one-shots on activity changes
      if (act !== s.lastAct) {
        if (act === 'sniff') this.bank.play('dog_sniff', { pos });
        if (act === 'play' && Math.random() < 0.6) this.vocal(c, 'yip', 0.3);
        if (act === 'greet' && c.r.stats.trust > 50) this.vocal(c, Math.random() < 0.6 ? 'yip' : 'bark', 0.2);
        s.lastAct = act;
      }
      // idle vocal life
      if (t > s.nextIdle) {
        s.nextIdle = t + 7 + Math.random() * 9;
        if (c.r.status === 'wild' && d < 12 && !c.offerSession && Math.random() < 0.55) this.vocal(c, 'whine');
        else if (c.state === 'follow' && d > 12) this.vocal(c, 'yip');
        else if (c.r.status === 'resident' && c.r.stats.hunger < 30 && d < 10 && Math.random() < 0.6) this.vocal(c, 'whine');
        else if (act === 'play' && Math.random() < 0.5) this.vocal(c, Math.random() < 0.5 ? 'yip' : 'bark');
      }
      if (c.pose?.sleep > 0.6) s.nextVocal = Math.max(s.nextVocal, t + 2);
    }
  }
}

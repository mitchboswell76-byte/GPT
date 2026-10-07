// Owns all creatures: spawning, care simulation, growth, research
// observations and the player's interactions with them.
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { SPECIES, PUPPY_NAMES } from '../data/species.js';
import { Creature } from './Creature.js';
import { PUPPY_SPAWN } from '../world/WorldLayout.js';
import { clamp, damp } from '../util/noise.js';

export class CreatureSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextUid = 1;
    this.growthSpeed = +(new URLSearchParams(location.search).get('growth') || 1);
  }

  get state() { return this.game.state; }

  load(records) {
    for (const r of records || []) this.add(r);
  }

  add(record) {
    this.nextUid = Math.max(this.nextUid, parseInt(record.uid.slice(1), 10) + 1);
    const c = new Creature(this.game, record);
    this.list.push(c);
    return c;
  }

  spawnStray() {
    if (this.list.some((c) => c.r.origin?.type === 'stray')) return;
    const rnd = Math.random;
    const sp = SPECIES.dog;
    const record = {
      uid: 'c' + this.nextUid++,
      speciesId: 'dog',
      name: null,
      sex: rnd() < 0.5 ? 'Female' : 'Male',
      seed: Math.floor(rnd() * 1e9),
      traits: { coat: 'Golden', build: +(0.97 + rnd() * 0.06).toFixed(3), temperament: sp.traits.temperament.values[Math.floor(rnd() * 4)] },
      affinity: null,
      lineage: { sire: null, dam: null },
      origin: { type: 'stray', place: 'Woodland edge, west of the footbridge', day: this.game.calendar.day },
      status: 'wild',
      growth: 0,
      stats: { health: 74, hunger: 28, thirst: 55, happiness: 32, trust: 0, energy: 65 },
      strayHome: { x: PUPPY_SPAWN.x, z: PUPPY_SPAWN.z },
      pos: { x: PUPPY_SPAWN.x, z: PUPPY_SPAWN.z, yaw: 1.2 },
      history: [{ day: this.game.calendar.day, text: 'Reported as a stray near the fallen oak.' }],
      observations: {},
      statLog: [],
    };
    this.state.creatures.push(record);
    const c = this.add(record);
    this.game.events.emit('creature:spawned', { uid: record.uid });
    return c;
  }

  byUid(uid) { return this.list.find((c) => c.r.uid === uid); }
  get acquired() { return this.list.filter((c) => c.r.status !== 'wild'); }

  // ---- simulation --------------------------------------------------------------
  update(dt) {
    for (const c of this.list) {
      this.simulate(c, dt);
      c.update(dt);
    }
    // offer choreography: release the player once the session finishes
    const p = this.game.player;
    if (this.offering && !this.offering.offerSession && this.offerT > 0.5) this.endOffer();
    if (this.offering) this.offerT += dt;
    if (this.petting) {
      this.petT += dt; this.updatePet();
      const o = this.petting.override;
      if ((o?.arrived && o.t - o.arrivedAt > 2.8) || this.petT > 8) this.endPet();
    }
    p.recentHurry = Math.max(0, (p.recentHurry || 0) - dt);
    if (p.speed > 1.9) p.recentHurry = 2;
  }

  simulate(c, dt) {
    if (dt <= 0) return;
    const s = c.r.stats, K = CONFIG.care;
    const active = c.speed > 0.3 ? 1.3 : 1;
    const sleeping = c.pose.sleep > 0.5;
    s.hunger = clamp(s.hunger - K.hungerDrain * dt * active * (sleeping ? 0.5 : 1), 0, 100);
    s.thirst = clamp(s.thirst - K.thirstDrain * dt * active * (sleeping ? 0.4 : 1), 0, 100);
    s.energy = clamp(s.energy + (sleeping ? 2.0 : c.pose.lie > 0.5 ? 0.35 : -0.11 * active) * dt, 0, 100);
    if (s.hunger < 15 || s.thirst < 15) s.health = clamp(s.health - K.healthLoss * dt, 0, 100);
    else if (s.hunger > 40 && s.thirst > 40) s.health = clamp(s.health + K.healthRecover * dt, 0, 100);

    let comfort = 0.25;
    if (c.r.status === 'resident') {
      const enc = this.game.structures.enclosures.find((e) => e.id === c.r.homeId);
      if (enc) comfort = enc.checks.filter((k) => k.ok).length / enc.checks.length;
    } else if (c.r.status === 'befriended') comfort = 0.5;
    const social = c.socialBoost = damp(c.socialBoost || 0, 0, 0.012, dt);
    const target = clamp(12 + 0.28 * s.hunger + 0.15 * s.thirst + 26 * comfort + 0.12 * s.trust + social + (s.health < 50 ? -15 : 0), 0, 100);
    s.happiness = clamp(s.happiness + (target - s.happiness) * K.happinessEase * dt, 0, 100);
    if (c.r.status !== 'wild') {
      // time near the keeper slowly deepens trust
      if (c.distToPlayer() < 6) s.trust = clamp(s.trust + 0.08 * dt, 0, 100);
      const care = this.careFactor(c);
      const before = c.r.growth;
      c.r.growth = clamp(c.r.growth + (dt / CONFIG.growth.secondsToAdult) * care * this.growthSpeed, 0, 1);
      this.checkStage(c, before, c.r.growth);
    } else {
      s.trust = clamp(s.trust - K.trustDecay * dt, 0, 100);
    }
    // sparse stat history for the Atlas
    c.logT = (c.logT || 0) + dt;
    if (c.logT > 20) {
      c.logT = 0;
      c.r.statLog.push({ d: +this.game.calendar.dayFloat.toFixed(2), g: +c.r.growth.toFixed(3), h: Math.round(s.health), f: Math.round(s.hunger), p: Math.round(s.happiness), t: Math.round(s.trust) });
      if (c.r.statLog.length > 240) c.r.statLog.splice(0, c.r.statLog.length - 240);
    }
  }

  careFactor(c) {
    const s = c.r.stats;
    const fed = clamp(Math.min(s.hunger, s.thirst) / 35, 0, 1);
    return 0.2 + 0.8 * fed * (0.5 + 0.5 * s.health / 100) * (0.75 + 0.25 * s.happiness / 100);
  }

  checkStage(c, before, after) {
    for (const f of c.species.forms) {
      if (before < f.from && after >= f.from) {
        c.r.history.push({ day: this.game.calendar.day, text: `Reached the ${f.name.toLowerCase()} stage.` });
        this.game.events.emit('creature:stage', { uid: c.r.uid, form: f });
        if (f.id === 'juvenile') this.observe(c, 'juvenile', true);
        if (f.id === 'adult') this.observe(c, 'adult', true);
      }
    }
  }

  ageWeeks(c) {
    const G = CONFIG.growth;
    return G.startAgeWeeks + c.r.growth * (G.adultAgeWeeks - G.startAgeWeeks);
  }

  /** Record a research observation if the keeper is close enough to see it. */
  observe(c, id, force = false) {
    const atlas = this.state.atlas.dog;
    const obs = c.r.observations;
    if (!force && c.distToPlayer() > 18) return false;
    obs[id] = (obs[id] || 0) + 1;
    if (obs[id] === 1) {
      const def = SPECIES.dog.research.find((r) => r.id === id);
      if (def && !atlas.research.includes(id)) {
        atlas.research.push(id);
        atlas.points += def.points;
        c.r.history.push({ day: this.game.calendar.day, text: def.text });
        this.game.events.emit('research', { id, label: def.label, points: def.points, uid: c.r.uid });
      }
      return true;
    }
    return false;
  }

  // ---- interactions -----------------------------------------------------------
  interactionsNear(px, pz) {
    const out = [];
    const res = this.state.resources;
    for (const c of this.list) {
      const d = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (c.r.status === 'wild') {
        if (d < 5.5 && !this.offering) {
          out.push({ id: 'offer:' + c.r.uid, x: c.pos.x, z: c.pos.z, d: d * 0.5, label: res.rations > 0 ? 'Offer food' : 'No rations to offer', disabled: res.rations <= 0, priority: 2, run: () => this.beginOffer(c) });
        }
      } else if (d < 2.2 && !this.petting && c.pose.sleep < 0.5 && c.speed < 0.35) {
        out.push({ id: 'pet:' + c.r.uid, x: c.pos.x, z: c.pos.z, d: d * 0.8, label: `Stroke ${c.r.name || 'the puppy'}`, priority: 0.5, run: () => this.beginPet(c) });
      }
    }
    return out;
  }

  beginOffer(c) {
    const p = this.game.player;
    const res = this.state.resources;
    if (res.rations <= 0) return;
    res.rations -= 1;
    this.offering = c; this.offerT = 0;
    p.crouchTarget = 1; p.offerTarget = 1; p.armTarget = null;
    p.lookTarget = c.headPosition();
    p.controlsEnabled = false;
    p.faceTarget = c.pos.clone();
    c.startOffer();
    if (!c.r.contacted) { c.r.contacted = true; this.observe(c, 'first_contact', true); }
    this.game.cameraRig.frameMoment(p.pos, c.pos, 3.0);
  }

  endOffer() {
    const p = this.game.player; const c = this.offering;
    p.crouchTarget = 0; p.offerTarget = 0; p.controlsEnabled = true; p.faceTarget = null;
    this.offering = null;
    if (this.game.cameraRig.focusOverride) this.game.cameraRig.focusOverride.target = 0;
  }

  beginPet(c) {
    const p = this.game.player;
    this.petting = c; this.petT = 0;
    p.crouchTarget = c.height < 0.35 ? 0.85 : 0.45; p.petTarget = 1; p.controlsEnabled = false;
    p.faceTarget = c.pos.clone();
    c.override = { type: 'come-to-hand', t: 0 };
    c.posture.queue.length = 0; // a pending stretch or shake waits; the keeper comes first
    if (c.act && !['eat', 'drink'].includes(c.act.type)) c.act = null;
    c.excite = Math.min(1, c.excite + 0.5);
    const s = c.r.stats;
    const fresh = (this.game.time - (c.lastPetTime || -99)) > 20;
    c.lastPetTime = this.game.time;
    if (fresh) { s.happiness = clamp(s.happiness + 10, 0, 100); s.trust = clamp(s.trust + 3, 0, 100); c.socialBoost = Math.min(20, (c.socialBoost || 0) + 12); }
    this.observe(c, 'petted', true);
    this.game.cameraRig.frameMoment(p.pos, c.pos, 2.8);
    this.game.events.emit('creature:petted', { uid: c.r.uid });
  }

  updatePet() {
    const c = this.petting; const p = this.game.player;
    if (!c) return;
    const o = c.override;
    p.faceTarget = c.pos.clone();
    p.lookTarget = c.headPosition();
    if (!o?.arrived) { p.petTarget = 0.25; p.armTarget = null; return; }
    // stroke from the crown of the head down the neck
    const head = c.headPosition();
    const back = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const k = 0.5 + 0.5 * Math.sin((o.t - o.arrivedAt) * 3.2);
    p.petTarget = 1;
    p.armTarget = head.clone().add(new THREE.Vector3(0, c.height * 0.35 + 0.04, 0)).addScaledVector(back, c.height * (0.15 + 0.55 * k));
  }

  endPet() {
    const p = this.game.player;
    p.crouchTarget = 0; p.petTarget = 0; p.controlsEnabled = true; p.armTarget = null; p.faceTarget = null;
    if (this.petting) { this.petting.override = null; this.petting.socialT = 15; }
    this.petting = null;
    if (this.game.cameraRig.focusOverride) this.game.cameraRig.focusOverride.target = 0;
  }

  giveTreat(c) {
    const res = this.state.resources; if (res.rations <= 0) return false;
    res.rations -= 1;
    const s = c.r.stats;
    s.hunger = clamp(s.hunger + CONFIG.care.treatSatiety, 0, 100);
    s.happiness = clamp(s.happiness + 6, 0, 100);
    s.trust = clamp(s.trust + 4, 0, 100);
    c.excite = 1;
    this.game.events.emit('creature:treat', { uid: c.r.uid });
    return true;
  }

  callNearest() {
    const p = this.game.player;
    const list = this.acquired.sort((a, b) => a.distToPlayer() - b.distToPlayer());
    if (!list.length) return null;
    const res = list[0].call();
    return { c: list[0], res };
  }

  name(c, name) {
    c.r.name = name;
    c.r.history.push({ day: this.game.calendar.day, text: `Named ${name}.` });
    this.game.events.emit('creature:named', { uid: c.r.uid, name });
  }

  randomName() { return PUPPY_NAMES[Math.floor(Math.random() * PUPPY_NAMES.length)]; }
}

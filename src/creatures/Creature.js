// A single creature: its saved record, runtime motion and behaviour.
//
// Record (saved): identity, traits, stats, growth, status and history.
// Runtime: root transform, one or two CreatureBody instances (two only while
// cross-fading between growth models), smoothed pose weights, look target.
// Brain: a small state machine — stray, follow, wait, resident — with
// activities (eat, drink, sleep, play, explore, greet).
import * as THREE from 'three';
import { CONFIG } from '../data/config.js';
import { SPECIES } from '../data/species.js';
import { MODELS } from '../data/assets.js';
import { CreatureBody } from './CreatureBody.js';
import { damp, dampAngle, angleDiff, clamp, lerp, smoothstep, mulberry32 } from '../util/noise.js';

const POSES = ['sit', 'lie', 'sleep', 'eat', 'bow'];

export class Creature {
  constructor(game, record) {
    this.game = game;
    this.r = record;
    this.species = SPECIES[record.speciesId];
    this.root = new THREE.Group();
    this.root.name = 'creature:' + record.uid;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3(record.pos.x, 0, record.pos.z);
    this.pos.y = game.world.groundAt(this.pos.x, this.pos.z);
    this.yaw = record.pos.yaw || 0;
    this.vel = new THREE.Vector3();
    this.speed = 0; this.yawRate = 0;
    this.pose = Object.fromEntries(POSES.map((p) => [p, 0]));
    this.poseTarget = null;
    this.look = { target: null, weight: 0 };
    this.lookWeight = 0;
    this.tail = { wag: 0.2, freq: 2.2, height: 0 };
    this.excite = 0;
    this.pant = 0;
    this.blinkT = 2 + Math.random() * 3; this.blink = 0;
    this.breathPhase = 0;
    this.rnd = mulberry32(record.seed || 7);
    this.bodies = [];
    this.collider = game.world.colliders.addCircle(this.pos.x, this.pos.z, 0.2, 'creature', record.uid);
    this.stuckT = 0;
    this.act = null;       // current activity {type, t, ...}
    this.state = record.status === 'wild' ? 'stray' : record.homeId ? 'resident' : record.following ? 'follow' : 'wait';
    this.offerSession = null;
    this.lastObserved = {};
    this.socialT = 0;
    this.syncBodies(true);
  }

  // ---- model / growth -------------------------------------------------------
  get form() {
    const g = this.r.growth;
    let f = this.species.forms[0];
    for (const x of this.species.forms) if (g >= x.from) f = x;
    return f;
  }

  modelScale(modelId) {
    const g = this.r.growth, swap = CONFIG.growth.adultSwapAt;
    const range = MODELS[modelId].scaleRange;
    const build = this.r.traits?.build || 1;
    if (modelId === 'dog_puppy') return lerp(range[0], range[1], clamp(g / swap, 0, 1.05)) * build;
    return lerp(range[0], range[1], clamp((g - swap) / (1 - swap), 0, 1)) * build;
  }

  syncBodies(instant = false) {
    const want = this.form.model;
    if (this.bodies.length && this.bodies[this.bodies.length - 1].modelId === want) return;
    const body = new CreatureBody(this.game, want, this.root);
    body.fade = instant || !this.bodies.length ? 1 : 0;
    body.setOpacity(body.fade);
    this.bodies.push(body);
    if (!instant && this.bodies.length > 1) this.game.events.emit('creature:transform', { uid: this.r.uid, model: want });
    if (instant) { for (const b of this.bodies.slice(0, -1)) b.dispose(); this.bodies = [body]; }
  }

  get primary() { return this.bodies[this.bodies.length - 1]; }
  get height() { return this.primary.rig.hipHeight * this.modelScale(this.primary.modelId); }
  get radius() { return clamp(this.height * 0.8, 0.14, 0.38); }
  headPosition() { return this.primary.rig.head?.getWorldPosition(new THREE.Vector3()) || this.pos.clone().setY(this.pos.y + this.height * 1.5); }

  // ---- motion -------------------------------------------------------------
  /** Steer toward (x, z) at up to `maxSpeed`; returns distance remaining. */
  steer(dt, x, z, maxSpeed, arrive = 0.3) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < arrive) { this.brake(dt); return d; }
    if (this.posing() > 0.15) { this.poseTarget = null; this.brake(dt); return d; }
    const want = Math.atan2(dx, dz);
    const turn = angleDiff(this.yaw, want);
    const turnRate = lerp(3.4, 2.2, clamp(this.speed / 2.5, 0, 1));
    const nyaw = this.yaw + clamp(turn, -turnRate * dt, turnRate * dt);
    this.yawRate = dt > 0 ? (nyaw - this.yaw) / dt : 0;
    this.yaw = nyaw;
    const align = Math.max(0, Math.cos(turn));
    const slow = clamp(d / Math.max(0.8, maxSpeed * 0.7), 0, 1);
    const target = maxSpeed * align * align * slow;
    this.speed = damp(this.speed, target, target > this.speed ? 3.2 : 6, dt);
    this.advance(dt);
    return d;
  }

  turnToward(dt, x, z, rate = 2.6) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    const turn = angleDiff(this.yaw, want);
    if (Math.abs(turn) < 0.12 || this.posing() > 0.3) { this.yawRate = damp(this.yawRate, 0, 8, dt); return Math.abs(turn); }
    const nyaw = this.yaw + clamp(turn, -rate * dt, rate * dt);
    this.yawRate = dt > 0 ? (nyaw - this.yaw) / dt : 0;
    this.yaw = nyaw;
    return Math.abs(turn);
  }

  brake(dt) {
    this.speed = damp(this.speed, 0, 7, dt);
    if (this.speed < 0.02) this.speed = 0;
    this.yawRate = damp(this.yawRate, 0, 6, dt);
    this.advance(dt);
  }

  advance(dt) {
    const step = this.speed * dt;
    const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
    this.collider.enabled = false;
    const p = this.game.world.moveCircle(this.pos.x, this.pos.z, nx, nz, this.radius,
      (it) => it.tag !== 'footprint' && it.tag !== 'structure-player' && !(it.tag === 'creature' && it.data === this.r.uid));
    this.collider.enabled = true;
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    this.blocked = step > 0.002 && moved < step * 0.4;
    this.vel.set(p.x - this.pos.x, 0, p.z - this.pos.z).divideScalar(Math.max(dt, 1e-4));
    this.pos.x = p.x; this.pos.z = p.z;
  }

  setPose(name) { this.poseTarget = name; }
  posing() { return Math.max(...POSES.map((p) => this.pose[p])); }

  teleport(x, z, yaw = this.yaw) {
    this.pos.set(x, this.game.world.groundAt(x, z), z);
    this.yaw = yaw; this.speed = 0;
    for (const b of this.bodies) b.rig.initialised = false;
  }

  // ---- per frame --------------------------------------------------------------
  update(dt) {
    if (dt <= 0) { this.render(0); return; }
    this.think(dt);
    // pose smoothing
    for (const p of POSES) this.pose[p] = damp(this.pose[p], this.poseTarget === p ? 1 : 0, this.poseTarget === p ? 2.6 : 4, dt);
    this.lookWeight = damp(this.lookWeight, this.look.target ? 1 : 0, 3, dt);
    // ground follow and slope tilt
    const w = this.game.world;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const half = this.height * 0.9;
    const hf = w.groundAt(this.pos.x + fwd.x * half, this.pos.z + fwd.z * half);
    const hb = w.groundAt(this.pos.x - fwd.x * half, this.pos.z - fwd.z * half);
    this.pos.y = damp(this.pos.y, (hf + hb) / 2, 14, dt);
    this.slope = damp(this.slope || 0, clamp(Math.atan2(hb - hf, half * 2), -0.35, 0.35), 8, dt);
    this.collider.x = this.pos.x; this.collider.z = this.pos.z; this.collider.r = this.radius;
    // life signs
    this.pant = damp(this.pant, this.speed > 1.6 ? 1 : this.excite > 0.6 ? 0.6 : 0, 0.8, dt);
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 1; if (this.blinkT < -0.14) { this.blinkT = 2.5 + this.rnd() * 4; this.blink = 0; } }
    this.breathPhase += dt * (this.pose.sleep > 0.5 ? 0.35 : this.pant > 0.3 ? 2.6 : 0.6) * Math.PI * 2;
    this.render(dt);
    this.r.pos = { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3) };
  }

  render(dt) {
    this.syncBodies();
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    const ctx = {
      dt, time: this.game.time, rootObj: this.root, position: this.pos, yaw: this.yaw, yawRate: this.yawRate,
      velocity: this.vel, speed: this.speed, ground: (x, z) => this.game.world.groundAt(x, z), pose: this.pose,
      look: { target: this.look.target, weight: this.lookWeight }, tail: this.tail, pant: this.pant,
      blink: Math.max(this.blink, this.pose.sleep > 0.6 ? 1 : 0), breath: 0.5 + 0.5 * Math.sin(this.breathPhase),
      perk: this.excite, slopePitch: this.slope || 0,
      onStep: (leg) => { if (this.speed > 0.2 && leg.front) this.game.events.emit('footstep', { who: 'creature', x: this.pos.x, z: this.pos.z, speed: this.speed, size: this.height }); },
    };
    for (const b of this.bodies) {
      const s = this.modelScale(b.modelId);
      b.update({ ...ctx, scale: s });
    }
    // cross-fade between growth models
    if (this.bodies.length > 1) {
      const nb = this.bodies[this.bodies.length - 1];
      nb.fade = Math.min(1, nb.fade + dt / 2.2);
      nb.setOpacity(nb.fade);
      for (const ob of this.bodies.slice(0, -1)) ob.setOpacity(1 - nb.fade);
      if (nb.fade >= 1) { for (const ob of this.bodies.slice(0, -1)) ob.dispose(); this.bodies = [nb]; nb.setOpacity(1); }
    }
  }

  // ---- behaviour -------------------------------------------------------------
  get player() { return this.game.player; }
  distToPlayer() { return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z); }

  think(dt) {
    const s = this.r.stats;
    const happy = s.happiness / 100;
    this.excite = damp(this.excite, 0, 0.4, dt);
    // tail: low and still when wary, broad when happy or excited
    const wary = this.state === 'stray' && s.trust < 25 && this.distToPlayer() < 9;
    this.tail.wag = damp(this.tail.wag, wary ? 0.06 : 0.12 + 0.45 * happy + 0.5 * this.excite, 2, dt);
    this.tail.freq = damp(this.tail.freq, wary ? 1 : 2.2 + 4 * this.excite + 1.5 * happy, 2, dt);
    this.tail.height = damp(this.tail.height, wary ? -0.35 : -0.05 + 0.3 * happy + 0.2 * this.excite, 2, dt);
    if (this.pose.sleep > 0.5) this.tail.wag = damp(this.tail.wag, 0, 4, dt);
    this.socialT = Math.max(0, this.socialT - dt);

    if (this.override) { this.runOverride(dt); return; }
    if (this.state !== 'stray' && this.yieldToKeeper(dt)) return;
    switch (this.state) {
      case 'stray': this.thinkStray(dt); break;
      case 'follow': this.thinkFollow(dt); break;
      case 'wait': this.thinkWait(dt); break;
      case 'resident': this.thinkResident(dt); break;
    }
  }

  /** Step out of the keeper's way when they walk straight at the dog. */
  yieldToKeeper(dt) {
    const p = this.player;
    if (p.speed < 0.3 || this.pose.sleep > 0.5 || this.offerSession) return false;
    if (this.act && ['eat', 'drink'].includes(this.act.type) && this.act.arrived) return false;
    const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 1.2 + this.radius * 2 || d < 1e-3) return false;
    const fwd = p.forward();
    if ((dx * fwd.x + dz * fwd.z) / d < 0.45) return false;
    const side = Math.sign(fwd.x * dz - fwd.z * dx) || 1;
    const tx = this.pos.x - fwd.z * side * 1.1 + fwd.x * 0.3, tz = this.pos.z + fwd.x * side * 1.1 + fwd.z * 0.3;
    this.poseTarget = null;
    this.steer(dt, tx, tz, 1.5, 0.05);
    this.lookAtPlayer();
    return true;
  }

  /** Short scripted moments driven by the keeper (e.g. being stroked). */
  runOverride(dt) {
    const o = this.override; const p = this.player;
    o.t += dt;
    if (o.type === 'come-to-hand') {
      const fwd = p.forward();
      const reach = 0.3 + this.height * 1.15;
      const tx = p.pos.x + fwd.x * reach, tz = p.pos.z + fwd.z * reach;
      if (!o.arrived) {
        this.poseTarget = null;
        const rem = this.steer(dt, tx, tz, 1.0, 0.12);
        this.lookAtPlayer();
        if (rem < 0.16 || (this.blocked && rem < 0.8) || o.t > 5) { o.arrived = true; o.arrivedAt = o.t; }
      } else {
        this.brake(dt);
        this.turnToward(dt, p.pos.x, p.pos.z, 3);
        this.lookAtPlayer();
        this.poseTarget = this.height < 0.3 ? null : 'sit';
        this.excite = Math.min(1, this.excite + dt * 0.4);
      }
    }
  }

  lookAtPlayer(weight = 1) {
    if (weight <= 0) { this.look.target = null; return; }
    this.look.target = this.player.headPosition.clone().lerp(this.player.pos.clone().setY(this.player.pos.y + 0.5), 0.3);
  }

  // Wild puppy at the woodland edge.
  thinkStray(dt) {
    const p = this.player;
    const d = this.distToPlayer();
    const home = this.r.strayHome;
    const s = this.r.stats;
    const hurried = p.speed > 1.9 && p.crouch < 0.3;
    const calm = !hurried && (p.calm || p.crouch > 0.4 || p.speed < 1.75);
    if (d < 14 && !this.r.seenPlayer) { this.r.seenPlayer = true; this.game.events.emit('creature:noticed', { uid: this.r.uid }); }

    // Offer in progress
    if (this.offerSession) { this.runOffer(dt); return; }

    if (d < 9 && hurried) {
      // Startled: retreat away from the player, staying near its hiding place.
      if (!this.act || this.act.type !== 'flee') {
        const ax = this.pos.x - p.pos.x, az = this.pos.z - p.pos.z, l = Math.hypot(ax, az) || 1;
        let tx = this.pos.x + (ax / l) * 6, tz = this.pos.z + (az / l) * 6;
        const hx = tx - home.x, hz = tz - home.z, hl = Math.hypot(hx, hz);
        if (hl > 9) { tx = home.x + hx / hl * 9; tz = home.z + hz / hl * 9; }
        this.act = { type: 'flee', x: tx, z: tz, t: 0 };
        s.trust = Math.max(0, s.trust - 3);
        this.game.events.emit('creature:startled', { uid: this.r.uid });
      }
    }
    if (this.act?.type === 'flee') {
      this.act.t += dt;
      this.poseTarget = null;
      const rem = this.steer(dt, this.act.x, this.act.z, 2.4, 0.5);
      if (rem < 0.6 || this.act.t > 5) this.act = { type: 'watch', t: 0, dur: 4 };
      this.look.target = null;
      return;
    }
    if (d < 11) {
      // Aware of the player: stop and watch. Keep a cautious distance until trusted.
      this.lookAtPlayer();
      const keep = s.trust < 20 ? 3.2 : s.trust < 40 ? 2.2 : 1.2;
      if (d < keep && p.crouch < 0.5) {
        const ax = this.pos.x - p.pos.x, az = this.pos.z - p.pos.z, l = Math.hypot(ax, az) || 1;
        this.poseTarget = null;
        this.steer(dt, this.pos.x + ax / l * 1.5, this.pos.z + az / l * 1.5, 0.7, 0.2);
        this.turnToward(dt, p.pos.x, p.pos.z);
        return;
      }
      this.brake(dt);
      this.turnToward(dt, p.pos.x, p.pos.z, 2);
      this.poseTarget = s.trust > 30 && calm ? 'sit' : null;
      return;
    }
    this.look.target = null;
    this.idleNear(dt, home.x, home.z, 5);
  }

  /** Called by the player's "Offer food" interaction. */
  startOffer() {
    if (this.offerSession) return;
    const p = this.player;
    const hurried = p.recentHurry > 0;
    this.offerSession = { t: 0, phase: hurried ? 'hesitate' : 'approach', ate: false };
    this.game.events.emit('creature:offer', { uid: this.r.uid, hesitant: hurried });
  }

  runOffer(dt) {
    const o = this.offerSession; const p = this.player; const s = this.r.stats;
    o.t += dt;
    const hand = p.handPosition;
    this.look.target = hand;
    if (p.offerTarget < 0.5 && o.phase !== 'done') o.phase = 'done';
    if (o.phase === 'hesitate') {
      this.brake(dt); this.turnToward(dt, hand.x, hand.z);
      if (o.t > 2.5) { s.trust = Math.min(100, s.trust + 2); o.phase = 'done'; this.game.events.emit('creature:hesitated', { uid: this.r.uid }); }
    } else if (o.phase === 'approach') {
      // Approach slowly, stopping with the muzzle at the hand.
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const reach = this.height * 1.25;
      const tx = hand.x - fwd.x * reach * 0.6, tz = hand.z - fwd.z * reach * 0.6;
      this.poseTarget = null;
      const rem = this.steer(dt, tx, tz, s.trust > 30 ? 0.7 : 0.45, 0.12);
      if (rem < 0.2 || (this.blocked && rem < 0.6)) { o.phase = 'eat'; o.eatT = 0; }
      if (o.t > 12) o.phase = 'done';
    } else if (o.phase === 'eat') {
      this.brake(dt); this.turnToward(dt, hand.x, hand.z);
      this.excite = Math.min(1, this.excite + dt * 0.6);
      o.eatT += dt;
      if (o.eatT > 1.6 && !o.ate) {
        o.ate = true;
        const gain = s.trust < 5 ? 20 : 18;
        s.trust = Math.min(100, s.trust + gain);
        s.hunger = Math.min(100, s.hunger + CONFIG.care.treatSatiety * 2);
        s.happiness = Math.min(100, s.happiness + 8);
        this.game.events.emit('creature:handfed', { uid: this.r.uid, trust: s.trust });
      }
      if (o.eatT > 2.6) o.phase = 'done';
    } else {
      this.offerSession = null;
      this.act = { type: 'watch', t: 0, dur: 3 };
      if (s.trust >= 55) this.befriend();
      return;
    }
  }

  befriend() {
    const s = this.r.stats;
    this.r.status = 'befriended';
    this.r.following = true;
    this.r.acquiredDay = this.game.calendar.day;
    this.state = 'follow';
    this.excite = 1;
    this.act = { type: 'celebrate', t: 0 };
    s.happiness = Math.min(100, s.happiness + 15);
    this.game.events.emit('creature:befriended', { uid: this.r.uid });
  }

  idleNear(dt, hx, hz, radius) {
    const a = this.act;
    if (!a || a.done) {
      const r = this.rnd();
      if (r < 0.45) {
        const ang = this.rnd() * Math.PI * 2, rad = this.rnd() * radius;
        this.act = { type: 'wander', x: hx + Math.cos(ang) * rad, z: hz + Math.sin(ang) * rad, t: 0 };
      } else if (r < 0.65) this.act = { type: 'sniff', t: 0, dur: 2 + this.rnd() * 2 };
      else if (r < 0.85) this.act = { type: 'sit', t: 0, dur: 4 + this.rnd() * 5 };
      else this.act = { type: 'lie', t: 0, dur: 8 + this.rnd() * 8 };
      return;
    }
    a.t += dt;
    this.runBasic(dt, a);
  }

  runBasic(dt, a) {
    switch (a.type) {
      case 'wander': {
        this.poseTarget = null;
        const rem = this.steer(dt, a.x, a.z, a.speed || 0.6, 0.35);
        if (rem < 0.4 || a.t > 14 || (this.blocked && a.t > 1.5)) a.done = true;
        break;
      }
      case 'sniff':
        this.brake(dt); this.poseTarget = null;
        this.look.target = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 0.6, -0.1, Math.cos(this.yaw) * 0.6));
        if (a.t > a.dur) { a.done = true; this.look.target = null; }
        break;
      case 'sit': case 'lie': case 'watch':
        this.brake(dt);
        this.poseTarget = a.type === 'watch' ? null : a.type;
        if (a.t > (a.dur || 3)) a.done = true;
        break;
      case 'celebrate':
        this.brake(dt);
        this.lookAtPlayer();
        this.poseTarget = a.t < 1.6 ? 'bow' : null;
        this.excite = 1;
        if (a.t > 2.6) a.done = true;
        break;
      default: a.done = true;
    }
  }

  // Following the keeper along their trail.
  thinkFollow(dt) {
    const p = this.player;
    const d = this.distToPlayer();
    if (this.act?.type === 'celebrate' && !this.act.done) { this.act.t += dt; this.runBasic(dt, this.act); return; }
    const near = 1.6 + this.height * 2;
    if (d > near) {
      // Walk the player's breadcrumb trail: the first crumb behind the player
      // that's at least `near` metres from them.
      const trail = p.trail;
      let tgt = { x: p.pos.x, z: p.pos.z };
      let best = Infinity;
      for (let i = trail.length - 1; i >= 0; i--) {
        const c = trail[i];
        if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < near * 0.85) continue;
        const dd = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
        if (dd < best) { best = dd; tgt = c; }
        if (dd < 1.0) break;
      }
      // If the trail crumb is behind us (we already passed it), aim at the player.
      if (best < 0.7) {
        const idx = trail.indexOf(tgt);
        tgt = trail[Math.min(trail.length - 1, idx + 2)] || tgt;
      }
      const sp = d > 14 ? 3.0 : d > 7 ? 2.4 : d > 4 ? 1.8 : clamp(p.speed * 1.05 + 0.3, 0.6, 1.8);
      this.poseTarget = null;
      this.steer(dt, tgt.x, tgt.z, sp, 0.25);
      this.look.target = d < 8 ? p.headPosition : null;
      this.idleT = 0;
      // stuck far behind: catch up out of sight
      if (d > 26 || (this.blocked && d > 8)) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 5) { this.catchUp(); this.stuckT = 0; }
    } else {
      this.brake(dt);
      this.turnToward(dt, p.pos.x, p.pos.z, 2.2);
      this.lookAtPlayer();
      this.idleT = (this.idleT || 0) + dt;
      this.poseTarget = this.idleT > 9 ? 'lie' : this.idleT > 2.5 ? 'sit' : null;
      if (p.speed > 0.3) this.poseTarget = null;
    }
    this.checkSettle(dt);
  }

  catchUp() {
    const p = this.player, t = p.trail;
    for (let i = t.length - 1; i >= 0; i--) {
      if (Math.hypot(t[i].x - p.pos.x, t[i].z - p.pos.z) > 4) { this.teleport(t[i].x, t[i].z); return; }
    }
  }

  /** Inside a suitable enclosure with the gate shut and the keeper outside: settle in. */
  checkSettle(dt) {
    const S = this.game.structures;
    const enc = S.enclosureAt(this.pos.x, this.pos.z);
    if (!enc) { this.settleT = 0; return; }
    const playerIn = S.enclosureAt(this.player.pos.x, this.player.pos.z) === enc;
    const closed = enc.gates.every((k) => !S.edges.get(k)?.data.open);
    if (!playerIn && closed) {
      this.settleT = (this.settleT || 0) + dt;
      if (this.settleT > 2.5) this.settle(enc);
    } else this.settleT = 0;
  }

  settle(enc) {
    this.r.homeId = enc.id;
    this.r.following = false;
    this.r.status = 'resident';
    this.state = 'resident';
    this.act = null;
    this.game.events.emit('creature:settled', { uid: this.r.uid, enclosure: enc.id, suitable: enc.suitable });
  }

  /** Recall / dismiss from the keeper (F). */
  call() {
    if (this.r.status === 'wild') return false;
    if (this.state === 'follow') {
      const enc = this.game.structures.enclosureAt(this.pos.x, this.pos.z);
      if (enc) this.settle(enc); else { this.state = 'wait'; this.r.following = false; this.game.events.emit('creature:stay', { uid: this.r.uid }); }
      return 'stay';
    }
    this.state = 'follow'; this.r.following = true; this.r.homeId = null;
    this.r.status = 'befriended';
    this.act = null; this.excite = 0.8;
    this.game.events.emit('creature:recalled', { uid: this.r.uid });
    return 'follow';
  }

  thinkWait(dt) {
    this.lookAtPlayer(this.distToPlayer() < 10 ? 1 : 0);
    this.idleNear(dt, this.r.pos.x, this.r.pos.z, 2);
  }

  // Resident in an enclosure: needs-driven routines.
  thinkResident(dt) {
    const S = this.game.structures;
    const enc = S.enclosures.find((e) => e.id === this.r.homeId) || S.enclosureAt(this.pos.x, this.pos.z);
    if (!enc) { this.state = 'wait'; return; }
    if (enc.id !== this.r.homeId) this.r.homeId = enc.id;
    const s = this.r.stats;
    const p = this.player;
    const playerNear = this.distToPlayer() < 5 && (S.enclosureAt(p.pos.x, p.pos.z) === enc || this.distToPlayer() < 3.2);
    if (this.act && !this.act.done) {
      this.act.t += dt;
      // the keeper arriving interrupts quiet activities
      if (playerNear && ['wander', 'sniff', 'sit', 'lie', 'explore'].includes(this.act.type) && this.socialT <= 0 && s.trust > 40 && this.rnd() < dt * 0.8) this.act = { type: 'greet', t: 0 };
      else { this.runResident(dt, this.act, enc); return; }
    }
    // choose next activity
    const item = (kind) => enc.contents[kind].map((u) => S.items.get(u)).filter(Boolean);
    const water = item('water').find((it) => (it.data.fill || 0) > 0.05);
    const food = item('food').find((it) => (it.data.fill || 0) > 0.05);
    const shelter = item('shelter')[0];
    const toys = item('enrichment');
    if (s.thirst < 50 && water) this.act = { type: 'drink', it: water, t: 0 };
    else if (s.hunger < 60 && food) this.act = { type: 'eat', it: food, t: 0 };
    else if (s.energy < 30 && shelter) this.act = { type: 'sleep', it: shelter, t: 0 };
    else if (playerNear && s.trust > 40 && this.socialT <= 0) this.act = { type: 'greet', t: 0 };
    else {
      const r = this.rnd();
      if (r < 0.3 && toys.length && s.energy > 35) this.act = { type: 'play', it: toys[Math.floor(this.rnd() * toys.length)], t: 0 };
      else if (r < 0.62) { const q = S.randomPointIn(enc, this.rnd); this.act = { type: 'wander', x: q.x, z: q.z, t: 0, speed: 0.5 + this.rnd() * 0.5 }; }
      else if (r < 0.75) this.act = { type: 'sniff', t: 0, dur: 2 + this.rnd() * 2 };
      else if (r < 0.88) this.act = { type: 'sit', t: 0, dur: 4 + this.rnd() * 4 };
      else if (shelter && s.energy < 70) this.act = { type: 'sleep', it: shelter, t: 0, short: true };
      else this.act = { type: 'lie', t: 0, dur: 8 + this.rnd() * 6 };
    }
  }

  approachItem(dt, it, offset, speed = 0.8) {
    const p = this.game.structures.toWorld(it.data, offset.x, offset.z);
    return this.steer(dt, p.x, p.z, speed, 0.18);
  }

  runResident(dt, a, enc) {
    const s = this.r.stats; const S = this.game.structures;
    const obs = (id) => this.game.creatures.observe(this, id);
    switch (a.type) {
      case 'eat': case 'drink': {
        const it = a.it; const isFood = a.type === 'eat';
        if (!S.items.has(it.data.uid)) { a.done = true; break; }
        if (!a.arrived) {
          // stand in front of the bowl / beside the trough, facing it
          const side = isFood ? { x: 0, z: 0.36 + this.height * 0.9 } : { x: 0, z: 0.28 + this.height * 0.9 };
          const rem = this.approachItem(dt, it, side);
          if (rem < 0.22 || (this.blocked && a.t > 3)) a.arrived = true;
          if (a.t > 20) a.done = true;
          break;
        }
        this.brake(dt);
        const mouth = it.obj.localToWorld(it.obj.userData.mouth.clone());
        if (this.turnToward(dt, mouth.x, mouth.z) < 0.25) {
          this.poseTarget = 'eat'; this.look.target = mouth;
          a.eat = (a.eat || 0) + dt;
          const rate = dt / 6;
          const fill = it.data.fill || 0;
          if (fill > 0) {
            if (isFood) { S.setFill(it.data.uid, fill - rate * 0.5); s.hunger = Math.min(100, s.hunger + CONFIG.care.mealSatiety * rate); }
            else { S.setFill(it.data.uid, fill - rate * 0.15); s.thirst = Math.min(100, s.thirst + CONFIG.care.drinkHydration * rate); }
          }
          if (a.eat > 1.5) obs(isFood ? 'eating' : 'drinking');
          if (a.eat > 6 || fill <= 0 || (isFood ? s.hunger > 98 : s.thirst > 98)) { a.done = true; this.poseTarget = null; this.look.target = null; }
        }
        break;
      }
      case 'sleep': {
        const it = a.it;
        if (!S.items.has(it.data.uid)) { a.done = true; break; }
        if (!a.arrived) {
          if (a.stage !== 'in') {
            const rem = this.approachItem(dt, it, { x: 0, z: 1.25 + this.height }, 0.8);
            if (rem < 0.25 || (this.blocked && a.t > 4)) a.stage = 'in';
          } else {
            const rem = this.approachItem(dt, it, { x: 0, z: -0.05 - this.height * 0.3 }, 0.45);
            if (rem < 0.2 || this.blocked) { a.arrived = true; a.sleepT = 0; }
          }
          if (a.t > 25) a.done = true;
          break;
        }
        this.brake(dt);
        // turn round to face the doorway, then settle
        const door = S.toWorld(it.data, 0, 2.5);
        const err = this.turnToward(dt, door.x, door.z, 1.8);
        if (!a.faced && (err < 0.2 || a.sleepT > 6)) { a.faced = true; a.settleT = 0; }
        a.sleepT += dt;
        if (a.faced) a.settleT += dt;
        this.poseTarget = a.faced ? (a.settleT > 2.5 ? 'sleep' : 'lie') : null;
        this.look.target = null;
        s.energy = Math.min(100, s.energy + dt * 2.2);
        if (a.sleepT > 3) obs('resting');
        if ((a.short && a.sleepT > 22) || s.energy > 96) { a.done = true; this.poseTarget = null; }
        break;
      }
      case 'play': this.runPlay(dt, a); break;
      case 'greet': {
        const p = this.player;
        const d = this.distToPlayer();
        this.excite = Math.min(1, this.excite + dt * 0.8);
        if (d > 1.2 + this.height * 2 && a.t < 10) {
          this.poseTarget = null;
          this.steer(dt, p.pos.x, p.pos.z, 1.6, 0.9 + this.height * 2);
          this.lookAtPlayer();
        } else {
          this.brake(dt); this.turnToward(dt, p.pos.x, p.pos.z);
          this.lookAtPlayer();
          a.near = (a.near || 0) + dt;
          this.poseTarget = a.near > 1.5 && a.near < 5 ? 'sit' : null;
          if (a.near > 6) { a.done = true; this.socialT = 25; }
        }
        if (a.t > 14) { a.done = true; this.socialT = 20; }
        break;
      }
      default: this.runBasic(dt, a);
    }
  }

  runPlay(dt, a) {
    const S = this.game.structures; const it = a.it; const s = this.r.stats;
    if (!S.items.has(it.data.uid)) { a.done = true; return; }
    const obs = () => this.game.creatures.observe(this, 'playing');
    s.energy = Math.max(0, s.energy - dt * 0.6);
    this.excite = Math.min(1, this.excite + dt * 0.5);
    if (it.def.toy === 'ball') {
      const b = it.ball;
      const d = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      a.bow = a.bow || 0;
      if (a.t < 1.5 && d < 2.5) { this.brake(dt); this.turnToward(dt, b.x, b.z); this.poseTarget = 'bow'; this.look.target = new THREE.Vector3(b.x, this.pos.y, b.z); return; }
      this.poseTarget = null;
      this.look.target = new THREE.Vector3(b.x, this.pos.y + 0.05, b.z);
      if (d > 0.3 + this.radius) this.steer(dt, b.x, b.z, 2.2, 0.1);
      else {
        // nose the ball onward
        const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
        S.kickBall(it, dir.x + (this.rnd() - 0.5) * 0.8, dir.z + (this.rnd() - 0.5) * 0.8, 2 + this.rnd() * 1.8, 'creature');
        a.kicks = (a.kicks || 0) + 1;
        if (a.kicks > 1) obs();
      }
      if (a.t > 18 || (a.kicks || 0) > 5) { a.done = true; this.poseTarget = null; }
      return;
    }
    if (it.def.toy === 'tug') {
      if (!a.arrived) {
        const rem = this.approachItem(dt, it, { x: 0.22, z: 0.3 + this.height * 1.2 }, 1.2);
        if (rem < 0.25 || (this.blocked && a.t > 3)) a.arrived = true;
        if (a.t > 15) a.done = true;
        return;
      }
      this.brake(dt);
      const rope = it.obj.localToWorld(it.obj.userData.rope.clone());
      this.turnToward(dt, rope.x, rope.z);
      a.tug = (a.tug || 0) + dt;
      this.look.target = rope.clone().add(new THREE.Vector3(Math.sin(a.tug * 9) * 0.25, 0, Math.cos(a.tug * 7) * 0.05));
      this.poseTarget = Math.sin(a.tug * 1.7) > 0.3 ? 'bow' : null;
      if (a.tug > 2) obs();
      if (a.tug > 7) { a.done = true; this.poseTarget = null; }
      return;
    }
    // hollow log: trot through the tunnel, then sniff
    if (!a.route) {
      const yaw = it.data.yaw;
      const sgn = this.rnd() < 0.5 ? 1 : -1;
      const p0 = S.toWorld(it.data, -1.6 * sgn, 0), p1 = S.toWorld(it.data, 1.6 * sgn, 0);
      a.route = [p0, p1]; a.leg = 0;
    }
    const tgt = a.route[a.leg];
    const rem = this.steer(dt, tgt.x, tgt.z, a.leg === 0 ? 1.0 : 1.4, 0.3);
    if (rem < 0.35 || (this.blocked && a.t > 4)) { a.leg++; if (a.leg === 2) obs(); }
    if (a.leg >= 2 || a.t > 16) { a.done = true; }
  }
}

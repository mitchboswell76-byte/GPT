// Wires the systems into the opening loop: loading and title, save restore,
// key routing, interaction prompts, story beats and notifications.
import * as THREE from 'three';
import { CONFIG, urlParam } from '../data/config.js';
import { Player } from '../entities/Player.js';
import { CameraRig } from '../entities/CameraRig.js';
import { Structures } from '../construction/Structures.js';
import { BuildSystem } from '../construction/BuildSystem.js';
import { CreatureSystem } from '../creatures/CreatureSystem.js';
import { Guidance } from './Guidance.js';
import { SaveSystem, newState } from './Save.js';
import { Audio } from './Audio.js';
import { UI } from '../ui/UI.js';
import { Atlas } from '../ui/Atlas.js';
import { OUTPOST } from '../world/WorldLayout.js';

export class Session {
  constructor(game) {
    this.game = game;
    game.session = this;
  }

  async init() {
    const g = this.game;
    g.saves = new SaveSystem(g);
    const saved = urlParam('fresh') ? null : g.saves.read();
    g.state = saved || newState();
    g.calendar = { day: g.state.calendar.day, t: g.state.calendar.t, dayFloat: g.state.calendar.day };
    g.ui = new UI(g);
    g.ui.showTitle(!!saved && !urlParam('fresh'));
    await g.loadWorld((p, l) => g.ui.setLoad(p * 0.6, l));
    g.ui.setLoad(0.65, 'Waking the animals');
    await g.assets.loadModels(['player', 'dog_puppy', 'dog_adult'], (p) => g.ui.setLoad(0.65 + p * 0.3));
    g.mode = 'explore';
    g.player = g.add(new Player(g));
    g.structures = new Structures(g);
    g.events.on('structures:changed', () => g.saves.markDirty());
    g.cameraRig = new CameraRig(g);
    g.cameraRig.occluders = [g.world.outpost.cabin, g.world.outpost.shed];
    g.build = new BuildSystem(g);
    g.creatures = new CreatureSystem(g);
    g.guidance = new Guidance(g);
    g.audio = new Audio(g);
    g.atlas = new Atlas(g);
    g.add(this);
    g.add({ update: (dt) => g.structures.update(dt) });
    g.add({ update: (dt) => g.creatures.update(dt) });
    g.add(g.build);
    g.add(g.cameraRig);
    g.add({ lateUpdate: () => g.ui.update() });
    g.add({ update: (dt) => g.audio.update(dt) });
    g.add(g.saves);

    this.restore();
    this.wireEvents();
    g.ui.setLoad(1, 'Ready');
    // warm-up frame so shaders compile behind the title
    g.cameraRig.snapBehindPlayer();
    g.step?.(1, 1 / 60);
    g.start();
    window.__ready = true;
    if (urlParam('autostart') || urlParam('step')) { g.ui.hideTitle(); this.begin(); }
    else g.ui.titleReady(() => this.begin(), () => { g.saves.wipe(); if (saved) { location.href = location.pathname + '?fresh=1'; } else this.begin(); });
  }

  begin() {
    const g = this.game;
    g.audio.start();
    this.started = true;
    if (!g.state.objectives.flags.welcomed) {
      g.state.objectives.flags.welcomed = true;
      setTimeout(() => g.ui.toast(`${CONFIG.reserveName}`, { big: true, eyebrow: `Day ${g.calendar.day}` }), 600);
    }
  }

  restore() {
    const g = this.game, s = g.state;
    g.player.setPosition(s.player.x, s.player.z, s.player.yaw);
    g.player.calm = !!s.player.calm;
    g.structures.load(s.build);
    for (const it of g.structures.items.values()) if (it.def.id === 'kennel' && !g.cameraRig.occluders.includes(it.obj)) g.cameraRig.occluders.push(it.obj);
    g.creatures.growthSpeed = +(urlParam('growth') || s.settings.growthSpeed || 1);
    g.creatures.load(s.creatures);
    if (s.settings.volume !== undefined) g.audio.setVolume(s.settings.volume);
  }

  wireEvents() {
    const g = this.game, ui = g.ui, E = g.events, flags = () => g.state.objectives.flags;
    const save = (r) => g.saves.save(r);
    E.on('build:enter', () => { flags().buildOpened = true; });
    E.on('build:placed', () => g.saves.markDirty());
    E.on('objective', (e) => {
      const next = g.guidance.view();
      if (e.completed !== 'notes') ui.toast(esc(next.title), { eyebrow: 'New objective', ms: 5000 });
      if (e.completed === 'habitat') this.onHabitatReady();
      save('objective');
    });
    E.on('care', (e) => { if (e.type === 'fill-food') flags().filledFood = true; if (e.type === 'fill-water') flags().filledWater = true; });
    E.on('creature:petted', () => { flags().petted = true; });
    E.on('research', (e) => ui.toast(`${esc(e.label)} <span style="color:var(--muted)">+${e.points} research</span>`, { eyebrow: 'Field note recorded' }));
    E.on('creature:noticed', () => ui.toast('The puppy has seen you. Move slowly.', { eyebrow: 'Stray sighted' }));
    E.on('creature:startled', () => { if (!this.startleHint) { this.startleHint = true; ui.toast('Too quick — it bolted. Walk calmly (C) and let it come to you.', { eyebrow: 'Startled' }); } });
    E.on('creature:hesitated', () => ui.toast('It hesitates. You were moving fast a moment ago.', { eyebrow: 'Trust' }));
    E.on('creature:handfed', (e) => {
      const c = g.creatures.byUid(e.uid);
      g.creatures.observe(c, 'hand_fed', true);
      if (e.trust < 55) ui.toast(`It ate from your hand. Trust ${Math.round(e.trust)} / 55`, { eyebrow: 'Trust' });
    });
    E.on('creature:befriended', (e) => {
      const c = g.creatures.byUid(e.uid);
      g.state.atlas.dog.discovered = true;
      g.creatures.observe(c, 'befriended', true);
      ui.toast('The puppy trusts you', { big: true, eyebrow: 'First companion' });
      setTimeout(() => ui.openNaming(c, (name) => { g.creatures.name(c, name); ui.toast(`${esc(name)} will follow you home. Press F to call.`, { eyebrow: 'Life Atlas entry created' }); save('named'); }), 1600);
    });
    E.on('creature:settled', (e) => {
      const c = g.creatures.byUid(e.uid);
      g.creatures.observe(c, 'home', true);
      if (!c.r.history.some((h) => h.text.startsWith('Moved into'))) c.r.history.push({ day: g.calendar.day, text: 'Moved into the meadow enclosure.' });
      ui.toast(`${esc(c.r.name || 'The puppy')} has settled into the enclosure`, { big: true, eyebrow: 'Home' });
      save('settled');
    });
    E.on('creature:stay', (e) => ui.toast(`${esc(g.creatures.byUid(e.uid).r.name)} will wait here.`));
    E.on('creature:recalled', (e) => ui.toast(`${esc(g.creatures.byUid(e.uid).r.name)} is coming.`));
    E.on('creature:stage', (e) => {
      const c = g.creatures.byUid(e.uid);
      if (e.form.id === 'young') return;
      ui.toast(`${esc(c.r.name)} is now ${e.form.id === 'adult' ? 'an adult' : 'a ' + e.form.name.toLowerCase()}`, { big: true, eyebrow: 'Growth' });
      save('stage');
    });
    E.on('creature:treat', (e) => ui.toast(`${esc(g.creatures.byUid(e.uid).r.name)} enjoyed a treat.`));
    E.on('gate', () => g.saves.markDirty());
    window.addEventListener('beforeunload', () => { if (this.started) g.saves.save('unload'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started) g.saves.save('hidden'); });
  }

  onHabitatReady() {
    const g = this.game;
    if (!g.creatures.list.length) {
      g.creatures.spawnStray();
      setTimeout(() => g.ui.toast('A walker has reported a stray puppy near the fallen oak, across the footbridge.', { eyebrow: 'Radio message', ms: 6500 }), 1200);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, rawDt) {
    const g = this.game, input = g.input, ui = g.ui;
    // calendar
    if (dt > 0) {
      g.calendar.t += dt;
      g.calendar.dayFloat = 1 + g.calendar.t / CONFIG.time.dayLengthSeconds;
      g.calendar.day = Math.floor(g.calendar.dayFloat);
      g.state.calendar = { day: g.calendar.day, t: +g.calendar.t.toFixed(1) };
      g.state.playTime += dt;
    }
    // safety: the stray should exist once the enclosure objective is done
    if (g.state.objectives.step > 2 && !g.creatures.list.length) g.creatures.spawnStray();
    g.guidance.update();
    if (!this.started || ui.titleOpen) return;

    if (input.wasPressed('Escape')) {
      if (ui.modal) { if (ui.modal.dismissable) ui.closeModal(); }
      else if (g.mode !== 'build') { g.paused = true; ui.openPause(); ui.modal.onClose = () => { g.paused = false; }; }
    }
    if (input.wasPressed('Backquote')) ui.toggleDebug();
    if (ui.modal) { ui.setPrompt(null); if (input.wasPressed('KeyL') && g.atlas.open) ui.closeModal(); return; }
    if (input.wasPressed('KeyB')) { if (g.mode === 'build') g.build.exit(); else { g.build.enter(); } }
    if (input.wasPressed('KeyL')) g.atlas.toggle();
    if (input.wasPressed('KeyH')) ui.hideKeys = !ui.hideKeys;
    if (input.wasPressed('Tab')) ui.cardPinned = !ui.cardPinned;
    if (g.mode !== 'explore') { ui.setPrompt(null); return; }

    if (input.wasPressed('KeyV')) this.toggleObserve();
    if (g.cameraRig.observe && (input.anyDown('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || g.cameraRig.observe.distToPlayer() > 30)) this.toggleObserve(false);
    if (input.wasPressed('KeyF')) this.creatureAction('call');
    if (input.wasPressed('KeyT')) this.creatureAction('treat');

    // interactions
    const p = g.player;
    const cands = [];
    const busy = !p.controlsEnabled;
    if (!busy) {
      const nb = OUTPOST.noticeboard;
      const dn = Math.hypot(nb.x - p.pos.x, nb.z - p.pos.z);
      if (dn < 2.4) cands.push({ id: 'notes', x: nb.x, z: nb.z, d: dn, label: 'Read the field notes', priority: 0.5, run: () => ui.openNotes() });
      cands.push(...g.structures.interactionsNear(p.pos.x, p.pos.z));
      cands.push(...g.creatures.interactionsNear(p.pos.x, p.pos.z));
    }
    // prefer things in front of the player
    const fwd = p.forward();
    let best = null, bs = Infinity;
    for (const c of cands) {
      const dx = c.x - p.pos.x, dz = c.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
      const facing = (dx * fwd.x + dz * fwd.z) / l;
      const score = c.d - facing * 0.8 - (c.priority || 0) * 0.6 + (c.disabled ? 1.5 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    this.currentInteraction = best;
    if (best) {
      ui.setPrompt({ key: 'E', label: best.label, disabled: best.disabled });
      if (input.wasPressed('KeyE') && !best.disabled) { best.run(); g.events.emit('interact', { id: best.id }); }
    } else ui.setPrompt(null);
    p.lookTarget = this.lookTargetFor(best);
    // grass pushers
    const pushers = [{ x: p.pos.x, z: p.pos.z, r: 0.55, s: 0.7 }];
    for (const c of g.creatures.list.slice(0, 3)) pushers.push({ x: c.pos.x, z: c.pos.z, r: 0.25 + c.height, s: 0.6 });
    g.pushers = pushers;
  }

  toggleObserve(on) {
    const g = this.game, rig = g.cameraRig;
    const want = on ?? !rig.observe;
    if (!want) { rig.observe = null; g.ui.setObserving(null); return; }
    const c = g.creatures.list.filter((x) => x.distToPlayer() < 30).sort((a, b) => a.distToPlayer() - b.distToPlayer())[0];
    if (!c) { g.ui.toast('Nothing close enough to observe.'); return; }
    rig.observe = c;
    g.ui.setObserving(c);
  }

  lookTargetFor(best) {
    const g = this.game, p = g.player;
    if (!p.controlsEnabled) return p.lookTarget;
    const dog = g.creatures.list[0];
    if (dog && (dog.distToPlayer() < 7 || g.cameraRig.observe === dog)) return dog.headPosition();
    if (best) return new THREE.Vector3(best.x, g.world.groundAt(best.x, best.z) + 0.8, best.z);
    return null;
  }

  creatureAction(act) {
    const g = this.game;
    const c = g.creatures.acquired.sort((a, b) => a.distToPlayer() - b.distToPlayer())[0];
    if (act === 'atlas') { g.atlas.toggle(); return; }
    if (!c) return;
    if (act === 'call') {
      const r = g.creatures.callNearest();
      if (r?.res === 'follow') g.player.whistle = 1;
    }
    if (act === 'treat') {
      if (c.distToPlayer() > 3) { g.ui.toast(`Get closer to give ${c.r.name} a treat.`); return; }
      if (!g.creatures.giveTreat(c)) g.ui.toast('No rations left.');
    }
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

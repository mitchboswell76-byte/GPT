// The Life Atlas: an expandable creature encyclopaedia with a live 3D
// preview, species knowledge that unlocks through research, and individual
// records that grow as the creature does.
import * as THREE from 'three';
import { SPECIES, ATLAS_SILHOUETTES } from '../data/species.js';
import { MODELS } from '../data/assets.js';
import { CONFIG } from '../data/config.js';
import { CreatureBody } from '../creatures/CreatureBody.js';
import { WORDS, describe } from './UI.js';
import { clamp } from '../util/noise.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT = { real: 'Living species', prehistoric: 'Prehistoric', mythical: 'Mythical', scifi: 'Speculative' };

export class Atlas {
  constructor(game) {
    this.game = game;
    this.tab = 'individual';
    this.open = false;
  }

  toggle() { if (this.open) this.game.ui.closeModal(); else this.show(); }

  show() {
    const g = this.game, ui = g.ui;
    const st = g.state.atlas.dog;
    const dog = g.creatures.list[0];
    if (!st.discovered && !dog) this.tab = 'species';
    if (dog && dog.r.status !== 'wild') st.discovered = true;
    const el = document.createElement('div');
    el.className = 'atlas panel';
    el.innerHTML = `
      <div class="side">
        <h1>Life Atlas</h1><div class="tag">Field records of ${esc(CONFIG.reserveName)}</div>
        <div class="eyebrow group">${CAT.real}</div>
        <div class="entry on"><div class="dot">${st.discovered || dog ? 'D' : '?'}</div><div><div class="t">${st.discovered || dog ? 'Domestic Dog' : 'Unrecorded canid'}</div><div class="s">${dog && dog.r.status !== 'wild' ? '1 individual in care' : dog ? 'Sighted' : 'Not yet recorded'}</div></div></div>
        ${Object.keys(CAT).map((k) => {
          const list = ATLAS_SILHOUETTES.filter((s) => s.category === k);
          if (!list.length) return '';
          return `${k !== 'real' ? `<div class="eyebrow group">${CAT[k]}</div>` : ''}${list.map(() => `<div class="entry locked"><div class="dot">?</div><div><div class="t">Undiscovered</div><div class="s">${CAT[k]}</div></div></div>`).join('')}`;
        }).join('')}
      </div>
      <div class="stage"><canvas></canvas><div class="cap"></div><div class="scale"></div><button class="btn close">Close <b class="key">L</b></button></div>
      <div class="info"><div class="tabs"><button data-t="species">Species</button><button data-t="individual">Individual</button><button data-t="research">Research</button></div><div class="body"></div></div>`;
    el.querySelector('.close').onclick = () => ui.closeModal();
    el.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { this.tab = b.dataset.t; this.render(); g.events.emit('ui:click'); });
    this.el = el;
    ui.openModal(el, { onClose: () => this.teardown() });
    this.open = true;
    g.state.objectives.flags.atlasOpened = true;
    if (dog && dog.r.growth >= CONFIG.growth.adultSwapAt) g.state.objectives.flags.atlasAfterAdult = true;
    this.setupPreview(el.querySelector('canvas'));
    this.render();
    g.events.emit('atlas:open');
  }

  render() {
    const el = this.el; if (!el) return;
    el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === this.tab));
    const body = el.querySelector('.body');
    body.innerHTML = this.tab === 'species' ? this.speciesHTML() : this.tab === 'individual' ? this.individualHTML() : this.researchHTML();
    const dog = this.game.creatures.list[0];
    const cap = el.querySelector('.cap'), sc = el.querySelector('.scale');
    if (dog && dog.r.status !== 'wild') {
      cap.innerHTML = `<b>${esc(dog.r.name)}</b>${esc(dog.form.name)} · ${Math.round(this.game.creatures.ageWeeks(dog))} weeks`;
      sc.innerHTML = `Shown at current size<br>${Math.round(dog.height * 1.15 * 100)} cm at the shoulder`;
    } else {
      cap.innerHTML = '<b>Domestic Dog</b>Reference specimen · puppy';
      sc.textContent = 'Drag to turn';
    }
  }

  section(title, need, html) {
    const pts = this.game.state.atlas.dog.points;
    if (pts >= need) return `<section><h3>${title}</h3>${html}</section>`;
    return `<section><h3>${title}</h3><div class="locked-note">◌ Further observation needed — ${need - pts} more research points.</div></section>`;
  }

  speciesHTML() {
    const s = SPECIES.dog;
    const U = s.unlocks;
    return `<div class="eyebrow">Species record</div><h2>${s.commonName}</h2><div class="sci">${s.scientificName}</div>
      <div class="chips"><span class="chip real">${CAT[s.category]}</span><span class="chip">${s.family}</span><span class="chip">Affinity: none</span></div>
      <p style="font-size:13.5px;line-height:1.55;color:var(--ink-2)">${s.blurb}</p>
      ${this.section('Diet', U.diet, `<p><b>${s.diet.type}.</b> ${s.diet.detail}</p>`)}
      ${this.section('Habitat needs', U.habitat, `<p>${s.habitat.summary}</p><ul><li>Fenced area of at least ${s.habitat.minArea} m² with a gate</li><li>Dry shelter with bedding</li><li>Fresh water, topped up daily</li><li>Food bowl, filled from rations</li><li>Enrichment: balls, rope toys, tunnels</li></ul>`)}
      ${this.section('Behaviour', U.behaviour, `<ul>${s.behaviour.map((b) => `<li>${b}</li>`).join('')}</ul>`)}
      ${this.section('Growth', U.growth, `<p>Forms recorded: ${s.forms.map((f) => f.name).join(' → ')}. Adult size ${s.adultSize}. Lifespan ${s.lifespan}.</p>`)}
      <section><h3>Genetics</h3><div class="locked-note">◌ Collect a genetic sample to record inherited traits (planned).</div></section>`;
  }

  individualHTML() {
    const g = this.game;
    const dog = g.creatures.list[0];
    if (!dog || dog.r.status === 'wild') {
      return `<div class="eyebrow">Individuals</div><h2>None in care</h2><p style="font-size:13.5px;color:var(--ink-2);line-height:1.5">${dog ? 'A stray has been sighted at the woodland edge. Earn its trust to begin a record.' : 'Individuals you take into care are recorded here: identity, growth, health and history.'}</p>`;
    }
    const r = dog.r, s = r.stats;
    const weeks = Math.round(g.creatures.ageWeeks(dog));
    const enc = g.structures.enclosures.find((e) => e.id === r.homeId);
    const bar = (label, v, words, cls = '') => `<div class="stat"><label>${label}</label><div class="bar ${cls}"><i style="width:${clamp(v, 0, 100)}%"></i></div><em>${describe(v, words)}</em></div>`;
    const log = r.statLog.length > 1 ? r.statLog : null;
    let chart = '';
    if (log) {
      const W = 340, H = 90, n = log.length;
      const xs = (i) => (i / (n - 1)) * (W - 4) + 2;
      const line = (k, max, col) => `<polyline fill="none" stroke="${col}" stroke-width="1.6" points="${log.map((p, i) => `${xs(i).toFixed(1)},${(H - 4 - (p[k] / max) * (H - 10)).toFixed(1)}`).join(' ')}"/>`;
      chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect x="0" y="0" width="${W}" height="${H}" fill="rgba(255,255,255,0.35)"/>${line('g', 1, '#4d6a39')}${line('p', 100, '#b5852c')}${line('h', 100, '#4f7186')}</svg>
        <div style="font-size:11px;color:var(--muted);display:flex;gap:12px"><span style="color:#4d6a39">■ Growth</span><span style="color:#b5852c">■ Happiness</span><span style="color:#4f7186">■ Health</span></div>`;
    }
    return `<div class="eyebrow">Individual record · ${esc(r.uid.toUpperCase())}</div><h2>${esc(r.name)}</h2><div class="sci">${esc(r.sex)} ${esc(SPECIES.dog.commonName.toLowerCase())}, ${esc(dog.form.name.toLowerCase())}</div>
      <dl class="kv">
        <dt>Age</dt><dd>${weeks} weeks</dd>
        <dt>Growth stage</dt><dd>${esc(dog.form.name)} · ${Math.round(r.growth * 100)}% grown</dd>
        <dt>Coat</dt><dd>${esc(r.traits.coat)}</dd>
        <dt>Temperament</dt><dd>${esc(r.traits.temperament)}</dd>
        <dt>Build</dt><dd>${r.traits.build >= 1.02 ? 'Sturdy' : r.traits.build <= 0.98 ? 'Slight' : 'Average'}</dd>
        <dt>Acquired</dt><dd>Day ${r.acquiredDay ?? '—'} · ${esc(r.origin.place)}</dd>
        <dt>Home</dt><dd>${enc ? `Enclosure, ${enc.area} m²` : r.following ? 'With you' : 'No enclosure yet'}</dd>
        <dt>Lineage</dt><dd style="color:var(--muted)">Unknown (stray)</dd>
      </dl>
      <section><h3>Condition</h3>${bar('Health', s.health, WORDS.health)}${bar('Hunger', s.hunger, WORDS.hunger, 'ochre')}${bar('Thirst', s.thirst, WORDS.thirst, 'sky')}${bar('Happiness', s.happiness, WORDS.happiness)}${bar('Trust', s.trust, WORDS.trust, 'ochre')}
      <div class="stat"><label>Growth</label><div class="bar"><i style="width:${r.growth * 100}%"></i></div><em>${Math.round(r.growth * 100)}%</em></div>${chart}</section>
      <section><h3>History</h3><ul class="timeline">${r.history.slice().reverse().map((e) => `<li><b>Day ${e.day}</b>${esc(e.text)}</li>`).join('')}</ul></section>`;
  }

  researchHTML() {
    const g = this.game;
    const st = g.state.atlas.dog;
    const sp = SPECIES.dog;
    const next = Object.entries(sp.unlocks).map(([k, v]) => ({ k, v })).find((u) => u.v > st.points);
    const max = Math.max(...Object.values(sp.unlocks));
    return `<div class="eyebrow">Research</div><h2>${st.points} points</h2><div class="sci">${next ? `Next: ${next.k} notes at ${next.v} points` : 'All species notes unlocked'}</div>
      <div class="bar" style="margin:6px 0 12px"><i style="width:${clamp(st.points / max, 0, 1) * 100}%"></i></div>
      <section><h3>Field observations</h3><ul class="obs">${sp.research.map((r) => `<li class="${st.research.includes(r.id) ? '' : 'no'}"><span>${st.research.includes(r.id) ? '✓' : '○'} ${r.label}</span><span>+${r.points}</span></li>`).join('')}</ul></section>
      <section><h3>Samples</h3><div class="locked-note">◌ Genetic sampling, breeding and incubation become available with the research lab (planned).</div></section>`;
  }

  // ---------------------------------------------------------------- 3D preview
  setupPreview(canvas) {
    const g = this.game;
    const r = canvas.getBoundingClientRect();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!new URLSearchParams(location.search).get('shot') });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(r.width, r.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.environment = g.world.env.envMap;
    scene.environmentIntensity = 0.5;
    const cam = new THREE.PerspectiveCamera(30, r.width / r.height, 0.05, 50);
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6); key.position.set(2, 3, 2.5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -1.5; key.shadow.camera.right = key.shadow.camera.top = 1.5;
    const rim = new THREE.DirectionalLight(0xcfe0ff, 1.4); rim.position.set(-2.5, 1.5, -2);
    scene.add(key, rim, new THREE.HemisphereLight(0xfff6e6, 0x8a7a5a, 0.6));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
    floor.receiveShadow = true; scene.add(floor);
    const root = new THREE.Group(); scene.add(root);
    const dog = g.creatures.list[0];
    const acquired = dog && dog.r.status !== 'wild';
    const modelId = acquired ? dog.form.model : 'dog_puppy';
    const body = new CreatureBody(g, modelId, root);
    const scale = acquired ? dog.modelScale(modelId) : MODELS.dog_puppy.scaleRange[0];
    const pose = { sit: 0, lie: 0, sleep: 0, eat: 0, bow: 0 };
    const height = body.rig.hipHeight * scale;
    let spin = 0.6, drag = false, lastX = 0, vel = 0.35;
    canvas.addEventListener('pointerdown', (e) => { drag = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (drag) { vel = (e.clientX - lastX) * 0.01; spin += vel; lastX = e.clientX; } });
    canvas.addEventListener('pointerup', () => { drag = false; vel = Math.sign(vel || 1) * 0.35; });
    const dist = height * 7.2 + 0.4;
    const t0 = performance.now();
    let last = t0;
    const happy = acquired ? dog.r.stats.happiness / 100 : 0.2;
    const tick = () => {
      if (!this.preview) return;
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) spin += vel * dt;
      body.update({ dt, time: (now - t0) / 1000, rootObj: root, position: new THREE.Vector3(), yaw: 0, yawRate: 0,
        velocity: new THREE.Vector3(), speed: 0, scale, ground: () => 0, pose, look: { target: null, weight: 0 },
        tail: { wag: 0.15 + 0.4 * happy, freq: 2 + 2 * happy, height: 0.1 + 0.2 * happy }, pant: 0, blink: 0, breath: 0.5 + 0.5 * Math.sin(now * 0.004) });
      cam.position.set(Math.sin(spin) * dist, height * 1.9, Math.cos(spin) * dist);
      cam.lookAt(0, height * 1.05, 0);
      renderer.render(scene, cam);
      this.preview.raf = requestAnimationFrame(tick);
    };
    this.preview = { renderer, body, raf: 0 };
    tick();
  }

  teardown() {
    this.open = false;
    if (this.preview) {
      cancelAnimationFrame(this.preview.raf);
      this.preview.body.dispose();
      this.preview.renderer.dispose();
      this.preview = null;
    }
    this.el = null;
  }
}

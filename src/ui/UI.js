// DOM interface layered over the 3D view: HUD, objectives, compass, prompts,
// toasts, the creature card, construction dock and dialogs.
import { CONFIG } from '../data/config.js';
import { BUILDABLES, CATEGORIES } from '../data/buildables.js';
import { ICONS } from './icons.js';
import { clamp } from '../util/noise.js';

const h = (tag, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function describe(v, words) {
  for (const [lim, w] of words) if (v >= lim) return w;
  return words[words.length - 1][1];
}
export const WORDS = {
  hunger: [[80, 'Well fed'], [55, 'Content'], [30, 'Peckish'], [12, 'Hungry'], [0, 'Starving']],
  thirst: [[70, 'Hydrated'], [40, 'Fine'], [18, 'Thirsty'], [0, 'Parched']],
  health: [[85, 'Thriving'], [65, 'Healthy'], [40, 'Under par'], [0, 'Poorly']],
  happiness: [[80, 'Joyful'], [60, 'Content'], [40, 'Settled'], [20, 'Unsettled'], [0, 'Miserable']],
  trust: [[80, 'Devoted'], [55, 'Trusting'], [30, 'Warming'], [10, 'Cautious'], [0, 'Wary']],
};

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.modal = null;
    this.toastsEl = this.add(h('div', 'toasts'));
    this.buildHUD();
    this.buildDock();
    this.lastObjectiveKey = '';
    this.cardPinned = false;
    game.events.on('build:enter', () => this.setBuildVisible(true));
    game.events.on('build:exit', () => this.setBuildVisible(false));
    game.events.on('build:tool', () => this.refreshDockItems());
    game.events.on('structures:changed', () => { this.refreshAssess(); this.refreshDockItems(); });
  }

  add(el) { this.root.appendChild(el); return el; }

  pointerCaptured() {
    const m = this.game.input.mouse;
    if (this.modal) return true;
    const r = this.game.renderer.domElement.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + m.x, r.top + m.y);
    return !!el && el !== this.game.renderer.domElement;
  }

  blocksMovement() { return !!this.modal; }

  // ---------------------------------------------------------------- HUD
  buildHUD() {
    this.hud = this.add(h('div', 'hud'));
    this.obj = h('div', 'objective panel');
    this.hud.appendChild(this.obj);
    this.res = h('div', 'resources panel');
    this.hud.appendChild(this.res);
    this.compass = h('div', 'compass');
    this.hud.appendChild(this.compass);
    this.prompt = h('div', 'prompt panel off');
    this.hud.appendChild(this.prompt);
    this.status = h('div', 'status-chip hidden');
    this.hud.appendChild(this.status);
    this.keys = h('div', 'keys');
    this.keys.innerHTML = [['WASD', 'Move'], ['Shift', 'Brisk walk'], ['C', 'Calm pace'], ['E', 'Interact'], ['F', 'Call / stay'], ['V', 'Observe'], ['B', 'Build'], ['L', 'Life Atlas'], ['Tab', 'Creature card'], ['Drag', 'Look'], ['Esc', 'Menu']]
      .map(([k, l]) => `<span><b class="key">${k}</b>${l}</span>`).join('');
    this.hud.appendChild(this.keys);
    this.card = h('div', 'ccard panel off');
    this.hud.appendChild(this.card);
    this.card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      this.game.session.creatureAction(b.dataset.act);
    });
    // compass ticks
    const ticks = [];
    for (let a = 0; a < 360; a += 15) ticks.push({ a, label: { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' }[a] });
    this.ticks = ticks.map((t) => { const e = h('div', t.label ? 'tick' : 'tick minor', t.label || ''); this.compass.appendChild(e); return { ...t, e }; });
    this.compass.appendChild(h('div', 'centre'));
    this.markEl = h('div', 'mark hidden', '<i></i><span></span>');
    this.compass.appendChild(this.markEl);
  }

  setPrompt(p) {
    if (!p) { this.prompt.classList.add('off'); this.promptKey = ''; return; }
    const key = p.key + p.label + (p.sub || '') + !!p.disabled;
    if (key !== this.promptKey) {
      this.prompt.innerHTML = `<b class="key">${p.key}</b><span>${esc(p.label)}</span>${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ''}`;
      this.promptKey = key;
    }
    this.prompt.classList.toggle('disabled', !!p.disabled);
    this.prompt.classList.remove('off');
  }

  updateHUD() {
    const g = this.game;
    const building = g.mode === 'build';
    this.hud.style.display = this.titleOpen ? 'none' : '';
    this.obj.style.display = building ? 'none' : '';
    this.keys.style.display = building || this.hideKeys ? 'none' : '';
    // objective
    const v = g.guidance.view();
    const key = JSON.stringify([v.title, v.detail, v.checklist, v.progress && Math.round(v.progress.value * 50)]);
    if (key !== this.lastObjectiveKey) {
      const flash = this.lastObjectiveKey && JSON.parse(this.lastObjectiveKey)[0] !== v.title;
      this.lastObjectiveKey = key;
      this.obj.innerHTML = `<div class="eyebrow"><span>Field objective</span><span>${Math.min(v.index + 1, v.total)} / ${v.total}</span></div>
        <h2>${esc(v.title)}</h2>${v.detail ? `<p>${esc(v.detail)}</p>` : ''}
        ${v.checklist ? `<ul>${v.checklist.map((c) => `<li class="${c.ok ? 'ok' : ''}"><span class="tick">${c.ok ? '✓' : ''}</span>${esc(c.label)}</li>`).join('')}</ul>` : ''}
        ${v.progress ? `<div class="meter"><div class="row"><span>${esc(v.progress.label)}</span><span>${Math.round(clamp(v.progress.value, 0, 1) * 100)}%</span></div><div class="bar"><i style="width:${clamp(v.progress.value, 0, 1) * 100}%"></i></div></div>` : ''}`;
      if (flash) { this.obj.classList.remove('flash'); void this.obj.offsetWidth; this.obj.classList.add('flash'); }
    }
    // resources
    const r = g.state.resources;
    const rk = `${g.calendar.day}|${r.materials}|${r.rations}`;
    if (rk !== this.resKey) {
      this.resKey = rk;
      this.res.innerHTML = `<div class="res"><b>${g.calendar.day}</b><span>Day</span></div><div class="res"><b>${r.materials}</b><span>Materials</span></div><div class="res"><b>${r.rations}</b><span>Rations</span></div>`;
    }
    // compass
    const yaw = g.mode === 'build' ? g.cameraRig.build.yaw : g.cameraRig.yaw;
    const heading = ((-yaw * 180 / Math.PI) % 360 + 720) % 360; // view direction is -(sin yaw, cos yaw); north is -Z
    const W = 420, span = 150;
    for (const t of this.ticks) {
      let d = ((t.a - heading + 540) % 360) - 180;
      const x = W / 2 + (d / span) * W;
      t.e.style.display = Math.abs(d) < span / 2 ? '' : 'none';
      t.e.style.left = x + 'px';
    }
    const mk = v.marker;
    if (mk && !building) {
      const p = g.player.pos;
      const bearing = (Math.atan2(mk.x - p.x, -(mk.z - p.z)) * 180 / Math.PI + 360) % 360;
      let d = ((bearing - heading + 540) % 360) - 180;
      d = clamp(d, -span / 2 + 4, span / 2 - 4);
      const dist = Math.hypot(mk.x - p.x, mk.z - p.z);
      this.markEl.classList.remove('hidden');
      this.markEl.style.left = (W / 2 + (d / span) * W) + 'px';
      this.markEl.querySelector('span').textContent = dist > 6 ? `${mk.fuzzy ? '~' : ''}${Math.round(dist)} m` : '';
    } else this.markEl.classList.add('hidden');
    this.compass.style.display = building ? 'none' : '';
    // status chip
    const st = this.observing ? `Observing ${this.observing.r.name || 'the puppy'} · V to stop` : g.player.calm ? 'Calm pace' : '';
    this.status.textContent = st; this.status.classList.toggle('hidden', !st || building);
  }

  setObserving(c) { this.observing = c; }

  // ---------------------------------------------------------------- toasts
  toast(html, { big = false, eyebrow = '', ms = 4200 } = {}) {
    const t = h('div', 'toast panel' + (big ? ' big' : ''), `${eyebrow ? `<div><div class="eyebrow">${esc(eyebrow)}</div>${big ? `<h3>${html}</h3>` : `<div>${html}</div>`}</div>` : html}`);
    this.toastsEl.appendChild(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }

  // ---------------------------------------------------------------- creature card
  updateCard() {
    const g = this.game;
    if (g.mode === 'build' || this.modal) { this.card.classList.add('off'); return; }
    const c = g.creatures.list[0];
    let show = false;
    if (c) {
      const d = c.distToPlayer();
      show = this.cardPinned || (c.r.status !== 'wild' ? d < 7 : (c.r.seenPlayer && d < 14));
    }
    this.card.classList.toggle('off', !show);
    if (!show) return;
    const s = c.r.stats;
    const wild = c.r.status === 'wild';
    const ses = g.creatures;
    const weeks = Math.round(ses.ageWeeks(c));
    const mood = this.moodOf(c);
    const bar = (label, val, words, cls = '') => `<div class="stat"><label>${label}</label><div class="bar ${cls}"><i style="width:${clamp(val, 0, 100)}%"></i></div><em>${describe(val, words)}</em></div>`;
    const key = JSON.stringify([c.r.name, c.r.status, Math.round(s.health), Math.round(s.hunger), Math.round(s.thirst), Math.round(s.happiness), Math.round(s.trust), Math.round(c.r.growth * 100), mood, weeks, c.state, g.state.resources.rations]);
    if (key === this.cardKey) return;
    this.cardKey = key;
    if (wild) {
      this.card.innerHTML = `<div class="eyebrow">Stray sighting</div><h2>Unknown puppy</h2><div class="sub">Domestic Dog · roughly ${weeks} weeks old</div>
        <div class="mood">${esc(mood)}</div>${bar('Trust', s.trust / 0.55, WORDS.trust, 'ochre')}
        <p style="font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.4">Thin and hungry. Move slowly and crouch-offer food (E) to build trust.</p>`;
      return;
    }
    const form = c.form.name;
    this.card.innerHTML = `<div class="eyebrow">In your care</div><h2>${esc(c.r.name || 'Puppy')}</h2>
      <div class="sub">Domestic Dog · ${esc(form)} · ${weeks} weeks · ${esc(c.r.sex)}</div>
      <div class="mood">${esc(mood)}</div>
      ${bar('Health', s.health, WORDS.health)}${bar('Hunger', s.hunger, WORDS.hunger, s.hunger < 30 ? 'rust' : 'ochre')}${bar('Thirst', s.thirst, WORDS.thirst, s.thirst < 25 ? 'rust' : 'sky')}
      ${bar('Happiness', s.happiness, WORDS.happiness)}${bar('Trust', s.trust, WORDS.trust, 'ochre')}
      <div class="stat"><label>Growth</label><div class="bar"><i style="width:${c.r.growth * 100}%"></i></div><em>${Math.round(c.r.growth * 100)}%</em></div>
      <div class="actions">
        <button class="btn" data-act="treat" ${g.state.resources.rations ? '' : 'disabled'}><b class="key">T</b>Treat</button>
        <button class="btn" data-act="call"><b class="key">F</b>${c.state === 'follow' ? 'Stay' : 'Call'}</button>
        <button class="btn" data-act="atlas"><b class="key">L</b>Atlas</button>
      </div>`;
  }

  moodOf(c) {
    const s = c.r.stats;
    if (c.r.status === 'wild') return s.trust < 15 ? 'Wary, watching you closely' : s.trust < 40 ? 'Curious but cautious' : 'Edging closer';
    if (c.pose.sleep > 0.5) return 'Asleep';
    if (s.health < 40) return 'Unwell — needs food and water';
    if (s.hunger < 25) return 'Hungry';
    if (s.thirst < 25) return 'Thirsty';
    if (c.excite > 0.6) return 'Excited';
    if (s.energy < 25) return 'Sleepy';
    if (c.state === 'follow') return 'Following you';
    if (s.happiness > 70) return 'Happy and relaxed';
    return 'Settled';
  }

  // ---------------------------------------------------------------- construction dock
  buildDock() {
    this.dock = this.add(h('div', 'dock panel hidden'));
    this.cat = 'fencing';
    this.dock.innerHTML = `<div class="top"><h3>Construction</h3><div class="cats"></div><div class="spacer"></div>
      <span class="eyebrow" data-mat></span><button class="btn" data-exit><b class="key">B</b> Done</button></div>
      <div class="items"></div>
      <div class="hint"><span><b class="key">LMB</b> place / select</span><span><b class="key">R</b> rotate</span><span><b class="key">RMB</b> cancel</span><span><b class="key">WASD</b> pan</span><span><b class="key">Q</b><b class="key">E</b> turn view</span><span><b class="key">Wheel</b> zoom</span><span><b class="key">Del</b> remove</span></div>`;
    const cats = this.dock.querySelector('.cats');
    for (const c of CATEGORIES) {
      const b = h('button', '', c.name); b.dataset.cat = c.id;
      b.onclick = () => { this.cat = c.id; this.game.events.emit('ui:click'); this.refreshDockItems(); };
      cats.appendChild(b);
    }
    this.dock.querySelector('[data-exit]').onclick = () => this.game.build.exit();
    this.assess = this.add(h('div', 'assess panel hidden'));
    this.msg = this.add(h('div', 'buildmsg panel hidden'));
    this.sel = this.add(h('div', 'selpanel panel hidden'));
    this.sel.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sel]'); if (!b) return;
      const B = this.game.build;
      if (b.dataset.sel === 'move') B.startMove(B.selected.uid);
      if (b.dataset.sel === 'rotate') B.rotateSelected();
      if (b.dataset.sel === 'remove') B.removeSelected();
      if (b.dataset.sel === 'gate') { const k = B.selected.key; const ed = this.game.structures.edges.get(k); this.game.structures.setGate(k, !ed.data.open); }
    });
  }

  setBuildVisible(v) {
    for (const el of [this.dock, this.assess]) el.classList.toggle('hidden', !v);
    if (!v) { this.msg.classList.add('hidden'); this.sel.classList.add('hidden'); }
    this.refreshDockItems(); this.refreshAssess();
  }

  refreshDockItems() {
    const items = this.dock.querySelector('.items');
    const tool = this.game.build?.tool;
    const mats = this.game.state.resources.materials;
    for (const b of this.dock.querySelectorAll('.cats button')) b.classList.toggle('on', b.dataset.cat === this.cat);
    items.innerHTML = '';
    for (const def of Object.values(BUILDABLES).filter((d) => d.category === this.cat)) {
      const b = h('button', 'item' + (tool?.id === def.id ? ' on' : '') + (mats < def.cost ? ' poor' : ''), `${ICONS[def.id] || ''}<div class="n">${esc(def.name)}</div><div class="c">${def.cost} materials${def.kind === 'edge' ? ' / bay' : ''}</div>`);
      b.title = def.desc;
      b.onclick = () => { this.game.events.emit('ui:click'); this.game.build.selectTool(tool?.id === def.id ? null : def.id); };
      items.appendChild(b);
    }
    this.dock.querySelector('[data-mat]').textContent = `${mats} materials`;
  }

  refreshAssess() {
    if (!this.game.structures) return;
    const encs = this.game.structures.enclosures;
    let html = '<div class="eyebrow">Habitat assessment</div><h3>Dog enclosure</h3>';
    if (!encs.length) html += '<p>No enclosed area yet. Run fence bays on the grid until they close into a loop, then hang a gate in one bay.</p>';
    encs.slice(0, 3).forEach((e, n) => {
      const ok = e.suitable;
      html += `<div class="enc"><div class="hd"><span>Enclosure ${n + 1} · ${e.area} m²</span><span class="${ok ? 'good' : 'warn'}">${ok ? 'Suitable' : 'Incomplete'}</span></div>
        <ul>${e.checks.map((c) => `<li class="${c.ok ? 'ok' : ''}"><span>${c.ok ? '✓' : '○'}</span>${esc(c.label)}</li>`).join('')}</ul></div>`;
    });
    this.assess.innerHTML = html;
  }

  updateBuild() {
    const B = this.game.build;
    if (this.game.mode !== 'build') return;
    const m = B.message;
    this.msg.classList.toggle('hidden', !m);
    if (m) { this.msg.textContent = m; this.msg.classList.toggle('bad', /Blocked|Too|Not enough|Outside|steep|Already|footbridge|gate is/.test(m)); }
    const mats = this.game.state.resources.materials;
    if (mats !== this.lastMats) { this.lastMats = mats; this.refreshDockItems(); }
    const sel = B.selected;
    const sk = sel ? JSON.stringify(sel) + (sel.key ? this.game.structures.edges.get(sel.key)?.data.open : '') : '';
    if (sk !== this.selKey) {
      this.selKey = sk;
      if (!sel) this.sel.classList.add('hidden');
      else {
        this.sel.classList.remove('hidden');
        if (sel.type === 'object') {
          const it = this.game.structures.items.get(sel.uid);
          const fill = it.def.fill ? `<p>${it.def.fill === 'food' ? 'Food' : 'Water'} level: ${Math.round((it.data.fill || 0) * 100)}%</p>` : '';
          this.sel.innerHTML = `<h3>${esc(it.def.name)}</h3><p>${esc(it.def.desc)}</p>${fill}<div class="row"><button class="btn" data-sel="move"><b class="key">M</b> Move</button><button class="btn" data-sel="rotate"><b class="key">R</b> Rotate</button><button class="btn danger" data-sel="remove"><b class="key">Del</b> Remove (+${it.def.cost})</button></div>`;
        } else {
          const ed = this.game.structures.edges.get(sel.key);
          const def = BUILDABLES[ed.data.type];
          this.sel.innerHTML = `<h3>${esc(def.name)}</h3><p>One 2 m bay.</p><div class="row">${ed.data.type === 'gate' ? `<button class="btn" data-sel="gate">${ed.data.open ? 'Close' : 'Open'} gate</button>` : ''}<button class="btn danger" data-sel="remove"><b class="key">Del</b> Remove (+${def.cost})</button></div>`;
        }
      }
    }
  }

  // ---------------------------------------------------------------- dialogs
  openModal(el, { onClose, dismissable = true } = {}) {
    this.closeModal();
    const ov = h('div', 'overlay');
    ov.appendChild(el);
    if (dismissable) ov.addEventListener('pointerdown', (e) => { if (e.target === ov) this.closeModal(); });
    this.root.appendChild(ov);
    this.modal = { ov, onClose, dismissable };
    return ov;
  }

  closeModal() {
    if (!this.modal) return;
    const m = this.modal; this.modal = null;
    m.ov.remove();
    m.onClose?.();
  }

  openNotes() {
    const el = h('div', 'modal panel notes');
    el.innerHTML = `<div class="eyebrow">Field brief · Day ${this.game.calendar.day}</div><h2>Welcome to Hollin Vale</h2>
      <div class="lined">
      <p>The reserve is yours to shape. The cabin, the store and this season’s materials are ready; the rest of the vale is open land.</p>
      <p>First job: <b>build a dog enclosure</b> on the meadow south of the cabin. A dog needs a fenced run with a gate, a kennel, food, water and something to play with.</p>
      <p>A walker reported <b>a stray puppy</b> near the fallen oak, across the footbridge at the woodland edge. Once the enclosure is ready, see if you can win its trust. Go gently: it’s frightened and hungry.</p>
      <p>Record what you see in the <b>Life Atlas</b> (L). Every observation helps.</p>
      <p class="sig">— M. Hollin, reserve warden</p></div>
      <div class="row"><button class="btn primary" data-ok>Pin it to my notebook</button></div>`;
    el.querySelector('[data-ok]').onclick = () => this.closeModal();
    this.openModal(el, { onClose: () => { this.game.state.objectives.flags.notesRead = true; } });
  }

  openNaming(c, onDone) {
    const el = h('div', 'modal panel');
    const sexWord = c.r.sex === 'Female' ? 'her' : 'him';
    el.innerHTML = `<div class="eyebrow">Trust earned</div><h2>The puppy has chosen you</h2>
      <p>A ${esc(c.r.traits.temperament.toLowerCase())} ${esc(c.r.sex.toLowerCase())} puppy, about ${Math.round(this.game.creatures.ageWeeks(c))} weeks old. What will you call ${sexWord}?</p>
      <input type="text" maxlength="18" spellcheck="false" />
      <div class="row"><button class="btn" data-sug>Suggest another</button><button class="btn primary" data-ok>Name the puppy</button></div>`;
    const input = el.querySelector('input');
    input.value = this.game.creatures.randomName();
    const done = () => { const v = input.value.trim().slice(0, 18) || this.game.creatures.randomName(); this.closeModal(); onDone(v); };
    el.querySelector('[data-sug]').onclick = () => { input.value = this.game.creatures.randomName(); input.focus(); input.select(); };
    el.querySelector('[data-ok]').onclick = done;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); e.stopPropagation(); });
    this.openModal(el, { dismissable: false });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  openPause() {
    const g = this.game;
    const el = h('div', 'modal panel');
    const q = g.qualityName, gs = g.creatures.growthSpeed;
    el.innerHTML = `<div class="eyebrow">${esc(CONFIG.reserveName)}</div><h2>Paused</h2>
      <div class="setting"><span>Graphics quality</span><div class="seg">${['low', 'medium', 'high'].map((n) => `<button class="btn ${n === q ? 'on' : ''}" data-q="${n}">${n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div></div>
      <div class="setting"><span>Growth speed (prototype)</span><div class="seg">${[1, 4, 12].map((n) => `<button class="btn ${n === gs ? 'on' : ''}" data-g="${n}">${n}×</button>`).join('')}</div></div>
      <div class="setting"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${g.audio.volume}" data-vol /></div>
      <div class="setting" style="border:0"><span>Controls</span><span></span></div>
      <div class="controls"><b class="key">W A S D</b><span>Walk (camera-relative); hold Shift for a brisk walk</span><b class="key">C</b><span>Toggle a calm, slow pace</span><b class="key">Drag</b><span>Orbit the camera; wheel zooms</span><b class="key">E</b><span>Interact (offer food, stroke, gates, bowls)</span><b class="key">F</b><span>Call your dog, or tell it to stay</span><b class="key">V</b><span>Observe: frame the nearest animal (move to stop)</span><b class="key">B</b><span>Construction mode</span><b class="key">L</b><span>Life Atlas</span><b class="key">Tab</b><span>Pin the creature card</span></div>
      <div class="row"><button class="btn danger" data-new>New reserve…</button><button class="btn" data-save>Save now</button><button class="btn primary" data-resume>Resume</button></div>`;
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { localStorage.setItem('cr.quality', b.dataset.q); g.saves.save('quality'); location.reload(); });
    el.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { g.creatures.growthSpeed = +b.dataset.g; g.state.settings.growthSpeed = +b.dataset.g; this.closeModal(); this.openPause(); });
    el.querySelector('[data-vol]').oninput = (e) => { g.audio.setVolume(+e.target.value); g.state.settings.volume = +e.target.value; };
    el.querySelector('[data-save]').onclick = () => { g.saves.save('manual'); this.toast('Progress saved'); };
    el.querySelector('[data-resume]').onclick = () => this.closeModal();
    el.querySelector('[data-new]').onclick = () => this.confirmNew();
    this.openModal(el);
  }

  confirmNew() {
    const el = h('div', 'modal panel');
    el.innerHTML = `<h2>Start a new reserve?</h2><p>This clears your saved enclosure, creatures and Atlas progress.</p>
      <div class="row"><button class="btn" data-no>Keep playing</button><button class="btn danger" data-yes>Start again</button></div>`;
    el.querySelector('[data-no]').onclick = () => this.closeModal();
    el.querySelector('[data-yes]').onclick = () => { this.game.saves.enabled = false; this.game.saves.wipe(); location.reload(); };
    this.openModal(el);
  }

  // ---------------------------------------------------------------- title
  showTitle(hasSave) {
    this.titleOpen = true;
    const el = this.titleEl = h('div', 'title');
    el.innerHTML = `<div class="inner"><div class="eyebrow" style="color:#cfc59f">Working title</div><h1>${esc(CONFIG.title)}</h1>
      <div class="sub">${esc(CONFIG.reserveName)} — a keeper’s field station at the edge of the woods.</div>
      <div class="load"><i></i></div><div class="lbl">Preparing the reserve…</div>
      <div class="row hidden">${hasSave ? '<button class="btn primary" data-cont>Continue</button><button class="btn" data-new>New reserve</button>' : '<button class="btn primary" data-new>Begin</button>'}</div></div>
      <div class="credit">Adult Labrador model: “Labrador Dog” by kenchoo, CC-BY-4.0. Trees: ez-tree (MIT).
        Dog recordings: Freesound contributors via ESC-50 (K. J. Piczak), CC BY 3.0; footsteps and impacts: Kenney (CC0).
        <a href="assets/audio/CREDITS.md" target="_blank" rel="noopener">Full sound credits</a></div>`;
    this.root.appendChild(el);
    return el;
  }

  setLoad(p, label) {
    if (!this.titleEl) return;
    this.titleEl.querySelector('.load i').style.width = Math.round(p * 100) + '%';
    if (label) this.titleEl.querySelector('.lbl').textContent = label;
  }

  titleReady(onContinue, onNew) {
    const el = this.titleEl;
    el.querySelector('.load').classList.add('hidden');
    el.querySelector('.lbl').classList.add('hidden');
    el.querySelector('.row').classList.remove('hidden');
    el.querySelector('[data-cont]')?.addEventListener('click', () => { this.hideTitle(); onContinue(); });
    el.querySelector('[data-new]')?.addEventListener('click', () => { this.hideTitle(); onNew(); });
  }

  hideTitle() {
    this.titleOpen = false;
    this.titleEl.style.transition = 'opacity 500ms'; this.titleEl.style.opacity = 0;
    setTimeout(() => this.titleEl.remove(), 520);
  }

  // ---------------------------------------------------------------- debug
  toggleDebug() {
    if (this.debugEl) { this.debugEl.remove(); this.debugEl = null; return; }
    const g = this.game;
    const el = this.debugEl = this.add(h('div', 'debug panel'));
    el.innerHTML = `<h3>Prototype tools</h3><div class="eyebrow">Growth speed</div><div class="row">${[1, 4, 12, 40].map((n) => `<button class="btn" data-g="${n}">${n}×</button>`).join('')}</div>
      <div class="eyebrow">Resources</div><div class="row"><button class="btn" data-m>+100 materials</button><button class="btn" data-r>+10 rations</button></div>
      <div class="eyebrow">Creature</div><div class="row"><button class="btn" data-grow>+10% growth</button><button class="btn" data-feed>Feed & water</button></div>`;
    el.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { g.creatures.growthSpeed = +b.dataset.g; g.state.settings.growthSpeed = +b.dataset.g; this.toast(`Growth speed ${b.dataset.g}×`); });
    el.querySelector('[data-m]').onclick = () => { g.state.resources.materials += 100; };
    el.querySelector('[data-r]').onclick = () => { g.state.resources.rations += 10; };
    el.querySelector('[data-grow]').onclick = () => { const c = g.creatures.acquired[0]; if (c) { const b = c.r.growth; c.r.growth = Math.min(1, b + 0.1); g.creatures.checkStage(c, b, c.r.growth); } };
    el.querySelector('[data-feed]').onclick = () => { for (const c of g.creatures.list) { c.r.stats.hunger = 100; c.r.stats.thirst = 100; } };
  }

  update() {
    this.updateHUD();
    this.updateCard();
    this.updateBuild();
  }
}

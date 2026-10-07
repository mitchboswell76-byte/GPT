// Versioned save/load to localStorage. The saved document is plain JSON so a
// later build (or another tool) can migrate it; see migrate().
import { CONFIG } from '../data/config.js';

export function newState() {
  return {
    version: CONFIG.saveVersion,
    created: new Date().toISOString(),
    savedAt: null,
    playTime: 0,
    calendar: { day: 1, t: 0 },
    resources: { ...CONFIG.start.resources },
    player: { x: CONFIG.start.playerPos[0], z: CONFIG.start.playerPos[1], yaw: CONFIG.start.playerYaw, calm: false },
    build: { objects: [], edges: [] },
    creatures: [],
    atlas: { dog: { discovered: false, points: 0, research: [] } },
    objectives: { step: 0, done: [], flags: {} },
    settings: { growthSpeed: 1, volume: 0.8 },
  };
}

function migrate(s) {
  // v1 is current. Future versions upgrade older documents here.
  if (!s.version) s.version = 1;
  const base = newState();
  for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
  return s;
}

export class SaveSystem {
  constructor(game) {
    this.game = game;
    this.key = CONFIG.saveKey;
    this.timer = 0;
    this.dirty = false;
    this.enabled = true;
  }

  exists() {
    try { return !!localStorage.getItem(this.key); } catch { return false; }
  }

  read() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('Save could not be read', e);
      return null;
    }
  }

  /** Gather live data into the state document and write it. */
  save(reason = 'auto') {
    if (!this.enabled) return false;
    const g = this.game, s = g.state;
    s.savedAt = new Date().toISOString();
    s.player = g.player.serialize();
    s.build = g.structures.serialize();
    s.creatures = g.creatures.list.map((c) => c.r);
    try {
      localStorage.setItem(this.key, JSON.stringify(s));
      this.dirty = false;
      g.events.emit('saved', { reason });
      return true;
    } catch (e) {
      console.warn('Save failed', e);
      return false;
    }
  }

  wipe() {
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
  }

  markDirty() { this.dirty = true; }

  update(dt, rawDt) {
    this.timer += rawDt || dt;
    if (this.timer > CONFIG.autosaveSeconds) {
      this.timer = 0;
      this.save('auto');
    }
  }
}

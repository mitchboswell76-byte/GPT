// Playtest helpers: drive the game with real keyboard/mouse events in a
// headless browser. Frames are stepped explicitly so slow software rendering
// doesn't affect simulation timing. Reading game state is used only to aim
// inputs and to verify outcomes.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

export async function launch({ profile, width = 1280, height = 720 } = {}) {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  let context, browser;
  if (profile) {
    fs.mkdirSync(profile, { recursive: true });
    context = await chromium.launchPersistentContext(profile, { args, viewport: { width, height } });
  } else {
    browser = await chromium.launch({ args });
    context = await browser.newContext({ viewport: { width, height } });
  }
  const page = context.pages()[0] || await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[pt]')) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => { logs.push('PAGEERROR ' + e.message); console.log('PAGEERROR', e.message); });
  const T = new Tester(page, context, browser, logs);
  return T;
}

export class Tester {
  constructor(page, context, browser, logs) { this.page = page; this.context = context; this.browser = browser; this.logs = logs; this.frames = 0; }

  async open(qs) {
    await this.page.goto('http://localhost:5173/?step=1&' + qs);
    await this.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
  }

  async step(n = 1, render = false, dt = 1 / 30) {
    await this.page.evaluate(([n, r, dt]) => window.__game.step(n, dt, r), [n, render, dt]);
    this.frames += n;
  }

  async shot(path) {
    await this.step(1, true);
    await this.page.screenshot({ path, timeout: 180000 });
    console.log('shot', path);
  }

  async st() {
    return this.page.evaluate(() => {
      const g = window.__game; const p = g.player; const c = g.creatures.list[0];
      return {
        p: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, speed: p.speed, crouch: p.crouch }, camYaw: g.cameraRig.yaw, mode: g.mode,
        objective: g.guidance.view().title, step: g.state.objectives.step, res: { ...g.state.resources },
        modal: !!g.ui.modal, prompt: g.session.currentInteraction?.label || null,
        dog: c ? { x: c.pos.x, z: c.pos.z, state: c.state, status: c.r.status, trust: c.r.stats.trust, name: c.r.name, growth: c.r.growth, act: c.act?.type, stats: c.r.stats, form: c.form.id, speed: c.speed } : null,
        encs: g.structures.enclosures.map((e) => ({ id: e.id, area: e.area, suitable: e.suitable, checks: e.checks.filter((k) => !k.ok).map((k) => k.id) })),
        time: g.time,
      };
    });
  }

  async press(key, frames = 1) {
    await this.page.keyboard.down(key);
    await this.step(frames);
    await this.page.keyboard.up(key);
    await this.step(1);
  }

  /** Walk toward (x, z) with camera-relative WASD. */
  async walkTo(x, z, { tol = 0.6, maxFrames = 1800, chunk = 5, keys = [] } = {}) {
    let frames = 0, last = null, stuck = 0;
    for (const k of keys) await this.page.keyboard.down(k);
    while (frames < maxFrames) {
      const s = await this.st();
      const dx = x - s.p.x, dz = z - s.p.z, d = Math.hypot(dx, dz);
      if (d < tol) break;
      const cy = s.camYaw;
      const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
      const iz = (dx * fx + dz * fz) / d, ix = (dx * rx + dz * rz) / d;
      const down = [];
      if (iz > 0.38) down.push('w'); if (iz < -0.38) down.push('s');
      if (ix > 0.38) down.push('d'); if (ix < -0.38) down.push('a');
      for (const k of down) await this.page.keyboard.down(k);
      await this.step(Math.min(chunk, Math.max(1, Math.ceil(d / 0.06))));
      for (const k of down) await this.page.keyboard.up(k);
      frames += chunk;
      if (last && Math.hypot(s.p.x - last.x, s.p.z - last.z) < 0.01) stuck++; else stuck = 0;
      last = s.p;
      if (stuck > 12) { console.log('walkTo stuck at', s.p.x.toFixed(2), s.p.z.toFixed(2), 'target', x, z); break; }
    }
    for (const k of keys) await this.page.keyboard.up(k);
    await this.step(2);
    return this.st();
  }

  async route(points, opts) { for (const [x, z] of points) await this.walkTo(x, z, opts); return this.st(); }

  /** Screen position of a world point. */
  async screenOf(x, z, yOff = 0) {
    return this.page.evaluate(([x, z, yOff]) => {
      const g = window.__game; const THREE = g.THREE;
      const v = new g.camera.position.constructor(x, g.world.groundAt(x, z) + yOff, z).project(g.camera);
      const r = g.renderer.domElement.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    }, [x, z, yOff]);
  }

  /** In build mode, pan the camera with WASD until (x, z) is in clear view. */
  async frameBuild(x, z) {
    for (let i = 0; i < 80; i++) {
      const sp = await this.screenOf(x, z);
      const vw = this.page.viewportSize();
      const okX = sp.x > vw.width * 0.25 && sp.x < vw.width * 0.7, okY = sp.y > vw.height * 0.25 && sp.y < vw.height * 0.62;
      if (okX && okY) return true;
      const keys = [];
      if (sp.y < vw.height * 0.25) keys.push('w'); else if (sp.y > vw.height * 0.62) keys.push('s');
      if (sp.x < vw.width * 0.25) keys.push('a'); else if (sp.x > vw.width * 0.7) keys.push('d');
      for (const k of keys) await this.page.keyboard.down(k);
      await this.step(3);
      for (const k of keys) await this.page.keyboard.up(k);
    }
    return false;
  }

  async clickWorld(x, z, { button = 'left', yOff = 0 } = {}) {
    const s = await this.screenOf(x, z, yOff);
    await this.page.mouse.move(s.x, s.y);
    await this.step(1);
    await this.page.mouse.down({ button });
    await this.step(1);
    await this.page.mouse.up({ button });
    await this.step(2);
  }

  async hoverWorld(x, z) { const s = await this.screenOf(x, z); await this.page.mouse.move(s.x, s.y); await this.step(2); }

  async click(selector) {
    await this.page.click(selector, { timeout: 10000 });
    await this.step(2);
  }

  async type(text) { await this.page.keyboard.type(text, { delay: 10 }); await this.step(1); }

  async close() { if (this.browser) await this.browser.close(); else await this.context.close(); }
}

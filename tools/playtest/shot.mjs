// Screenshot the running game (vite dev server) with URL params, stepping
// frames manually so slow software rendering does not stall capture.
// usage: node tools/playtest/shot.mjs out.png "q=low&cam=..." [frames]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [out, qs = '', frames = '3'] = process.argv.slice(2);
const W = +(process.env.VW || 1280), H = +(process.env.VH || 720);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', async (e) => { console.log('PAGEERROR ' + e.message); await browser.close(); process.exit(2); });
const t0 = Date.now();
await page.goto('http://localhost:5173/?shot=1&step=1&' + qs);
await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
const tl = Date.now();
const ms = await page.evaluate((n) => { const t = performance.now(); window.__game.step(n, 1 / 30); return performance.now() - t; }, +frames);
const t1 = Date.now();
await page.screenshot({ path: out, timeout: 120000 });
console.log(JSON.stringify({ out, loadMs: tl - t0, stepMs: Math.round(ms), shotMs: Date.now() - t1, logs: logs.slice(0, 15) }));
await browser.close();

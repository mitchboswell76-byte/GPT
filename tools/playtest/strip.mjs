// Capture a sequence of frames: node strip.mjs outPrefix "query" warmup every count
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [prefix, qs = '', warm = '10', every = '3', count = '8'] = process.argv.slice(2);
const W = +(process.env.VW || 640), H = +(process.env.VH || 400);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', async (e) => { console.log('PAGEERROR ' + e.message); await browser.close(); process.exit(2); });
await page.goto(`http://localhost:${process.env.PORT || 5173}/?shot=1&step=1&` + qs);
await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
await page.evaluate((n) => window.__game.step(n, 1 / 30, false), +warm);
for (let i = 0; i < +count; i++) {
  await page.evaluate((n) => window.__game.step(n, 1 / 30), +every);
  await page.screenshot({ path: `${prefix}_${String(i).padStart(2, '0')}.png`, timeout: 120000 });
}
console.log(JSON.stringify({ prefix, logs: logs.slice(0, 10) }));
await browser.close();

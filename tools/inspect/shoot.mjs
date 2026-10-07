// usage: node tools/inspect/shoot.mjs out.png "query" [more "out|query" pairs via JSON file]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const jobs = JSON.parse(process.argv[2]);
const base = process.env.BASE || 'http://localhost:5173/tools/inspect/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', e => console.log('pageerror', e.message));
for (const [out, qs] of jobs) {
  await page.goto(base + '?' + qs);
  await page.waitForFunction('window.done === true', null, { timeout: 120000 });
  await page.screenshot({ path: out });
  console.log(out, JSON.stringify(await page.evaluate('window.info')));
}
await browser.close();

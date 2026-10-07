// Checks the recorded-sound pipeline in a real browser: every manifest file
// decodes, walking with the keyboard triggers surface footsteps, and dog
// vocal kinds resolve to recordings for a puppy and an adult.
// usage: node tools/playtest/audio_check.mjs   (needs the dev server)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('sound failed')) errors.push(m.text()); });
await page.goto(`http://localhost:${process.env.PORT || 5173}/?q=low&step=1&fresh=1&autostart=1`);
await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
await page.mouse.click(480, 270); // user gesture for the AudioContext

const decoded = await page.evaluate(async () => {
  const a = window.__game.audio;
  a.start();
  await a.bank.preload();
  const out = { ok: 0, bad: [], ids: {} };
  for (const [url, buf] of a.bank.buffers) {
    if (buf && buf.duration) { out.ok++; const id = url.split('/').pop().replace(/_\d+\.mp3$/, ''); out.ids[id] = (out.ids[id] || 0) + 1; }
    else out.bad.push(url);
  }
  // count every play by id from here on
  window.__plays = {};
  const play = a.bank.play.bind(a.bank);
  a.bank.play = (id, o) => { const r = play(id, o); if (r) window.__plays[id] = (window.__plays[id] || 0) + 1; return r; };
  return out;
});

// walk forward with the real keyboard for ~4 s of game time
await page.keyboard.down('KeyW');
for (let i = 0; i < 16; i++) await page.evaluate(() => window.__game.step(8, 1 / 30));
await page.keyboard.up('KeyW');

const vocals = await page.evaluate(() => {
  const a = window.__game.audio, p = window.__game.player.pos;
  const mk = (growth) => ({ r: { uid: 'test' + growth, growth, stats: { trust: 60, hunger: 80 }, status: 'resident' }, headPosition: () => p, pos: p });
  const res = {};
  for (const g of [0.2, 0.9]) for (const k of ['whine', 'yip', 'bark']) res[`${g < 0.5 ? 'puppy' : 'adult'}_${k}`] = a.creatureAudio.vocal(mk(g), k, 0, true);
  return { res, plays: window.__plays, ctx: a.ctx.state };
});
console.log(JSON.stringify({ decoded, ...vocals, errors }, null, 1));
await browser.close();

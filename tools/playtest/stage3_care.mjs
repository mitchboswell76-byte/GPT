// Stage 3: care for the dog, observe it, open the Life Atlas, raise it to
// adulthood with the prototype growth control, then reload and verify.
import { launch } from './lib.mjs';
const OUT = process.argv[2] || '/tmp/pt';
const PROFILE = process.argv[3] || '/tmp/pt-profile';
const Q = process.env.Q || 'low';
const T = await launch({ profile: PROFILE });
const log = async (l) => { const s = await T.st(); console.log(l, JSON.stringify({ p: [s.p.x.toFixed(1), s.p.z.toFixed(1)], obj: s.objective, dog: s.dog && { st: s.dog.state, act: s.dog.act, pos: [s.dog.x.toFixed(1), s.dog.z.toFixed(1)], g: s.dog.growth.toFixed(3), form: s.dog.form, h: Math.round(s.dog.stats.hunger), t: Math.round(s.dog.stats.thirst), hp: Math.round(s.dog.stats.health), hap: Math.round(s.dog.stats.happiness), e: Math.round(s.dog.stats.energy) }, res: s.res, prompt: s.prompt })); return s; };
try {
  await T.open(`q=${Q}&autostart=1`);
  await T.step(3);
  await log('start');
  await T.walkTo(9, 10.9, { tol: 0.3 });
  await T.press('e'); await T.step(20);           // open gate
  await T.walkTo(9.6, 13.2, { tol: 0.3 });
  await T.walkTo(10.4, 13.5, { tol: 0.3, maxFrames: 60 });
  let s = await log('at bowl');
  await T.press('e'); await T.step(10);           // fill bowl
  await T.walkTo(11.3, 17.4, { tol: 0.3 });
  s = await log('at trough');
  await T.press('e'); await T.step(10);           // top up water
  await T.shot(`${OUT}/20_filled.png`);
  await T.press('v'); await T.step(30);           // observe the dog
  // let the dog eat and drink while we watch
  let shots = { eat: 0, drink: 0, sleep: 0, play: 0 };
  for (let i = 0; i < 120; i++) {
    await T.step(15);
    s = await T.st();
    const a = s.dog.act;
    if (shots[a] === 0 && ['eat', 'drink'].includes(a)) {
      await T.step(70);
      await T.shot(`${OUT}/21_${a}.png`); shots[a] = 1;
    }
    if (shots.eat && shots.drink) break;
  }
  await log('after meal');
  await T.press('v'); await T.step(10);           // stop observing
  // stroke the dog
  for (let i = 0; i < 40; i++) {
    s = await T.st();
    const d = Math.hypot(s.dog.x - s.p.x, s.dog.z - s.p.z);
    if (s.prompt && s.prompt.startsWith('Stroke')) break;
    if (d > 1.6) await T.walkTo(s.dog.x + (s.p.x - s.dog.x) / d * 1.2, s.dog.z + (s.p.z - s.dog.z) / d * 1.2, { tol: 0.3, maxFrames: 90 });
    else await T.step(10);
  }
  await T.press('e'); await T.step(45);
  await T.shot(`${OUT}/22_stroke.png`);
  await T.step(40);
  await T.shot(`${OUT}/22b_stroke.png`);
  await T.step(60);
  await log('after stroke');
  // Life Atlas
  await T.press('l'); await T.step(10, true);
  await T.page.waitForTimeout(1500);
  await T.shot(`${OUT}/23_atlas_individual.png`);
  await T.click('.atlas .tabs button[data-t="species"]'); await T.page.waitForTimeout(500);
  await T.shot(`${OUT}/24_atlas_species.png`);
  await T.click('.atlas .tabs button[data-t="research"]'); await T.page.waitForTimeout(500);
  await T.shot(`${OUT}/25_atlas_research.png`);
  await T.press('l'); await T.step(5);
  // observe routines for a while (one in-game day)
  await T.press('v'); await T.step(20);
  for (let i = 0; i < 160; i++) {
    await T.step(15);
    s = await T.st();
    const a = s.dog.act;
    if (shots[a] === 0 && ['sleep', 'play'].includes(a)) { await T.step(a === 'sleep' ? 200 : 40); await T.shot(`${OUT}/26_${a}.png`); shots[a] = 1; }
    if (shots.sleep && shots.play) break;
  }
  s = await log('after observing');
  // speed growth with the prototype tools (backtick panel), keep bowls filled
  await T.page.keyboard.press('Backquote'); await T.step(2);
  await T.click('.debug [data-g="40"]');
  await T.page.keyboard.press('Backquote'); await T.step(2);
  let refill = 0;
  for (let i = 0; i < 400; i++) {
    await T.step(15);
    s = await T.st();
    if (s.dog.growth > 0.74 && !shots.fade) { shots.fade = 1; }
    if (s.dog.form === 'adult' && !shots.adult) { await T.step(20); await T.shot(`${OUT}/27_transform.png`); await T.step(80); shots.adult = 1; }
    if (s.dog.growth >= 0.95) break;
    if (i % 40 === 39) {
      await T.page.keyboard.press('Backquote'); await T.step(1);
      await T.click('.debug [data-feed]');
      await T.page.keyboard.press('Backquote'); await T.step(1);
      refill++;
    }
  }
  s = await log('grown');
  await T.shot(`${OUT}/28_adult.png`);
  await T.press('l'); await T.page.waitForTimeout(1500); await T.step(5, true);
  await T.shot(`${OUT}/29_atlas_adult.png`);
  await T.press('l'); await T.step(10);
  s = await log('final');
  await T.page.evaluate(() => window.__game.saves.save('test'));
  // reload and verify
  await T.page.reload();
  await T.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
  await T.step(30);
  const s2 = await log('after reload');
  await T.shot(`${OUT}/30_reloaded.png`);
  console.log('PERSIST', JSON.stringify({ ok: s2.dog.growth >= s.dog.growth - 0.001 && s2.dog.name === s.dog.name && s2.dog.state === 'resident' && s2.encs.length === s.encs.length && s2.encs[0]?.suitable && s2.step === s.step, before: { g: s.dog.growth, name: s.dog.name, step: s.step }, after: { g: s2.dog.growth, name: s2.dog.name, step: s2.step }, encs: s2.encs, objective: s2.objective }));
} finally {
  console.log('logs', T.logs.slice(0, 20));
  await T.close();
}

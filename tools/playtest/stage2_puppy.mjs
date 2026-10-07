// Stage 2: walk to the woodland edge, approach the stray calmly, hand-feed it
// until it trusts you, name it, and lead it home into the enclosure.
import { launch } from './lib.mjs';
const OUT = process.argv[2] || '/tmp/pt';
const PROFILE = process.argv[3] || '/tmp/pt-profile';
const Q = process.env.Q || 'low';
const T = await launch({ profile: PROFILE });
const log = async (l) => { const s = await T.st(); console.log(l, JSON.stringify({ p: [s.p.x.toFixed(1), s.p.z.toFixed(1)], obj: s.objective, dog: s.dog && { st: s.dog.state, status: s.dog.status, trust: s.dog.trust.toFixed(1), act: s.dog.act, pos: [s.dog.x.toFixed(1), s.dog.z.toFixed(1)], name: s.dog.name }, res: s.res, prompt: s.prompt })); return s; };
try {
  await T.open(`q=${Q}&autostart=1`);
  await T.step(3);
  const B = await T.page.evaluate(async () => { const m = await import('/src/world/WorldLayout.js'); return m.BRIDGE; });
  const bp = (k) => [B.x + B.nx * k, B.z + B.nz * k];
  await log('start');
  await T.route([[0, 3], [-4, 4.5], [-10, 9.5], [-17, 14.5], [-22.5, 18.5], bp(-6.5), bp(-3), bp(3), bp(6.5), [-44, 32]], { tol: 0.8 });
  await log('across bridge');
  await T.shot(`${OUT}/10_woodland_edge.png`);
  // calm pace for the approach
  await T.press('c');
  let s = await T.walkTo(-51.5, 36, { tol: 0.6 });
  await log('near');
  await T.step(30);
  await T.shot(`${OUT}/11_puppy_sighted.png`);
  s = await log('before approach');
  // approach to ~4.5 m of the puppy
  for (let i = 0; i < 6; i++) {
    s = await T.st();
    const dx = s.dog.x - s.p.x, dz = s.dog.z - s.p.z, d = Math.hypot(dx, dz);
    if (d < 4.6) break;
    await T.walkTo(s.p.x + dx * (1 - 4.2 / d), s.p.z + dz * (1 - 4.2 / d), { tol: 0.4, maxFrames: 200 });
  }
  await log('in range');
  for (let attempt = 0; attempt < 6; attempt++) {
    s = await T.st();
    if (s.dog.status !== 'wild') break;
    if (!s.prompt || !s.prompt.startsWith('Offer')) {
      const dx = s.dog.x - s.p.x, dz = s.dog.z - s.p.z, d = Math.hypot(dx, dz);
      await T.walkTo(s.p.x + dx * (1 - 3.6 / d), s.p.z + dz * (1 - 3.6 / d), { tol: 0.4, maxFrames: 150 });
    }
    await T.press('e');
    for (let k = 0; k < 14; k++) {
      await T.step(10);
      if (attempt === 0 && k === 5) await T.shot(`${OUT}/12_offer_approach.png`);
      if (attempt === 1 && k === 6) await T.shot(`${OUT}/13_offer_eating.png`);
    }
    await log('after offer ' + attempt);
    await T.step(20);
  }
  // naming dialog appears after a short beat
  await T.page.waitForSelector('.modal input', { timeout: 20000 }).catch(() => {});
  await T.step(2, true);
  await T.shot(`${OUT}/14_naming.png`);
  await T.page.fill('.modal input', '');
  await T.type('Bramble');
  await T.page.keyboard.press('Enter');
  await T.step(30);
  await log('named');
  await T.shot(`${OUT}/15_befriended.png`);
  // lead home along the path
  await T.page.keyboard.down('Shift');
  await T.route([[-44, 32], bp(6.5), bp(3), bp(-3), bp(-6.5), [-22.5, 18.5], [-17, 14.5], [-10, 9.5], [-2, 8], [5, 9.5], [9, 10.4]], { tol: 0.8 });
  await T.page.keyboard.up('Shift');
  await log('at gate');
  // wait for the dog to catch up
  for (let i = 0; i < 20; i++) { s = await T.st(); if (Math.hypot(s.dog.x - s.p.x, s.dog.z - s.p.z) < 3.5) break; await T.step(15); }
  await T.shot(`${OUT}/16_back_at_gate.png`);
  await T.press('e'); // open gate
  await T.step(30);
  await log('gate opened');
  await T.walkTo(9, 15.5, { tol: 0.5 });
  for (let i = 0; i < 20; i++) { s = await T.st(); if (s.dog.z > 13.2) break; await T.step(15); }
  await log('inside together');
  await T.shot(`${OUT}/17_inside.png`);
  await T.walkTo(9, 10.6, { tol: 0.4 });
  // turn to face the gate and close it
  await T.walkTo(9, 11.0, { tol: 0.25, maxFrames: 60 });
  s = await log('before close');
  await T.press('e');
  await T.step(120);
  s = await log('after close');
  await T.shot(`${OUT}/18_settled.png`);
  await T.page.evaluate(() => window.__game.saves.save('test'));
} finally {
  console.log('logs', T.logs.slice(0, 20));
  await T.close();
}

// Stage 1: read the brief, open construction, build a complete dog enclosure.
import { launch } from './lib.mjs';
const OUT = process.argv[2] || '/tmp/pt';
const PROFILE = process.argv[3] || '/tmp/pt-profile';
const Q = process.env.Q || 'low';
const T = await launch({ profile: PROFILE });
try {
  await T.open(`q=${Q}&fresh=1`);
  await T.step(5, true);
  await T.shot(`${OUT}/01_start.png`);
  // walk to the noticeboard and read it
  let s = await T.walkTo(5.4, -0.6, { tol: 0.5 });
  console.log('at board', s.p, 'prompt', s.prompt);
  await T.press('e');
  await T.step(3, true);
  await T.shot(`${OUT}/02_notes.png`);
  await T.click('.modal [data-ok]');
  s = await T.st(); console.log('objective', s.objective);
  // construction mode
  await T.press('b');
  await T.step(40);
  await T.shot(`${OUT}/03_build_mode.png`);
  // fence a 10 x 8 m run: nodes x 4..14, z 12..20
  await T.click('.dock .cats button[data-cat="fencing"]');
  await T.click('.dock .items .item:nth-child(1)');
  const corners = [[4, 12], [14, 12], [14, 20], [4, 20], [4, 12]];
  await T.frameBuild(9, 16);
  await T.clickWorld(...corners[0]);
  await T.hoverWorld(...corners[1]);
  await T.shot(`${OUT}/04_fence_preview.png`);
  for (const c of corners.slice(1)) await T.clickWorld(...c);
  await T.page.keyboard.press('Escape'); await T.step(2);
  s = await T.st(); console.log('after fence', JSON.stringify(s.encs), s.res);
  // gate on the north side, x 8..10 at z 12
  await T.click('.dock .items .item:nth-child(2)');
  await T.frameBuild(9, 12);
  await T.clickWorld(9, 12.15);
  await T.page.keyboard.press('Escape'); await T.step(2);
  // kennel (door facing north into the run), bowl, trough, toys
  const place = async (cat, idx, x, z, rots = 0) => {
    await T.click(`.dock .cats button[data-cat="${cat}"]`);
    await T.click(`.dock .items .item:nth-child(${idx})`);
    for (let i = 0; i < rots; i++) await T.press('r');
    await T.frameBuild(x, z);
    await T.hoverWorld(x, z);
    await T.clickWorld(x, z);
    await T.page.keyboard.press('Escape'); await T.step(2);
  };
  await place('shelter', 1, 6, 18.4, 4);
  await place('care', 1, 10.5, 14.2);
  await place('care', 2, 12.4, 17.6, 2);
  await place('enrichment', 1, 8.5, 16);
  await place('enrichment', 2, 12.6, 13.6);
  await place('enrichment', 3, 9.5, 18.6);
  s = await T.st(); console.log('enclosures', JSON.stringify(s.encs), 'res', s.res, 'objective', s.objective);
  await T.step(10, true);
  await T.shot(`${OUT}/05_enclosure_build.png`);
  await T.press('b');
  await T.step(60);
  s = await T.st(); console.log('after exit', s.mode, s.objective, 'dog', s.dog && s.dog.status);
  await T.shot(`${OUT}/06_enclosure_explore.png`);
  await T.page.evaluate(() => window.__game.saves.save('test'));
} finally {
  console.log('logs', T.logs.slice(0, 20));
  await T.close();
}

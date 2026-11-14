// Browser tests for Color Rides. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const URL = pathToFileURL(path.join(__dirname, '..', 'public', 'colorrides', 'index.html')).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

// motion: false turns animations off; tick sets how fast the walking loop moves (ms per step).
async function open({ width = 390, height = 844, motion = false, tick = 15 } = {}) {
  const phone = width < 800;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, reducedMotion: motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(t => { window.__crTick = t; }, tick);
  await page.goto(URL);
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__colorrides())));
const idle = p => p.waitForFunction(() => !window.__colorridesBusy());
const rightCar = async p => { const s = await state(p); return s.cars.find(c => c.key === s.rider).id; };
const wrongCar = async p => { const s = await state(p); return s.cars.find(c => c.key !== s.rider).id; };
// Records every class name added to the page, so short animation pieces (sparks, smoke) are noticed even on a slow machine.
const watch = p => p.evaluate(() => { window.__seen = new Set(); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList && n.classList.forEach(c => window.__seen.add(c))))).observe(document.body, { childList: true, subtree: true }); });
const seen = p => p.evaluate(() => [...window.__seen]);

test('math: one passenger with a number; a wrong car explains and costs a heart; the right car picks them up', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  const s = await state(p);
  assert.equal(await p.textContent('#rider .pp b'), String(s.rider));
  assert.equal(await p.locator('.gcar').count(), s.cars.length);
  assert.equal(await p.locator('#hearts .gone').count(), 0);
  await p.click(`.gcar[data-id="${await wrongCar(p)}"]`);
  assert.match(await p.textContent('#msg'), new RegExp(`= \\d+\\. We need ${s.rider}!`));
  assert.equal(await p.locator('#hearts .gone').count(), 1);
  await p.click(`.gcar[data-id="${await rightCar(p)}"]`); await idle(p);
  const after = await state(p);
  assert.equal(after.served, 1);
  assert.equal(await p.textContent('#pnum'), '2');
  assert.equal(await p.textContent('#rider .pp b'), String(after.rider));
  await done(p);
});

test('math: picking every passenger completes the stage; Next stage goes on; best is saved', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=medium]');
  const riders = (await state(p)).riders;
  for (let i = 0; i < riders; i++) { await p.click(`.gcar[data-id="${await rightCar(p)}"]`); await idle(p); }
  await p.waitForSelector('.stagebanner');
  assert.match(await p.textContent('.stagebanner'), /Stage 1 complete!/);
  await p.click('#nextBtn');
  assert.equal(await p.textContent('#stage'), '2');
  assert.equal(await p.locator('.gcar').count(), (await state(p)).cars.length);
  await p.click('#menuBtn');
  assert.match(await p.textContent('[data-mode=medium]'), /Best: 1 stage/);
  await done(p);
});

test('math: 3 wrong cars show the animated game-over card; tapping starts again', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=hard]');
  for (let i = 0; i < 3; i++) await p.click(`.gcar[data-id="${await wrongCar(p)}"]`);
  await p.waitForSelector('#gameover.show');
  assert.match(await p.textContent('#goReason'), /3 wrong cars\. The last one was .* = \d+, but the passenger needed \d+\./);
  assert.equal(await p.textContent('#goStages'), '0');
  await p.waitForTimeout(1000);
  await p.click('#gameover');
  assert.ok(!(await p.isVisible('#gameover')));
  const s = await state(p);
  assert.equal(s.hearts, 3); assert.equal(s.stage, 1);
  await done(p);
});

test('math with animations on: the car drives to the passenger, they get in, it drives off with smoke', { skip }, async () => {
  const p = await open({ motion: true });
  await p.click('[data-mode=easy]');
  await p.waitForTimeout(600);
  await watch(p);
  await p.click(`.gcar[data-id="${await rightCar(p)}"]`);
  assert.ok(await p.evaluate(() => window.__colorridesBusy()));
  await idle(p);
  const pieces = await seen(p);
  assert.ok(pieces.includes('flyer'), 'the car drove to the passenger');
  assert.ok(pieces.includes('smoke'), 'it left a puff of smoke');
  assert.equal(await p.locator('.flyer').count(), 0, 'animation pieces are cleaned up');
  assert.equal((await state(p)).served, 1);
  await done(p);
});

test('colors: people walk round; tapping the cars in the planned order wins the stage', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=colors]');
  const s = await state(p);
  assert.ok(s.cars.length >= 14);
  assert.equal(await p.locator('.car').count(), s.cars.length);
  assert.equal(await p.locator('#slots > div').count(), 4);
  const pos = () => p.evaluate(() => [...document.querySelectorAll('#walkers .pp')].map(e => e.style.transform).join());
  const a = await pos(); await p.waitForTimeout(80);
  assert.notEqual(await pos(), a, 'people are moving round the loop');
  for (const id of s.order) {
    await p.waitForFunction(() => { const g = window.__colorrides(); return !g || g.slots.includes(null) || !document.querySelector('.car'); }, null, { timeout: 15000 });
    if (await p.locator('.stagebanner').count()) break;
    await p.click(`.car[data-id="${id}"]`);
  }
  await p.waitForSelector('.stagebanner', { timeout: 20000 });
  assert.match(await p.textContent('.stagebanner'), /Stage 1 complete!/);
  await p.click('#nextBtn');
  assert.equal(await p.textContent('#stage'), '2');
  await done(p);
});

test('colors: a blocked car shakes and stays; four spots full with nobody fitting is game over', { skip }, async () => {
  const p = await open({ tick: 40 });
  await p.click('[data-mode=colors]');
  const blocked = await p.evaluate(() => { const g = window.__colorrides();
    const occ = {}; g.cars.forEach(o => { const hor = o.dir === 'L' || o.dir === 'R'; for (let i = 0; i < o.len; i++) occ[hor ? (o.x + i) + ',' + o.y : o.x + ',' + (o.y + i)] = o.id; });
    return g.cars.find(c => { const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[c.dir]; let x = c.dir === 'R' ? c.x + c.len - 1 : c.x, y = c.dir === 'D' ? c.y + c.len - 1 : c.y;
      for (;;) { x += d[0]; y += d[1]; if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false; if (occ[x + ',' + y] !== undefined) return true; } }); });
  await p.click(`.car[data-id="${blocked.id}"]`);
  assert.match(await p.textContent('#msg'), /blocked/);
  assert.ok(!(await state(p)).cars[blocked.id].gone);
  // Fill all 4 spots with cars of a color nobody has.
  await p.evaluate(() => { const g = window.__colorrides(); g.slots = [0, 1, 2, 3].map(i => ({ id: 900 + i, key: 9, color: 0, seats: 4, filled: 0, at: 90 + i })); });
  await p.waitForSelector('#gameover.show', { timeout: 5000 });
  assert.match(await p.textContent('#goReason'), /All 4 parking spots were full/);
  assert.equal(await p.textContent('#goStages'), '0');
  await p.waitForTimeout(1000);
  await p.click('#gameover');
  assert.ok(!(await p.isVisible('#gameover')));
  assert.deepEqual((await state(p)).slots, [null, null, null, null]);
  await done(p);
});

test('both versions fit phone and desktop screens with no scrolling', { skip }, async () => {
  for (const [w, h] of [[375, 667], [390, 844], [1280, 800]]) {
    for (const mode of ['colors', 'easy']) {
      const p = await open({ width: w, height: h });
      const back = await p.locator('#menu .back').boundingBox(), logo = await p.locator('#menu .logo').boundingBox();
      assert.ok(logo.y >= 0 && back.y + back.height <= h, `whole menu on screen at ${w}x${h}`);
      await p.click(`[data-mode=${mode}]`);
      const r = await p.evaluate(m => {
        const box = document.getElementById(m === 'colors' ? 'lot' : 'garage').getBoundingClientRect(), msg = document.getElementById('msg').getBoundingClientRect();
        return { bw: box.width, bh: box.height, bottom: box.bottom, mb: msg.bottom, sw: document.documentElement.scrollWidth, cw: innerWidth };
      }, mode);
      assert.ok(r.mb <= h + 1, `message on screen (${mode} ${w}x${h})`);
      assert.ok(r.bw >= 240, `play area big enough (${mode} ${w}x${h}: ${r.bw})`);
      assert.equal(r.sw, r.cw);
      await done(p);
    }
  }
});

test('the game-over card is a real animation: it falls from the top and bounces, pieces tumble, letters pop in', { skip }, async () => {
  const p = await open({ motion: true });
  await p.click('[data-mode=hard]');
  await p.waitForTimeout(600);
  for (let i = 0; i < 3; i++) await p.click(`.gcar[data-id="${await wrongCar(p)}"]`);
  await p.waitForSelector('#gameover.show');
  const top = () => p.evaluate(() => document.querySelector('.go-card').getBoundingClientRect().top);
  // The card's animation starts it above the screen and lasts about a second.
  const drop = await p.evaluate(() => { const a = document.querySelector('.go-card').getAnimations()[0]; return a && { name: a.animationName, first: a.effect.getKeyframes()[0].transform, ms: a.effect.getTiming().duration }; });
  assert.equal(drop.name, 'goDrop');
  const startY = drop.first.match(/translateY\((-?[\d.]+)(px|vh)\)/);
  assert.ok(startY && (startY[2] === 'vh' ? +startY[1] <= -100 : +startY[1] <= -600), `starts well above the screen (${drop.first})`);
  assert.ok(drop.ms >= 1000, 'slow enough to see');
  assert.ok(await p.locator('.go-piece').count() > 10, 'game pieces tumble down');
  assert.equal(await p.locator('#goTitle span').count(), 9, '"Game over" pops in letter by letter');
  await p.waitForTimeout(1500);
  const landed = await top();
  assert.ok(landed > 100, `the card has landed (top ${landed})`);
  await done(p);
});

test('with Reduce Motion the game-over card just fades in, with no falling pieces', { skip }, async () => {
  const p = await open({ motion: false });
  await p.click('[data-mode=hard]');
  for (let i = 0; i < 3; i++) await p.click(`.gcar[data-id="${await wrongCar(p)}"]`);
  await p.waitForSelector('#gameover.show');
  assert.ok(await p.evaluate(() => document.querySelector('.go-card').getBoundingClientRect().top) > 100);
  assert.equal(await p.locator('.go-piece').count(), 0);
  await done(p);
});

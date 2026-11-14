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

async function open({ width = 390, height = 844 } = {}) {
  const phone = width < 800;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(URL);
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__colorrides())));
const idle = p => p.waitForFunction(() => !window.__colorridesBusy());

// Taps the cars in the known winning order.
async function solve(p) {
  const s = await state(p);
  for (const id of s.order) { await p.click(`.car[data-id="${id}"]`); await idle(p); }
}

for (const mode of ['colors', 'easy', 'hard']) {
  test(`${mode}: tapping the cars in the right order wins and unlocks level 2`, { skip }, async () => {
    const p = await open();
    await p.click(`[data-mode=${mode}]`);
    const s = await state(p);
    assert.equal(await p.locator('.car').count(), s.cars.length);
    assert.equal(await p.textContent('#waiting'), String(s.queue.length));
    if (mode !== 'colors') {
      // cars show their sum, people show answers
      const first = s.cars[0];
      assert.match(await p.textContent(`.car[data-id="${first.id}"]`), new RegExp(String(first.eq[0])));
      assert.equal(await p.textContent('#queue .pp b'), String(s.queue[0]));
    }
    await solve(p);
    await p.waitForFunction(() => document.getElementById('waiting').textContent === '0');
    assert.match(await p.textContent('#msg'), /Everyone got a ride/);
    await p.click('#nextBtn');
    assert.equal(await p.textContent('#level'), '2');
    await p.click('#menuBtn');
    assert.match(await p.textContent(`[data-mode=${mode}]`), /Level 2/);
    await done(p);
  });
}

test('a blocked car shakes and stays; a free car parks in a spot', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=colors]');
  const s = await state(p);
  const blocked = await p.evaluate(() => { const g = window.__colorrides(); return g.cars.find(c => { const occ = new Set(); g.cars.forEach(o => { if (o.id !== c.id) { const hor = o.dir === 'L' || o.dir === 'R'; for (let i = 0; i < o.len; i++) occ.add(hor ? (o.x + i) + ',' + o.y : o.x + ',' + (o.y + i)); } });
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[c.dir]; let x = c.dir === 'R' ? c.x + c.len - 1 : c.x, y = c.dir === 'D' ? c.y + c.len - 1 : c.y;
    for (;;) { x += d[0]; y += d[1]; if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false; if (occ.has(x + ',' + y)) return true; } }); });
  if (blocked) {
    await p.click(`.car[data-id="${blocked.id}"]`);
    assert.match(await p.textContent('#msg'), /blocked/);
    assert.ok(!(await state(p)).cars[blocked.id].gone);
  }
  await p.click(`.car[data-id="${s.order[0]}"]`); await idle(p);
  assert.ok((await state(p)).cars[s.order[0]].gone);
  await done(p);
});

test('with animations on, a car glides into a spot and people hop in; the game still wins', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(URL); p.ctx = ctx;
  await p.click('[data-mode=colors]');
  const s = await state(p);
  await p.click(`.car[data-id="${s.order[0]}"]`);
  await p.waitForSelector('.flyer');                       // the car is on its way to a spot
  assert.ok(await p.evaluate(() => window.__colorridesBusy()));
  await p.click(`.car[data-id="${s.order[1]}"]`);           // taps while busy are ignored
  await idle(p);
  const after = await state(p);
  assert.ok(after.cars[s.order[0]].gone);
  assert.ok(!after.cars[s.order[1]].gone, 'second tap during the animation was ignored');
  assert.equal(await p.locator('.flyer, .hopper').count(), 0, 'animation pieces are cleaned up');
  for (const id of s.order.slice(1)) { await p.click(`.car[data-id="${id}"]`); await idle(p); }
  assert.match(await p.textContent('#msg'), /Everyone got a ride/);
  await done(p);
});

test('fits phone and desktop screens with no scrolling', { skip }, async () => {
  for (const [w, h] of [[375, 667], [390, 844], [1280, 800]]) {
    const p = await open({ width: w, height: h });
    const back = await p.locator('#menu .back').boundingBox();
    const logo = await p.locator('#menu .logo').boundingBox();
    assert.ok(logo.y >= 0 && back.y + back.height <= h, `whole menu on screen at ${w}x${h}`);
    await p.click('[data-mode=medium]');
    const r = await p.evaluate(() => { const l = document.getElementById('lot').getBoundingClientRect(), m = document.getElementById('msg').getBoundingClientRect();
      return { lw: l.width, lh: l.height, lb: l.bottom, mb: m.bottom, sw: document.documentElement.scrollWidth, cw: innerWidth }; });
    assert.ok(r.mb <= h, `message on screen at ${w}x${h}`);
    assert.ok(Math.abs(r.lw - r.lh) < 2 && r.lw >= 240, 'car park is square and big enough');
    assert.equal(r.sw, r.cw);
    await done(p);
  }
});

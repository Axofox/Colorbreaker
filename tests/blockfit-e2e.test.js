// Browser tests for Block Fit. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const URL = pathToFileURL(path.join(__dirname, '..', 'public', 'blockfit', 'index.html')).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open({ width = 390, height = 844, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(URL);
  await page.click('#playBtn');
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__blockfit(), (k, v) => k === 'rand' ? undefined : v)));
const filled = s => s.board.flat().filter(Boolean).length;

// Drags tray slot i so the shape's top-left block lands on (r, c), using a mouse.
async function drag(p, i, r, c) {
  const slot = await p.locator(`.slot[data-i="${i}"]`).boundingBox();
  await p.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
  await p.mouse.down();
  const cell = await p.locator(`.cell[data-r="${r}"][data-c="${c}"]`).boundingBox();
  const cells = (await state(p)).tray[i].cells;
  const w = Math.max(...cells.map(q => q[1])) + 1, h = Math.max(...cells.map(q => q[0])) + 1;
  const pitch = (await p.locator('.cell[data-r="0"][data-c="1"]').boundingBox()).x - (await p.locator('.cell[data-r="0"][data-c="0"]').boundingBox()).x;
  const x = cell.x + w * pitch / 2, y = cell.y + h * pitch / 2;
  await p.mouse.move(x - 30, y - 30, { steps: 4 });
  await p.mouse.move(x, y, { steps: 4 });
  await p.mouse.up();
}

test('starts with an empty grid and three shapes, laid out like the other games', { skip }, async () => {
  const p = await open();
  assert.equal(await p.textContent('.top h2'), 'Block Fit');
  assert.match(await p.textContent('.scorebox'), /Score\s*0/);
  assert.equal(await p.locator('.cell').count(), 64);
  assert.equal(await p.locator('.slot[data-i]').count(), 3);
  assert.equal(filled(await state(p)), 0);
  await done(p);
});

test('dragging a shape onto the grid places it and scores', { skip }, async () => {
  const p = await open();
  const before = await state(p);
  await drag(p, 0, 2, 2);
  const after = await state(p);
  assert.equal(after.tray[0], null);
  assert.equal(filled(after), before.tray[0].cells.length);
  assert.equal(await p.textContent('#score'), String(after.score));
  for (const [dr, dc] of before.tray[0].cells) assert.ok(after.board[2 + dr][2 + dc]);
  assert.equal(await p.locator('.slot[data-i]').count(), 2);
  await done(p);
});

test('tap a shape then tap a square places it; a full row clears', { skip }, async () => {
  const p = await open({ touch: true });
  await p.evaluate(() => {
    const g = window.__blockfit();
    for (let c = 0; c < 6; c++) g.board[7][c] = 1;
    g.tray = [{ cells: [[0, 0], [0, 1]], color: 3 }, { cells: [[0, 0]], color: 2 }, { cells: [[0, 0]], color: 2 }];
  });
  await p.tap('.slot[data-i="0"]');
  await p.tap('.cell[data-r="7"][data-c="6"]');
  await p.waitForTimeout(400);
  const s = await state(p);
  assert.ok(s.board[7].every(v => !v), 'row cleared');
  assert.equal(s.score, 2 + 10);
  assert.match(await p.textContent('#msg'), /Line!/);
  await done(p);
});

test('game over shows the score and Play again starts fresh', { skip }, async () => {
  const p = await open();
  await p.evaluate(() => {
    const g = window.__blockfit();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board[r][c] = (r + c) % 2 ? 1 : 0;
    g.board[0][0] = 0; g.board[0][2] = 0;
    g.tray = [{ cells: [[0, 0]], color: 1 }, { cells: [[0, 0], [0, 1]], color: 1 }, null];
  });
  await drag(p, 0, 0, 0);
  assert.ok(await p.isVisible('#againBtn'));
  assert.match(await p.textContent('#msg'), /No more room/);
  await p.click('#againBtn');
  assert.ok(!(await p.isVisible('#againBtn')));
  assert.equal(filled(await state(p)), 0);
  await p.click('#menuBtn');
  assert.match(await p.textContent('#best'), /Best score: \d+/);
  await done(p);
});

test('fits phone and desktop screens with no scrolling', { skip }, async () => {
  for (const [w, h] of [[375, 667], [390, 844], [1280, 800]]) {
    const p = await open({ width: w, height: h, touch: w < 800 });
    const r = await p.evaluate(() => { const t = document.getElementById('tray').getBoundingClientRect(), b = document.getElementById('grid').getBoundingClientRect();
      return { trayBottom: t.bottom, bw: b.width, bh: b.height, right: b.right, sw: document.documentElement.scrollWidth, cw: innerWidth }; });
    assert.ok(r.trayBottom <= h, `shapes on screen at ${w}x${h}`);
    assert.ok(Math.abs(r.bw - r.bh) < 2, 'grid is square');
    assert.ok(r.bw >= 250, 'grid is big enough to play');
    assert.equal(r.sw, r.cw);
    await done(p);
  }
});

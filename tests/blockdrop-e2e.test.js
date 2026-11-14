// Browser tests for Block Drop. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const URL = pathToFileURL(path.join(__dirname, '..', 'public', 'blockdrop', 'index.html')).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open({ width = 390, height = 844, touch = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(URL);
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const piece = p => p.evaluate(() => { const g = window.__blockdrop(); return { x: g.piece.x, y: g.piece.y, over: g.over }; });

test('play opens the board; buttons move the piece', { skip }, async () => {
  const p = await open();
  await p.click('#playBtn');
  assert.ok(await p.isVisible('#well'));
  await p.click('#pauseBtn'); // freeze gravity so positions are predictable
  await p.click('#ovBtn');
  const a = await piece(p);
  await p.click('[data-act=left]');
  assert.equal((await piece(p)).x, a.x - 1);
  await p.click('[data-act=right]'); await p.click('[data-act=right]');
  assert.equal((await piece(p)).x, a.x + 1);
  await done(p);
});

test('the whole board fits on a phone screen with no page scroll', { skip }, async () => {
  for (const [w, h] of [[375, 667], [390, 844], [1280, 800]]) {
    const p = await open({ width: w, height: h, touch: w < 800 });
    await p.click('#playBtn');
    const r = await p.evaluate(() => { const b = document.getElementById('well').getBoundingClientRect(), pad = document.querySelector('.pad').getBoundingClientRect();
      return { bottom: pad.bottom, wellBottom: b.bottom, right: b.right, sw: document.documentElement.scrollWidth, cw: innerWidth, ratio: b.height / b.width }; });
    assert.ok(r.bottom <= h, `controls on screen at ${w}x${h}`);
    assert.ok(r.wellBottom <= h && r.right <= w);
    assert.equal(r.sw, r.cw, 'no sideways scroll');
    assert.ok(Math.abs(r.ratio - 2) < 0.05, 'board is 10 by 20');
    await done(p);
  }
});

test('keyboard: space drops the piece, and dropping repeatedly ends the game', { skip }, async () => {
  const p = await open({ width: 1280, height: 800, touch: false });
  await p.click('#playBtn');
  for (let i = 0; i < 60 && !(await piece(p)).over; i++) await p.keyboard.press(' ');
  assert.ok((await piece(p)).over);
  assert.ok(await p.isVisible('#overlay'));
  assert.equal(await p.textContent('#ovBtn'), 'Play again');
  await p.click('#ovBtn');
  assert.ok(!(await piece(p)).over);
  await p.click('#menuBtn');
  assert.match(await p.textContent('#best'), /Best score: \d+/);
  await done(p);
});

test('P pauses and gravity stops while paused', { skip }, async () => {
  const p = await open({ width: 1280, height: 800, touch: false });
  await p.click('#playBtn');
  await p.keyboard.press('p');
  assert.equal(await p.textContent('#ovTitle'), 'Paused');
  const a = await piece(p);
  await p.waitForTimeout(1200);
  assert.equal((await piece(p)).y, a.y);
  await p.keyboard.press('p');
  await p.waitForTimeout(1200);
  assert.ok((await piece(p)).y > a.y);
  await done(p);
});

// Browser tests for Mahjong Pairs. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const URL = pathToFileURL(path.join(__dirname, '..', 'public', 'mahjong', 'index.html')).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open({ width = 390, height = 844, motion = false } = {}) {
  const phone = width < 800;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, reducedMotion: motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(URL);
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__mahjong())));
const idle = p => p.waitForFunction(() => !window.__mahjongBusy());
const tap = async (p, id) => { await p.click(`#stack .tile[data-id="${id}"]`); await idle(p); };

test('menu and board: tiles, an empty tray of 4, helpers with counts', { skip }, async () => {
  const p = await open();
  await p.click('#playBtn');
  const s = await state(p);
  assert.equal(await p.locator('#stack .tile').count(), 24);
  assert.equal(await p.locator('#tray .tslot').count(), 4);
  assert.equal(await p.locator('#stack .tile.covered').count(), s.tiles.filter(t => s.tiles.some(u => u.z > t.z && Math.abs(u.x - t.x) < 2 && Math.abs(u.y - t.y) < 2)).length);
  assert.equal(await p.textContent('#shuffleN'), '1');
  assert.equal(await p.textContent('#hintN'), '2');
  assert.equal(await p.textContent('#undoN'), '3');
  await done(p);
});

test('a pair pops out of the tray; clearing every tile completes the stage; best is saved', { skip }, async () => {
  const p = await open();
  await p.click('#playBtn');
  const s = await state(p);
  await tap(p, s.solution[0]);
  assert.equal(await p.locator('#tray .tile').count(), 1);
  await tap(p, s.solution[1]);
  assert.equal(await p.locator('#tray .tile').count(), 0, 'the pair popped');
  for (const id of s.solution.slice(2)) await tap(p, id);
  await p.waitForSelector('.stagebanner');
  assert.match(await p.textContent('.stagebanner'), /Stage 1 complete!/);
  await p.click('#nextBtn');
  assert.equal(await p.textContent('#stage'), '2');
  assert.equal(await p.locator('#stack .tile').count(), 36);
  await p.click('#menuBtn');
  assert.match(await p.textContent('#playBtn'), /Best: 1 stage/);
  await done(p);
});

test('a covered tile shakes and stays; hint lights tiles; undo takes a tile back', { skip }, async () => {
  const p = await open();
  await p.click('#playBtn');
  const s = await state(p);
  const covered = s.tiles.find(t => s.tiles.some(u => u.z > t.z && Math.abs(u.x - t.x) < 2 && Math.abs(u.y - t.y) < 2));
  await p.click(`#stack .tile[data-id="${covered.id}"]`, { force: true });
  assert.match(await p.textContent('#msg'), /covered/);
  await tap(p, s.solution[0]);
  await p.click('#hintBtn');
  assert.equal(await p.locator('#stack .tile.hint').count(), 1, 'the hint shows the matching tile');
  assert.equal(await p.textContent('#hintN'), '1');
  await p.click('#undoBtn');
  assert.equal(await p.locator('#tray .tile').count(), 0);
  assert.equal(await p.locator('#stack .tile').count(), 24);
  assert.equal(await p.textContent('#undoN'), '2');
  await done(p);
});

test('four different tiles fill the tray: the animated game-over card; tapping starts again', { skip }, async () => {
  const p = await open();
  await p.click('#playBtn');
  // Four times: give a free tile a picture nobody in the tray has, then tap it.
  for (let i = 0; i < 4; i++) {
    const id = await p.evaluate(i => {
      const g = window.__mahjong(), free = g.tiles.filter(t => !t.gone && !g.tiles.some(u => !u.gone && u.z > t.z && Math.abs(u.x - t.x) < 2 && Math.abs(u.y - t.y) < 2));
      free[0].sym = 12 + i; return free[0].id;
    }, i);
    await p.click(`#stack .tile[data-id="${id}"]`);
    await p.waitForFunction(n => window.__mahjong().tray.length === n, i + 1);   // the game stays busy once it's over
    if (i < 3) await idle(p);
  }
  await p.waitForSelector('#gameover.show');
  assert.match(await p.textContent('#goReason'), /The tray was full: 4 different tiles and no pair\./);
  assert.equal(await p.textContent('#goStages'), '0');
  await p.waitForTimeout(1000);
  await p.click('#gameover');
  assert.equal((await state(p)).tray.length, 0);
  assert.equal(await p.textContent('#stage'), '1');
  await done(p);
});

test('with animations on: the tile flies to the tray and a pair pops with sparkles', { skip }, async () => {
  const p = await open({ motion: true });
  await p.click('#playBtn');
  await p.waitForTimeout(1500);
  const s = await state(p);
  await p.click(`#stack .tile[data-id="${s.solution[0]}"]`);
  await p.waitForSelector('.flyer');
  await idle(p);
  await p.click(`#stack .tile[data-id="${s.solution[1]}"]`);
  await p.waitForSelector('.spark');
  await idle(p);
  assert.equal(await p.locator('#tray .tile').count(), 0);
  assert.equal(await p.locator('.flyer').count(), 0, 'animation pieces are cleaned up');
  await done(p);
});

test('every stage size fits phone, tablet and desktop screens with no scrolling', { skip }, async () => {
  for (const [w, h] of [[375, 667], [390, 844], [1180, 820], [1280, 800]]) {
    const p = await open({ width: w, height: h });
    await p.click('#playBtn');
    for (const stage of [1, 3, 5]) {
      await p.evaluate(st => window.__mahjongStart(st), stage);
      const r = await p.evaluate(() => {
        const tiles = [...document.querySelectorAll('#stack .tile')].map(t => t.getBoundingClientRect());
        const tools = document.querySelector('.tools').getBoundingClientRect(), tray = document.getElementById('tray').getBoundingClientRect();
        return { top: Math.min(...tiles.map(t => t.top)), bottom: Math.max(...tiles.map(t => t.bottom)), left: Math.min(...tiles.map(t => t.left)), right: Math.max(...tiles.map(t => t.right)),
          tw: tiles[0].width, toolsTop: tools.top, toolsBottom: tools.bottom, trayBottom: tray.bottom, sw: document.documentElement.scrollWidth, cw: innerWidth };
      });
      assert.ok(r.top >= r.trayBottom - 1 && r.bottom <= r.toolsTop + 1, `stage ${stage} tiles between tray and tools at ${w}x${h}`);
      assert.ok(r.left >= 0 && r.right <= w, `stage ${stage} tiles inside the screen at ${w}x${h}`);
      assert.ok(r.toolsBottom <= h, `helpers on screen at ${w}x${h}`);
      assert.ok(r.tw >= 30, `tiles big enough to tap (${r.tw}px) at stage ${stage}, ${w}x${h}`);
      assert.equal(r.sw, r.cw);
    }
    await done(p);
  }
});

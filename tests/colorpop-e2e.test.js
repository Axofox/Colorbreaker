// Browser tests for Color Pop. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const url = pathToFileURL(path.join(__dirname, '..', 'public', 'colorpop', 'index.html')).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open({ width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(url);
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__colorpop())));
const sq = (p, x, y) => p.locator(`.sq:not(.gone)[data-x="${x}"][data-y="${y}"]`);
const idle = p => p.waitForFunction(() => !window.__colorpop().busy);

// Plays the board's own plan to the end by tapping squares.
async function playPlan(p) {
  const { plan } = await state(p);
  for (const step of plan) { await sq(p, ...step.cell).click(); await idle(p); }
}

test('menu shows both levels and links back to all games', { skip }, async () => {
  const p = await open();
  assert.equal(await p.title(), 'Color Pop');
  assert.equal(await p.locator('[data-mode]').count(), 2);
  assert.equal(await p.getAttribute('a.back', 'href'), '../index.html');
  await done(p);
});

for (const [mode, w, h] of [['easy', 6, 8], ['hard', 8, 12]]) {
  test(`${mode}: the full board fits on a phone with no scrolling`, { skip }, async () => {
    const p = await open({ width: 360, height: 640 });
    await p.click(`[data-mode=${mode}]`);
    assert.equal(await p.locator('.sq').count(), w * h);
    const box = await p.locator('.board').boundingBox(), field = await p.locator('#field').boundingBox();
    assert.ok(field.width <= box.width && field.height <= box.height, 'board fits');
    const scroll = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]);
    assert.ok(scroll[0] <= scroll[1] && scroll[2] <= scroll[3], 'no page scroll');
    await done(p);
  });
}

test('a single square does not pop', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  const lone = await p.evaluate(() => {
    const { cols } = window.__colorpop();
    for (let x = 0; x < cols.length; x++) for (let y = 0; y < cols[x].length; y++) {
      const c = cols[x][y], n = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      if (!n.some(([a, b]) => cols[a] && cols[a][b] === c)) return [x, y];
    }
  });
  if (!lone) { await p.ctx.close(); return; } // rare: every square has a partner
  await sq(p, ...lone).click();
  assert.equal(await p.locator('.sq').count(), 48);
  assert.equal(await p.textContent('#score'), '0');
  assert.match(await p.textContent('#msg'), /on its own can't pop/);
  await done(p);
});

test('popping a pair scores and makes the squares above fall', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  const first = (await state(p)).plan[0].cell;
  await sq(p, ...first).click(); await idle(p);
  const s = await state(p);
  assert.ok(+(await p.textContent('#score')) >= 2);
  assert.equal(+(await p.textContent('#left')), s.cols.flat().length);
  assert.ok(s.cols.flat().length < 48);
  await done(p);
});

test('clearing the board gives the bonus, explodes, and saves the high score', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await playPlan(p);
  const s = await state(p);
  assert.equal(s.cols.length, 0);
  assert.ok(s.over);
  assert.match(await p.textContent('#msg'), /cleared the board! \+500 bonus/);
  assert.ok(s.score > 500);
  // the explosion is drawing on the canvas
  await p.waitForTimeout(150);
  const lit = await p.evaluate(() => { const c = document.getElementById('boom'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert.ok(lit > 500, 'explosion pieces are on screen');
  assert.ok(await p.isVisible('#again'));
  assert.ok(await p.isDisabled('#hint'));
  assert.equal(await p.evaluate(() => localStorage.getItem('cp-best-easy')), String(s.score));
  await p.click('#menuBtn');
  assert.match(await p.textContent('#best'), new RegExp(`Easy ${s.score}.*Boards cleared 1`));
  // still saved after a reload
  await p.reload();
  assert.match(await p.textContent('#best'), new RegExp(`Easy ${s.score}`));
  await done(p);
});

test('hints: 2 per board, and following them clears the board', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=hard]');
  for (const left of ['1', '0']) {
    await p.click('#hint');
    assert.equal(await p.textContent('#hints'), left);
    const lit = p.locator('.sq.hint');
    assert.ok(await lit.count() >= 2, 'a whole group lights up');
    assert.match(await p.textContent('#msg'), /Hint/);
    await lit.first().click(); await idle(p);
    assert.equal(await p.locator('.sq.hint').count(), 0);
  }
  assert.ok(await p.isDisabled('#hint'));
  await playPlan2(p);
  assert.equal((await state(p)).cols.length, 0, 'still clearable after following hints');
  await p.click('#again');
  assert.equal(await p.textContent('#hints'), '2');
  assert.equal(await p.textContent('#score'), '0');
  await done(p);
});
// Continues the plan from wherever the board is now (after following hints, it is still on the plan).
async function playPlan2(p) {
  const { plan, cols } = await state(p);
  const k = cols.map(c => c.join('')).join('|');
  for (const step of plan.slice(plan.findIndex(s => s.board === k))) { await sq(p, ...step.cell).click(); await idle(p); }
}

test('hint off the plan still finds a way, or shows the biggest group', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  // pop some group that is not the planned first move
  const off = await p.evaluate(() => {
    const s = window.__colorpop(), first = s.plan[0].cell, cols = s.cols;
    for (let x = 0; x < cols.length; x++) for (let y = 0; y < cols[x].length; y++) {
      const n = [[x + 1, y], [x, y + 1]];
      if (n.some(([a, b]) => cols[a] && cols[a][b] === cols[x][y]) && !(x === first[0] && y === first[1])) return [x, y];
    }
  });
  await sq(p, ...off).click(); await idle(p);
  if ((await state(p)).over) { await p.ctx.close(); return; }
  await p.click('#hint');
  assert.ok(await p.locator('.sq.hint').count() >= 2);
  await done(p);
});

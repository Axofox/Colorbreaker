// Browser tests for Number Cross and the games menu. Skipped if Playwright isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const url = (...p) => pathToFileURL(path.join(__dirname, '..', 'public', ...p)).href;

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(file = ['numbercross', 'index.html'], { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(url(...file));
  page.ctx = ctx;
  return page;
}
const done = async p => { assert.deepEqual(p.errors, []); await p.ctx.close(); };
const state = p => p.evaluate(() => { const s = window.__numbercross(); return { sel: s.sel, answer: s.sel >= 0 ? s.puzzle.cells[s.sel].v : null, tiles: s.tiles.map((t, i) => ({ i, v: t.v, used: t.used })), cells: JSON.stringify(s.puzzle.cells.map(c => c.v)), blanks: s.puzzle.cells.filter(c => c.blank).length }; });
const right = async p => { const s = await state(p); await p.click(`.tile[data-t="${s.tiles.find(t => !t.used && t.v === s.answer).i}"]`); };
// Clicks a wrong tile; returns false if this puzzle has no wrong tile for the selected box.
const wrong = async p => { const s = await state(p); const t = s.tiles.find(t => !t.used && t.v !== s.answer); if (!t) return false; await p.click(`.tile[data-t="${t.i}"]`); return true; };
// Starts a level and makes sure the selected box has at least one wrong tile available.
async function startWithWrongTile(p, level) {
  await p.click(`[data-level=${level}]`);
  for (let i = 0; i < 30; i++) {
    const s = await state(p);
    if (s.tiles.some(t => t.v !== s.answer)) return;
    await p.click('#menuBtn'); await p.click(`[data-level=${level}]`);
  }
  throw new Error('no puzzle with a wrong tile');
}

test('games menu links to both games', { skip }, async () => {
  const p = await open(['index.html']);
  const links = await p.$$eval('a.game', as => as.map(a => a.getAttribute('href')));
  assert.deepEqual(links, ['colorbreaker/index.html', 'numbercross/index.html']);
  await p.click('a.game >> nth=1');
  assert.equal(await p.title(), 'Number Cross');
  await p.click('a.back');
  assert.equal(await p.title(), 'Games');
  await p.click('a.game >> nth=0');
  assert.equal(await p.title(), 'Color Breaker');
  await p.click('#allGames');
  assert.equal(await p.title(), 'Games');
  await done(p);
});

for (const level of ['easy', 'medium', 'hard']) {
  test(`${level}: can be solved with the right numbers`, { skip }, async () => {
    const p = await open();
    await p.click(`[data-level=${level}]`);
    const n = (await state(p)).blanks;
    assert.equal(await p.locator('.tile').count(), n);
    assert.equal(await p.locator('.c.blank').count(), n);
    for (let i = 0; i < n; i++) await right(p);
    assert.match(await p.textContent('#msg'), /Great job/);
    assert.equal(await p.textContent('#solved'), '1');
    assert.equal(await p.textContent('#tries'), '3');
    assert.equal(await p.locator('.tile').count(), 0);
    assert.equal(await p.locator('.c.blank').count(), 0);
    assert.ok(await p.isVisible('#next'));
    await p.click('#next');
    assert.ok((await p.locator('.c.blank').count()) >= 2);
    assert.ok(!(await p.isVisible('#next')));
    await p.click('#menuBtn');
    assert.match(await p.textContent('#best'), /1/);
    await done(p);
  });
}

test('a wrong number costs a try and the box stays empty', { skip }, async () => {
  const p = await open();
  await startWithWrongTile(p, 'easy');
  const before = await p.locator('.tile').count();
  assert.ok(await wrong(p));
  assert.equal(await p.textContent('#tries'), '2');
  assert.match(await p.textContent('#msg'), /Try again! 2 tries left/);
  assert.equal(await p.locator('.tile').count(), before, 'the tile goes back');
  assert.equal(await p.locator('#dots .dot.used').count(), 1);
  await p.waitForTimeout(900);
  assert.equal(await p.locator('.c.blank').count(), before);
  await done(p);
});

test('three wrong numbers load a new puzzle with 3 tries and 2 hints again', { skip }, async () => {
  const p = await open();
  await startWithWrongTile(p, 'medium');
  const first = (await state(p)).cells;
  await p.click('#hint');
  for (let i = 0; i < 3; i++) {
    const s = await state(p);
    if (!s.tiles.some(t => !t.used && t.v !== s.answer)) { await p.ctx.close(); return; } // rare: no wrong tile left
    await wrong(p);
  }
  assert.match(await p.textContent('#msg'), /3 wrong tries/);
  assert.equal(await p.textContent('#tries'), '0');
  assert.ok(await p.locator('.tile').first().isDisabled(), 'no more guessing while waiting');
  await p.waitForFunction(() => document.getElementById('tries').textContent === '3', null, { timeout: 5000 });
  assert.notEqual((await state(p)).cells, first, 'the puzzle changed');
  assert.equal(await p.textContent('#hints'), '2');
  assert.equal(await p.textContent('#solved'), '0');
  await done(p);
});

test('hints: fill the selected box correctly, 2 per puzzle', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=hard]');
  const n = (await state(p)).blanks;
  await p.click('#hint');
  assert.equal(await p.textContent('#hints'), '1');
  assert.equal(await p.locator('.c.done').count(), 1);
  assert.equal(await p.locator('.tile').count(), n - 1);
  assert.equal(await p.textContent('#tries'), '3', 'a hint is not a wrong try');
  await p.click('#hint');
  assert.equal(await p.textContent('#hints'), '0');
  assert.ok(await p.isDisabled('#hint'));
  await done(p);
});

// Drags from the middle of one element to the middle of another with real pointer events.
async function dragTo(p, from, to) {
  const a = await from.boundingBox(), b = to ? await to.boundingBox() : { x: 5, y: 5, width: 2, height: 2 };
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 - 12, { steps: 2 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await p.mouse.up();
}

test('drag and drop: the right number dropped on a box stays there', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=medium]');
  const s = await state(p), n = s.blanks;
  // drop on the LAST empty box, not the selected one, to prove the drop target is what counts
  const lastIdx = await p.locator('.c.blank').last().getAttribute('data-i');
  const answer = await p.evaluate(i => window.__numbercross().puzzle.cells[i].v, +lastIdx);
  const ti = s.tiles.find(t => t.v === answer).i;
  await dragTo(p, p.locator(`.tile[data-t="${ti}"]`), p.locator(`.c.blank[data-i="${lastIdx}"]`));
  assert.equal(await p.locator('.c.done').count(), 1);
  assert.equal(await p.locator(`.c.done[data-f="${lastIdx}"]`).count(), 1);
  assert.equal(await p.locator('.tile').count(), n - 1);
  assert.equal(await p.textContent('#tries'), '3');
  assert.equal(await p.locator('.dragcopy').count(), 0, 'the dragged copy is gone');
  await done(p);
});

test('drag and drop: a wrong number costs a try and goes back', { skip }, async () => {
  const p = await open();
  await startWithWrongTile(p, 'easy');
  const s = await state(p), n = s.blanks;
  const t = s.tiles.find(t => t.v !== s.answer);
  await dragTo(p, p.locator(`.tile[data-t="${t.i}"]`), p.locator('.c.blank.sel'));
  assert.equal(await p.textContent('#tries'), '2');
  assert.equal(await p.locator('.tile').count(), n);
  await done(p);
});

test('drag and drop: dropping a number outside any box changes nothing', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=easy]');
  const n = (await state(p)).blanks;
  await dragTo(p, p.locator('.tile').first(), null);
  assert.equal(await p.textContent('#tries'), '3');
  assert.equal(await p.locator('.tile').count(), n);
  assert.equal(await p.locator('.c.blank').count(), n);
  await done(p);
});

test('take back: tapping a placed number returns it and it can be placed again', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=medium]');
  const n = (await state(p)).blanks;
  await right(p);
  assert.equal(await p.locator('.tile').count(), n - 1);
  await p.click('button.c.done');
  assert.equal(await p.locator('.tile').count(), n);
  assert.equal(await p.locator('.c.done').count(), 0);
  assert.equal(await p.locator('.c.blank').count(), n);
  assert.match(await p.textContent('#msg'), /is back/);
  assert.equal(await p.textContent('#tries'), '3');
  for (let i = 0; i < n; i++) await right(p);
  assert.match(await p.textContent('#msg'), /Great job/);
  assert.equal(await p.locator('button.c.done').count(), 0, 'nothing can be taken back after winning');
  await done(p);
});

test('take back: dragging a placed number away returns it', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=medium]');
  const n = (await state(p)).blanks;
  await right(p);
  await dragTo(p, p.locator('button.c.done'), p.locator('#tray'));
  assert.equal(await p.locator('.tile').count(), n);
  assert.equal(await p.locator('.c.done').count(), 0);
  assert.equal(await p.textContent('#tries'), '3');
  await done(p);
});

test('tapping another empty box selects it', { skip }, async () => {
  const p = await open();
  await p.click('[data-level=medium]');
  const boxes = p.locator('.c.blank');
  await boxes.nth(1).click();
  assert.ok(await boxes.nth(1).evaluate(e => e.classList.contains('sel')));
  assert.equal(await p.locator('.c.blank.sel').count(), 1);
  await right(p);
  assert.equal(await p.locator('.c.done').count(), 1);
  await done(p);
});

for (const [w, h] of [[360, 640], [375, 667], [390, 844], [412, 915]]) {
  test(`no scrolling or clipping at ${w}x${h} on every level`, { skip }, async () => {
    const p = await open(undefined, { width: w, height: h });
    for (const level of ['easy', 'medium', 'hard']) {
      for (let round = 0; round < 6; round++) {
        await p.click(`[data-level=${level}]`);
        const m = await p.evaluate(() => {
          const b = document.querySelector('.board'), g = document.getElementById('grid'), s = document.getElementById('game');
          return { page: document.documentElement.scrollHeight - innerHeight, screen: s.scrollHeight - s.clientHeight,
            gw: g.offsetWidth - b.clientWidth, gh: g.offsetHeight - b.clientHeight, cell: g.querySelector('.c').offsetWidth };
        });
        assert.ok(m.page <= 0 && m.screen <= 0 && m.gw <= 0 && m.gh <= 0, `${level}: ${JSON.stringify(m)}`);
        assert.ok(m.cell >= 30, `boxes too small to tap: ${m.cell}px`);
        await p.click('#menuBtn');
      }
    }
    await done(p);
  });
}

test('sideways phone shows the rotate message', { skip }, async () => {
  const p = await open(undefined, { width: 844, height: 390 });
  assert.ok(await p.isVisible('#rotate'));
  assert.ok(!(await p.isVisible('#menu')));
  await done(p);
});

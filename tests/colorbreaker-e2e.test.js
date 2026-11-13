// End-to-end tests: drive public/index.html in a real (headless) Chromium.
// Needs Playwright (`require('playwright')`); the whole file is skipped if it isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* skipped below */ }
const URL = pathToFileURL(path.join(__dirname, '..', 'public', 'colorbreaker', 'index.html')).href;
const skip = chromium ? false : 'playwright is not installed';

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

// Opens a fresh page (fresh storage). With `fixed`, Math.random is pinned to 0, so the secret is
// predictable: Easy = colors [0,1,2,3] (white, pink, yellow, green); Hard = [0,0,0,0,0].
async function open({ width = 390, height = 844, touch = true, fixed = true, rows } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (fixed) await page.addInitScript(() => { Math.random = () => 0; });
  if (rows) await page.addInitScript(r => { for (const k in r) localStorage.setItem('cb-rows-' + k, r[k]); }, rows);
  await page.goto(URL);
  page.ctx = ctx;
  return page;
}
const done = async page => { assert.deepEqual(page.errors, [], 'no JavaScript errors'); await page.ctx.close(); };
const guess = async (page, colors) => { for (const c of colors) await page.click(`#tray button[data-c="${c}"]`); await page.click('#check'); };
const text = (page, sel) => page.textContent(sel);
const count = (page, sel) => page.locator(sel).count();

test('menu: shows Easy, Hard and Settings, and the game is hidden', { skip }, async () => {
  const p = await open();
  assert.ok(await p.isVisible('[data-mode=easy]'));
  assert.ok(await p.isVisible('[data-mode=hard]'));
  assert.ok(await p.isVisible('#settingsBtn'));
  assert.ok(!(await p.isVisible('#game')));
  await done(p);
});

test('easy: 4 holes, 8 rows, 6 colors in the tray', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  assert.equal(await count(p, '#tray button'), 6);
  assert.equal(await count(p, '.row:not(.secretrow)'), 8);
  assert.equal(await count(p, '.row.active .hole'), 4);
  assert.equal(await text(p, '#modeName'), 'Easy');
  await done(p);
});

test('hard: 5 holes, 10 rows', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=hard]');
  assert.equal(await count(p, '.row:not(.secretrow)'), 10);
  assert.equal(await count(p, '.row.active .hole'), 5);
  assert.equal(await text(p, '#modeName'), 'Hard');
  await done(p);
});

test('check stays disabled until every hole is filled', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  assert.ok(await p.isDisabled('#check'));
  for (const c of [0, 1, 2]) await p.click(`#tray button[data-c="${c}"]`);
  assert.ok(await p.isDisabled('#check'));
  await p.click('#tray button[data-c="3"]');
  assert.ok(await p.isEnabled('#check'));
  await done(p);
});

test('colors fill the holes left to right and the selected hole advances', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await p.click('#tray button[data-c="4"]');
  await p.click('#tray button[data-c="5"]');
  assert.equal(await count(p, '.row.active .marble'), 2);
  const label = i => p.locator('.row.active .hole').nth(i).getAttribute('aria-label');
  assert.match(await label(0), /red/);
  assert.match(await label(1), /blue/);
  assert.match(await label(2), /empty/);
  assert.ok(await p.locator('.row.active .hole').nth(2).evaluate(e => e.classList.contains('sel')));
  await done(p);
});

test('tapping a filled hole clears it and the next color goes there', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await guessless(p, [0, 1, 2]);
  await p.locator('.row.active .hole').nth(1).click();
  assert.equal(await count(p, '.row.active .marble'), 2);
  await p.click('#tray button[data-c="5"]');
  assert.match(await p.locator('.row.active .hole').nth(1).getAttribute('aria-label'), /blue/);
  await done(p);
});
async function guessless(page, colors) { for (const c of colors) await page.click(`#tray button[data-c="${c}"]`); }

test('clues: black = right hole, white = right color wrong hole', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await guess(p, [0, 1, 3, 2]); // secret is 0,1,2,3
  const firstRow = p.locator('.row:not(.secretrow)').last();
  assert.equal(await firstRow.locator('.hp.black').count(), 2);
  assert.equal(await firstRow.locator('.hp.white').count(), 2);
  assert.match(await text(p, '#msg'), /2 black, 2 white/);
  assert.equal(await count(p, '.row.active .marble'), 0, 'next row starts empty');
  await done(p);
});

test('winning: message, points and best score', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await guess(p, [0, 1, 2, 3]);
  assert.match(await text(p, '#msg'), /cracked it in 1 try! \+80 points/);
  assert.equal(await text(p, '#score'), '80');
  assert.equal(await text(p, '#check'), 'Play again');
  assert.equal(await count(p, '.secretrow .marble'), 4, 'secret code is revealed');
  assert.equal(await count(p, '.row.active'), 0, 'no row is active after the game');
  assert.equal(await count(p, 'button.hole'), 0, 'holes can no longer be changed');
  await p.click('#menuBtn');
  assert.match(await text(p, '#best'), /Easy 80/);
  await done(p);
});

test('winning on the last try still counts as a win', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  for (let i = 0; i < 7; i++) await guess(p, [5, 5, 5, 5]);
  await guess(p, [0, 1, 2, 3]);
  assert.match(await text(p, '#msg'), /cracked it in 8 tries/);
  await done(p);
});

test('losing: reveals the secret and offers Play again', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  for (let i = 0; i < 8; i++) await guess(p, [5, 5, 5, 5]);
  assert.match(await text(p, '#msg'), /Out of tries/);
  assert.equal(await count(p, '.secretrow .marble'), 4);
  assert.equal(await text(p, '#check'), 'Play again');
  assert.equal(await text(p, '#score'), '0');
  await done(p);
});

test('play again starts a clean game and keeps the running score', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await guess(p, [0, 1, 2, 3]);
  await p.click('#check'); // "Play again"
  assert.equal(await count(p, '.row.active .marble'), 0);
  assert.equal(await count(p, '.secretrow .marble'), 0);
  assert.equal(await text(p, '#check'), 'Check');
  assert.equal(await text(p, '#score'), '80');
  await guess(p, [0, 1, 2, 3]);
  assert.equal(await text(p, '#score'), '160');
  await done(p);
});

test('hard mode: 5-hole code can be cracked with repeated colors', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=hard]');
  await guess(p, [0, 0, 0, 0, 1]); // secret is five whites: four black, the pink does not match
  assert.equal(await p.locator('.row:not(.secretrow)').last().locator('.hp.black').count(), 4);
  await guess(p, [0, 0, 0, 0, 0]);
  assert.match(await text(p, '#msg'), /cracked it in 2 tries/);
  await done(p);
});

test('hints: reveal one hole each, cost points, stop at zero', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  assert.equal(await text(p, '#bulbs'), '2');
  await p.click('#bulb');
  assert.match(await text(p, '#msg'), /Hint: hole \d is (white|pink|yellow|green)\./);
  assert.equal(await count(p, '.secretrow .marble'), 1);
  assert.equal(await text(p, '#bulbs'), '1');
  await p.click('#bulb');
  assert.equal(await count(p, '.secretrow .marble'), 2);
  assert.equal(await text(p, '#bulbs'), '0');
  assert.ok(await p.isDisabled('#bulb'));
  await guess(p, [0, 1, 2, 3]);
  assert.match(await text(p, '#msg'), /\+70 points/, 'two hints cost 10 points');
  await done(p);
});

test('hint reveals a color that really is in that hole', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await p.click('#bulb');
  const msg = await text(p, '#msg');
  const hole = +msg.match(/hole (\d)/)[1];
  const color = msg.match(/is (\w+)\./)[1];
  assert.equal(color, ['white', 'pink', 'yellow', 'green'][hole - 1]);
  await done(p);
});

test('menu button returns to the menu; a new game can be started', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await p.click('#menuBtn');
  assert.ok(await p.isVisible('[data-mode=hard]'));
  assert.ok(!(await p.isVisible('#game')));
  await p.click('[data-mode=hard]');
  assert.equal(await count(p, '.row.active .hole'), 5);
  await done(p);
});

test('settings: rows go up and down, stay within 4 to 12, and are remembered', { skip }, async () => {
  const p = await open();
  await p.click('#settingsBtn');
  assert.ok(await p.isVisible('#settings'));
  assert.equal(await text(p, '#rows-easy'), '8');
  assert.equal(await text(p, '#rows-hard'), '10');
  for (let i = 0; i < 20; i++) await p.click('.step[data-mode=easy][data-dir="-1"]');
  assert.equal(await text(p, '#rows-easy'), '4');
  for (let i = 0; i < 20; i++) await p.click('.step[data-mode=hard][data-dir="1"]');
  assert.equal(await text(p, '#rows-hard'), '12');
  await p.click('.step[data-mode=easy][data-dir="1"]');
  assert.equal(await text(p, '#rows-easy'), '5');
  await p.reload();
  await p.click('#settingsBtn');
  assert.equal(await text(p, '#rows-easy'), '5', 'remembered after reload');
  assert.equal(await text(p, '#rows-hard'), '12');
  await p.click('#settingsBtn'); // Done
  assert.ok(!(await p.isVisible('#settings')));
  await p.click('[data-mode=easy]');
  assert.equal(await count(p, '.row:not(.secretrow)'), 5, 'game uses the chosen rows');
  for (let i = 0; i < 4; i++) await guess(p, [5, 5, 5, 5]);
  await guess(p, [5, 5, 5, 5]);
  assert.match(await text(p, '#msg'), /Out of tries/, 'game ends after the chosen number of rows');
  await done(p);
});

test('settings: bad stored values fall back to the defaults', { skip }, async () => {
  const p = await open({ rows: { easy: 'abc', hard: '99' } });
  await p.click('[data-mode=easy]');
  assert.equal(await count(p, '.row:not(.secretrow)'), 8);
  await p.click('#menuBtn'); await p.click('[data-mode=hard]');
  assert.equal(await count(p, '.row:not(.secretrow)'), 10);
  await done(p);
});

// The page must never scroll, whatever the phone and the row setting.
const phones = [[360, 640], [375, 667], [390, 844], [412, 915]];
for (const [w, h] of phones) {
  for (const mode of ['easy', 'hard']) {
    for (const rows of [4, 8, 12]) {
      test(`no scrolling or clipping: ${w}x${h}, ${mode}, ${rows} rows`, { skip }, async () => {
        const p = await open({ width: w, height: h, rows: { [mode]: rows } });
        for (const screen of ['menu', 'game']) {
          if (screen === 'game') await p.click(`[data-mode=${mode}]`);
          const m = await p.evaluate(() => {
            const board = document.querySelector('.board');
            const rowsEl = document.querySelector('.rows');
            const vis = document.querySelector('.screen:not(.hidden)');
            return {
              pageOverflowY: document.documentElement.scrollHeight - innerHeight,
              pageOverflowX: document.documentElement.scrollWidth - innerWidth,
              screenOverflow: vis.scrollHeight - vis.clientHeight,
              rowsOverflowY: screen_ok() ? rowsEl.offsetHeight - board.clientHeight : 0,
              rowsOverflowX: screen_ok() ? rowsEl.offsetWidth - board.clientWidth : 0,
            };
            function screen_ok() { return vis.id === 'game'; }
          });
          assert.ok(m.pageOverflowY <= 0, `${screen}: page scrolls vertically: ${JSON.stringify(m)}`);
          assert.ok(m.pageOverflowX <= 0, `${screen}: page scrolls sideways: ${JSON.stringify(m)}`);
          assert.ok(m.screenOverflow <= 0, `${screen}: content overflows the screen: ${JSON.stringify(m)}`);
          assert.ok(m.rowsOverflowY <= 0, `rows are clipped vertically: ${JSON.stringify(m)}`);
          assert.ok(m.rowsOverflowX <= 0, `rows are clipped sideways: ${JSON.stringify(m)}`);
        }
        await done(p);
      });
    }
  }
}

test('no scrolling even when every row is filled (a finished game)', { skip }, async () => {
  const p = await open({ width: 375, height: 667, rows: { easy: 12 } });
  await p.click('[data-mode=easy]');
  for (let i = 0; i < 12; i++) await guess(p, [5, 5, 5, 5]);
  const over = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  assert.ok(over <= 0);
  await p.mouse.wheel(0, 500);
  assert.equal(await p.evaluate(() => scrollY), 0);
  await done(p);
});

test('holes stay big enough to tap on a normal phone with 10 rows', { skip }, async () => {
  const p = await open({ width: 390, height: 844 });
  await p.click('[data-mode=hard]');
  const box = await p.locator('.row.active .hole').first().boundingBox();
  assert.ok(box.width >= 28 && box.height >= 28, `hole is ${box.width}px`);
  await done(p);
});

test('portrait only: sideways touch device shows the rotate message', { skip }, async () => {
  const p = await open({ width: 844, height: 390 });
  assert.ok(await p.isVisible('#rotate'));
  assert.ok(!(await p.isVisible('#menu')));
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(!(await p.isVisible('#rotate')));
  assert.ok(await p.isVisible('#menu'));
  await done(p);
});

test('portrait only: rotating in the middle of a game keeps the game', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await guessless(p, [0, 1]);
  await p.setViewportSize({ width: 844, height: 390 });
  assert.ok(await p.isVisible('#rotate'));
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.isVisible('#game'));
  assert.equal(await count(p, '.row.active .marble'), 2);
  await done(p);
});

test('desktop (mouse) is not blocked by the rotate message', { skip }, async () => {
  const p = await open({ width: 1280, height: 720, touch: false });
  assert.ok(await p.isVisible('#menu'));
  assert.ok(!(await p.isVisible('#rotate')));
  await done(p);
});

test('dark mode renders (colors come from the theme)', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(URL);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(20, 21, 26)');
  await ctx.close();
});

test('marbles are matte: flat color, no gradient, no shadow', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  await p.click('#tray button[data-c="4"]');
  const style = await p.locator('.row.active .marble').first().evaluate(e => {
    const s = getComputedStyle(e); return { image: s.backgroundImage, shadow: s.boxShadow };
  });
  assert.equal(style.image, 'none');
  assert.equal(style.shadow, 'none');
  await done(p);
});

test('keyboard: color buttons and holes are reachable and have names', { skip }, async () => {
  const p = await open();
  await p.click('[data-mode=easy]');
  const names = await p.$$eval('#tray button', bs => bs.map(b => b.getAttribute('aria-label')));
  assert.deepEqual(names, ['white', 'pink', 'yellow', 'green', 'red', 'blue']);
  await p.focus('#tray button[data-c="2"]');
  await p.keyboard.press('Enter');
  assert.equal(await count(p, '.row.active .marble'), 1);
  await done(p);
});

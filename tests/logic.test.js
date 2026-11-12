// Unit tests for the game rules. The game's script lives inside public/index.html,
// so load it the same way a browser would, with no `document`, which makes it export its pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'expected exactly one inline script');
  const sandbox = { module: { exports: {} }, Math };
  vm.runInNewContext(scripts[0][1], sandbox);
  return sandbox.module.exports;
}
const game = load();
// Results are created inside the vm sandbox, so copy them into this realm before strict comparisons.
const score = (a, b) => ({ ...game.score(a, b) });
const makeSecret = mode => [...game.makeSecret(mode)];
const MODES = JSON.parse(JSON.stringify(game.MODES));
const COLORS = JSON.parse(JSON.stringify(game.COLORS));

test('score: exact match', () => {
  assert.deepEqual(score([0, 1, 2, 3], [0, 1, 2, 3]), { exact: 4, partial: 0 });
});
test('score: nothing right', () => {
  assert.deepEqual(score([0, 1, 2, 3], [4, 4, 5, 5]), { exact: 0, partial: 0 });
});
test('score: all colors right but every hole wrong', () => {
  assert.deepEqual(score([0, 1, 2, 3], [3, 2, 1, 0]), { exact: 0, partial: 4 });
});
test('score: mixed', () => {
  assert.deepEqual(score([0, 1, 2, 3], [0, 1, 3, 2]), { exact: 2, partial: 2 });
});
test('score: repeated colors in the guess are not over-counted', () => {
  // secret has one red (0); guessing four reds earns one black and no whites
  assert.deepEqual(score([0, 1, 2, 3], [0, 0, 0, 0]), { exact: 1, partial: 0 });
  // red guessed twice, only once in the secret and not in the guessed hole
  assert.deepEqual(score([1, 0, 2, 3], [0, 0, 4, 4]), { exact: 1, partial: 0 });
});
test('score: repeated colors in the secret', () => {
  assert.deepEqual(score([0, 0, 1, 1], [0, 1, 0, 0]), { exact: 1, partial: 2 });
  assert.deepEqual(score([0, 0, 0, 0], [0, 0, 0, 0]), { exact: 4, partial: 0 });
  assert.deepEqual(score([2, 2, 3, 3, 3], [3, 3, 3, 2, 2]), { exact: 1, partial: 4 });
});
test('score: exact + partial never exceeds the number of holes, and is symmetric in totals', () => {
  for (let i = 0; i < 2000; i++) {
    const n = 4 + (i % 2);
    const rnd = () => Array.from({ length: n }, () => Math.floor(Math.random() * COLORS.length));
    const a = rnd(), b = rnd();
    const r = score(a, b), r2 = score(b, a);
    assert.ok(r.exact + r.partial <= n);
    assert.deepEqual(r, r2, 'scoring must not depend on which side is the secret');
  }
});

test('modes: Easy is 4 holes, no repeats; Hard is 5 holes, repeats allowed', () => {
  assert.equal(MODES.easy.pegs, 4);
  assert.equal(MODES.easy.repeats, false);
  assert.equal(MODES.hard.pegs, 5);
  assert.equal(MODES.hard.repeats, true);
});
test('makeSecret: right length, valid colors, Easy never repeats', () => {
  for (let i = 0; i < 500; i++) {
    const s = makeSecret(MODES.easy);
    assert.equal(s.length, 4);
    assert.equal(new Set(s).size, 4, 'Easy secret must have no repeated colors');
    s.forEach(c => assert.ok(Number.isInteger(c) && c >= 0 && c < COLORS.length));
  }
});
test('makeSecret: Hard is 5 long and does produce repeats sometimes', () => {
  let sawRepeat = false;
  for (let i = 0; i < 500; i++) {
    const s = makeSecret(MODES.hard);
    assert.equal(s.length, 5);
    s.forEach(c => assert.ok(c >= 0 && c < COLORS.length));
    if (new Set(s).size < 5) sawRepeat = true;
  }
  assert.ok(sawRepeat);
});
test('makeSecret: every color can appear', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) makeSecret(MODES.easy).forEach(c => seen.add(c));
  assert.equal(seen.size, COLORS.length);
});

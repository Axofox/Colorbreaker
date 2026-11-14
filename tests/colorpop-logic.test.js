// Rules tests for Color Pop: popping, falling, and that every generated board can be cleared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'colorpop', 'index.html'), 'utf8');
const sandbox = { module: { exports: {} }, Math };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const game = sandbox.module.exports;
const plain = v => JSON.parse(JSON.stringify(v));

test('a group is same-colored squares touching up, down, left or right, not corners', () => {
  // columns bottom-up:  x0: r r   x1: b r   x2: r
  const cols = [['r', 'r'], ['b', 'r'], ['r']];
  assert.equal(game.group(cols, 0, 0).length, 3); // (0,0) (0,1) (1,1)
  assert.equal(game.group(cols, 2, 0).length, 1); // (2,0) only touches (1,1) by its corner
  assert.equal(game.group(cols, 1, 0).length, 1);
  assert.deepEqual(plain(game.groups(cols).map(g => g.length)), [3]);
});

test('popping drops the squares above and closes empty columns', () => {
  const cols = [['r', 'b', 'g'], ['r'], ['y', 'y']];
  const after = game.pop(cols, game.group(cols, 0, 0));
  assert.deepEqual(plain(after), [['b', 'g'], ['y', 'y']]);
});

test('points grow with the group size', () => {
  assert.deepEqual([2, 3, 4, 5].map(game.points), [2, 6, 12, 20]);
});

test('the solver finds a way, or says there is none', () => {
  assert.deepEqual(plain(game.solve([['r', 'b', 'b', 'r']])), [0, 1]);
  assert.equal(game.solve([['r', 'b', 'r']]), null);
});

for (const mode of ['easy', 'hard']) {
  test(`${mode}: 200 boards are full, use 5 colors, and can be cleared by their plan`, () => {
    const M = game.MODES[mode];
    for (let n = 0; n < 200; n++) {
      const b = game.generate(mode);
      assert.equal(b.cols.length, M.w);
      b.cols.forEach(col => assert.equal(col.length, M.h));
      const used = new Set(b.cols.flat());
      used.forEach(c => assert.ok(c in game.COLORS));
      assert.ok(used.size >= 4, 'board uses most of the 5 colors');
      let cols = b.cols;
      for (const step of b.plan) {
        assert.equal(game.key(cols), step.board);
        const g = game.group(cols, step.cell[0], step.cell[1]);
        assert.ok(g.length >= 2, 'every planned move pops at least 2');
        cols = game.pop(cols, g);
      }
      assert.equal(cols.length, 0, 'the plan clears the board');
    }
  });
}

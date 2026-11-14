// Rules tests for Block Drop. Loads the page's script without a `document`, so it exports its pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'blockdrop', 'index.html'), 'utf8');
const sandbox = { module: { exports: {} }, Math };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const G = sandbox.module.exports;
const plain = x => JSON.parse(JSON.stringify(x));
const full = () => Array(G.COLS).fill(9);

test('there are 7 shapes of 4 blocks each', () => {
  assert.equal(G.SHAPES.length, 7);
  for (const s of G.SHAPES) assert.equal(s.flat().filter(Boolean).length, 4);
});
test('turning a shape four times gets back to the start', () => {
  for (const s of G.SHAPES) {
    let r = s; for (let i = 0; i < 4; i++) r = G.rotateCW(r);
    assert.deepEqual(plain(r), plain(s));
  }
});
test('fits: walls, floor and other blocks stop a piece; above the top is fine', () => {
  const b = G.emptyBoard(), o = G.SHAPES[1];
  assert.ok(G.fits(b, o, 0, 0));
  assert.ok(!G.fits(b, o, -1, 0));
  assert.ok(!G.fits(b, o, G.COLS - 1, 0));
  assert.ok(!G.fits(b, o, 0, G.ROWS - 1));
  assert.ok(G.fits(b, o, 0, -1));
  b[5][3] = 1;
  assert.ok(!G.fits(b, o, 2, 4));
});
test('clearLines removes full rows and adds empty ones on top', () => {
  const b = G.emptyBoard();
  b[19] = full(); b[18] = full(); b[17][0] = 3;
  const r = G.clearLines(b);
  assert.equal(r.cleared, 2);
  assert.equal(r.board.length, G.ROWS);
  assert.equal(r.board[19][0], 3);
  assert.ok(r.board.slice(0, 19).every(row => row.every(v => !v)));
});
test('points: more rows at once are worth more, and levels multiply', () => {
  assert.deepEqual([1, 2, 3, 4].map(n => G.pointsFor(n, 1)), [100, 300, 500, 800]);
  assert.equal(G.pointsFor(2, 3), 900);
  assert.equal(G.levelFor(0), 1); assert.equal(G.levelFor(9), 1); assert.equal(G.levelFor(10), 2);
  assert.ok(G.fallDelay(5) < G.fallDelay(1)); assert.ok(G.fallDelay(99) >= 80);
});
test('the bag hands out every shape once per 7', () => {
  const next = G.makeBag();
  for (let k = 0; k < 20; k++) assert.deepEqual(Array.from({ length: 7 }, next).sort(), [0, 1, 2, 3, 4, 5, 6]);
});
test('hard drop lands on the floor and completes a row', () => {
  const g = G.newGame();
  g.board[19] = full(); g.board[19][0] = g.board[19][1] = 0;  // gap for the square piece
  g.piece = { id: 1, shape: G.SHAPES[1], x: 0, y: 0 };
  const cleared = G.hardDrop(g);
  assert.equal(cleared, 1);
  assert.equal(g.lines, 1);
  assert.deepEqual(plain(g.board[19].slice(0, 3)), [2, 2, 0]);
  assert.ok(g.score >= 100);
});
test('turning next to a wall nudges the piece back inside', () => {
  const g = G.newGame();
  g.piece = { id: 0, shape: G.rotateCW(G.SHAPES[0]), x: -2, y: 5 }; // upright bar hugging the left wall
  assert.ok(G.fits(g.board, g.piece.shape, g.piece.x, g.piece.y));
  assert.ok(G.rotate(g));
  assert.ok(G.fits(g.board, g.piece.shape, g.piece.x, g.piece.y));
});
test('random play always ends with the stack reaching the top', () => {
  for (let n = 0; n < 30; n++) {
    const g = G.newGame();
    let steps = 0;
    while (!g.over && steps++ < 5000) {
      const r = Math.random();
      if (r < .2) G.move(g, -1, 0); else if (r < .4) G.move(g, 1, 0); else if (r < .5) G.rotate(g); else if (r < .55) G.hardDrop(g); else G.tick(g);
      for (const row of g.board) assert.equal(row.length, G.COLS);
      assert.equal(g.board.length, G.ROWS);
    }
    assert.ok(g.over, 'game should end');
  }
});

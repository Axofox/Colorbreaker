// Rules tests for Block Fit. Loads the page's script without a `document`, so it exports its pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'blockfit', 'index.html'), 'utf8');
const sandbox = { module: { exports: {} }, Math };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const G = sandbox.module.exports;
const plain = x => JSON.parse(JSON.stringify(x));
const line = n => Array.from({ length: n }, (_, i) => [0, i]);
// A game on a clean board with a single star block at (r, c), so a scene doesn't finish by accident.
function fresh(r = 7, c = 7) {
  const g = G.newGame();
  g.board = G.emptyBoard(); g.goal = G.emptyBoard();
  g.board[r][c] = 1; g.goal[r][c] = 1;
  return g;
}

test('shapes: every turned position is distinct, starts at 0,0, and keeps its block count', () => {
  G.SHAPES.forEach((turns, i) => {
    const count = G.BASE[i].split('').filter(ch => ch === '#').length;
    const keys = turns.map(t => JSON.stringify(t));
    assert.equal(new Set(keys).size, turns.length);
    for (const t of turns) {
      assert.equal(t.length, count);
      assert.equal(Math.min(...t.map(p => p[0])), 0);
      assert.equal(Math.min(...t.map(p => p[1])), 0);
    }
  });
  assert.equal(G.SHAPES[0].length, 1, 'single block has one position');
  assert.equal(G.SHAPES[2].length, 2, 'a 3-line is flat or upright');
  assert.equal(G.SHAPES[5].length, 1, 'square has one position');
  assert.equal(G.SHAPES[7].length, 4, 'small corner has four');
});
test('canPlace: stays inside the grid and off other blocks', () => {
  const b = G.emptyBoard();
  assert.ok(G.canPlace(b, line(8), 0, 0));
  assert.ok(!G.canPlace(b, line(8), 0, 1));
  assert.ok(!G.canPlace(b, line(1), -1, 0));
  assert.ok(!G.canPlace(b, line(1), 8, 0));
  b[3][3] = 1;
  assert.ok(!G.canPlace(b, line(2), 3, 2));
  assert.ok(G.canPlace(b, line(2), 3, 4));
});
test('place: a full row clears, a full column clears, and both at once', () => {
  let b = G.emptyBoard();
  for (let c = 0; c < 7; c++) b[2][c] = 1;
  let r = G.place(b, line(1), 2, 7, 4);
  assert.deepEqual(plain(r.rows), [2]); assert.equal(r.lines, 1);
  assert.ok(r.board[2].every(v => !v));

  b = G.emptyBoard();
  for (let i = 0; i < 8; i++) { if (i !== 5) { b[5][i] = 1; b[i][5] = 1; } }
  r = G.place(b, line(1), 5, 5, 2);   // the crossing square completes row 5 and column 5
  assert.deepEqual(plain(r.rows), [5]); assert.deepEqual(plain(r.cols), [5]); assert.equal(r.lines, 2);
  assert.ok(r.board.flat().every(v => !v));
  assert.equal(b[5][5], 0, 'the original board is not changed');
});
test('points: one per block, line bonus grows with lines and combo', () => {
  assert.equal(G.pointsFor(4, 0, 0), 4);
  assert.equal(G.pointsFor(3, 1, 1), 13);
  assert.equal(G.pointsFor(3, 2, 1), 43);
  assert.equal(G.pointsFor(3, 1, 3), 33);
});
test('play: a used shape leaves the tray; a new set of three comes after all three', () => {
  const g = fresh();
  g.tray = [{ cells: line(1), color: 1 }, { cells: line(1), color: 2 }, { cells: line(1), color: 3 }];
  assert.ok(G.play(g, 0, 0, 0));
  assert.equal(g.tray[0], null);
  assert.equal(G.play(g, 0, 1, 1), null, 'cannot play an empty slot');
  assert.equal(G.play(g, 1, 0, 0), null, 'cannot play on a filled square');
  G.play(g, 1, 0, 1); G.play(g, 2, 0, 2);
  assert.equal(g.tray.filter(Boolean).length, 3);
  assert.equal(g.score, 3);
});
test('play: combo streak builds while lines keep clearing and resets after a move without', () => {
  const g = fresh();
  for (let c = 0; c < 7; c++) { g.board[0][c] = 1; g.board[1][c] = 1; }
  g.tray = [{ cells: line(1), color: 1 }, { cells: line(1), color: 1 }, { cells: line(1), color: 1 }];
  G.play(g, 0, 0, 7); assert.equal(g.streak, 1);
  G.play(g, 1, 1, 7); assert.equal(g.streak, 2);
  assert.equal(g.score, 11 + 21);
  G.play(g, 2, 4, 4); assert.equal(g.streak, 0);
});
test('game over when no tray shape fits anywhere', () => {
  const g = fresh();
  // Checkerboard: no two neighbours free, so only single blocks fit.
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board[r][c] = (r + c) % 2 ? 1 : 0;
  g.board[0][0] = 0;
  g.goal = G.emptyBoard(); g.goal[0][1] = 1;
  g.tray = [{ cells: line(1), color: 1 }, { cells: line(2), color: 1 }, null];
  G.play(g, 0, 0, 0);
  assert.ok(g.over);
});
test('random games always end and the board stays 8 by 8', () => {
  for (let n = 0; n < 40; n++) {
    const g = G.newGame();
    let moves = 0;
    while (!g.over && moves < 2000) {
      if (g.complete) { G.nextScene(g); continue; }
      const options = [];
      g.tray.forEach((p, i) => { if (p) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (G.canPlace(g.board, p.cells, r, c)) options.push([i, r, c]); });
      assert.ok(options.length, 'not over means a move exists');
      const [i, r, c] = options[Math.floor(Math.random() * options.length)];
      assert.ok(G.play(g, i, r, c));
      moves++;
      assert.equal(g.board.length, 8); for (const row of g.board) assert.equal(row.length, 8);
    }
    assert.ok(g.over, 'game should end'); assert.ok(moves >= 1, 'the first set always has a move');
  }
});

test('scenes: star blocks are filled, mirrored, never a full line, and more each scene', () => {
  for (let scene = 1; scene <= 12; scene++) for (let n = 0; n < 50; n++) {
    const { board, goal } = G.sceneLayout(scene);
    let stars = 0;
    for (let r = 0; r < 8; r++) {
      assert.ok(!board[r].every(Boolean), 'no full row');
      for (let c = 0; c < 8; c++) {
        if (goal[r][c]) { stars++; assert.ok(board[r][c], 'a star sits on a block'); }
        assert.equal(Boolean(board[r][c]), Boolean(board[r][7 - c]), 'mirrored');
      }
    }
    for (let c = 0; c < 8; c++) assert.ok(!board.every(row => row[c]), 'no full column');
    const want = Math.min(6 + scene * 2, 24);
    assert.ok(stars >= want && stars <= want + 1, `scene ${scene}: ${stars} stars`);
  }
});
test('a new game starts at scene 1 with stars to clear', () => {
  const g = G.newGame();
  assert.equal(g.scene, 1); assert.equal(g.scenesDone, 0);
  assert.ok(G.starsLeft(g) >= 8);
  assert.ok(!g.over && !g.complete);
});
test('clearing the last star finishes the scene with a bonus; next scene starts fresh', () => {
  const g = fresh(7, 0);
  for (let c = 1; c < 7; c++) g.board[7][c] = 2;      // row 7 needs one more block
  g.tray = [{ cells: line(1), color: 3 }, { cells: line(1), color: 3 }, { cells: line(1), color: 3 }];
  const res = G.play(g, 0, 7, 7);
  assert.equal(res.stars, 1);
  assert.ok(res.sceneDone);
  assert.equal(res.bonus, 100);
  assert.equal(g.score, 1 + 10 + 100);
  assert.ok(g.complete); assert.equal(g.scenesDone, 1);
  assert.equal(G.play(g, 1, 0, 0), null, 'no moves until the next scene starts');
  G.nextScene(g);
  assert.equal(g.scene, 2); assert.ok(!g.complete);
  assert.ok(G.starsLeft(g) >= 10);
  assert.equal(g.tray.filter(Boolean).length, 3);
  assert.equal(g.score, 111, 'score carries on');
  assert.equal(G.sceneBonus(3), 300);
});
test('a line without the last star does not finish the scene', () => {
  const g = fresh(5, 5);
  for (let c = 0; c < 7; c++) g.board[0][c] = 2;
  g.goal[0][3] = 1;
  g.tray = [{ cells: line(1), color: 3 }, { cells: line(1), color: 3 }, { cells: line(1), color: 3 }];
  const res = G.play(g, 0, 0, 7);
  assert.equal(res.stars, 1);
  assert.ok(!res.sceneDone && !g.complete);
  assert.equal(G.starsLeft(g), 1);
});

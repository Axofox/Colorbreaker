// Rules tests for Number Cross: every generated puzzle must be solvable and simple enough for a small child.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'numbercross', 'index.html'), 'utf8');
const sandbox = { module: { exports: {} }, Math };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const game = sandbox.module.exports;
const calc = (a, op, b) => op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a / b;

test('sums: small numbers and no-carry sums are allowed, carrying is not', () => {
  assert.ok(game.easyAdd(7, 7));
  assert.ok(game.easyAdd(12, 5));
  assert.ok(game.easyAdd(10, 10));
  assert.ok(!game.easyAdd(14, 16));
  assert.ok(!game.easyAdd(15, 7));
});
test('take-aways: no borrowing above 10', () => {
  assert.ok(game.easySub(17, 5));
  assert.ok(game.easySub(9, 4));
  assert.ok(game.easySub(10, 7));
  assert.ok(!game.easySub(14, 7));
  assert.ok(!game.easySub(21, 5));
});

for (const key of ['easy', 'medium', 'hard']) {
  const L = game.LEVELS[key];
  test(`${key}: every allowed equation is true, whole, in range and uses allowed signs`, () => {
    const all = game.equationsFor(key);
    assert.ok(all.length > 20);
    for (const [a, op, b, c] of all) {
      assert.ok(L.ops.includes(op));
      assert.equal(calc(a, op, b), c);
      for (const n of [a, b, c]) assert.ok(Number.isInteger(n) && n >= 1 && n <= L.max, `${a}${op}${b}=${c}`);
      if (op === '+') assert.ok(game.easyAdd(a, b));
      if (op === '-') assert.ok(game.easySub(a, b));
      if (op === '×') assert.ok((a <= 2 || b <= 2) && c <= 20, `${a}×${b}`);
      if (op === '÷') assert.ok(b <= 2 && a <= 20, `${a}÷${b}`);
    }
  });
  test(`${key}: easy and medium have no times or divide`, () => {
    const ops = new Set(game.equationsFor(key).map(e => e[1]));
    if (key !== 'hard') assert.deepEqual([...ops].sort(), ['+', '-']);
    else assert.equal(ops.size, 4);
  });
  test(`${key}: 300 generated puzzles are all valid`, () => {
    const allowed = new Set(game.equationsFor(key).map(e => e.join(' ')));
    for (let n = 0; n < 300; n++) {
      const p = game.generate(key);
      assert.equal(p.eqs.length, L.eqs);
      assert.ok(p.w <= game.MAX_W && p.h <= game.MAX_H, `too big: ${p.w}x${p.h}`);
      const seen = new Set();
      for (const c of p.cells) {
        assert.ok(c.x >= 0 && c.x < p.w && c.y >= 0 && c.y < p.h);
        assert.ok(!seen.has(c.x + ',' + c.y), 'two cells in one box'); seen.add(c.x + ',' + c.y);
      }
      for (const e of p.eqs) {
        const [a, op, b, eq, c] = e.map(i => p.cells[i].v);
        assert.equal(eq, '=');
        assert.ok(allowed.has([a, op, b, c].join(' ')), `not allowed: ${a} ${op} ${b} = ${c}`);
        const blanks = e.filter(i => p.cells[i].blank).length;
        assert.ok(blanks <= 1, 'an equation has more than one empty box');
        // the five boxes are in a straight line, one step apart
        const cs = e.map(i => p.cells[i]);
        const dx = cs[1].x - cs[0].x, dy = cs[1].y - cs[0].y;
        assert.equal(Math.abs(dx) + Math.abs(dy), 1);
        cs.forEach((cell, i) => { assert.equal(cell.x, cs[0].x + i * dx); assert.equal(cell.y, cs[0].y + i * dy); });
      }
      const blanks = p.cells.filter(c => c.blank);
      assert.ok(blanks.length >= 2);
      blanks.forEach(c => assert.equal(c.t, 'num'));
      assert.deepEqual([...p.tiles], Array.from(blanks, c => c.v).sort((x, y) => x - y), 'tiles match the empty boxes');
      // every empty box sits in an equation, so it can be worked out
      blanks.forEach(c => assert.ok(p.eqs.some(e => e.includes(p.cells.indexOf(c)))));
    }
  });
}

// Rules tests for Mahjong Pairs. Loads the page's script without a `document`, so it exports its pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'mahjong', 'index.html'), 'utf8');
const sandbox = { module: { exports: {} }, Math };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const G = sandbox.module.exports;
const plain = x => JSON.parse(JSON.stringify(x));
const copy = s => plain(s);

test('16 different tile pictures; stages use more tiles and pictures as they go', () => {
  assert.equal(G.SYMBOLS.length, 16);
  assert.equal(new Set(G.SYMBOLS.map(s => s.name)).size, 16);
  assert.equal(G.TRAY, 4);
  assert.deepEqual([1, 2, 3, 4, 5].map(n => G.stageConfig(n).tiles), [24, 36, 48, 60, 72]);
  assert.deepEqual([1, 2, 3, 4, 5].map(n => G.stageConfig(n).symbols), [6, 8, 10, 12, 14]);
  assert.equal(G.stageConfig(20).tiles, 72);
});

test('every generated stage is valid: exact tile count, pairs only, upper tiles rest on lower ones, mirrored-ish, winnable', () => {
  for (let n = 0; n < 300; n++) {
    const stage = 1 + (n % 6), s = G.generate(stage), cfg = G.stageConfig(stage);
    assert.equal(s.tiles.length, cfg.tiles);
    const count = {};
    for (const t of s.tiles) count[t.sym] = (count[t.sym] || 0) + 1;
    assert.ok(Object.keys(count).length <= cfg.symbols);
    for (const k in count) assert.equal(count[k] % 2, 0, 'every picture comes in pairs');
    const seen = new Set();
    for (const t of s.tiles) {
      const k = `${t.x},${t.y},${t.z}`; assert.ok(!seen.has(k), 'two tiles in one place'); seen.add(k);
      if (t.z > 0) assert.ok(s.tiles.some(u => u.z === t.z - 1 && G.overlaps(u, t)), 'upper tile rests on a lower one');
      for (const u of s.tiles) if (u !== t && u.z === t.z) assert.ok(!G.overlaps(u, t), 'tiles on one layer do not overlap');
    }
    // The known order wins and never has more than 2 tiles in the tray.
    const a = copy(s);
    for (const id of s.solution) { const r = G.pick(a, id); assert.ok(r.ok); assert.ok(a.tray.length <= 2); }
    assert.equal(G.status(a), 'won');
  }
});

test('only free tiles can be picked: a covered tile is refused', () => {
  const s = G.generate(3);
  const covered = s.tiles.find(t => !G.isFree(s.tiles, t));
  assert.ok(covered);
  assert.deepEqual(plain(G.pick(s, covered.id)), { ok: false, reason: 'covered' });
  assert.ok(G.freeTiles(s.tiles).length > 0);
});

test('two the same in the tray pop; four different fill the tray and lose', () => {
  // A flat hand-made board: six free tiles side by side. Pictures: 0 0 1 2 3 4.
  const tiles = [0, 0, 1, 2, 3, 4].map((sym, id) => ({ id, x: id * 2, y: 0, z: 0, sym, gone: false }));
  const s = { stage: 1, tiles, tray: [], history: [], tools: { shuffle: 1, hint: 2, undo: 3 } };
  let r = G.pick(s, 0); assert.equal(r.slot, 0);
  r = G.pick(s, 1); assert.equal(r.matched, 0, 'the pair pops');
  assert.equal(s.tray.length, 0);
  for (const id of [2, 3, 4]) G.pick(s, id);
  assert.equal(G.status(s), 'playing', '3 different: still playing');
  G.pick(s, 5);
  assert.equal(s.tray.length, 4);
  assert.equal(G.status(s), 'lost');
  // A covered tile can't be taken: put one on top of tile 0's spot.
  const t = { id: 6, x: 1, y: 0, z: 1, sym: 9, gone: false }, u = { id: 7, x: 0, y: 0, z: 0, sym: 9, gone: false };
  const s2 = { tiles: [u, t].map((x, i) => ({ ...x, id: i })), tray: [], history: [], tools: {} };
  assert.equal(G.pick(s2, 0).reason, 'covered');
  assert.ok(G.pick(s2, 1).ok);
  assert.ok(G.pick(s2, 0).ok, 'free once the tile on top is gone');
  assert.equal(G.status(s2), 'won');
});

test('undo puts the last tile back, and brings back a popped partner', () => {
  const s = G.generate(1), [a, b] = [s.solution[0], s.solution[1]];
  G.pick(s, a); G.pick(s, b);                 // a pair: tray empty again
  assert.equal(s.tray.length, 0);
  assert.ok(G.undo(s));
  assert.deepEqual(plain(s.tray.map(x => x.id)), [a], 'partner back in the tray');
  assert.ok(!s.tiles[b].gone, 'tile back on the board');
  assert.ok(G.undo(s));
  assert.equal(s.tray.length, 0); assert.ok(!s.tiles[a].gone);
  assert.equal(s.tools.undo, 1);
  G.undo(s); assert.equal(s.tools.undo, 1, 'nothing to undo');
});

test('shuffle mixes the pictures but the stage can still be won, including tiles already in the tray', () => {
  for (let n = 0; n < 100; n++) {
    const s = G.generate(1 + (n % 5));
    // Take a few tiles off the known order (sometimes leaving one in the tray), then shuffle.
    const k = 1 + (n % 5);
    for (const id of s.solution.slice(0, k)) G.pick(s, id);
    const before = plain(s.tiles.filter(t => !t.gone).map(t => t.sym)).sort().join();
    assert.ok(G.shuffleBoard(s));
    assert.equal(plain(s.tiles.filter(t => !t.gone).map(t => t.sym)).sort().join(), before, 'same pictures, new places');
    for (const id of s.solution) assert.ok(G.pick(s, id).ok);
    assert.equal(G.status(s), 'won');
    assert.equal(s.tools.shuffle, 0);
  }
});

test('hint points at a free tile matching the tray, or a free pair', () => {
  const s = G.generate(2);
  const h = G.hint(s);
  if (h.length === 2) { assert.equal(s.tiles[h[0]].sym, s.tiles[h[1]].sym); assert.ok(h.every(id => G.isFree(s.tiles, s.tiles[id]))); }
  G.pick(s, s.solution[0]);
  const h2 = G.hint(s);
  assert.equal(h2.length, 1);
  assert.equal(s.tiles[h2[0]].sym, s.tray[0].sym);
  assert.ok(G.useHint(s)); assert.equal(s.tools.hint, 1);
});

test('fair but not trivial: matching pairs wins most early stages; tapping at random almost never wins', () => {
  const greedy = s => { for (let n = 0; n < 500 && G.status(s) === 'playing'; n++) { const h = G.hint(s), f = G.freeTiles(s.tiles); G.pick(s, h.length ? h[0] : f[Math.floor(Math.random() * f.length)].id); } return G.status(s) === 'won'; };
  const random = s => { for (let n = 0; n < 500 && G.status(s) === 'playing'; n++) { const f = G.freeTiles(s.tiles); G.pick(s, f[Math.floor(Math.random() * f.length)].id); } return G.status(s) === 'won'; };
  const rate = (fn, st) => { let w = 0; for (let i = 0; i < 100; i++) if (fn(G.generate(st))) w++; return w / 100; };
  assert.ok(rate(greedy, 1) > 0.8);
  assert.ok(rate(random, 2) < 0.1);
});

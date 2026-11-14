// Rules tests for Color Rides. Loads the page's script without a `document`, so it exports its pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = dir => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', dir, 'index.html'), 'utf8');
  const sandbox = { module: { exports: {} }, Math };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
  return sandbox.module.exports;
};
const G = load('colorrides');
const NC = load('numbercross');
const plain = x => JSON.parse(JSON.stringify(x));
const calc = (a, op, b) => op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a / b;
// The order people join (ring nearest the gate first, then the rest).
const queueOf = s => [...s.ring.filter(Boolean), ...s.feed].sort((a, b) => a.id - b.id).map(p => p.key);

test('math rules are exactly the same as Number Cross', () => {
  for (const key of ['easy', 'medium', 'hard']) {
    assert.deepEqual(plain(G.equationsFor(key)), plain(NC.equationsFor(key)), key);
  }
  for (let a = 1; a <= 30; a++) for (let b = 1; b <= 30; b++) {
    assert.equal(G.easyAdd(a, b), NC.easyAdd(a, b));
    assert.equal(G.easySub(a, b), NC.easySub(a, b));
  }
});

// ===== Colors =====
test('colors: 4 spots, about 25 cars from stage 3, and every stage is valid and winnable', () => {
  assert.equal(G.SPOTS, 4);
  let cars3 = 0;
  for (let n = 0; n < 60; n++) {
    const stage = 1 + (n % 5), s = G.generateColors(stage), cfg = G.colorsConfig(stage);
    assert.equal(s.slots.length, 4);
    if (stage >= 3) cars3 += s.cars.length;
    assert.ok(s.cars.length >= cfg.cars - 4, `stage ${stage}: ${s.cars.length} cars`);
    const seen = new Set();
    for (const c of s.cars) for (const [x, y] of G.cellsOf(c)) {
      assert.ok(x >= 0 && x < s.w && y >= 0 && y < s.h);
      assert.ok(!seen.has(x + ',' + y), 'two cars on one square'); seen.add(x + ',' + y);
      assert.ok(c.color < cfg.colors);
    }
    // one person per seat, per color
    const seats = {}, people = {};
    for (const c of s.cars) seats[c.key] = (seats[c.key] || 0) + c.seats;
    for (const k of queueOf(s)) people[k] = (people[k] || 0) + 1;
    assert.deepEqual(people, seats);
    assert.equal(s.ring.filter(Boolean).length, Math.min(G.RING, s.total), 'the loop starts full');
    assert.ok(G.ringWins(s.cars, s.w, s.h, { taps: s.order, queue: queueOf(s) }), 'the known plan wins');
  }
  assert.ok(cars3 / 36 >= 24, `about 25 cars from stage 3 (got ${cars3 / 36})`);
});
test('colors: there is always a car with a clear way out, until all are gone', () => {
  for (let n = 0; n < 40; n++) {
    const s = G.generateColors(3), left = new Set(s.cars.map(c => c.id));
    while (left.size) {
      const free = [...left].filter(id => G.blockerOf(s, id) < 0);
      assert.ok(free.length, 'some car can move');
      const id = free[Math.floor(Math.random() * free.length)];
      s.cars[id].gone = true; left.delete(id);
    }
  }
});
// A tiny hand-made stage: 4x4 car park, car 0 (pink, drives right) is blocked by car 1 (yellow, drives up).
function tiny(queue) {
  const cars = [
    { id: 0, x: 0, y: 1, len: 2, dir: 'R', seats: 4, color: 0, key: 0, gone: false },
    { id: 1, x: 2, y: 0, len: 2, dir: 'U', seats: 4, color: 1, key: 1, gone: false },
  ];
  const s = G.colorsState(1, 4, 4, cars, queue, [1, 0], 0);
  s.w = 4; s.h = 4;
  return s;
}
test('colors: a blocked car stays put and names the car in its way', () => {
  const s = tiny([1, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(plain(G.tap(s, 0)), { ok: false, reason: 'blocked', by: 1 });
  assert.ok(G.tap(s, 1).ok);
  assert.equal(G.blockerOf(s, 0), -1);
});
test('colors: people walk round; only the person at the gate gets in, into a car of their color', () => {
  const s = tiny([1, 0, 1, 0, 1, 0, 1, 0]);
  G.tap(s, 1);                                     // a yellow car parks
  const before = s.ring.filter(Boolean).length;
  let boarded = [];
  for (let i = 0; i < G.RING; i++) { const ev = G.ringStep(s); if (ev.board) boarded.push(ev.board.person.key); }
  assert.deepEqual(boarded, [1, 1, 1, 1], 'all four yellow people got in on one lap; pink kept walking');
  assert.equal(s.ring.filter(Boolean).length, before - 4);
  assert.equal(s.slots[0], null, 'the full car drove away');
  assert.equal(G.colorsStatus(s), 'playing');
  G.tap(s, 0); G.settle(s);
  assert.equal(G.colorsStatus(s), 'won');
});
test('colors: a car still driving in, or driving away, takes nobody', () => {
  const s = tiny([1, 1, 1, 1, 0, 0, 0, 0]);
  s.hold = true;
  G.tap(s, 1);
  assert.ok(s.slots[0].arriving);
  assert.equal(G.matchSlot(s, 1), -1, 'not while arriving');
  s.slots[0].arriving = false;
  assert.equal(G.matchSlot(s, 1), 0);
  G.settle(s);
  assert.ok(s.slots[0].leaving, 'full car is driving away');
  assert.equal(G.matchSlot(s, 1), -1);
});
test('colors: lost when all 4 spots hold cars nobody walking round fits; not lost while a car drives away', () => {
  const s = tiny([0, 0, 0, 0, 1, 1, 1, 1]);
  s.slots = [0, 1, 2, 3].map(i => ({ id: 9 + i, key: 3, color: 3, seats: 4, filled: 0, at: i }));
  assert.equal(G.colorsStatus(s), 'lost');
  assert.equal(G.tap(s, 1).reason, 'full');
  s.slots[2].leaving = true;
  assert.equal(G.colorsStatus(s), 'playing');
  s.slots[2] = { id: 20, key: 0, color: 0, seats: 4, filled: 0, at: 9 };
  assert.equal(G.colorsStatus(s), 'playing', 'a pink car lets the pink people in');
});

// Players: careless taps any car that can move; sensible drives out cars people on the loop need, clearing the way first.
function careless(s) {
  for (let n = 0; n < 400 && G.colorsStatus(s) === 'playing'; n++) {
    const free = s.cars.filter(c => !c.gone && G.blockerOf(s, c.id) < 0);
    if (!free.length) break;
    if (!G.tap(s, free[Math.floor(Math.random() * free.length)].id).ok) { G.settle(s); continue; }
    G.settle(s);
  }
  G.settle(s); return G.colorsStatus(s) === 'won';
}
function sensible(s) {
  for (let n = 0; n < 400 && G.colorsStatus(s) === 'playing'; n++) {
    const gone = new Set(s.cars.filter(c => c.gone).map(c => c.id)), need = {};
    for (const p of s.ring.filter(Boolean)) need[p.key] = (need[p.key] || 0) + 1;
    for (const sl of s.slots) if (sl) need[sl.key] = (need[sl.key] || 0) - (sl.seats - sl.filled);
    const free = s.slots.filter(x => !x).length;
    const o = s.cars.filter(c => !c.gone && (need[c.key] || 0) > 0).map(c => ({ c, chain: G.chainFor(s.cars, s.w, s.h, gone, c.id) }))
      .sort((a, b) => a.chain.length - b.chain.length).find(o => o.chain.length + 1 <= free);
    if (!o) { G.settle(s); if (s.slots.every(Boolean)) break; continue; }
    G.tap(s, o.chain.length ? o.chain[0] : o.c.id); G.settle(s);
  }
  G.settle(s); return G.colorsStatus(s) === 'won';
}
const rate = (fn, stage, n = 40) => { let w = 0; for (let i = 0; i < n; i++) if (fn(G.generateColors(stage))) w++; return w / n; };
test('colors: a sensible player wins almost every stage; careless tapping often loses later on', () => {
  assert.ok(rate(sensible, 3) > 0.85);
  assert.ok(rate(careless, 4) < 0.75);
});

// ===== Math =====
test('math: every car has a different answer, the passenger matches exactly one car, sums follow the level rules', () => {
  for (const mode of ['easy', 'medium', 'hard']) for (let stage = 1; stage <= 6; stage++) {
    const s = G.generateMath(mode, stage), allowed = new Set(G.equationsFor(mode).map(e => e.join(' ')));
    assert.equal(s.cars.length, G.mathConfig(stage).cars);
    assert.equal(new Set(s.cars.map(c => c.key)).size, s.cars.length, 'answers are all different');
    assert.equal(s.cars.filter(c => c.key === s.rider).length, 1);
    for (const c of s.cars) { assert.equal(calc(...c.eq), c.key); assert.ok(allowed.has([...c.eq, c.key].join(' '))); }
  }
});
test('math: a wrong car costs a heart; 3 wrong ends the game', () => {
  const s = G.generateMath('easy', 1);
  const wrong = () => s.cars.find(c => c.key !== s.rider).id;
  let r = G.pick(s, wrong());
  assert.equal(r.ok, false); assert.equal(s.hearts, 2); assert.equal(r.wanted, s.rider); assert.ok(!r.over);
  G.pick(s, wrong());
  r = G.pick(s, wrong());
  assert.ok(r.over); assert.equal(s.hearts, 0);
  assert.equal(G.pick(s, s.cars[0].id), null, 'no more picks after game over');
});
test('math: the right car picks the passenger up, a new car takes its place, and the stage ends after all riders', () => {
  for (const mode of ['easy', 'hard']) {
    const s = G.generateMath(mode, 3);
    for (let n = 1; n <= s.riders; n++) {
      const car = s.cars.find(c => c.key === s.rider), r = G.pick(s, car.id);
      assert.ok(r.ok); assert.equal(s.served, n);
      assert.equal(s.cars[r.index].id, r.fresh.id, 'new car in the same place');
      assert.equal(new Set(s.cars.map(c => c.key)).size, s.cars.length, 'answers still all different');
      if (n < s.riders) { assert.ok(!r.done); assert.equal(s.cars.filter(c => c.key === s.rider).length, 1); }
      else { assert.ok(r.done); assert.equal(s.rider, null); }
    }
    assert.equal(s.hearts, 3);
  }
});
test('math: later stages have more cars and more passengers', () => {
  assert.ok(G.mathConfig(5).cars > G.mathConfig(1).cars);
  assert.ok(G.mathConfig(5).riders > G.mathConfig(1).riders);
  assert.ok(G.mathConfig(50).cars <= 8);
});

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
const MODES = ['colors', 'easy', 'medium', 'hard'];

// Plays a level by driving the cars out in the given order, letting everyone board after each one.
function playOrder(s, order) {
  for (const id of order) {
    const r = G.tap(s, id);
    if (!r.ok) return r.reason;
    G.boardAll(s);
  }
  return G.status(s);
}

test('math rules are exactly the same as Number Cross', () => {
  for (const key of ['easy', 'medium', 'hard']) {
    assert.deepEqual(plain(G.equationsFor(key)), plain(NC.equationsFor(key)), key);
    assert.equal(G.LEVELS[key].max, NC.LEVELS[key].max);
    assert.deepEqual(plain(G.LEVELS[key].ops), plain(NC.LEVELS[key].ops));
  }
  for (let a = 1; a <= 30; a++) for (let b = 1; b <= 30; b++) {
    assert.equal(G.easyAdd(a, b), NC.easyAdd(a, b));
    assert.equal(G.easySub(a, b), NC.easySub(a, b));
  }
});

for (const mode of MODES) {
  test(`${mode}: 200 generated levels are valid and solvable`, () => {
    for (let n = 0; n < 200; n++) {
      const level = 1 + (n % 8);
      const s = G.generate(mode, level);
      const cfg = G.levelConfig(mode, level);
      assert.ok(s.cars.length >= 4 && s.cars.length <= cfg.cars, `car count ${s.cars.length}`);
      // inside the car park, no overlaps
      const seen = new Set();
      for (const c of s.cars) for (const [x, y] of G.cellsOf(c)) {
        assert.ok(x >= 0 && x < s.w && y >= 0 && y < s.h);
        assert.ok(!seen.has(x + ',' + y), 'two cars on one square'); seen.add(x + ',' + y);
      }
      // exactly one person per seat, per color or answer
      const seats = {}, people = {};
      for (const c of s.cars) seats[c.key] = (seats[c.key] || 0) + c.seats;
      for (const k of s.queue) people[k] = (people[k] || 0) + 1;
      assert.deepEqual(people, seats);
      // math cars carry a true, allowed sum whose answer is the key
      if (mode !== 'colors') {
        const allowed = new Set(G.equationsFor(mode).map(e => e.join(' ')));
        for (const c of s.cars) {
          assert.equal(calc(...c.eq), c.key);
          assert.ok(allowed.has([...c.eq, c.key].join(' ')), c.eq.join(' '));
        }
      } else for (const c of s.cars) assert.ok(c.color < cfg.colors);
      // the known order wins
      assert.equal(playOrder(s, s.order), 'won');
    }
  });
}

test('there is always a car with a clear way out, until all are gone', () => {
  for (let n = 0; n < 100; n++) {
    const s = G.generate('colors', 6);
    const left = new Set(s.cars.map(c => c.id));
    while (left.size) {
      const free = [...left].filter(id => G.blockerOf(s, id) < 0);
      assert.ok(free.length, 'some car can move');
      const id = free[Math.floor(Math.random() * free.length)];
      s.cars[id].gone = true; left.delete(id);
    }
  }
});

function tiny() {
  // 4x4 car park: car 0 drives right but car 1 (vertical) is in its way.
  const cars = [
    { id: 0, x: 0, y: 1, len: 2, dir: 'R', seats: 4, color: 0, key: 0, gone: false },
    { id: 1, x: 2, y: 0, len: 2, dir: 'U', seats: 4, color: 1, key: 1, gone: false },
  ];
  return { mode: 'colors', level: 1, w: 4, h: 4, cars, order: [1, 0], queue: [1, 1, 0, 0, 1, 1, 0, 0], slots: Array(5).fill(null), parked: 0 };
}
test('tap: a blocked car stays put and names the car in its way', () => {
  const s = tiny();
  assert.deepEqual(plain(G.tap(s, 0)), { ok: false, reason: 'blocked', by: 1 });
  assert.ok(!s.cars[0].gone);
  assert.ok(G.tap(s, 1).ok);
  assert.equal(G.blockerOf(s, 0), -1);
});
test('boarding: front of the line only, earliest matching car, full car drives away', () => {
  const s = tiny();
  G.tap(s, 1);
  assert.equal(G.boardAll(s), 2);            // two "1"s get on, then a "0" is at the front with no car
  assert.equal(s.slots[0].filled, 2);
  assert.equal(G.status(s), 'playing');
  G.tap(s, 0);
  G.boardAll(s);
  assert.deepEqual(plain(s.slots), [null, null, null, null, null]);
  assert.equal(G.status(s), 'won');
});
test('lost when all spots are full and nobody can get on; full spots refuse more cars', () => {
  const s = tiny();
  s.queue = [7, 0, 0, 0, 0, 1, 1, 1, 1];
  s.slots = [0, 1, 2, 3, 4].map(i => ({ id: 9 + i, key: 9, color: 0, seats: 4, filled: 0, at: i }));
  assert.equal(G.status(s), 'lost');
  assert.equal(G.tap(s, 1).reason, 'full');
});
test('levels get bigger, and math car parks stay at most 7 wide', () => {
  assert.ok(G.levelConfig('colors', 8).cars > G.levelConfig('colors', 1).cars);
  assert.ok(G.levelConfig('colors', 8).size > G.levelConfig('colors', 1).size);
  for (let l = 1; l < 30; l++) for (const m of ['easy', 'medium', 'hard']) assert.ok(G.levelConfig(m, l).size <= 7);
});

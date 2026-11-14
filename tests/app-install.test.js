// The site can be installed on a tablet or phone (Add to Home Screen) and played offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const PAGES = ['index.html', 'colorbreaker/index.html', 'numbercross/index.html', 'colorpop/index.html', 'blockfit/index.html', 'colorrides/index.html'];
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const pngSize = f => { const b = fs.readFileSync(path.join(PUBLIC, f)); assert.equal(b.toString('ascii', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: name, standalone, and icons that exist at the sizes they claim', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Color Games');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'a maskable icon for Android');
  for (const i of m.icons) {
    assert.ok(fs.existsSync(path.join(PUBLIC, i.src)), i.src);
    if (i.type === 'image/png') { const [w, h] = pngSize(i.src); assert.equal(`${w}x${h}`, i.sizes, i.src); }
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  assert.deepEqual(pngSize('icons/favicon-32.png'), [32, 32]);
});

test('every page links the manifest, icons and the offline helper, with paths that exist', () => {
  for (const page of PAGES) {
    const html = read(page), dir = path.dirname(page);
    for (const re of [/rel="manifest" href="([^"]+)"/, /rel="apple-touch-icon" href="([^"]+)"/, /rel="icon" href="([^"]+)"/, /<script src="([^"]+)" defer>/]) {
      const m = html.match(re);
      assert.ok(m, `${page} is missing ${re}`);
      assert.ok(fs.existsSync(path.join(PUBLIC, dir, m[1])), `${page}: ${m[1]} does not exist`);
    }
    assert.match(html, /apple-mobile-web-app-title" content="Color Games"/);
  }
});

test('the offline copy includes every page and icon, and every file it lists exists', () => {
  const sw = read('sw.js'), files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, ']'));
  for (const f of files) if (f !== './') assert.ok(fs.existsSync(path.join(PUBLIC, f)), f);
  for (const page of PAGES) assert.ok(files.includes(page), `${page} is saved for offline`);
});

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) {}
const skip = chromium ? false : 'playwright is not installed';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// A tiny local web server for the public/ folder (offline play needs http, not file://).
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let f = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (f.endsWith('/')) f += 'index.html';
      const file = path.join(PUBLIC, f);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('after one visit, every game opens with the internet off', { skip }, async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(base);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.waitForFunction(async () => (await caches.keys()).length > 0 && (await (await caches.open((await caches.keys())[0])).keys()).length >= 15);
    await ctx.setOffline(true);
    await p.reload();
    assert.equal(await p.title(), 'Games');
    for (const [href, title] of [['colorbreaker/index.html', 'Color Breaker'], ['numbercross/index.html', 'Number Cross'], ['colorpop/index.html', 'Color Pop'], ['blockfit/index.html', 'Block Fit'], ['colorrides/index.html', 'Color Rides']]) {
      await p.goto(base + href);
      assert.equal(await p.title(), title, `${href} offline`);
    }
    await p.click('[data-mode=easy]');                       // a game really runs offline
    assert.ok(await p.isVisible('#garage'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
});

test('tablets can play sideways; only phones are asked to turn upright', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    for (const [w, h, blocked] of [[1180, 820, false], [1024, 768, false], [844, 390, true]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const p = await ctx.newPage();
      await p.goto('file://' + path.join(PUBLIC, 'colorrides', 'index.html'));
      assert.equal(await p.isVisible('#rotate'), blocked, `${w}x${h}`);
      assert.equal(await p.isVisible('#menu'), !blocked, `${w}x${h}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
});

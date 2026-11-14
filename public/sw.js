// Offline play: keeps a copy of every game so they still work with no internet.
// Online, pages come from the network (so new versions show up right away) and the copy is refreshed.
// Offline, or if the network is very slow, the saved copy is used.
const CACHE = "color-games-v3";
const FILES = [
  "./", "index.html", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  "colorbreaker/index.html", "numbercross/index.html", "colorpop/index.html", "blockfit/index.html", "colorrides/index.html", "mahjong/index.html",
];

// A copy that is safe to hand back for a page visit even if the server redirected (some browsers refuse redirected copies).
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async f => { const res = await fetch(f, { cache: "reload" }); if (res.ok) await cache.put(f, await clean(res)); }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]);
      if (res.ok) { const copy = await clean(res.clone()); await cache.put(req, copy); return await clean(res); }
      return res;
    } catch (err) {
      const saved = await cache.match(req, { ignoreSearch: true });
      if (saved) return saved;
      if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
      return Response.error();
    }
  })());
});

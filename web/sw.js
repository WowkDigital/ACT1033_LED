// Service worker: lets the page be installed and open offline (for composing and sending over Bluetooth).
// Same-origin GET requests are answered from the cache and refreshed in the background; everything cross-origin
// (the Worker API with the token, map tiles, the transit API) goes straight to the network and is never cached.
const CACHE = "act1033-led-__BUILD__"; // __BUILD__ is replaced by build.mjs, so every deploy starts a fresh cache
const SHELL = ["./", "style.css", "leaflet.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(fresh); // refresh in the background
        return hit;
      }
      return (await fresh) || (req.mode === "navigate" ? cache.match("./") : Response.error());
    }),
  );
});

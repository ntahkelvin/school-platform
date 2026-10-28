// Service worker: lets the app open with no internet once it has been opened online.
// Screens and styles are cached; data from /api is never cached here (the app handles that itself).
const CACHE = "school-platform-v3";

// On install, save the page and every script and style it uses, so the very first visit is enough.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(["/manifest.webmanifest", "/icon.svg"]);
      const res = await fetch("/index.html", { cache: "no-store" });
      const html = await res.clone().text();
      await cache.put("/index.html", res);
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(assets);
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Built files have unique names, so a cached copy is always correct.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: try the network first so updates arrive, fall back to the saved copy when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/index.html" : req, copy));
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/index.html" : req, { ignoreVary: true }).then((hit) => hit || Response.error())),
  );
});

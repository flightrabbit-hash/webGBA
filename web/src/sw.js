const VERSION = "__WEBGBA_VERSION__";
const FILES = ["__WEBGBA_FILES__"];
const CACHE = `webgba-${VERSION}`;
const LIST = "/__files.json";

async function reuse(cache) {
  const missing = new Map(FILES);
  for (const key of await caches.keys()) {
    if (!missing.size) break;
    if (!key.startsWith("webgba-") || key === CACHE) continue;
    const old = await caches.open(key);
    let list = null;
    try {
      list = await (await old.match(LIST))?.json();
    } catch {
      list = null;
    }
    if (!list || typeof list !== "object") continue;
    for (const [url, hash] of [...missing]) {
      if (list[url] !== hash) continue;
      const hit = await old.match(url);
      if (!hit) continue;
      await cache.put(url, hit);
      missing.delete(url);
    }
  }
  return [...missing.keys()];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const need = await reuse(cache);
      await cache.addAll(need.map((url) => new Request(url, { cache: "no-cache" })));
      await cache.put(LIST, new Response(JSON.stringify(Object.fromEntries(FILES)), { headers: { "content-type": "application/json" } }));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("webgba-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && !/\.[a-z0-9]+$/i.test(url.pathname.replace(/\/index\.html$/, "/"))) {
    event.respondWith(
      (async () => {
        const hit = await caches.match("/index.html", { cacheName: CACHE });
        if (hit) return hit;
        return fetch(request);
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const hit = await caches.match(url.pathname, { cacheName: CACHE });
      return hit ?? fetch(request);
    })(),
  );
});

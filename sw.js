const CACHE_NAME = "tennis-tracker-v26";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/i18n.js",
  "./js/scoring.js",
  "./js/storage.js",
  "./js/court.js",
  "./js/export.js",
  "./js/ai-review.js",
  "./js/live-share.js",
  "./js/qrcode.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first with cache fallback, so a match in progress still works if wifi drops.
// "no-cache" makes the browser revalidate instead of trusting GitHub Pages' 10-minute max-age,
// so a fresh deploy shows up on the next open.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request.url, { cache: "no-cache", credentials: "same-origin" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

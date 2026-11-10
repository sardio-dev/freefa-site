// Answers the game's requests from the files boot.js downloaded, so that a return visit fetches none of them. Only the
// public build registers this; see boot.js.
const CACHE = 'kickoff-game';
const MANIFEST = '/__cache/manifest';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // boot.js downloads with a query, which has to reach the network even when an older copy of the file is held.
  if (event.request.method !== 'GET' || event.request.mode === 'navigate') return;
  if (url.origin !== location.origin || url.search) return;
  event.respondWith(serve(event.request, url.pathname));
});

// The manifest is read for every request, not kept in a variable, because the browser stops this worker whenever it
// likes and boot.js replaces the manifest from the page.
async function serve(request, path) {
  try {
    const cache = await caches.open(CACHE);
    const manifest = await (await cache.match(MANIFEST))?.json();
    const file = manifest?.files[path];
    const held = file && (await cache.match(`/__cache/${file.hash}`));
    if (held) return held;
  } catch (error) {
    console.warn('cache unavailable', error);
  }
  return fetch(request);
}

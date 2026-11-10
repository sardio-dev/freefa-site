// Starts the game. On the public site its files are first downloaded into the browser's Cache Storage, where sw.js
// serves them, so a return visit downloads nothing. GitHub Pages sets its own Cache-Control, which has the browser ask
// again after ten minutes, so response headers cannot do this.
//
// Files are stored by the hash of their content, and the manifest that names them is replaced only once all of a new
// build's files are held. A visit therefore runs one whole build, never a new wasm with an old script, a download cut
// short resumes from the files it finished, and a new build fetches only the files that changed.
const CACHE = 'kickoff-game';
const MANIFEST = '/__cache/manifest';
const DOWNLOADS_AT_ONCE = 6;
const CONTROL_WAIT_MS = 2000;
const LOADING_LIMIT_MS = 60000;

const stored = (hash) => `/__cache/${hash}`;

function hex(digest) {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A hard reload leaves the page outside the worker's control and no event says so, hence the wait's limit. The game
// then comes from the network, which is what a hard reload asks for.
async function takeControl() {
  const workers = navigator.serviceWorker;
  await workers.register('/sw.js');
  if (workers.controller) return;
  await new Promise((done) => {
    workers.addEventListener('controllerchange', done, { once: true });
    setTimeout(done, CONTROL_WAIT_MS);
  });
}

function showLoading(updating, total) {
  const screen = document.getElementById('loading');
  screen.querySelector('p').textContent = updating
    ? 'Downloading the new version'
    : 'Downloading the game. This happens once, and later visits start faster.';
  const bar = screen.querySelector('.bar');
  const fill = screen.querySelector('i');
  const count = screen.querySelector('.count');
  const megabytes = (bytes) => (bytes / 1e6).toFixed(0);
  return (received) => {
    const percent = Math.min(100, (100 * received) / total);
    fill.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', percent.toFixed(0));
    count.textContent = `${megabytes(received)} of ${megabytes(total)} MB`;
  };
}

// The body is read here, not through Cache.add, to count its bytes. They are counted as they arrive, after the browser
// has unpacked them, so they add up to the manifest's sizes whatever compression the host applies. The hash is checked
// because a host can answer with the previous build's file for a moment after a publish, and a wrong file stored under
// this hash would stay for good.
async function download(cache, { path, hash }, onBytes) {
  const response = await fetch(`${path}?v=${hash}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const chunks = [];
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  const blob = new Blob(chunks);
  if (hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())) !== hash) {
    throw new Error(`${path}: not the file the manifest names`);
  }
  const headers = { 'content-type': response.headers.get('content-type') ?? '' };
  await cache.put(stored(hash), new Response(blob, { headers }));
}

async function downloadAll(cache, missing, updating) {
  const total = missing.reduce((sum, file) => sum + file.size, 0);
  const show = showLoading(updating, total);
  let received = 0;
  show(received);
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: DOWNLOADS_AT_ONCE }, async () => {
      while (queue.length) {
        await download(cache, queue.pop(), (bytes) => show((received += bytes)));
      }
    }),
  );
  // Asks the browser not to clear these files when the disk runs low. Firefox puts the question to the player, so it
  // is only asked of someone who has just waited for the download.
  navigator.storage?.persist?.();
}

async function dropOldFiles(cache, files) {
  const kept = new Set([MANIFEST, ...files.map((file) => stored(file.hash))]);
  for (const request of await cache.keys()) {
    if (!kept.has(new URL(request.url).pathname)) await cache.delete(request);
  }
}

async function prepareCache() {
  await takeControl();
  const cache = await caches.open(CACHE);
  const response = await fetch('/cache-manifest.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`cache-manifest.json: ${response.status}`);
  const text = await response.text();
  const files = Object.entries(JSON.parse(text).files).map(([path, file]) => ({ path, ...file }));
  const held = await Promise.all(files.map((file) => cache.match(stored(file.hash))));
  const missing = files.filter((_, i) => !held[i]);
  if (missing.length) await downloadAll(cache, missing, Boolean(await cache.match(MANIFEST)));
  await cache.put(MANIFEST, new Response(text));
  await dropOldFiles(cache, files);
}

// The build marks its page; see tools/dev/build-public.sh. A dev server must never serve yesterday's build from here.
if (document.documentElement.hasAttribute('data-cache') && navigator.serviceWorker && crypto.subtle) {
  try {
    await prepareCache();
  } catch (error) {
    // Offline, out of quota or a failed download. The game can still start from whatever the network or the last
    // whole build provides, and the next visit picks the download up again.
    console.warn('game files not cached', error);
  }
}
// The game takes the loading screen away once it has drawn the stadium; see crates/client/src/loading.rs. If it never
// gets that far, the menu still has to come into view.
setTimeout(() => document.getElementById('loading')?.remove(), LOADING_LIMIT_MS);
const { default: init } = await import('./pkg/kickoff_client.js');
await init();

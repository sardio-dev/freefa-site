// Generates SMGDiff chunks off the page's main thread. See crates/client/src/motion/worker.rs.
import init, { smgdiff_generate, smgdiff_load } from './pkg/kickoff_client.js';

const loaded = (async () => {
  try {
    await init();
    const [manifest, bin] = await Promise.all([
      fetch('/motion/smgdiff.json').then((r) => r.text()),
      fetch('/motion/smgdiff.bin').then((r) => r.arrayBuffer()),
    ]);
    return smgdiff_load(manifest, new Uint8Array(bin));
  } catch {
    return false;
  }
})();

loaded.then((ok) => {
  if (ok) postMessage('ready');
});

onmessage = async (event) => {
  await loaded;
  const reply = smgdiff_generate(event.data);
  if (reply.length) postMessage(reply, [reply.buffer]);
};

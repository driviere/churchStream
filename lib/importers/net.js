'use strict';
// Small download helpers built on Node's global fetch.
async function download(url, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ChurchStream' } });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Download timed out. Check the internet connection.');
    if (/fetch failed/i.test(err.message)) throw new Error('Could not connect. Check the internet connection.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// Run async jobs with limited parallelism.
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

module.exports = { download, pool };

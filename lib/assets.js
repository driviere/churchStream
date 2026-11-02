'use strict';
// Read-only application files (web UI + default data). Inside the packaged exe they are
// embedded SEA assets; in development they are read straight from the repo.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const ROOTS = ['public', 'defaults'];
let manifest = null;

function getAsset(key) {
  key = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!ROOTS.some((r) => key.startsWith(r + '/')) || key.includes('..')) return null;
  if (paths.isSea) {
    try { return Buffer.from(paths.sea.getAsset(key)); } catch { return null; }
  }
  try { return fs.readFileSync(path.join(paths.appRoot, key)); } catch { return null; }
}

function walk(dir, base, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = base + '/' + e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
}

function listAssets(prefix) {
  if (!manifest) {
    if (paths.isSea) {
      try { manifest = JSON.parse(Buffer.from(paths.sea.getAsset('assets-manifest.json')).toString('utf8')); }
      catch { manifest = []; }
    } else {
      manifest = ROOTS.flatMap((r) => walk(path.join(paths.appRoot, r), r, []));
    }
  }
  return manifest.filter((k) => k.startsWith(prefix));
}

// Copy defaults/<sub>/** into the user data dir on first run (never overwrites).
function seedDefaults() {
  const marker = path.join(paths.dataDir, '.seeded');
  if (fs.existsSync(marker)) return false;
  for (const key of listAssets('defaults/')) {
    const dest = path.join(paths.dataDir, key.slice('defaults/'.length));
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, getAsset(key));
  }
  fs.writeFileSync(marker, new Date().toISOString());
  return true;
}

module.exports = { getAsset, listAssets, seedDefaults };

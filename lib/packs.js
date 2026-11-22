'use strict';
// Which copy of ChurchStream's own code runs: the one built into the program, or a newer
// "app pack" that the updater (lib/updater.js) downloaded into <data>/app/<version>/.
// Used by the start-up loader (scripts/launcher.cjs) before the app itself runs.
//
// <data>/app/current.json = { version, dir, sha256, minRuntime, bad }
//   sha256      of the pack's churchstream.cjs (checked at every start: a damaged pack is skipped)
//   minRuntime  the Node major version the pack needs (a pack needing a newer one waits for
//               the full download)
//   bad         set when the pack failed to start twice in a row; it is not tried again
// <data>/run/boot-pending = { version, tries } while a pack is starting; the server removes
// it once it is listening (bootOk). Found again at the next start = that start failed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FAILS_BEFORE_GIVING_UP = 2;

// Compare "0.5.10" with "0.5.9" (numbers, not text). Anything after a "-" (0.6.0-rc1) sorts
// before the plain version.
function cmpVersion(a, b) {
  const parse = (v) => { const [main, pre] = String(v || '0').replace(/^v/, '').split('-'); return { n: main.split('.').map((x) => Number(x) || 0), pre: pre || '' }; };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
    const d = (x.n[i] || 0) - (y.n[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const runtimeMajor = (v) => Number(String(v || process.versions.node).split('.')[0]) || 0;

// → { kind: 'pack', dir, version } or { kind: 'builtin', failed?: version }
function chooseApp({ appsDir, runDir, builtinVersion, runtime = process.versions.node }) {
  const builtin = (extra) => ({ kind: 'builtin', ...extra });
  const curFile = path.join(appsDir, 'current.json');
  const cur = readJson(curFile);
  if (!cur || !cur.version || !cur.dir || cur.bad) return builtin();
  if (cmpVersion(cur.version, builtinVersion) <= 0) return builtin(); // the program itself is as new (a full update was installed)
  if (runtimeMajor(runtime) < (Number(cur.minRuntime) || 0)) return builtin();
  const dir = path.join(appsDir, path.basename(cur.dir));
  let code;
  try { code = fs.readFileSync(path.join(dir, 'churchstream.cjs')); } catch { return builtin(); }
  if (cur.sha256 && sha256(code) !== cur.sha256) return builtin();
  // Did the last starts of this pack fail?
  const markerFile = path.join(runDir, 'boot-pending');
  const marker = readJson(markerFile);
  const tries = marker && marker.version === cur.version ? (Number(marker.tries) || 1) : 0;
  if (tries >= FAILS_BEFORE_GIVING_UP) {
    try { fs.writeFileSync(curFile, JSON.stringify({ ...cur, bad: true }, null, 2)); } catch { /* read-only */ }
    try { fs.rmSync(markerFile, { force: true }); } catch { /* gone */ }
    return builtin({ failed: cur.version });
  }
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(markerFile, JSON.stringify({ version: cur.version, tries: tries + 1 }));
  } catch { /* read-only data folder: just start it */ }
  return { kind: 'pack', dir, version: cur.version };
}

// The server is listening: this start worked.
function bootOk(runDir) {
  try { fs.rmSync(path.join(runDir, 'boot-pending'), { force: true }); } catch { /* fine */ }
}

module.exports = { cmpVersion, chooseApp, bootOk, sha256, runtimeMajor, FAILS_BEFORE_GIVING_UP };

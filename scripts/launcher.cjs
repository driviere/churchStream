'use strict';
// The start-up loader: the "main" of the packaged program (Node single executable).
// It runs ChurchStream's own code, either the copy built into the program or a newer app pack
// that the updater downloaded (only a few MB: the program and FFmpeg rarely change, so they
// aren't downloaded again). See lib/packs.js for the rules, and lib/updater.js.
// Bundled by scripts/build-exe.js; ChurchStream's code itself is the SEA asset
// app/churchstream.cjs.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const sea = require('node:sea');
const { dataDirFor } = require('../lib/datadir');
const { chooseApp } = require('../lib/packs');

const appRoot = path.dirname(process.execPath);
let pick = { kind: 'builtin' };
try {
  const dataDir = dataDirFor(appRoot, true);
  const builtin = JSON.parse(sea.getAsset('pack.json', 'utf8'));
  pick = chooseApp({ appsDir: path.join(dataDir, 'app'), runDir: path.join(dataDir, 'run'), builtinVersion: builtin.version });
} catch { /* anything odd: the built-in copy */ }

let filename;
let code;
if (pick.kind === 'pack') {
  process.env.CHURCHSTREAM_PACK = pick.dir;
  filename = path.join(pick.dir, 'churchstream.cjs');
  code = fs.readFileSync(filename, 'utf8');
} else {
  if (pick.failed) process.env.CHURCHSTREAM_UPDATE_FAILED = pick.failed;
  delete process.env.CHURCHSTREAM_PACK;
  filename = path.join(appRoot, 'churchstream.cjs');
  code = sea.getAsset('app/churchstream.cjs', 'utf8');
}
const m = new Module(filename, null);
m.filename = filename;
m.id = '.';
m.paths = Module._nodeModulePaths(path.dirname(filename));
process.mainModule = m;
m._compile(code, filename);

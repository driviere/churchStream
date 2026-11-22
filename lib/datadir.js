'use strict';
// Where a packaged ChurchStream keeps its data (settings, songs, recordings, updates). Shared
// by lib/paths.js and the start-up loader (scripts/launcher.cjs), which needs it before the
// app itself runs.
//   1. CHURCHSTREAM_DATA (the Mac app and tests set it)
//   2. ChurchStream.ini next to the program, with a line  data=<folder>  (the Windows
//      installer writes one, so the data lives in the user's home folder and survives
//      uninstalling and reinstalling). "~" means the home folder.
//   3. the ChurchStream-data folder next to the program (the portable zip)
const fs = require('fs');
const os = require('os');
const path = require('path');

function iniData(appRoot) {
  let text = '';
  try { text = fs.readFileSync(path.join(appRoot, 'ChurchStream.ini'), 'utf8'); } catch { return null; }
  const m = /^\s*data\s*=\s*(.+?)\s*$/im.exec(text);
  if (!m) return null;
  let p = m[1].replace(/^"(.*)"$/, '$1');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), ...p.slice(1).split(/[\\/]+/).filter(Boolean));
  return path.resolve(appRoot, p);
}

function dataDirFor(appRoot, packaged) {
  if (process.env.CHURCHSTREAM_DATA) return path.resolve(process.env.CHURCHSTREAM_DATA);
  if (packaged) {
    const ini = iniData(appRoot);
    if (ini) return ini;
  }
  return path.join(appRoot, packaged ? 'ChurchStream-data' : 'userdata');
}

module.exports = { dataDirFor, iniData };

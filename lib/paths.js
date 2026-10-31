'use strict';
// Where things live. Two modes:
//  - development: running `node server.js` from the repo; user data goes to ./userdata
//  - packaged:    running ChurchStream.exe (Node single executable); user data goes to
//                 ./ChurchStream-data next to the exe so the whole folder is portable.
const path = require('path');

let sea = null;
try { sea = require('node:sea'); } catch { /* older Node: not packaged */ }
const isSea = !!(sea && typeof sea.isSea === 'function' && sea.isSea());

const appRoot = isSea ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const dataDir = process.env.CHURCHSTREAM_DATA
  ? path.resolve(process.env.CHURCHSTREAM_DATA)
  : path.join(appRoot, isSea ? 'ChurchStream-data' : 'userdata');

module.exports = {
  isSea,
  sea: isSea ? sea : null,
  appRoot,
  dataDir,
  configFile: path.join(dataDir, 'config.json'),
  planFile: path.join(dataDir, 'plan.json'),
  songsDir: path.join(dataDir, 'songs'),
  bibleDir: path.join(dataDir, 'bible'),
  mediaDir: path.join(dataDir, 'media'),
  recordingsDir: path.join(dataDir, 'recordings'),
  runDir: path.join(dataDir, 'run'),
};

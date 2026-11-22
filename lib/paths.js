'use strict';
// Where things live. Two modes:
//  - development: running `node server.js` from the repo; user data goes to ./userdata
//  - packaged:    running ChurchStream.exe (Node single executable); user data goes to
//                 ./ChurchStream-data next to the exe so the whole folder is portable, or
//                 where ChurchStream.ini says (the Windows installer: the home folder).
//                 See lib/datadir.js.
// An updated app pack (downloaded by lib/updater.js, started by scripts/launcher.cjs) runs
// from <data>/app/<version>; packDir is then that folder (its web pages and default data).
const path = require('path');
const { dataDirFor } = require('./datadir');

let sea = null;
try { sea = require('node:sea'); } catch { /* older Node: not packaged */ }
const isSea = !!(sea && typeof sea.isSea === 'function' && sea.isSea());

const appRoot = isSea ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const dataDir = dataDirFor(appRoot, isSea);

module.exports = {
  isSea,
  sea: isSea ? sea : null,
  appRoot,
  dataDir,
  packDir: process.env.CHURCHSTREAM_PACK ? path.resolve(process.env.CHURCHSTREAM_PACK) : null,
  configFile: path.join(dataDir, 'config.json'),
  planFile: path.join(dataDir, 'plan.json'),
  songsDir: path.join(dataDir, 'songs'),
  bibleDir: path.join(dataDir, 'bible'),
  mediaDir: path.join(dataDir, 'media'),
  recordingsDir: path.join(dataDir, 'recordings'),
  runDir: path.join(dataDir, 'run'),
  appsDir: path.join(dataDir, 'app'),
  ffmpegUpdatesDir: path.join(dataDir, 'ffmpeg'),
};

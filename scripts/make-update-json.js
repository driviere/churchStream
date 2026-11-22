#!/usr/bin/env node
'use strict';
// Writes update.json for a release: what the updater in ChurchStream (lib/updater.js) needs to
// download only what changed.
//
//   node scripts/make-update-json.js <dist folder> <tag> [<repo url>]
//
// Reads from the dist folder: ChurchStream-app-<version>.zip (the app pack), and for each
// platform ffmpeg-<target>.zip with ffmpeg-<target>.json ({ id }) when present.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readZip } = require('../lib/unzip');

const [dist, tag, repoUrl = 'https://github.com/driviere/churchStream'] = process.argv.slice(2);
if (!dist || !tag) { console.error('Usage: make-update-json.js <dist> <tag> [repo url]'); process.exit(2); }

function describe(file) {
  const buf = fs.readFileSync(path.join(dist, file));
  return { file, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

const packFile = `ChurchStream-app-${tag.replace(/^v/, '')}.zip`;
if (!fs.existsSync(path.join(dist, packFile))) { console.error(`No ${packFile} in ${dist}`); process.exit(1); }
const packJson = readZip(fs.readFileSync(path.join(dist, packFile))).find((e) => e.name === 'pack.json');
if (!packJson) { console.error(packFile + ' has no pack.json'); process.exit(1); }
const pack = JSON.parse(packJson.read().toString('utf8'));
if (`v${pack.version}` !== tag && pack.version !== tag) { console.error(`The app pack is version ${pack.version}, but the release is ${tag}`); process.exit(1); }

const ffmpeg = {};
for (const target of ['win-x64', 'mac-arm64', 'mac-x64']) {
  const meta = path.join(dist, `ffmpeg-${target}.json`);
  if (!fs.existsSync(meta)) continue;
  const { id, file } = JSON.parse(fs.readFileSync(meta, 'utf8'));
  if (!fs.existsSync(path.join(dist, file))) continue;
  ffmpeg[target] = { id, ...describe(file) };
}

const notesUrl = `${repoUrl}/releases/tag/${tag}`;
const update = {
  format: 'churchstream-update',
  version: pack.version,
  minRuntime: pack.minRuntime,
  notesUrl,
  fullUrl: notesUrl,
  pack: describe(packFile),
  ffmpeg,
};
fs.writeFileSync(path.join(dist, 'update.json'), JSON.stringify(update, null, 2));
console.log(JSON.stringify(update, null, 2));

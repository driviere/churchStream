#!/usr/bin/env node
'use strict';
// Build the portable Windows release:
//
//   dist/ChurchStream/ChurchStream.exe     ← Node.js single executable with the app inside
//   dist/ChurchStream/ffmpeg/ffmpeg.exe    ← FFmpeg (GPL build, with its licence)
//   dist/ChurchStream/README.txt
//   dist/ChurchStream-win-x64.zip
//
// Works on Windows, Linux or macOS (the exe is always for Windows x64).
// Options: --no-ffmpeg   skip bundling FFmpeg
//          --ffmpeg-zip <file>  use a local FFmpeg zip instead of downloading
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readZip } = require('../lib/unzip');
const { zipDirectory } = require('./zip');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, 'ChurchStream');
const CACHE = path.join(BUILD, 'cache');
const NODE_VERSION = process.version; // the SEA blob must match the node.exe version
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
// BtbN renames release builds as FFmpeg versions move on, so try the newest names first.
const FFMPEG_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
const FFMPEG_CANDIDATES = process.env.FFMPEG_URL ? [process.env.FFMPEG_URL] : [
  'ffmpeg-n8.1-latest-win64-gpl-8.1.zip', 'ffmpeg-n8.0-latest-win64-gpl-8.0.zip', 'ffmpeg-n7.1-latest-win64-gpl-7.1.zip', 'ffmpeg-master-latest-win64-gpl.zip',
].map((f) => FFMPEG_BASE + f);
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const step = (m) => console.log(`\n▸ ${m}`);

async function fetchTo(url, file) {
  if (fs.existsSync(file)) { console.log(`  cached ${path.basename(file)}`); return file; }
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(file + '.part', file);
  return file;
}

function listFiles(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

let ffmpegUrl = null;

async function main() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  step('Bundling the server');
  require('esbuild').buildSync({
    entryPoints: [path.join(ROOT, 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(BUILD, 'churchstream.cjs'),
    external: ['node:sea', 'node:sqlite'],
    legalComments: 'none',
    logLevel: 'warning',
  });

  step('Embedding the web UI and default data');
  const keys = [...listFiles(path.join(ROOT, 'public'), 'public'), ...listFiles(path.join(ROOT, 'defaults'), 'defaults')];
  fs.writeFileSync(path.join(BUILD, 'assets-manifest.json'), JSON.stringify(keys));
  const assets = { 'assets-manifest.json': path.join(BUILD, 'assets-manifest.json') };
  for (const k of keys) assets[k] = path.join(ROOT, k);
  console.log(`  ${keys.length} files`);
  const seaConfig = {
    main: path.join(BUILD, 'churchstream.cjs'),
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false, // code cache is platform-specific; we may be cross-building
    assets,
  };
  fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

  step(`Creating ChurchStream.exe (Node ${NODE_VERSION})`);
  const nodeExe = await fetchTo(NODE_URL, path.join(CACHE, `node-${NODE_VERSION}-win-x64.exe`));
  const exe = path.join(APP, 'ChurchStream.exe');
  fs.copyFileSync(nodeExe, exe);
  if (process.platform === 'win32') {
    try { execFileSync('signtool', ['remove', '/s', exe], { stdio: 'ignore' }); } catch { /* signtool is optional */ }
  }
  const postject = require.resolve('postject/dist/cli.js');
  execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', path.join(BUILD, 'sea-prep.blob'), '--sentinel-fuse', FUSE, '--overwrite'], { stdio: 'inherit' });

  if (!flag('--no-ffmpeg')) {
    step('Adding FFmpeg');
    let zipFile = opt('--ffmpeg-zip');
    for (const url of zipFile ? [] : FFMPEG_CANDIDATES) {
      try { zipFile = await fetchTo(url, path.join(CACHE, path.basename(url))); ffmpegUrl = url; break; } catch (err) { console.log(`  ${err.message}`); }
    }
    if (!zipFile) throw new Error('Could not download FFmpeg. Pass --ffmpeg-zip <file> or --no-ffmpeg.');
    const entries = readZip(fs.readFileSync(zipFile));
    const pick = (re) => entries.find((e) => re.test(e.name));
    const ff = pick(/(^|\/)bin\/ffmpeg\.exe$/) || pick(/(^|\/)ffmpeg\.exe$/);
    if (!ff) throw new Error('ffmpeg.exe not found in ' + zipFile);
    fs.mkdirSync(path.join(APP, 'ffmpeg'), { recursive: true });
    fs.writeFileSync(path.join(APP, 'ffmpeg', 'ffmpeg.exe'), ff.read());
    const lic = pick(/(^|\/)LICENSE(\.txt)?$/i);
    fs.writeFileSync(path.join(APP, 'ffmpeg', 'LICENSE.txt'), (lic ? lic.read().toString('utf8') : '') +
      `\n\nThis ffmpeg.exe is an unmodified build from https://github.com/BtbN/FFmpeg-Builds (GPL).\nSource code: https://ffmpeg.org/download.html and https://github.com/BtbN/FFmpeg-Builds (${path.basename(ffmpegUrl || zipFile)})\n`);
  }

  step('Writing README.txt');
  fs.writeFileSync(path.join(APP, 'README.txt'), README.replace(/\n/g, '\r\n'));

  step('Zipping');
  const zipOut = path.join(DIST, 'ChurchStream-win-x64.zip');
  zipDirectory(APP, zipOut, 'ChurchStream');
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
  console.log(`\n✓ ${path.relative(ROOT, exe)} (${mb(exe)})`);
  console.log(`✓ ${path.relative(ROOT, zipOut)} (${mb(zipOut)})\n`);
}

const README = `ChurchStream
============

Live streaming to YouTube and Facebook, song lyrics, Bible verses and lower thirds
for small churches. Everything runs on this one computer.

Getting started
---------------
1. Unzip this folder anywhere (for example to your Desktop or Documents).
2. Double-click ChurchStream.exe.
   The first time, Windows may say "Windows protected your PC".
   Click "More info", then "Run anyway". (The app is not code-signed.)
   If Windows Firewall asks, allow access on Private networks so tablets can connect.
3. Your web browser opens the setup page. Follow the steps.

Every Sunday
------------
- Double-click ChurchStream.exe. The control panel opens in your browser.
- Close the black ChurchStream window to stop everything.

Moving to another computer
--------------------------
Copy the whole ChurchStream folder. Your settings, songs and Bibles are in the
"ChurchStream-data" folder next to ChurchStream.exe and come along automatically.

Recordings are saved in ChurchStream-data\\recordings.
`;

main().catch((err) => { console.error('\n✗ ' + err.message); process.exit(1); });

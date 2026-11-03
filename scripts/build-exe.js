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
// --target win-x64 (default) | mac-arm64 (Apple Silicon) | mac-x64 (Intel Macs)
const TARGET = opt('--target') || 'win-x64';
if (!['win-x64', 'mac-arm64', 'mac-x64'].includes(TARGET)) throw new Error('Unknown --target ' + TARGET);
const MAC = TARGET.startsWith('mac-');
const MAC_ARCH = TARGET === 'mac-arm64' ? 'arm64' : 'x64';
// Static macOS FFmpeg builds (GPL, with libx264), by Martin Riedl; evermeet.cx as an Intel fallback.
const MAC_FFMPEG = process.env.FFMPEG_URL ? [process.env.FFMPEG_URL] : MAC_ARCH === 'arm64'
  ? ['https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip']
  : ['https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip', 'https://evermeet.cx/ffmpeg/getrelease/zip'];
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...o });
const step = (m) => console.log(`\n▸ ${m}`);

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { console.log(`  cached ${path.basename(file)}`); return file; }
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

  if (MAC) return buildMac();

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

// macOS: the official Node binary for the chosen chip with the app injected, ad-hoc signed
// (Apple Silicon only runs signed code), plus FFmpeg and a double-clickable start script.
// Must run on a Mac (codesign and ditto are macOS tools).
async function buildMac() {
  if (process.platform !== 'darwin') throw new Error('Build the Mac version on a Mac (it needs codesign).');
  const name = `node-${NODE_VERSION}-darwin-${MAC_ARCH}`;
  step(`Creating ChurchStream for Mac (${MAC_ARCH}, Node ${NODE_VERSION})`);
  const tgz = await fetchTo(`https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`, path.join(CACHE, name + '.tar.gz'));
  run('tar', ['-xzf', tgz, '-C', CACHE, `${name}/bin/node`]);
  const bin = path.join(APP, 'ChurchStream');
  fs.copyFileSync(path.join(CACHE, name, 'bin', 'node'), bin);
  fs.chmodSync(bin, 0o755);
  run('codesign', ['--remove-signature', bin]);
  const postject = require.resolve('postject/dist/cli.js');
  run(process.execPath, [postject, bin, 'NODE_SEA_BLOB', path.join(BUILD, 'sea-prep.blob'), '--sentinel-fuse', FUSE, '--macho-segment-name', 'NODE_SEA', '--overwrite']);
  run('codesign', ['--sign', '-', '--force', bin]);

  if (!flag('--no-ffmpeg')) {
    step('Adding FFmpeg');
    let zipFile = opt('--ffmpeg-zip');
    for (const url of zipFile ? [] : MAC_FFMPEG) {
      try { zipFile = await fetchTo(url, path.join(CACHE, `ffmpeg-mac-${MAC_ARCH}-${MAC_FFMPEG.indexOf(url)}.zip`)); ffmpegUrl = url; break; } catch (err) { console.log(`  ${err.message}`); }
    }
    if (!zipFile) throw new Error('Could not download FFmpeg for Mac. Pass --ffmpeg-zip <file> or --no-ffmpeg.');
    const entries = readZip(fs.readFileSync(zipFile));
    const ff = entries.find((e) => /(^|\/)ffmpeg$/.test(e.name));
    if (!ff) throw new Error('ffmpeg not found in ' + zipFile);
    const ffPath = path.join(APP, 'ffmpeg', 'ffmpeg');
    fs.mkdirSync(path.dirname(ffPath), { recursive: true });
    fs.writeFileSync(ffPath, ff.read(), { mode: 0o755 });
    try { execFileSync('codesign', ['-v', ffPath], { stdio: 'ignore' }); } catch { run('codesign', ['--sign', '-', '--force', ffPath]); }
    fs.writeFileSync(path.join(APP, 'ffmpeg', 'LICENSE.txt'),
      `This ffmpeg is an unmodified static build of FFmpeg (GPL), from ${ffmpegUrl || path.basename(zipFile)}.\nFFmpeg is licensed under the GNU GPL; source code: https://ffmpeg.org/download.html\n`);
  }

  step('Writing the start script and README');
  const start = path.join(APP, 'Start ChurchStream.command');
  fs.writeFileSync(start, `#!/bin/bash
# Double-click to start ChurchStream. Keep this window open during the service;
# close it (or press Control-C) to stop everything.
cd "$(dirname "$0")" || exit 1
# Files downloaded from the internet are marked by macOS; clear that so ChurchStream and
# FFmpeg are allowed to run.
xattr -dr com.apple.quarantine . 2>/dev/null
echo ""
echo "  ChurchStream is starting. Keep this window open during the service."
echo "  Close it to stop ChurchStream."
echo ""
exec ./ChurchStream
`, { mode: 0o755 });
  fs.writeFileSync(path.join(APP, 'README.txt'), README_MAC);

  step('Zipping');
  const zipOut = path.join(DIST, `ChurchStream-${TARGET}.zip`);
  fs.rmSync(zipOut, { force: true });
  // ditto keeps the executable permissions and signatures that a plain zip would lose.
  run('ditto', ['-c', '-k', '--keepParent', APP, zipOut]);
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
  console.log(`\n✓ ${path.relative(ROOT, bin)} (${mb(bin)})`);
  console.log(`✓ ${path.relative(ROOT, zipOut)} (${mb(zipOut)})\n`);
}

const README_MAC = `ChurchStream for Mac
====================

Live streaming to YouTube and Facebook, hymns, Bible readings and lower thirds for
Seventh-day Adventist churches. Everything runs on this one Mac.

Getting started
---------------
1. Move this ChurchStream folder somewhere permanent, e.g. your Documents folder.
2. Double-click "Start ChurchStream.command".
   The first time, macOS may say it "cannot be opened" or "Apple could not verify" it,
   because ChurchStream isn't from the App Store. Then:
     - open System Settings → Privacy & Security, scroll down, and click "Open Anyway"
       next to "Start ChurchStream.command"; or
     - in Finder, Control-click the file, choose Open, then Open again.
3. A Terminal window opens and keeps ChurchStream running. Your browser opens the
   setup page. Follow the steps.
4. When macOS asks whether Terminal may use the camera and microphone, click Allow.
   When it asks whether ChurchStream may accept incoming network connections, click
   Allow, so phones and tablets can connect.

Every Sabbath
-------------
- Double-click "Start ChurchStream.command". Keep its window open.
- Close that window to stop everything.
- For the projector, Google Chrome (free) gives an automatic full-screen window on the
  projector. Without it the projector page opens in Safari: drag it to the projector
  and press Control-Command-F.
- ChurchStream keeps the Mac awake while it's running. Plug the laptop in.

User manual
-----------
Click the "?" button at the top of the control panel (or open
http://localhost:8080/manual while ChurchStream is running).

Moving to another computer
--------------------------
Copy the whole ChurchStream folder. Your settings, songs and services are in the
"ChurchStream-data" folder next to the ChurchStream program.
`;

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

Every Sabbath
-------------
- Double-click ChurchStream.exe. The control panel opens in your browser.
- Close the black ChurchStream window to stop everything.

User manual
-----------
Click the "?" button at the top of the control panel (or open
http://localhost:8080/manual while ChurchStream is running).

Moving to another computer
--------------------------
Copy the whole ChurchStream folder. Your settings, songs and Bibles are in the
"ChurchStream-data" folder next to ChurchStream.exe and come along automatically.

Recordings are saved in ChurchStream-data\\recordings.
`;

main().catch((err) => { console.error('\n✗ ' + err.message); process.exit(1); });

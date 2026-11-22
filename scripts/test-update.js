#!/usr/bin/env node
'use strict';
// End-to-end test of updates with the real, built program (CI on Windows and Mac; Linux too):
//
//   node scripts/test-update.js <program> <newer app pack zip> [port]
//
//   <program>  the built ChurchStream (ChurchStream.exe, the Linux test program, or
//              ChurchStream.app: then it is opened like a user would, with its data in
//              ~/ChurchStream-data, and Restart goes through the app's own launcher)
//   <zip>      an app pack of a newer version (build-exe.js --pack-only --version 9.9.9)
//
// A small local server stands in for GitHub (CHURCHSTREAM_UPDATE_URL). Then:
//   1. the update shows up by itself (no click), with its notes
//   2. Update downloads it and checks its SHA-256; it is ready
//   3. Restart: the same address answers again, now as the new version
//   4. a damaged update (code that throws) is given up after two failed starts, and
//      ChurchStream runs as the version built into the program, saying so
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const [program, packZip, portArg] = process.argv.slice(2);
if (!program || !packZip) { console.error('Usage: test-update.js <program> <app pack zip> [port]'); process.exit(2); }
const PROGRAM = path.resolve(program);
const PORT = Number(portArg) || 8131;
const DIST = path.dirname(path.resolve(packZip));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-update-'));
const MAC_APP = /\.app\/?$/.test(PROGRAM);
const DATA = MAC_APP ? path.join(os.homedir(), 'ChurchStream-data') : path.join(TMP, 'data');
const step = (m) => console.log(`\n▸ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error(`::error::${m}`); cleanup(); process.exit(1); };

// --- the stand-in for GitHub ---------------------------------------------------------------
let srvPort = 0;
const tag = () => JSON.parse(fs.readFileSync(path.join(DIST, 'update.json'), 'utf8')).version;
const srv = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${srvPort}`;
  if (req.url === '/repos/driviere/churchStream/releases/latest') {
    const files = ['update.json', path.basename(packZip)];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ tag_name: 'v' + tag(), html_url: `${base}/notes`, body: '## Download\n…\n\n## New in ' + tag() + '\n\n### Test\n- Updates download only what changed.\n',
      assets: files.map((f) => ({ name: f, size: fs.statSync(path.join(DIST, f)).size, browser_download_url: `${base}/dl/${encodeURIComponent(f)}` })) }));
    return;
  }
  const m = /^\/dl\/(.+)$/.exec(req.url);
  if (m) { const f = path.join(DIST, path.basename(decodeURIComponent(m[1]))); if (fs.existsSync(f)) { res.end(fs.readFileSync(f)); return; } }
  res.statusCode = 404;
  res.end('{}');
});

// --- ChurchStream --------------------------------------------------------------------------
let child = null;
const ENV = () => ({ CHURCHSTREAM_UPDATE_URL: `http://127.0.0.1:${srvPort}`, CHURCHSTREAM_UPDATE_DELAY_MS: '1500', CHURCHSTREAM_NO_BROWSER: '1' });
function start() {
  if (MAC_APP) {
    // Apps opened by macOS get their environment from launchd.
    for (const [k, v] of Object.entries(ENV())) spawnSync('launchctl', ['setenv', k, v]);
    spawnSync('open', [PROGRAM]);
    return null;
  }
  const env = { ...process.env, CHURCHSTREAM_DATA: DATA, ...ENV() };
  delete env.CHURCHSTREAM_PACK;
  child = spawn(PROGRAM, ['--port', String(PORT)], { cwd: path.dirname(PROGRAM), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.output = () => out;
  return child;
}
const url = (p) => `http://127.0.0.1:${PORT}${p}`;
async function api(p, body) {
  const res = await fetch(url(p), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
async function waitFor(what, test, seconds = 40) {
  const until = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < until) {
    try { last = await api('/api/state'); if (test(last)) return last; } catch { /* starting */ }
    await sleep(500);
  }
  fail(`Timed out waiting for: ${what}. Last state: ${last ? JSON.stringify({ version: last.version, update: last.update }) : 'no answer'}`);
}
// Whatever ChurchStream is running now (after a restart it is a new process).
function stopRunning() {
  if (MAC_APP) {
    spawnSync('osascript', ['-e', 'tell application "ChurchStream" to quit']);
    for (const k of Object.keys(ENV())) spawnSync('launchctl', ['unsetenv', k]);
  }
  let pid = null;
  try { pid = Number(fs.readFileSync(path.join(DATA, 'run', 'server.pid'), 'utf8')); } catch { /* none */ }
  for (const p of [pid, child && child.pid]) {
    if (!p) continue;
    try { process.kill(p); } catch { /* gone */ }
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p), '/T', '/F'], { stdio: 'ignore' });
  }
}
function cleanup() { stopRunning(); srv.close(); }

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srvPort = srv.address().port;
  // update.json for the newer pack, as the release would have it.
  const packVersion = JSON.parse(require('../lib/unzip').readZip(fs.readFileSync(path.resolve(packZip))).find((e) => e.name === 'pack.json').read().toString('utf8')).version;
  const made = spawnSync(process.execPath, [path.join(__dirname, 'make-update-json.js'), DIST, 'v' + packVersion], { encoding: 'utf8' });
  if (made.status !== 0) fail('make-update-json failed: ' + made.stderr);
  const NEW = tag();
  if (MAC_APP) {
    fs.rmSync(DATA, { recursive: true, force: true });
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ setupComplete: true, port: PORT }));
  }

  step(`ChurchStream starts and finds ${NEW} by itself`);
  start();
  const first = await waitFor('the update to show up', (s) => s.update && s.update.available && s.update.available.version === NEW);
  const OLD = first.version;
  console.log(`  running ${OLD}; offered ${NEW} (${first.update.available.needs}, ${first.update.available.size} bytes)`);
  if (!/only what changed/.test(first.update.available.notes)) fail('The notes did not come along: ' + first.update.available.notes);

  step('Update: download and check');
  await api('/api/update/install', {});
  await waitFor('the update to be ready', (s) => s.update.ready === NEW);
  console.log('  ready');

  step('Restart now: same address, new version');
  await api('/api/update/restart', {});
  await sleep(2500);
  const after = await waitFor(`ChurchStream ${NEW} to answer`, (s) => s.version === NEW, 60);
  console.log(`  now ${after.version}, offered: ${after.update.available ? after.update.available.version : 'nothing'}`);
  if (after.update.available) fail('The new version still offers an update');
  const page = await fetch(url('/control')).then((r) => r.text());
  if (!/<div id="app">/.test(page)) fail('The control panel page did not load from the new version');
  stopRunning();
  await sleep(2000);
  if (MAC_APP) { // (the fallback is tested on Windows and Linux: the Mac app would show a dialog)
    srv.close();
    console.log('\n✓ Updates work in the Mac app: found by themselves, downloaded and checked, restarted into');
    process.exit(0);
  }

  step('A damaged update falls back to the built-in version');
  const cur = JSON.parse(fs.readFileSync(path.join(DATA, 'app', 'current.json'), 'utf8'));
  const code = path.join(DATA, 'app', cur.dir, 'churchstream.cjs');
  fs.writeFileSync(code, 'throw new Error("damaged on purpose");\n');
  cur.sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(code)).digest('hex');
  fs.writeFileSync(path.join(DATA, 'app', 'current.json'), JSON.stringify(cur));
  for (let i = 1; i <= 2; i++) {
    start();
    const code_ = await new Promise((r) => child.on('exit', r));
    console.log(`  start ${i} with the damaged update: stopped (${code_})`);
  }
  start();
  const back = await waitFor('ChurchStream to start as the built-in version', (s) => s.version === OLD);
  console.log(`  running ${back.version}; failed update reported: ${back.update.failed}`);
  if (back.update.failed !== NEW) fail('The failed update was not reported');
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n✓ Updates work: found by themselves, downloaded and checked, restarted into, and a damaged one is given up');
  process.exit(0);
})().catch((err) => { console.error(err); fail(err.message); });

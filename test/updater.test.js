'use strict';
// Updates: version order, the start-up loader's choice and fallback, where data lives, and the
// updater against a stand-in for GitHub (no network). The whole flow with the real program is
// scripts/test-update.js (run in CI on Linux, Windows and the Mac app).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { cmpVersion, chooseApp, bootOk } = require('../lib/packs');
const { Updater, notesSummary, safeEntry, platformKey, updatedFfmpeg } = require('../lib/updater');
const { dataDirFor } = require('../lib/datadir');
const { writeZip } = require('../lib/zip');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-upd-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('versions compare as numbers; a pre-release comes before its release', () => {
  assert.equal(cmpVersion('0.5.10', '0.5.9'), 1);
  assert.equal(cmpVersion('1.0.0', '0.9.99'), 1);
  assert.equal(cmpVersion('v1.0.0', '1.0.0'), 0);
  assert.equal(cmpVersion('1.0.0-rc1', '1.0.0'), -1);
  assert.equal(cmpVersion('1.0.1', '1.0.0-rc9'), 1);
});

test('the release notes become a short "what\'s new"', () => {
  const body = 'Intro\n\n## Download\n| a | b |\n\n## New in 1.0.0\n\nBig update.\n\n### Updates\n- Only what changed.\n\n## Good to know\n- CCLI\n';
  const n = notesSummary(body);
  assert.match(n, /Big update/);
  assert.match(n, /Only what changed/);
  assert.doesNotMatch(n, /Download|CCLI/);
});

test('zip entries must stay inside their folder', () => {
  for (const ok of ['churchstream.cjs', 'public/control.js']) assert.equal(safeEntry(ok), true, ok);
  for (const bad of ['../x', 'public/../../x', '/etc/passwd', 'C:/Windows/x', '..\\x']) assert.equal(safeEntry(bad), false, bad);
  assert.equal(platformKey('win32', 'x64'), 'win-x64');
  assert.equal(platformKey('darwin', 'arm64'), 'mac-arm64');
  assert.equal(platformKey('darwin', 'x64'), 'mac-x64');
});

test('loader: a newer, intact pack runs; a damaged, older or too-new one does not', () => {
  const d = tmp();
  const apps = path.join(d, 'app');
  const run = path.join(d, 'run');
  const pick = (extra = {}) => chooseApp({ appsDir: apps, runDir: run, builtinVersion: '1.0.0', runtime: '22.5.0', ...extra });
  assert.deepEqual(pick(), { kind: 'builtin' }, 'nothing downloaded');
  fs.mkdirSync(path.join(apps, '1.0.1'), { recursive: true });
  const code = Buffer.from('module.exports = 1;');
  fs.writeFileSync(path.join(apps, '1.0.1', 'churchstream.cjs'), code);
  const cur = { version: '1.0.1', dir: '1.0.1', sha256: sha(code), minRuntime: 22 };
  fs.writeFileSync(path.join(apps, 'current.json'), JSON.stringify(cur));
  assert.equal(pick().kind, 'pack');
  bootOk(run);
  assert.equal(pick({ builtinVersion: '1.0.1' }).kind, 'builtin', 'the program itself is as new');
  assert.equal(pick({ runtime: '20.1.0' }).kind, 'builtin', 'needs a newer runtime');
  fs.writeFileSync(path.join(apps, 'current.json'), JSON.stringify({ ...cur, sha256: sha(Buffer.from('other')) }));
  assert.equal(pick().kind, 'builtin', 'damaged pack');
  fs.writeFileSync(path.join(apps, 'current.json'), JSON.stringify({ ...cur, dir: '../../etc' }));
  assert.equal(pick().kind, 'builtin', 'a folder outside app/ is never used');
  fs.rmSync(d, { recursive: true, force: true });
});

test('loader: a pack that fails to start twice is given up, and that is reported once', () => {
  const d = tmp();
  const apps = path.join(d, 'app');
  const run = path.join(d, 'run');
  fs.mkdirSync(path.join(apps, '1.0.1'), { recursive: true });
  const code = Buffer.from('throw new Error()');
  fs.writeFileSync(path.join(apps, '1.0.1', 'churchstream.cjs'), code);
  fs.writeFileSync(path.join(apps, 'current.json'), JSON.stringify({ version: '1.0.1', dir: '1.0.1', sha256: sha(code) }));
  const pick = () => chooseApp({ appsDir: apps, runDir: run, builtinVersion: '1.0.0' });
  assert.equal(pick().kind, 'pack', 'first try');
  assert.equal(pick().kind, 'pack', 'second try (the first never reached bootOk)');
  assert.deepEqual(pick(), { kind: 'builtin', failed: '1.0.1' });
  assert.deepEqual(pick(), { kind: 'builtin' }, 'not tried again, not reported again');
  assert.equal(JSON.parse(fs.readFileSync(path.join(apps, 'current.json'), 'utf8')).bad, true);
  // One start that worked clears the count.
  fs.writeFileSync(path.join(apps, 'current.json'), JSON.stringify({ version: '1.0.1', dir: '1.0.1', sha256: sha(code) }));
  assert.equal(pick().kind, 'pack');
  bootOk(run);
  assert.equal(pick().kind, 'pack');
  fs.rmSync(d, { recursive: true, force: true });
});

test('data folder: CHURCHSTREAM_DATA, then ChurchStream.ini (the installer), then next to the program', () => {
  const d = tmp();
  const saved = process.env.CHURCHSTREAM_DATA;
  delete process.env.CHURCHSTREAM_DATA;
  try {
    assert.equal(dataDirFor(d, true), path.join(d, 'ChurchStream-data'));
    assert.equal(dataDirFor(d, false), path.join(d, 'userdata'));
    fs.writeFileSync(path.join(d, 'ChurchStream.ini'), '[ChurchStream]\r\ndata=~\\ChurchStream-data\r\n');
    assert.equal(dataDirFor(d, true), path.join(os.homedir(), 'ChurchStream-data'));
    process.env.CHURCHSTREAM_DATA = path.join(d, 'x');
    assert.equal(dataDirFor(d, true), path.join(d, 'x'));
  } finally {
    if (saved === undefined) delete process.env.CHURCHSTREAM_DATA; else process.env.CHURCHSTREAM_DATA = saved;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('web pages and default data come from an updated pack when one runs', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'public'), { recursive: true });
  fs.writeFileSync(path.join(d, 'public', 'hello.txt'), 'from the pack');
  fs.writeFileSync(path.join(d, 'assets-manifest.json'), JSON.stringify(['public/hello.txt']));
  const r = spawnSync(process.execPath, ['-e', "const a=require('./lib/assets');console.log(String(a.getAsset('public/hello.txt')), a.listAssets('public/').join(','))"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, CHURCHSTREAM_PACK: d }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'from the pack public/hello.txt');
  fs.rmSync(d, { recursive: true, force: true });
});

// A stand-in for GitHub: fetch answers from a table.
function fakeGitHub(files, { version = '1.0.1', minRuntime = 22, ffmpeg = {} } = {}) {
  const url = (n) => `https://github.example/dl/${n}`;
  const update = { version, minRuntime, notesUrl: 'https://github.example/notes', pack: { file: 'pack.zip', sha256: sha(files['pack.zip']), size: files['pack.zip'].length }, ffmpeg };
  const all = { ...files, 'update.json': Buffer.from(JSON.stringify(update)) };
  const rel = { tag_name: 'v' + version, html_url: 'https://github.example/notes', body: '## New in x\n- Faster.\n', assets: Object.keys(all).map((n) => ({ name: n, size: all[n].length, browser_download_url: url(n) })) };
  const respond = (buf) => ({ ok: true, status: 200, json: async () => JSON.parse(buf.toString()), body: (async function* () { yield buf; })() });
  return async (u) => {
    if (u.endsWith('/releases/latest')) return respond(Buffer.from(JSON.stringify(rel)));
    const n = decodeURIComponent(u.split('/dl/')[1] || '');
    if (all[n]) return respond(all[n]);
    return { ok: false, status: 404 };
  };
}
const packZip = (version, extra = []) => writeZip([
  { name: 'churchstream.cjs', data: Buffer.from('// app') },
  { name: 'pack.json', data: Buffer.from(JSON.stringify({ version, minRuntime: 22 })) },
  { name: 'assets-manifest.json', data: Buffer.from('[]') },
  ...extra,
]);

test('updater: finds a newer version by itself and says what it needs; installs only on request', async () => {
  const d = tmp();
  const files = { 'pack.zip': packZip('1.0.1'), 'ff.zip': writeZip([{ name: 'ffmpeg', data: Buffer.from('ff') }, { name: 'ffmpeg.id', data: Buffer.from('b') }]) };
  const ffmpeg = { [platformKey('darwin', 'arm64')]: { id: 'b', file: 'ff.zip', sha256: sha(files['ff.zip']), size: files['ff.zip'].length } };
  const u = new Updater({ version: '1.0.0', dataDir: d, runtime: '22.1.0', platform: 'mac-arm64', ffmpegId: () => 'a', fetchImpl: fakeGitHub(files, { ffmpeg }) });
  const seen = [];
  u.on('change', (st) => seen.push(st));
  const st = await u.check();
  assert.equal(st.available.version, '1.0.1');
  assert.equal(st.available.needs, 'pack+ffmpeg');
  assert.match(st.available.notes, /Faster/);
  assert.ok(seen.some((x) => x.available), 'pushed to the pages (change event)');
  assert.ok(!fs.existsSync(path.join(d, 'app')), 'nothing downloaded before a click');
  await u.install();
  assert.equal(u.state.ready, '1.0.1');
  const cur = JSON.parse(fs.readFileSync(path.join(d, 'app', 'current.json'), 'utf8'));
  assert.equal(cur.version, '1.0.1');
  assert.ok(fs.existsSync(path.join(d, 'app', '1.0.1', 'churchstream.cjs')));
  assert.equal(updatedFfmpeg(path.join(d, 'ffmpeg'), 'ffmpeg').id, 'b');
  // The same FFmpeg id: only the pack.
  const u2 = new Updater({ version: '1.0.0', dataDir: tmp(), runtime: '22.1.0', platform: 'mac-arm64', ffmpegId: () => 'b', fetchImpl: fakeGitHub(files, { ffmpeg }) });
  assert.equal((await u2.check()).available.needs, 'pack');
  // Not ChurchStream's own FFmpeg (the church's): left alone.
  const u3 = new Updater({ version: '1.0.0', dataDir: tmp(), runtime: '22.1.0', platform: 'mac-arm64', ffmpegId: () => null, fetchImpl: fakeGitHub(files, { ffmpeg }) });
  assert.equal((await u3.check()).available.needs, 'pack');
  // A newer runtime needed: the full download.
  const u4 = new Updater({ version: '1.0.0', dataDir: tmp(), runtime: '20.1.0', fetchImpl: fakeGitHub(files) });
  assert.equal((await u4.check()).available.needs, 'full');
  await assert.rejects(u4.install(), /full download/);
  // Up to date.
  const u5 = new Updater({ version: '1.0.1', dataDir: tmp(), fetchImpl: fakeGitHub(files) });
  assert.equal((await u5.check()).available, null);
  fs.rmSync(d, { recursive: true, force: true });
});

test('updater: a download that doesn\'t match its checksum, or with odd file names, changes nothing', async () => {
  const d = tmp();
  const good = packZip('1.0.1');
  const fetchBad = fakeGitHub({ 'pack.zip': good });
  const tampered = async (u) => (u.endsWith('/dl/pack.zip') ? fetchBad(u.replace('pack.zip', 'update.json')) : fetchBad(u));
  const u = new Updater({ version: '1.0.0', dataDir: d, fetchImpl: tampered });
  await u.check();
  await assert.rejects(u.install(), /checksum|incomplete/);
  assert.ok(!fs.existsSync(path.join(d, 'app', 'current.json')));
  const evil = packZip('1.0.1', [{ name: '../evil.txt', data: Buffer.from('x') }]);
  const u2 = new Updater({ version: '1.0.0', dataDir: d, fetchImpl: fakeGitHub({ 'pack.zip': evil }) });
  await u2.check();
  await assert.rejects(u2.install(), /unexpected file name/);
  assert.ok(!fs.existsSync(path.join(d, 'evil.txt')) && !fs.existsSync(path.join(d, 'app', 'evil.txt')));
  assert.ok(!fs.existsSync(path.join(d, 'app', 'current.json')));
  // Never during a service.
  const u3 = new Updater({ version: '1.0.0', dataDir: d, isBusy: () => true, fetchImpl: fakeGitHub({ 'pack.zip': good }) });
  await u3.check();
  await assert.rejects(u3.install(), /after the service/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('updater: offline is quiet; a release without update.json offers nothing', async () => {
  const offline = new Updater({ version: '1.0.0', dataDir: tmp(), fetchImpl: async () => { throw new Error('fetch failed'); } });
  const st = await offline.check();
  assert.equal(st.available, null);
  assert.match(st.error, /No internet/);
  const old = new Updater({ version: '1.0.0', dataDir: tmp(), fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.5.0', assets: [] }) }) });
  assert.equal((await old.check()).available, null);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { Bible } = require('../lib/bible');
const { recordingName, cameraFiles } = require('../lib/stream');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));

test('recordings: local time, and a restart never overwrites the file before', () => {
  const dir = tmp();
  const at = new Date(2026, 10, 28, 10, 30, 5);
  const a = recordingName(dir, at);
  assert.equal(path.basename(a), 'Service 2026-11-28 10h30.mkv');
  fs.writeFileSync(a, 'x');
  const b = recordingName(dir, at);
  assert.equal(path.basename(b), 'Service 2026-11-28 10h30 (2).mkv');
  // A camera's own recording counts too.
  fs.writeFileSync(cameraFiles(b, [1])[0], 'x');
  assert.equal(path.basename(recordingName(dir, at)), 'Service 2026-11-28 10h30 (3).mkv');
});

test('Bible: a damaged translation file is skipped, not fatal', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.json.gz'), Buffer.from('not gzip at all'));
  const b = new Bible(dir);
  assert.equal(b.load('bad'), null);
  assert.deepEqual(b.list(), []);
  assert.ok(b.lookup('John 3:16', 'bad').error);
});

test('server: a malformed address gets 400, and ChurchStream keeps running', { timeout: 30000 }, async () => {
  const data = tmp();
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--port', String(port)],
    { env: { ...process.env, CHURCHSTREAM_DATA: data, CHURCHSTREAM_NO_BROWSER: '1', CHURCHSTREAM_NO_MEDIA: '1' }, stdio: 'ignore' });
  const req = (p) => new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
  });
  try {
    for (let i = 0; i < 100 && (await req('/api/state')) !== 200; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await req('/%'), 400);
    assert.equal(await req('/media/100%.png'), 400);
    assert.equal(await req('/api/state'), 200);
  } finally { srv.kill(); }
});

test('stream: "Go live" while already live keeps the stream, and cancels a pending end screen', async () => {
  const { App } = require('../lib/app');
  const app = Object.create(App.prototype);
  let starts = 0;
  Object.assign(app, {
    ffmpeg: { path: 'ffmpeg' }, syncOverlay() {}, changed() {},
    streamer: { status: { mode: 'live' }, want: 'live', proc: {}, start: async () => { starts++; }, stop: async () => {} },
  });
  app.setPhase('end', Date.now() + 60000);
  await app.startStream('live');
  assert.equal(starts, 0);
  assert.equal(app.phase, null);
  clearTimeout(app.phaseTimer);
  app.streamer.status.mode = 'preview';
  await app.startStream('live');
  assert.equal(starts, 1);
});

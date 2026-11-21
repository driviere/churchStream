'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync, spawn } = require('child_process');
const { makeCertificate, loadCertificate } = require('../lib/cert');
const { PhoneCams, jpegSize, isJpeg } = require('../lib/phonecam');
const { buildFfmpegArgs } = require('../lib/stream');
const config = require('../lib/config');

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const cfg = (patch) => config.merge(config.DEFAULTS, patch);
const jpeg = (size = '1280x720', color = 'red') => spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', 'pipe:1']).stdout;

test('certificate: parses, lists the addresses, and works for https', async () => {
  const c = makeCertificate({ ips: ['127.0.0.1', '192.168.1.20'] });
  const x = new crypto.X509Certificate(c.cert);
  assert.equal(x.verify(x.publicKey), true);
  assert.match(x.subjectAltName, /IP Address:192\.168\.1\.20/);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.equal(x.checkIP('192.168.1.20'), '192.168.1.20');
  assert.ok(new Date(x.validTo) - Date.now() > 300 * 86400000);
  const srv = https.createServer(c, (q, r) => r.end('ok'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const body = await new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port: srv.address().port, ca: c.cert }, (r) => { let d = ''; r.on('data', (x) => { d += x; }); r.on('end', () => resolve(d)); }).on('error', reject);
  });
  srv.close();
  assert.equal(body, 'ok');
});

test('certificate: kept, and made again when the network address changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cert-'));
  const a = loadCertificate(dir, ['10.0.0.5']);
  assert.equal(loadCertificate(dir, ['10.0.0.5']).cert, a.cert);
  const b = loadCertificate(dir, ['10.0.0.9']);
  assert.notEqual(b.cert, a.cert);
  assert.match(new crypto.X509Certificate(b.cert).subjectAltName, /10\.0\.0\.9/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stream: a phone camera is read as MJPEG from the local feeder', () => {
  const args = buildFfmpegArgs({ cfg: cfg({ video: { type: 'phone' }, video2: { type: 'phone' }, audio: { source: 'none' } }), mode: 'preview', phone: { 1: 4001, 2: 4002 } });
  const s = args.join(' ');
  assert.match(s, /-use_wallclock_as_timestamps 1 -f mjpeg -framerate 30 -i tcp:\/\/127\.0\.0\.1:4001/);
  assert.match(s, /-i tcp:\/\/127\.0\.0\.1:4002/);
  assert.match(s, /streamselect@cams/);
  assert.doesNotMatch(s, /sine=/); // no test tone with a phone camera
  // Without the feeder, a test pattern stands in.
  const none = buildFfmpegArgs({ cfg: cfg({ video: { type: 'phone' } }), mode: 'preview' }).join(' ');
  assert.match(none, /testsrc2/);
});

test('phone camera: only 1280×720 JPEG pictures are taken', () => {
  const pc = Object.create(PhoneCams.prototype);
  pc.cams = { 1: { frame: null, at: 0, seen: 0 }, 2: { frame: null, at: 0, seen: 0 } };
  pc.emit = () => {};
  assert.throws(() => pc.frame(1, Buffer.from('hello')), /Not a picture/);
  if (!HAVE_FFMPEG) return;
  const good = jpeg();
  assert.ok(isJpeg(good));
  assert.deepEqual(jpegSize(good), { width: 1280, height: 720 });
  assert.throws(() => pc.frame(1, jpeg('640x480')), /1280×720/);
  pc.frame(1, good);
  assert.equal(pc.connected(1), true);
  assert.equal(pc.connected(2), false);
});

test('phone camera: FFmpeg receives the phone picture, then the waiting picture', { skip: !HAVE_FFMPEG }, async () => {
  const pc = new PhoneCams({ ffmpegPath: 'ffmpeg' });
  await pc.ready;
  assert.ok(isJpeg(pc.waiting), 'waiting picture made');
  pc.frame(1, jpeg('1280x720', 'blue'));
  const f = spawn('ffmpeg', ['-loglevel', 'error', '-use_wallclock_as_timestamps', '1', '-f', 'mjpeg', '-framerate', '30', '-i', `tcp://127.0.0.1:${pc.ports[1]}`,
    '-t', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  const chunks = [];
  f.stdout.on('data', (d) => chunks.push(d));
  await new Promise((r) => f.on('close', r));
  pc.close();
  const px = Buffer.concat(chunks);
  assert.ok(px.length >= 3 * 15, `about 30 pictures a second (got ${px.length / 3})`);
  assert.ok(px[2] > 150 && px[0] < 100, 'the phone picture (blue)');
  // No picture for 3 s → the waiting picture.
  pc.cams[1].at = Date.now() - 4000;
  assert.equal(pc.current(1), pc.waiting);
});

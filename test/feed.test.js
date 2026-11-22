'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { ProgramFeed, BOUNDARY } = require('../lib/program-feed');
const { buildFfmpegArgs } = require('../lib/stream');
const config = require('../lib/config');

const cfg = (patch) => config.merge(config.DEFAULTS, patch);
const fakeJpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 0x11), Buffer.from([0xff, 0xd9])]);

test('stream: the finished picture also goes to the browser feed, in preview and live', () => {
  for (const mode of ['preview', 'live']) {
    const args = buildFfmpegArgs({ cfg: cfg({ video: { type: 'testsrc' }, audio: { source: 'none' }, record: true }), mode, recordFile: '/tmp/x.mkv', feed: 5555 });
    const s = args.join(' ');
    // Watched (the default): the gate is open (enable=0 lets every picture through).
    assert.match(s, /\[vfd\]fps=15,framestep@gfd=step=30:enable=0,scale='min\(1280,iw\)':-2\[vfeed\]/, mode);
    assert.match(s, /-map \[vfeed\] -fps_mode passthrough -enc_time_base 1\/1000 -c:v mjpeg -q:v 5 -f mjpeg tcp:\/\/127\.0\.0\.1:5555/, mode);
  }
  // Nobody watching: one picture every 2 seconds.
  const idle = buildFfmpegArgs({ cfg: cfg({ video: { type: 'testsrc' }, audio: { source: 'none' } }), mode: 'preview', feed: 5555, watched: { program: false } }).join(' ');
  assert.match(idle, /framestep@gfd=step=30:enable=1/);
  // Without a feed, nothing changes.
  assert.doesNotMatch(buildFfmpegArgs({ cfg: cfg({}), mode: 'preview' }).join(' '), /vfeed/);
});

test('program feed: pictures cut from FFmpeg output reach every browser', async () => {
  const feed = new ProgramFeed();
  await feed.ready;
  const srv = http.createServer((req, res) => feed.serve(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const got = [];
  const req = http.get({ host: '127.0.0.1', port: srv.address().port, path: '/' }, (res) => {
    assert.match(res.headers['content-type'], new RegExp(`multipart/x-mixed-replace; boundary=${BOUNDARY}`));
    res.on('data', (d) => got.push(d));
  });
  await new Promise((r) => setTimeout(r, 100));
  // FFmpeg writes pictures in arbitrary pieces.
  const sock = net.connect(feed.port, '127.0.0.1');
  await new Promise((r) => sock.on('connect', r));
  const all = Buffer.concat([fakeJpeg(1000), fakeJpeg(2000), fakeJpeg(500)]);
  for (let i = 0; i < all.length; i += 333) { sock.write(all.subarray(i, i + 333)); await new Promise((r) => setTimeout(r, 5)); }
  await new Promise((r) => setTimeout(r, 150));
  const text = Buffer.concat(got).toString('latin1');
  assert.equal(text.split(`--${BOUNDARY}`).length - 1, 3);
  assert.match(text, /Content-Length: 1004\r\n/);
  assert.match(text, /Content-Length: 2004\r\n/);
  assert.equal(feed.latest.length, 504);
  assert.equal(feed.live(), true);
  // The first viewer and the last one leaving are announced (the stream opens/closes its gate).
  const seen = [];
  feed.on('watchers', (n) => seen.push(n));
  assert.equal(feed.watched, true);
  req.destroy();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen, [0]);
  assert.equal(feed.watched, false);
  sock.destroy(); srv.close(); feed.close();
});

test('feed gates: live commands open and close each picture feed', () => {
  const { gateCommands } = require('../lib/compositor');
  assert.deepEqual(gateCommands('program', true), ['framestep@gfd enable 0']);
  assert.deepEqual(gateCommands('preview', false), ['framestep@gpv enable 1']);
  assert.deepEqual(gateCommands('multiview', true, 3), ['framestep@gmv0 enable 0', 'framestep@gmv1 enable 0', 'framestep@gmv2 enable 0']);
});

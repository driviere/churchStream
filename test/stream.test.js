'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { buildFfmpegArgs, destinationsFor, teeEscape, redact, overlayGeometry, QUALITY, pipGeometry, scenePositions } = require('../lib/stream');
const config = require('../lib/config');

const cfg = (patch) => config.merge(config.DEFAULTS, patch);
const teeArg = (args) => args.find((a) => a.includes('[f=flv') || a.includes('[f=matroska'));

test('YouTube + Facebook from one encode via tee', () => {
  const c = cfg({ outputs: { youtube: { enabled: true, key: 'yt-key' }, facebook: { enabled: true, key: 'FB-KEY' } } });
  const args = buildFfmpegArgs({ cfg: c, mode: 'live', encoder: 'libx264' });
  const tee = teeArg(args);
  assert.ok(args.includes('-use_fifo'));
  assert.equal(args.filter((a) => a === '-c:v').length, 1, 'video is encoded exactly once');
  assert.match(tee, /\[f=flv:onfail=ignore\]rtmp:\/\/a\.rtmp\.youtube\.com\/live2\/yt-key/);
  assert.match(tee, /\|\[f=flv:onfail=ignore\]rtmps:\/\/live-api-s\.facebook\.com:443\/rtmp\/FB-KEY/);
  assert.ok(args.includes('preview.jpg'));
});

test('dshow camera + microphone use one capture input', () => {
  const c = cfg({ video: { type: 'dshow', device: 'USB Capture HDMI' }, audio: { source: 'device', device: 'Line (USB Capture HDMI)' }, outputs: { youtube: { enabled: true, key: 'k' } } });
  const args = buildFfmpegArgs({ cfg: c, mode: 'live', encoder: 'h264_qsv' });
  assert.ok(args.includes('video=USB Capture HDMI:audio=Line (USB Capture HDMI)'));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /\[0:a\]aresample/);
  assert.match(fc, /format=nv12\[venc\]/, 'QSV gets NV12 frames');
  assert.ok(args.includes('h264_qsv'));
});

test('RTSP camera without audio gets a silent track (Facebook requires audio)', () => {
  const c = cfg({ video: { type: 'rtsp', rtspUrl: 'rtsp://cam/1' }, audio: { source: 'none' }, outputs: { facebook: { enabled: true, key: 'k' } } });
  const args = buildFfmpegArgs({ cfg: c, mode: 'live', encoder: 'h264_nvenc' });
  assert.ok(args.includes('rtsp://cam/1'));
  assert.ok(args.some((a) => a.startsWith('anullsrc')));
  assert.match(args[args.indexOf('-filter_complex') + 1], /\[1:a\]/);
  assert.ok(args.includes('cbr'));
});

test('preview mode does not encode or stream', () => {
  const args = buildFfmpegArgs({ cfg: cfg({}), mode: 'preview' });
  assert.ok(!args.includes('-c:v'));
  assert.ok(!args.includes('tee'));
  assert.ok(args.includes('preview.jpg'));
});

test('no destinations is a friendly error', () => {
  assert.throws(() => buildFfmpegArgs({ cfg: cfg({}), mode: 'live' }), /stream key/);
});

test('recording path is relative and uses forward slashes', () => {
  const path = require('path');
  const run = path.join('C', 'data', 'run');
  const rec = path.join('C', 'data', 'recordings', 'Service.mkv');
  const args = buildFfmpegArgs({ cfg: cfg({ record: true }), mode: 'live', runDir: run, recordFile: rec });
  assert.ok(args.some((a) => a.includes('[f=matroska:onfail=ignore]../recordings/Service.mkv')));
});

test('escaping and redaction', () => {
  assert.equal(teeEscape('a|b[c]'), 'a\\|b\\[c\\]');
  assert.equal(redact('Error opening rtmp://x/live2/secret-key-1', ['secret-key-1']), 'Error opening rtmp://x/live2/••••');
  const d = destinationsFor(cfg({ outputs: { youtube: { enabled: true, key: '' }, custom: { enabled: true, url: 'rtmp://example.org/app/k' } } }));
  assert.deepEqual(d.map((x) => x.id), ['custom']);
  assert.equal(d[0].host, 'example.org');
});

test('overlay geometry stays inside the frame', () => {
  for (const q of Object.values(QUALITY)) {
    const g = overlayGeometry(q);
    assert.ok(g.yTitle + g.titleFs + g.padT < q.height);
    assert.ok(g.captionMaxChars > 30);
  }
});

test('generated filter graph is accepted by the local FFmpeg', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ff-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  const { Overlay } = require('../lib/overlay');
  const ov = new Overlay(dir);
  ov.setCaption('Amazing grace');
  ov.setTicker('Potluck lunch after the service today');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  // With sound clean-up, mic level and lip-sync on, so the whole audio chain is checked too.
  const args = buildFfmpegArgs({ cfg: cfg({ quality: 'low', record: true, audio: { source: 'device', cleanup: 'strong', gainDb: 3, delayMs: 120 } }), mode: 'live', runDir: dir, recordFile: path.join(dir, 'out.mkv') });
  // Limit both outputs to one second.
  const tee = args.indexOf(teeArg(args));
  args.splice(tee, 0, '-t', '1');
  args.splice(args.indexOf('preview.jpg'), 0, '-t', '1');
  const r = spawnSync('ffmpeg', args, { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr.split('\n').filter((l) => /error/i.test(l)).join('\n'));
  assert.ok(fs.statSync(path.join(dir, 'out.mkv')).size > 1000);
});

test('scenes: camera, slides and slides with a camera inset', () => {
  const q = QUALITY.good;
  const off = q.width + 8;
  assert.deepEqual(scenePositions('camera', q), { slidesX: off, pipX: off });
  assert.deepEqual(scenePositions('slides', q), { slidesX: 0, pipX: off });
  const pip = pipGeometry(q);
  assert.deepEqual(scenePositions('pip', q), { slidesX: 0, pipX: pip.x });
  assert.ok(pip.x > q.width / 2 && pip.y > q.height / 2, 'inset sits bottom-right');
  assert.ok(pip.x + pip.w + 2 * pip.border <= q.width && pip.y + pip.h + 2 * pip.border <= q.height, 'inset stays inside the frame');
  const args = buildFfmpegArgs({ cfg: cfg({ outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', scene: 'pip' });
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /overlay@slides=x=0:/);
  assert.match(fc, new RegExp(`overlay@pip=x=${pip.x}:`));
  assert.ok(args.includes('program.jpg'));
});

test('sound clean-up for online viewers', () => {
  const { micFilters } = require('../lib/stream');
  assert.deepEqual(micFilters({}), []);
  assert.deepEqual(micFilters({ cleanup: 'off', delayMs: 0, gainDb: 0 }), []);
  const light = micFilters({ cleanup: 'light' }).join(',');
  assert.match(light, /highpass/); assert.match(light, /afftdn/); assert.match(light, /acompressor/); assert.match(light, /alimiter/);
  assert.deepEqual(micFilters({ delayMs: 5000, gainDb: 40 }), ['adelay=1000|1000', 'volume=12dB']); // clamped
  const args = buildFfmpegArgs({ cfg: cfg({ outputs: { youtube: { enabled: true, key: 'k' } }, audio: { cleanup: 'light' } }), mode: 'live' });
  assert.match(args[args.indexOf('-filter_complex') + 1], /afftdn=.*ebur128/);
});

test('macOS: camera and microphone through AVFoundation, VideoToolbox encoder', () => {
  const { encoderArgs } = require('../lib/stream');
  const both = buildFfmpegArgs({ cfg: cfg({ video: { type: 'dshow', device: 'FaceTime HD Camera' }, audio: { source: 'device', device: 'MacBook Pro Microphone' }, outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', platform: 'darwin' });
  const i = both.indexOf('avfoundation');
  assert.ok(i > 0);
  assert.equal(both[both.indexOf('-i', i) ], '-i');
  assert.equal(both[both.indexOf('-i', i) + 1], 'FaceTime HD Camera:MacBook Pro Microphone');
  assert.ok(!both.includes('dshow'));
  // Separate microphone (e.g. IP camera + USB sound interface)
  const mic = buildFfmpegArgs({ cfg: cfg({ video: { type: 'rtsp', rtspUrl: 'rtsp://cam/1' }, audio: { source: 'device', device: 'USB Audio' }, outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', platform: 'darwin' });
  assert.ok(mic.includes('none:USB Audio'));
  // Camera without a microphone gets silence
  const silent = buildFfmpegArgs({ cfg: cfg({ video: { type: 'dshow', device: 'Cam' }, audio: { source: 'none' }, outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', platform: 'darwin' });
  assert.ok(silent.includes('Cam:none'));
  assert.ok(silent.some((x) => /anullsrc/.test(x)));
  assert.deepEqual(encoderArgs('h264_videotoolbox', QUALITY.good).slice(0, 4), ['-c:v', 'h264_videotoolbox', '-realtime', '1']);
});

test('macOS device and display lists', () => {
  const { parseAvfDevices, parseMacScreens } = require('../lib/ffmpeg');
  const d = parseAvfDevices('[AVFoundation indev @ 0x1] AVFoundation video devices:\n[AVFoundation indev @ 0x1] [0] FaceTime HD Camera\n[AVFoundation indev @ 0x1] [1] Capture screen 0\n[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone\n[in#0 @ 0x2] Error opening input');
  assert.deepEqual(d, { video: ['FaceTime HD Camera'], audio: ['MacBook Pro Microphone'] });
  const m = parseMacScreens('Built-in Retina Display|0|0|1512|982\nProjector|1512|0|1920|1080');
  assert.equal(m.length, 2);
  assert.equal(m[0].primary, true);
  assert.deepEqual([m[1].x, m[1].y, m[1].width], [1512, -98, 1920]); // top-left coordinates for the browser
});

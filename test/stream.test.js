'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { buildFfmpegArgs, destinationsFor, teeEscape, redact, overlayGeometry, QUALITY, pipGeometry, scenePositions } = require('../lib/stream');
const config = require('../lib/config');

const cfg = (patch) => config.merge(config.DEFAULTS, patch);
// What the local FFmpeg accepts (newer ones refuse -thread_queue_size on inputs), as the app checks.
const FFINFO = spawnSync('ffmpeg', ['-version']).status === 0 ? { inputQueue: require('../lib/ffmpeg').acceptsInputQueue('ffmpeg') } : {};
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
  const args = buildFfmpegArgs({ cfg: c, mode: 'live', encoder: 'h264_qsv', platform: 'win32' });
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
  const args = buildFfmpegArgs({ cfg: cfg({ quality: 'low', record: true, audio: { source: 'device', cleanup: 'strong', gainDb: 3, delayMs: 120 } }), mode: 'live', runDir: dir, ffmpegInfo: FFINFO, recordFile: path.join(dir, 'out.mkv') });
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
  assert.deepEqual(encoderArgs('h264_videotoolbox', QUALITY.good).slice(0, 4), ['-c:v', 'h264_videotoolbox', '-profile:v', 'high']);
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

test('encoder settings: quality first (B-frames, no zero-latency), plainer fallback per encoder', () => {
  const { encoderArgs, splitEncoder } = require('../lib/encoders');
  const q = QUALITY.good;
  const x = encoderArgs('libx264', q);
  assert.ok(!x.includes('zerolatency'));
  assert.equal(x[x.indexOf('-bf') + 1], '2');
  assert.equal(x[x.indexOf('-b:v') + 1], '2500k'); // same bitrate: better picture, same upload
  assert.equal(x[x.indexOf('-g') + 1], '60'); // keyframe every 2 s
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']) {
    const a = encoderArgs(enc, q);
    const c = encoderArgs(enc + ':compat', q);
    assert.equal(a[1], enc); assert.equal(c[1], enc);
    assert.notDeepEqual(a, c);
    assert.equal(c[c.indexOf('-bf') + 1] || '0', '0');
  }
  assert.deepEqual(splitEncoder('h264_qsv:compat'), { name: 'h264_qsv', variant: 'compat' });
  // QSV still gets NV12 frames with the fallback set
  const args = buildFfmpegArgs({ cfg: cfg({ outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', encoder: 'h264_qsv:compat' });
  assert.match(args[args.indexOf('-filter_complex') + 1], /format=nv12\[venc\]/);
});

test('two cameras: switch on air without a restart, and record each camera on its own', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 60000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawn } = require('child_process');
  const { cameraFiles, hasCamera2 } = require('../lib/stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cam2-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  const { Overlay } = require('../lib/overlay');
  new Overlay(dir);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  const c = cfg({ quality: 'low', record: true, recordCameras: true, video2: { type: 'testsrc' }, audio: { source: 'none' } });
  assert.ok(hasCamera2(c));
  assert.ok(!hasCamera2(cfg({ video2: { type: 'dshow', device: '' } })));
  const rec = path.join(dir, 'Service.mkv');
  const files = cameraFiles(rec, 2);
  assert.deepEqual(files.map((f) => path.basename(f)), ['Service - Camera 1.mkv', 'Service - Camera 2.mkv']);
  const args = buildFfmpegArgs({ cfg: c, mode: 'live', runDir: dir, ffmpegInfo: FFINFO, recordFile: rec, camera: 1, cameraRecordings: files });
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /streamselect@cams=inputs=2:map=0/);
  assert.match(fc, /asplit=3\[aout\]\[aiso1\]\[aiso2\]/);
  // Camera 2 on air from the start when it was chosen before going live.
  assert.match(buildFfmpegArgs({ cfg: c, mode: 'live', runDir: dir, ffmpegInfo: FFINFO, recordFile: rec, camera: 2 })[args.indexOf('-filter_complex') + 1] || '', /map=1/);
  // Run it: camera 1 for ~2 s, then switch to camera 2 with the live command, then stop.
  const p = spawn('ffmpeg', args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  await new Promise((r) => setTimeout(r, 2500));
  p.stdin.write('cstreamselect@cams -1 map 1\n');
  await new Promise((r) => setTimeout(r, 2500));
  p.stdin.write('q');
  const code = await new Promise((r) => p.on('close', r));
  assert.equal(code, 0, err.split('\n').filter((l) => /error/i.test(l)).slice(-5).join('\n'));
  for (const f of [rec, ...files]) assert.ok(fs.statSync(f).size > 1000, path.basename(f));
  // The stream recording shows camera 1 (testsrc2: dark corner) early and camera 2 (SMPTE bars: grey corner) late.
  const corner = (file, t) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=8:8:2:2,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer' }).stdout[0];
  // Read the frames near the real end: on a slow machine the files are shorter than 5 s.
  const duration = (file) => parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
  const end = duration(rec);
  assert.ok(end > 2, `recording is ${end} s`);
  const early = corner(rec, 0.3);
  const late = corner(rec, Math.max(0.5, end - 0.4));
  assert.ok(Math.abs(early - late) > 20, `picture changed when switching cameras (${early} → ${late})`);
  // The camera recordings never switch.
  const end2 = duration(files[1]);
  assert.ok(Math.abs(corner(files[1], 0.3) - corner(files[1], Math.max(0.5, end2 - 0.4))) < 10);
});

test('recording quality: a separate, better recording; the picture is built at 1080p and scaled for the stream', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 60000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawn } = require('child_process');
  const { composeQuality } = require('../lib/stream');
  // Same as the stream: the recording rides on the stream's encode (one encode, a tee slave).
  const same = buildFfmpegArgs({ cfg: cfg({ quality: 'good', record: true, recordQuality: 'stream', outputs: { youtube: { enabled: true, key: 'k' } } }), mode: 'live', recordFile: 'r.mkv' });
  assert.match(teeArg(same), /f=matroska/);
  assert.equal(same.filter((x) => x === '-c:v').length, 1);
  // 1080p recording of a 720p stream: built at 1080p, scaled down for the stream, encoded twice.
  const c = cfg({ quality: 'good', record: true, recordQuality: 'fullhd', outputs: { youtube: { enabled: true, key: 'k' } } });
  assert.deepEqual([composeQuality(c).width, composeQuality(c).height], [1920, 1080]);
  const both = buildFfmpegArgs({ cfg: c, mode: 'live', recordFile: 'r.mkv' });
  const fc = both[both.indexOf('-filter_complex') + 1];
  assert.match(fc, /\[vs\]scale=1280:720/);
  assert.ok(!/matroska/.test(teeArg(both)), 'the recording is not a copy of the stream');
  assert.equal(both.filter((x) => x === '-c:v').length, 2);
  assert.ok(both.includes('8000k'));
  // Recording only (no YouTube/Facebook): just the recording, run for real.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-recq-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  const { Overlay } = require('../lib/overlay');
  new Overlay(dir);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  const rec = path.join(dir, 'Service.mkv');
  const args = buildFfmpegArgs({ cfg: cfg({ quality: 'low', record: true, recordQuality: 'fullhd', audio: { source: 'none' } }), mode: 'live', runDir: dir, ffmpegInfo: FFINFO, recordFile: rec });
  const p = spawn('ffmpeg', args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  await new Promise((r) => setTimeout(r, 3000));
  p.stdin.write('q');
  assert.equal(await new Promise((r) => p.on('close', r)), 0, err.split('\n').filter((l) => /error/i.test(l)).slice(-5).join('\n'));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', rec], { encoding: 'utf8' }).stdout.trim();
  assert.equal(probe, '1920,1080');
});

test('camera 2 stops: the stream carries on with camera 1, and camera 2 comes back by itself', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 90000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { Streamer } = require('../lib/stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cam2down-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  const { Overlay } = require('../lib/overlay');
  new Overlay(dir);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  // Camera 2 is a network camera that isn't there (nothing listens on port 9).
  const c = cfg({ quality: 'low', audio: { source: 'none' }, video2: { type: 'rtsp', rtspUrl: 'rtsp://127.0.0.1:9/stream' } });
  const st = new Streamer({ getConfig: () => c, runDir: dir, ffmpegInfo: FFINFO, recordingsDir: dir, ffmpeg: { path: 'ffmpeg', ...FFINFO }, getEncoder: async () => 'libx264' });
  const logs = [];
  st.on('log', (l) => logs.push(l));
  st.camera = 2;
  const until = async (fn, ms = 40000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out; logs: ' + logs.join(' | ')); await new Promise((r) => setTimeout(r, 200)); } };
  await st.start('preview');
  await until(() => st.status.camera2 === 'down' && st.status.state === 'running');
  assert.equal(st.status.cameras, 1, 'running with camera 1 only');
  assert.equal(st.status.camera, 1);
  // Camera 2 "works again": two good checks in a row bring it back (with a short restart).
  st.probeCamera = async () => true;
  await st.checkCamera2();
  assert.equal(st.status.camera2, 'down', 'one good check is not enough');
  await st.checkCamera2();
  assert.ok(logs.includes('camera 2 is back'));
  // It's still not really there, so it is noticed again and the stream carries on.
  st.probeCamera = async () => false;
  await until(() => st.status.camera2 === 'down' && st.status.state === 'running');
  assert.equal(st.camera, 1, 'camera 1 stays on air');
  await st.stop();
  assert.equal(st.status.camera2, null);
});

test('watchdog: a picture that stops moving is restarted', { skip: process.platform === 'win32', timeout: 30000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { Streamer } = require('../lib/stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-stall-'));
  // A pretend FFmpeg that reports progress once, then keeps reporting the same time (a frozen camera).
  const fake = path.join(dir, 'fake-ffmpeg');
  fs.writeFileSync(fake, `#!${process.execPath}\nlet n = 0;\nsetInterval(() => { n++; process.stdout.write('out_time_us=' + (n < 3 ? n * 1000000 : 3000000) + '\\nfps=30\\nprogress=continue\\n'); }, 300);\nprocess.stdin.on('data', () => process.exit(0));\n`);
  fs.chmodSync(fake, 0o755);
  const st = new Streamer({ getConfig: () => cfg({ quality: 'low', audio: { source: 'none' } }), runDir: dir, ffmpegInfo: FFINFO, recordingsDir: dir, ffmpeg: { path: fake }, getEncoder: async () => 'libx264' });
  st.stallMs = 2000;
  const logs = [];
  st.on('log', (l) => logs.push(l));
  await st.start('preview');
  const t = Date.now();
  while (!logs.includes('the picture stopped moving; restarting') && Date.now() - t < 15000) await new Promise((r) => setTimeout(r, 200));
  assert.ok(logs.includes('the picture stopped moving; restarting'), logs.join(' | '));
  await new Promise((r) => setTimeout(r, 500));
  assert.match(st.status.problem, /camera picture stopped/);
  await st.stop();
});

test('newer FFmpeg: no input queue option when FFmpeg refuses it', () => {
  const c = cfg({ quality: 'low', video: { type: 'rtsp', rtspUrl: 'rtsp://cam/1' }, audio: { source: 'none' }, outputs: { youtube: { enabled: true, key: 'k' } } });
  assert.ok(buildFfmpegArgs({ cfg: c, mode: 'live' }).includes('-thread_queue_size'));
  assert.ok(buildFfmpegArgs({ cfg: c, mode: 'live', ffmpegInfo: { inputQueue: true } }).includes('-thread_queue_size'));
  assert.ok(!buildFfmpegArgs({ cfg: c, mode: 'live', ffmpegInfo: { inputQueue: false } }).includes('-thread_queue_size'));
});

test('media player: a video with no sound track plays to the end (silence is sent instead)', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 30000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { MediaRelay } = require('../lib/media');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-silent-'));
  const clip = path.join(dir, 'silent.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=2', '-pix_fmt', 'yuv420p', clip]);
  const relay = new MediaRelay({ ffmpegPath: 'ffmpeg' });
  await relay.ready;
  relay.configure({ width: 320, height: 180, fps: 25 });
  assert.equal(relay.fileInfo(clip).audio, false);
  assert.ok(Math.abs(relay.fileInfo(clip).duration - 2) < 0.2);
  const ended = new Promise((resolve) => relay.once('ended', resolve));
  relay.play({ id: 'x', kind: 'video', path: clip, title: 'Silent', loop: false });
  const { error } = await ended;
  assert.equal(error, '', 'played without an error');
  relay.close();
});

test('media relay: the picture goes as timed frames, a few a second while nothing plays', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 30000 }, async () => {
  const net = require('net');
  const { MediaRelay, IDLE_FPS } = require('../lib/media');
  const relay = new MediaRelay({ ffmpegPath: 'ffmpeg' });
  await relay.ready;
  relay.configure({ width: 64, height: 36, fps: 30 });
  // Read 2 seconds of what the stream FFmpeg would get, then let FFmpeg read it back.
  const chunks = [];
  const sock = net.connect(relay.ports.video, '127.0.0.1');
  sock.on('data', (d) => chunks.push(d));
  await new Promise((r) => setTimeout(r, 2000));
  sock.destroy();
  relay.close();
  const r = spawnSync('ffprobe', ['-v', 'error', '-f', 'matroska', '-i', 'pipe:0', '-select_streams', 'v', '-show_entries', 'stream=width,height,pix_fmt:frame=pts_time', '-of', 'json'], { input: Buffer.concat(chunks) });
  const info = JSON.parse(String(r.stdout));
  assert.deepEqual([info.streams[0].width, info.streams[0].height, info.streams[0].pix_fmt], [64, 36, 'yuv420p']);
  const times = info.frames.map((f) => Number(f.pts_time));
  assert.ok(times.length >= IDLE_FPS * 2 - 2 && times.length <= IDLE_FPS * 2 + 2, `about ${IDLE_FPS} frames a second, got ${times.length}`);
  assert.ok(Math.abs(times[0] - 0.2) < 0.05, 'stamped with the head start');
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - 1 / IDLE_FPS) < 0.06, `steady: ${times}`);
});

test('media relay: pause keeps the clip and its last picture; resume carries on from there', { skip: spawnSync('ffmpeg', ['-version']).status !== 0, timeout: 30000 }, async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { MediaRelay } = require('../lib/media');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-pause-'));
  const clip = path.join(dir, 'clip.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=10', '-f', 'lavfi', '-i', 'sine=d=10', '-pix_fmt', 'yuv420p', '-shortest', clip]);
  const relay = new MediaRelay({ ffmpegPath: 'ffmpeg' });
  await relay.ready;
  relay.configure({ width: 160, height: 90, fps: 25 });
  let ended = false;
  relay.on('ended', () => { ended = true; });
  relay.play({ id: 'x', kind: 'video', path: clip, title: 'Clip', loop: false });
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(relay.pause());
  const frame = relay.currentFrame();
  assert.notEqual(frame, relay.black, 'the last picture stays on the stream');
  assert.equal(relay.status().now.paused, true);
  const pos = relay.pausedPosition();
  assert.ok(pos > 1 && pos < 2.5, `paused at ${pos}`);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(ended, false, 'pausing is not the end of the clip');
  assert.ok(Math.abs(relay.pausedPosition() - pos) < 0.01, 'time stands still while paused');
  assert.ok(relay.resume());
  assert.equal(relay.status().now.paused, false);
  assert.ok(Math.abs((Date.now() - relay.now.startedAt) / 1000 - pos) < 0.2, 'resumes where it paused');
  assert.equal(relay.currentFrame(), frame, 'no black between pause and the next picture');
  relay.close();
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const c = require('../lib/compositor');
const { Studio } = require('../lib/studio');
const { ZmqCommander, freePort } = require('../lib/zmq');
const config = require('../lib/config');

const HAVE = spawnSync('ffmpeg', ['-version']).status === 0;
const ZMQ = HAVE && require('../lib/ffmpeg').hasZmq('ffmpeg');
const cfg = (patch) => config.merge(config.DEFAULTS, patch);
const q = { width: 1280, height: 720, fps: 30 };

test('scenes: built-ins follow the cameras that are set up', () => {
  const one = c.allScenes(cfg({}));
  assert.deepEqual(one.map((s) => s.id), ['cam1', 'slides', 'pip']);
  const three = c.allScenes(cfg({ video2: { type: 'testsrc' }, video3: { type: 'rtsp', rtspUrl: 'rtsp://x' }, video3_: 0 }));
  assert.deepEqual(three.map((s) => s.id), ['cam1', 'cam2', 'cam3', 'slides', 'pip', 'side']);
  // A camera name shows up in its scene.
  assert.equal(c.findScene(cfg({ video2: { type: 'testsrc', name: 'Pulpit' } }), 'cam2').name, 'Pulpit');
  // The control panel's choices as scenes.
  assert.deepEqual(c.simpleScene(cfg({ video2: { type: 'testsrc' } }), 'pip', 2).layers.map((l) => l.source), ['slides', 'cam2']);
  assert.equal(c.simpleScene(cfg({}), 'camera', 3).id, 'cam1', 'a camera that is not set up falls back to camera 1');
});

test('scenes: saved scenes are cleaned, limited to 4 layers, and can replace a built-in', () => {
  const s = c.cleanScene({ id: 'my scene!', name: 'Sermon', layers: [{ source: 'cam1', x: 2, y: -3, w: 0, h: 9 }, null, { nope: 1 }, ...Array(6).fill({ source: 'slides' })] });
  assert.equal(s.id, 'myscene');
  assert.equal(s.layers.length, 4);
  assert.deepEqual([s.layers[0].x, s.layers[0].y, s.layers[0].w, s.layers[0].h], [1, -1, 0.02, 1]);
  const all = c.allScenes(cfg({ scenes: [{ id: 'cam1', name: 'Wide', layers: [{ source: 'cam1' }] }] }));
  assert.equal(all.filter((x) => x.id === 'cam1').length, 1);
  assert.equal(c.findScene(cfg({ scenes: [{ id: 'cam1', name: 'Wide', layers: [{ source: 'cam1' }] }] }), 'cam1').name, 'Wide');
});

test('slots: a full-screen first layer is the background; the rest need overlay slots', () => {
  const index = c.sourceIndex(['cam1', 'cam2', 'slides']);
  const pip = c.findScene(cfg({}), 'pip');
  assert.deepEqual(c.sceneParts(pip, index).bg, index.slides);
  assert.equal(c.sceneParts(pip, index).over.length, 1);
  const side = c.findScene(cfg({ video2: { type: 'testsrc' } }), 'side');
  assert.equal(c.sceneParts(side, index).bg, index.black);
  assert.equal(c.slotsNeeded([pip], index), 1);
  assert.equal(c.slotsNeeded([pip, side], index), 2);
  // A layer showing a camera that isn't there is left out.
  assert.equal(c.sceneParts({ layers: [{ source: 'cam4', x: 0, y: 0, w: 1, h: 1 }] }, index).bg, index.black);
  // Geometry: even numbers, border around the outside, crop in source pixels.
  const p = c.slotParams({ source: 'cam2', x: 0.5, y: 0.25, w: 0.5, h: 0.5, border: true, crop: { l: 0.1, t: 0, r: 0.1, b: 0 } }, q, index);
  assert.deepEqual(p.pos, { x: 640, y: 180 });
  assert.deepEqual(p.scale, { w: 640, h: 360 });
  assert.deepEqual(p.crop, { w: 1024, h: 720, x: 128, y: 0 });
  assert.equal(p.box.t, c.borderWidth(q));
  assert.equal(p.box.x, 640 - p.box.t);
  // Unused slots are switched off.
  const cmds = c.sceneCommands(pip, 'b', q, index, 2);
  assert.ok(cmds.includes(`streamselect@bbg map ${index.slides}`));
  assert.ok(cmds.includes('overlay@bo0 enable 1'));
  assert.ok(cmds.includes('overlay@bo1 enable 0'));
});

test('graph: two buses, one fade and one slide/wipe, preview and multiview', () => {
  const sources = [{ id: 'cam1', label: '[0:v]' }, { id: 'cam2', label: '[1:v]' }, { id: 'slides', label: '[2:v]' }];
  const g = c.studioGraph({ q, sources, black: null, sceneA: c.findScene(cfg({}), 'pip'), sceneB: c.findScene(cfg({}), 'cam1'), zmqPort: 5555, slots: 2, iso: [1, 2] });
  for (const name of ['streamselect@abg', 'streamselect@bbg', 'overlay@ao0', 'overlay@bo1', 'streamselect@base', 'streamselect@next', 'blend@mix', 'overlay@tr', 'crop@wipe', 'streamselect@out', 'xstack', 'zmq=']) assert.ok(g.graph.includes(name), name);
  assert.equal(g.program, '[sprog]');
  assert.deepEqual(Object.keys(g.iso), ['1', '2']);
  // Every split output is used exactly once.
  const outs = (g.graph.match(/\[[a-z0-9_]+\]/g) || []);
  const counts = {};
  for (const l of outs) counts[l] = (counts[l] || 0) + 1;
  const dangling = Object.entries(counts).filter(([l, n]) => n === 1 && !['[sprog]', '[spv]', '[smv]', '[isoc1]', '[isoc2]'].includes(l));
  assert.deepEqual(dangling, []);
});

function recorder() {
  const lines = [];
  const st = new Studio({ send: (l) => lines.push(...[].concat(l)), tickMs: 5, gapMs: 5 });
  st.reset({ q, index: c.sourceIndex(['cam1', 'cam2', 'slides']), slots: 1, sceneA: { id: 'cam1', layers: [] }, sceneB: { id: 'cam2', layers: [] } });
  const settle = () => new Promise((r) => { const t = setInterval(() => { if (!st.busy) { clearInterval(t); r(); } }, 5); });
  return { st, lines, settle };
}

test('studio: a cut is one switch; the old scene becomes the Preview', async () => {
  const { st, lines, settle } = recorder();
  assert.ok(st.take('cut'));
  await settle();
  assert.equal(lines[0], 'streamselect@base map 1');
  assert.deepEqual(st.state(), { onAir: 'cam2', preview: 'cam1', transition: null });
  assert.ok(lines.includes('streamselect@next map 0'));
});

test('studio: a fade never switches what is on air while it shows', async () => {
  const { st, lines, settle } = recorder();
  assert.ok(st.take('fade', 60));
  assert.equal(st.take('cut'), false, 'one transition at a time');
  await settle();
  const i = (l) => lines.indexOf(l);
  assert.ok(i('blend@mix enable 1') < i('streamselect@out map 1'), 'the fade is on before it is shown');
  assert.ok(i('blend@mix all_opacity 1.000') < i('streamselect@base map 1'), 'base changes only when the fade shows the next scene fully');
  assert.ok(i('streamselect@base map 1') < i('streamselect@out map 0'));
  assert.ok(i('streamselect@out map 0') < i('blend@mix enable 0'));
  assert.equal(st.state().onAir, 'cam2');
});

test('studio: dip to black changes scene under black; slide and wipe; T-bar', async () => {
  let { st, lines, settle } = recorder();
  st.take('dip', 60);
  await settle();
  const i = (l) => lines.indexOf(l);
  assert.ok(i('streamselect@next map 2') < i('blend@mix enable 1'), 'next is black first');
  assert.ok(i('blend@mix all_opacity 1.000') < i('streamselect@base map 1'));
  assert.ok(lines.lastIndexOf('blend@mix all_opacity 0.000') > i('streamselect@base map 1'), 'then back up');
  ({ st, lines, settle } = recorder());
  st.take('wipe', 40);
  await settle();
  assert.ok(lines.includes('crop@wipe w 2') && lines.includes('crop@wipe w 1280') && lines.includes('overlay@tr enable 0'));
  ({ st, lines, settle } = recorder());
  st.tbar(0.3);
  assert.ok(lines.includes('blend@mix all_opacity 0.300'));
  st.tbar(0.7);
  st.tbar(1);
  await settle();
  assert.equal(st.state().onAir, 'cam2');
});

test('real FFmpeg: fade, cut to two layers, dip, slide and wipe', { skip: !ZMQ, timeout: 30000 }, async () => {
  const port = await freePort();
  const small = { width: 320, height: 180, fps: 30 };
  const colors = ['red', 'lime', 'blue', 'white'];
  const ids = ['cam1', 'cam2', 'cam3', 'slides'];
  const args = ['-hide_banner', '-loglevel', 'error'];
  colors.forEach((col) => args.push('-re', '-f', 'lavfi', '-i', `color=c=${col}:s=320x180:r=30`));
  const scenes = { cam: (n) => ({ id: `cam${n}`, layers: [{ source: `cam${n}`, x: 0, y: 0, w: 1, h: 1 }] }) };
  const g = c.studioGraph({ q: small, sources: ids.map((id, i) => ({ id, label: `[${i}:v]` })), black: null, sceneA: scenes.cam(1), sceneB: scenes.cam(2), zmqPort: port, slots: 2, preview: false, multiview: false });
  args.push('-filter_complex', g.graph + `;${g.program}scale=4:2:flags=neighbor,format=rgb24[o]`, '-t', '7', '-map', '[o]', '-f', 'rawvideo', '-');
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const seen = [];
  let buf = Buffer.alloc(0);
  const name = (r, gg, b) => (r > 200 && gg > 200 && b > 200 ? 'W' : r > 200 ? 'R' : gg > 200 ? 'G' : b > 200 ? 'B' : r + gg + b < 30 ? 'K' : 'm');
  p.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 24) { const f = buf.subarray(0, 24); buf = buf.subarray(24); const k = name(f[0], f[1], f[2]) + name(f[9], f[10], f[11]); if (seen[seen.length - 1] !== k) seen.push(k); }
  });
  const z = new ZmqCommander(port);
  setTimeout(() => z.connect(), 200);
  const st = new Studio({ send: (l) => z.send(l) });
  st.reset({ q: small, index: g.index, slots: 2, sceneA: scenes.cam(1), sceneB: scenes.cam(2) });
  const at = (ms, f) => setTimeout(f, ms);
  at(1000, () => st.take('fade', 400));
  at(2000, () => st.preview({ id: 'two', layers: [{ source: 'cam3', x: 0, y: 0, w: 0.5, h: 1 }, { source: 'slides', x: 0.5, y: 0, w: 0.5, h: 1 }] }));
  at(2300, () => st.take('cut'));
  at(2800, () => st.preview(scenes.cam(1)));
  at(3000, () => st.take('dip', 600));
  at(4200, () => st.preview(scenes.cam(2)));
  at(4400, () => st.take('slide', 400));
  at(5300, () => st.preview(scenes.cam(3)));
  at(5500, () => st.take('wipe', 400));
  await new Promise((r) => p.on('close', r));
  z.close();
  const path_ = seen.join(' ');
  // In order: red, (mix), green, blue|white, (to black), black, (up), red, green, blue.
  const want = ['RR', 'GG', 'BW', 'KK', 'RR', 'GG', 'BB'];
  let at_ = -1;
  for (const w of want) { const k = seen.indexOf(w, at_ + 1); assert.ok(k > at_, `expected ${w} after position ${at_} in: ${path_}`); at_ = k; }
  // No flash of the old scene: after green is fully on air, red doesn't come back before the cut;
  // after the cut, green doesn't come back before the dip.
  const g1 = seen.indexOf('GG');
  const cut = seen.indexOf('BW');
  const dark = seen.indexOf('KK');
  assert.ok(!seen.slice(g1, cut).includes('RR'), path_);
  assert.ok(!seen.slice(cut, dark).includes('GG'), path_);
});

test('stream arguments: the studio uses the compositor, its feeds, and placeholders for stopped cameras', () => {
  const { buildFfmpegArgs } = require('../lib/stream');
  const c2 = cfg({ audio: { source: 'none' }, video2: { type: 'testsrc' }, video3: { type: 'rtsp', rtspUrl: 'rtsp://10.0.0.9/s' } });
  const index = c.sourceIndex(c.sourceIds(c2, { media: false }));
  const args = buildFfmpegArgs({ cfg: c2, mode: 'preview', studio: { zmqPort: 5556, sceneA: c.findScene(c2, 'side'), sceneB: c.findScene(c2, 'cam3'), index, slots: 2, down: [3], feeds: { preview: 4001, multiview: 4002 } } });
  const s = args.join(' ');
  assert.match(s, /zmq=bind_address=tcp/);
  assert.match(s, /Camera 3 is not responding/);
  assert.doesNotMatch(s, /rtsp:\/\/10\.0\.0\.9/, 'a stopped camera is not opened');
  assert.match(s, /-map \[spv\] -c:v mjpeg .* tcp:\/\/127\.0\.0\.1:4001/);
  assert.match(s, /-map \[smv\] -c:v mjpeg .* tcp:\/\/127\.0\.0\.1:4002/);
  assert.doesNotMatch(s, /streamselect@cams/);
});

test('real FFmpeg: the stream with the studio runs, with its preview and multiview', { skip: !ZMQ, timeout: 30000 }, async () => {
  const { buildFfmpegArgs } = require('../lib/stream');
  const { ProgramFeed } = require('../lib/program-feed');
  const { Overlay } = require('../lib/overlay');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-studio-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  new Overlay(dir);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=navy:s=320x180', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  // The graphics channels (a picture on channel 1).
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=854x480,format=rgba,drawbox=x=600:y=20:w=200:h=80:color=white@0.9:t=fill', '-frames:v', '1', '-y', path.join(dir, 'gfx1.png')]);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=854x480,format=rgba', '-frames:v', '1', '-y', path.join(dir, 'gfx2.png')]);
  const c2 = cfg({ quality: 'low', audio: { source: 'none' }, video2: { type: 'testsrc' }, video3: { type: 'rtsp', rtspUrl: 'rtsp://127.0.0.1:9/x' } });
  const feeds = { preview: new ProgramFeed(), multiview: new ProgramFeed() };
  await Promise.all([feeds.preview.ready, feeds.multiview.ready]);
  const index = c.sourceIndex(c.sourceIds(c2, { media: false }));
  const info = { inputQueue: require('../lib/ffmpeg').acceptsInputQueue('ffmpeg'), zmq: true };
  const args = buildFfmpegArgs({ cfg: c2, mode: 'preview', runDir: dir, ffmpegInfo: info, studio: { zmqPort: await freePort(), sceneA: c.findScene(c2, 'pip'), sceneB: c.findScene(c2, 'side'), index, slots: 2, down: [3], gfx: { 1: true }, feeds: { preview: feeds.preview.port, multiview: feeds.multiview.port } } });
  const p = spawn('ffmpeg', args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.stdin.on('error', () => {});
  const closed = new Promise((r) => p.on('close', r));
  await Promise.race([closed, new Promise((r) => setTimeout(r, 7000))]);
  p.stdin.write('q');
  await closed;
  feeds.preview.close(); feeds.multiview.close();
  const bad = err.split('\n').filter((l) => /\[(error|fatal)\]/.test(l)).slice(0, 5).join('\n');
  const made = fs.existsSync(path.join(dir, 'preview.jpg'));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(made, 'the camera preview picture is made: ' + bad);
  assert.ok(feeds.preview.latest && feeds.preview.latest.length > 1000, 'Preview picture: ' + bad);
  assert.ok(feeds.multiview.latest && feeds.multiview.latest.length > 1000, 'multiview picture: ' + bad);
});

test('sound mixer: a live volume and a meter per source, and one for the whole mix', () => {
  const { buildFfmpegArgs, Streamer } = require('../lib/stream');
  const c2 = cfg({ audio: { source: 'none' }, audioMix: { mic: { gain: 0.5, mute: false }, media: { gain: 1, mute: true }, master: { gain: 2 } } });
  const index = c.sourceIndex(c.sourceIds(c2, { media: true }));
  const args = buildFfmpegArgs({ cfg: c2, mode: 'preview', platform: 'linux', media: { video: 4100, audio: 4101 }, studio: { zmqPort: 5557, sceneA: c.findScene(c2, 'cam1'), sceneB: c.findScene(c2, 'slides'), index, slots: 1 } });
  const s = args.join(' ');
  assert.match(s, /volume@amic=volume=0\.5/);
  assert.match(s, /volume@amedia=volume=0[,;]/, 'muted');
  assert.match(s, /volume@amaster=volume=2,ebur128/);
  assert.match(s, /ametadata@mmic=mode=print/);
  assert.match(s, /\[mico\]\[mediao\]amix=inputs=2/);
  // The meter lines from FFmpeg's log become levels, and are not logged.
  const st = new Streamer({ getConfig: () => c2, runDir: '.', recordingsDir: '.', ffmpeg: { path: 'ffmpeg' }, getEncoder: async () => 'libx264' });
  const got = [];
  const logged = [];
  st.on('levels', (v) => got.push(v));
  st.on('log', (l) => logged.push(l));
  st.lastLines = [];
  st.onLog('[ametadata@mmic @ 0x55] [info] lavfi.astats.Overall.RMS_level=-23.456');
  st.onLog('[ametadata@mmic @ 0x55] [info] frame:3 pts:14400 pts_time:0.3');
  assert.deepEqual(got[0], { mic: -23.5 });
  assert.equal(logged.length, 0);
});

test('graphics: the pictures that are on become one ready picture, fed to the stream', { skip: !HAVE, timeout: 30000 }, async () => {
  const { GraphicsFeed } = require('../lib/graphics');
  const { buildFfmpegArgs } = require('../lib/stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-gfx-'));
  const png = (name, x) => {
    const f = path.join(dir, name);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=white:s=320x180,format=rgba,geq=r=255:g=255:b=255:a='if(between(X,${x},${x + 40})*between(Y,10,40),255,0)'`, '-frames:v', '1', '-y', f]);
    return f;
  };
  const a = png('a.png', 10);
  const b = png('b.png', 200);
  const g = new GraphicsFeed({ ffmpegPath: 'ffmpeg' });
  await g.ready;
  g.configure({ width: 320, height: 180, fps: 30 });
  const alpha = (frame, x, y) => frame[320 * 180 * 1.5 + y * 320 + x];
  assert.equal(alpha(g.current(), 20, 20), 0, 'nothing shown: see-through');
  await g.show([a, b]);
  assert.equal(g.current().length, 320 * 180 * 2.5);
  assert.ok(alpha(g.current(), 20, 20) > 200 && alpha(g.current(), 210, 20) > 200, 'both pictures');
  assert.equal(alpha(g.current(), 120, 20), 0);
  await g.show([b]);
  assert.equal(alpha(g.current(), 20, 20), 0);
  await g.show([]);
  assert.equal(g.current(), g.blank);
  g.close();
  fs.rmSync(dir, { recursive: true, force: true });
  // In the stream: a raw see-through input timed on arrival, laid over the program.
  const c2 = cfg({ audio: { source: 'none' } });
  const args = buildFfmpegArgs({ cfg: c2, mode: 'preview', studio: { zmqPort: 5558, sceneA: c.findScene(c2, 'cam1'), sceneB: c.findScene(c2, 'slides'), index: c.sourceIndex(c.sourceIds(c2, { media: false })), slots: 1, graphics: 4200, gfxOn: true } }).join(' ');
  assert.match(args, /-use_wallclock_as_timestamps 1 -f rawvideo -pix_fmt yuva420p .* -i tcp:\/\/127\.0\.0\.1:4200/);
  assert.match(args, /overlay@gfx=x=0:y=0:enable=1/);
});

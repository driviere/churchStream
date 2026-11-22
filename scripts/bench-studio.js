#!/usr/bin/env node
'use strict';
// How much computer power does ChurchStream use for a stream, compared with the least any
// streaming software can use? Runs for real, each for the same time, on this computer:
//
//   Floor            plain FFmpeg doing only the encode: a 720p test picture + sound → x264
//                    → a file. Any streaming program (vMix, OBS, …) has at least this cost.
//   Before studio    ChurchStream's stream with the simple switching (slides + camera).
//   Studio at rest   the same with the studio (two scenes, transitions ready, graphics layer),
//                    nobody on the stream page: its pictures are paused, empty texts skipped.
//   … page open      the same while the stream page shows Program, Preview and multiview.
//   Studio fading    the same, fading between two scenes every second (the worst case).
//
// ChurchStream's runs include everything the real app runs (the video/music feed, the
// graphics layer and the pictures for the stream page) and count ChurchStream's own process
// as well as FFmpeg. All use the x264 encoder at the same quality, recording only.
//
// Usage: node scripts/bench-studio.js [ffmpeg] [seconds]
// In GitHub Actions the results also go to the run's summary page.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { buildFfmpegArgs, QUALITY } = require('../lib/stream');
const { encoderArgs } = require('../lib/encoders');
const config = require('../lib/config');
const compositor = require('../lib/compositor');
const { ProgramFeed } = require('../lib/program-feed');
const { GraphicsFeed } = require('../lib/graphics');
const { MediaRelay } = require('../lib/media');
const { Overlay } = require('../lib/overlay');
const { acceptsInputQueue, hasZmq } = require('../lib/ffmpeg');
const { ZmqCommander, freePort } = require('../lib/zmq');
const { Studio } = require('../lib/studio');

// A path to FFmpeg is made absolute: the runs start FFmpeg from their own folders.
const FF = process.argv[2] && /[\\/]/.test(process.argv[2]) ? path.resolve(process.argv[2]) : process.argv[2] || 'ffmpeg';
const SECONDS = Number(process.argv[3]) || 20;
const info = { inputQueue: acceptsInputQueue(FF), zmq: hasZmq(FF), major: 99 };
const cpuOf = (err) => { const m = err.match(/utime=([\d.]+)s stime=([\d.]+)s/); return m ? Number(m[1]) + Number(m[2]) : NaN; };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  new Overlay(dir);
  spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=navy:s=1280x720', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  return dir;
}

// Run FFmpeg for SECONDS and stop it with 'q'; returns its CPU time.
async function runFfmpeg(args, dir, during) {
  const p = spawn(FF, ['-benchmark', ...args], { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.stdin.on('error', () => {});
  const closed = new Promise((r) => p.on('close', r));
  const stopDuring = during ? during() : null;
  await Promise.race([closed, new Promise((r) => setTimeout(r, SECONDS * 1000))]);
  if (stopDuring) stopDuring();
  p.stdin.write('q');
  await closed;
  const cpu = cpuOf(err);
  if (!Number.isFinite(cpu)) console.log(err.split('\n').filter((l) => /error/i.test(l)).slice(-5).join('\n'));
  return cpu;
}

async function floor() {
  const dir = setup();
  const q = QUALITY.good;
  const cpu = await runFfmpeg(['-hide_banner', '-re', '-f', 'lavfi', '-i', `testsrc2=size=${q.width}x${q.height}:rate=${q.fps}`,
    '-re', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v', '-map', '1:a',
    ...encoderArgs('libx264', q), '-c:a', 'aac', '-b:a', `${q.abit}k`, '-f', 'matroska', '-y', 'floor.mkv'], dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ffmpeg: cpu, node: 0 };
}

async function churchstream({ studio, fades = false, watching = false }) {
  const dir = setup();
  const cfg = config.merge(config.DEFAULTS, { quality: 'good', record: true, audio: { source: 'none' }, video: { type: 'testsrc' }, video2: { type: 'testsrc' } });
  const q = QUALITY.good;
  const relay = new MediaRelay({ ffmpegPath: FF });
  await relay.ready;
  relay.configure({ width: q.width, height: q.height, fps: q.fps });
  const feed = new ProgramFeed();
  const feeds = { preview: new ProgramFeed(), multiview: new ProgramFeed() };
  const graphics = new GraphicsFeed({ ffmpegPath: FF });
  await Promise.all([feed.ready, feeds.preview.ready, feeds.multiview.ready, graphics.ready]);
  graphics.configure({ width: q.width, height: q.height, fps: q.fps });
  let st = null;
  if (studio) {
    const index = compositor.sourceIndex(compositor.sourceIds(cfg, { media: true }));
    st = { zmqPort: await freePort(), sceneA: compositor.findScene(cfg, 'pip'), sceneB: compositor.findScene(cfg, 'cam2'), index,
      slots: compositor.slotsNeeded(compositor.allScenes(cfg), index), feeds: { preview: feeds.preview.port, multiview: feeds.multiview.port }, graphics: graphics.port, gfxOn: false };
  }
  const watched = { program: watching, preview: watching, multiview: watching };
  const texts = studio ? { ltName: false, ltTitle: false, caption: false, ticker: false } : null;
  const args = buildFfmpegArgs({ cfg, mode: 'live', runDir: dir, recordFile: path.join(dir, 'rec.mkv'), ffmpegInfo: info, feed: feed.port, studio: st, scene: 'pip', media: relay.ports, watched, texts });
  const node0 = process.cpuUsage();
  const cpu = await runFfmpeg(args, dir, () => {
    if (!st || !fades) return null;
    const z = new ZmqCommander(st.zmqPort);
    const ctl = new Studio({ send: (l) => z.send(l) });
    ctl.reset({ q, index: st.index, slots: st.slots, sceneA: st.sceneA, sceneB: st.sceneB });
    setTimeout(() => z.connect(), 500);
    const t = setInterval(() => ctl.take('fade', 900), 1000);
    return () => { clearInterval(t); ctl.close(); z.close(); };
  });
  const n = process.cpuUsage(node0);
  relay.close(); feed.close(); feeds.preview.close(); feeds.multiview.close(); graphics.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { ffmpeg: cpu, node: (n.user + n.system) / 1e6 };
}

(async () => {
  const head = `${path.basename(FF)} on ${os.platform()} ${os.arch()} (${os.cpus().length} cores: ${os.cpus()[0] ? os.cpus()[0].model.trim() : '?'}), ${SECONDS} s each, 720p30, x264, recording`;
  console.log(head);
  const rows = [];
  const add = (label, r) => {
    const total = r.ffmpeg + r.node;
    rows.push({ label, pct: (total / SECONDS) * 100, ff: (r.ffmpeg / SECONDS) * 100, node: (r.node / SECONDS) * 100 });
    const x = rows[rows.length - 1];
    console.log(`${label.padEnd(30)} ${x.pct.toFixed(0).padStart(4)}% of one core   (FFmpeg ${x.ff.toFixed(0)}%, ChurchStream ${x.node.toFixed(0)}%)`);
  };
  add('Floor: plain FFmpeg encode', await floor());
  add('ChurchStream, before studio', await churchstream({ studio: false }));
  if (info.zmq) {
    add('ChurchStream, studio at rest', await churchstream({ studio: true }));
    add('… with the stream page open', await churchstream({ studio: true, watching: true }));
    add('ChurchStream, studio fading', await churchstream({ studio: true, fades: true, watching: true }));
  } else console.log('This FFmpeg has no zmq filter: the studio is not used with it.');
  const base = rows[0].pct;
  const lines = rows.map((r) => `| ${r.label} | ${r.pct.toFixed(0)}% | ${r.ff.toFixed(0)}% | ${r.node.toFixed(0)}% | ${r === rows[0] ? '—' : `+${(r.pct - base).toFixed(0)} points (×${(r.pct / base).toFixed(2)})`} |`);
  console.log(rows.slice(1).map((r) => `${r.label}: ${(r.pct / base).toFixed(2)}× the floor`).join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Computer power: ChurchStream vs. the floor (${os.platform()})`, '', head, '',
      '| Run | CPU (% of one core) | FFmpeg | ChurchStream itself | Compared with the floor |', '|---|---|---|---|---|', ...lines, '',
      'The floor is plain FFmpeg doing only the same encode — the least any streaming software (vMix, OBS, …) can use for this stream. CI machines are shared, so numbers vary by a few points between runs.', '',
    ].join('\n'));
  }
})();

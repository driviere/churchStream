#!/usr/bin/env node
'use strict';
// How much computer power does the studio (scenes, transitions, Preview, multiview) cost?
// Runs the stream FFmpeg for real (test cameras, recording only) with and without the studio,
// and prints the CPU time each used. Usage: node scripts/bench-studio.js [ffmpeg] [seconds]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { buildFfmpegArgs } = require('../lib/stream');
const config = require('../lib/config');
const compositor = require('../lib/compositor');
const { ProgramFeed } = require('../lib/program-feed');
const { Overlay } = require('../lib/overlay');
const { acceptsInputQueue, hasZmq } = require('../lib/ffmpeg');
const { ZmqCommander, freePort } = require('../lib/zmq');
const { Studio } = require('../lib/studio');

const FF = process.argv[2] || 'ffmpeg';
const SECONDS = Number(process.argv[3]) || 20;
const info = { inputQueue: acceptsInputQueue(FF), zmq: hasZmq(FF), major: 99 };

async function run(label, { studio, fades = false, noFeeds = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'fonts', 'Inter-SemiBold.otf'), path.join(dir, 'font.otf'));
  new Overlay(dir);
  spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=navy:s=1280x720', '-frames:v', '1', '-y', path.join(dir, 'program.jpg')]);
  const cfg = config.merge(config.DEFAULTS, { quality: 'good', record: true, audio: { source: 'none' }, video: { type: 'testsrc' }, video2: { type: 'testsrc' } });
  const feed = new ProgramFeed();
  const feeds = { preview: new ProgramFeed(), multiview: new ProgramFeed() };
  await Promise.all([feed.ready, feeds.preview.ready, feeds.multiview.ready]);
  let st = null;
  if (studio) {
    st = { zmqPort: await freePort(), sceneA: compositor.findScene(cfg, 'pip'), sceneB: compositor.findScene(cfg, 'cam2'), feeds: noFeeds ? null : { preview: feeds.preview.port, multiview: feeds.multiview.port } };
  }
  const args = buildFfmpegArgs({ cfg, mode: 'live', runDir: dir, recordFile: path.join(dir, 'rec.mkv'), ffmpegInfo: info, feed: feed.port, studio: st, scene: 'pip' });
  const extra = process.env.BENCH_FCT ? ['-filter_complex_threads', process.env.BENCH_FCT] : [];
  const p = spawn(FF, ['-benchmark', ...extra, ...args], { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  let z = null;
  let timer = null;
  if (st && fades) {
    // Fade back and forth all the time: the worst case.
    z = new ZmqCommander(st.zmqPort);
    const studioCtl = new Studio({ send: (l) => z.send(l) });
    studioCtl.reset({ q: { width: 1280, height: 720, fps: 30 }, index: compositor.sourceIndex(compositor.sourceIds(cfg, { media: false })), sceneA: st.sceneA, sceneB: st.sceneB });
    setTimeout(() => z.connect(), 500);
    timer = setInterval(() => studioCtl.take('fade', 900), 1000);
  }
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(timer);
  p.stdin.write('q');
  await new Promise((r) => p.on('close', r));
  if (z) z.close();
  feed.close(); feeds.preview.close(); feeds.multiview.close();
  const m = err.match(/utime=([\d.]+)s stime=([\d.]+)s/);
  const cpu = m ? Number(m[1]) + Number(m[2]) : NaN;
  console.log(`${label.padEnd(38)} ${(cpu / SECONDS * 100).toFixed(0).padStart(4)}% of one core`);
  if (!m) console.log(err.split('\n').filter((l) => /error/i.test(l)).slice(-5).join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
  return cpu;
}

(async () => {
  console.log(`${FF}: ${SECONDS} s each, 720p, 2 test cameras, slides + camera, live with a recording`);
  const base = await run('Before the studio (simple switching)', { studio: false });
  if (!info.zmq) { console.log('This FFmpeg has no zmq filter: the studio is not used with it.'); return; }
  if (process.env.BENCH_DETAIL) await run('Studio without Preview/multiview', { studio: true, noFeeds: true });
  const rest = await run('Studio, at rest', { studio: true });
  const fading = await run('Studio, fading every second', { studio: true, fades: true });
  console.log(`Extra at rest: ${((rest / base - 1) * 100).toFixed(0)}%   while fading: ${((fading / base - 1) * 100).toFixed(0)}%`);
})();

'use strict';
// One FFmpeg process does everything: capture → overlays → ONE encode → YouTube, Facebook
// and an optional recording (tee muxer). Each destination sits behind its own FIFO with
// automatic recovery, so if one platform drops the others keep streaming.
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { FILES } = require('./overlay');
const { encoderArgs, splitEncoder } = require('./encoders');

const QUALITY = {
  low: { width: 854, height: 480, fps: 30, vbit: 1200, abit: 96, label: 'Low bandwidth (480p)' },
  good: { width: 1280, height: 720, fps: 30, vbit: 2500, abit: 128, label: 'Good (720p)' },
  high: { width: 1920, height: 1080, fps: 30, vbit: 4500, abit: 160, label: 'High (1080p)' },
};

const DESTINATIONS = {
  youtube: { label: 'YouTube', host: 'youtube.com', url: (k) => `rtmp://a.rtmp.youtube.com/live2/${k}` },
  facebook: { label: 'Facebook', host: 'facebook.com', url: (k) => `rtmps://live-api-s.facebook.com:443/rtmp/${k}` },
  custom: { label: 'Custom', host: null, url: (u) => u },
};

function destinationsFor(cfg) {
  const out = [];
  for (const [id, d] of Object.entries(DESTINATIONS)) {
    const o = cfg.outputs[id];
    if (!o || !o.enabled) continue;
    const secret = id === 'custom' ? o.url : o.key;
    if (!secret) continue;
    let host = d.host;
    if (!host) { try { host = new URL(secret).hostname; } catch { host = null; } }
    out.push({ id, label: d.label, host, url: d.url(secret.trim()), secret: secret.trim() });
  }
  return out;
}

function overlayGeometry(q) {
  const W = q.width;
  const H = q.height;
  const r = (x) => Math.round(x);
  const nameFs = r(H * 0.05);
  const titleFs = r(H * 0.034);
  const padN = r(H * 0.02);
  const padT = r(H * 0.015);
  const left = r(W * 0.055);
  const yName = r(H * 0.73);
  const yTitle = yName + r(nameFs * 1.2) + padN + padT;
  const capFs = r(H * 0.045);
  return {
    nameFs, titleFs, padN, padT, left, yName, yTitle, capFs,
    capPad: r(H * 0.02), capSpacing: r(H * 0.012), capBottom: r(H * 0.1),
    tickFs: r(H * 0.036), tickPad: r(H * 0.012), tickBottom: r(H * 0.022),
    captionMaxChars: Math.floor((W * 0.86) / (capFs * 0.56)),
  };
}

function supportsTextAlign(ffmpegInfo) {
  if (!ffmpegInfo || !ffmpegInfo.major) return true; // git/nightly builds are recent
  return ffmpegInfo.major >= 7 || /version n?6\.1/.test(ffmpegInfo.version || '');
}

// What the stream shows. 'auto' is resolved by the app before it gets here.
const SCENES = ['camera', 'slides', 'pip'];
const PROGRAM_FILE = 'program.jpg';

function pipGeometry(q) {
  const even = (n) => 2 * Math.round(n / 2);
  const w = even(q.width * 0.3);
  const h = even(w * 9 / 16);
  const border = Math.max(2, even(q.height * 0.004));
  const margin = Math.round(q.height * 0.045);
  return { w, h, border, x: q.width - w - 2 * border - margin, y: q.height - h - 2 * border - margin };
}

function scenePositions(scene, q) {
  const off = q.width + 8; // just outside the frame
  return {
    slidesX: scene === 'slides' || scene === 'pip' ? 0 : off,
    pipX: scene === 'pip' ? pipGeometry(q).x : off,
  };
}

function overlayFilters(q, opts = {}) {
  const g = overlayGeometry(q);
  const font = 'fontfile=font.otf'; // copied into FFmpeg's working dir → no path escaping needed
  const common = 'reload=1:expansion=none:fix_bounds=1:box=1';
  const align = opts.textAlign === false ? '' : ':text_align=C';
  return [
    `drawtext=${font}:textfile=${FILES.ltName}:${common}:fontsize=${g.nameFs}:fontcolor=0x111827:boxcolor=white@0.96:boxborderw=${g.padN}:x=${g.left + g.padN}:y=${g.yName}`,
    `drawtext=${font}:textfile=${FILES.ltTitle}:${common}:fontsize=${g.titleFs}:fontcolor=white:boxcolor=0x2563EB@0.95:boxborderw=${g.padT}:x=${g.left + g.padT}:y=${g.yTitle}`,
    `drawtext=${font}:textfile=${FILES.caption}:${common}:fontsize=${g.capFs}:fontcolor=white:boxcolor=black@0.62:boxborderw=${g.capPad}:line_spacing=${g.capSpacing}${align}:x=(w-text_w)/2:y=h-text_h-${g.capBottom}`,
    // Scrolling ticker along the bottom (right to left, repeating).
    `drawtext=${font}:textfile=${FILES.ticker}:reload=1:expansion=none:box=1:fontsize=${g.tickFs}:fontcolor=white:boxcolor=black@0.7:boxborderw=${g.tickPad}:y=h-text_h-${g.tickBottom}:x=w-mod(t*${tickerSpeed(q, opts.tickerSpeed)}\\,w+text_w)`,
  ];
}

function tickerSpeed(q, speed) {
  return Math.round(q.width * ({ slow: 0.06, fast: 0.15 }[speed] || 0.1)); // pixels per second
}

const teeEscape = (s) => String(s).replace(/([\\|[\]])/g, '\\$1');
const fwd = (p) => p.split(path.sep).join('/');

/**
 * Build the FFmpeg argument list. Pure function: easy to test.
 * mode: 'preview' (camera preview + audio meter, no encoding) | 'live'
 */
// Microphone clean-up for online viewers. Light: remove rumble and steady noise (fans, hum),
// even out loud and quiet speakers, never distort. Strong: more of each, for noisy rooms.
// Plus lip-sync delay and a level adjustment.
function micFilters(a = {}) {
  const out = [];
  const delay = Math.max(0, Math.min(1000, Math.round(Number(a.delayMs) || 0)));
  if (delay) out.push(`adelay=${delay}|${delay}`);
  const gain = Math.max(-12, Math.min(12, Number(a.gainDb) || 0));
  if (gain) out.push(`volume=${gain}dB`);
  if (a.cleanup === 'light') {
    out.push('highpass=f=80', 'afftdn=nr=10:nf=-40', 'acompressor=threshold=-20dB:ratio=2.5:attack=15:release=250:makeup=3dB', 'alimiter=limit=0.95:level=false');
  } else if (a.cleanup === 'strong') {
    out.push('highpass=f=100', 'afftdn=nr=20:nf=-35', 'acompressor=threshold=-24dB:ratio=4:attack=10:release=200:makeup=5dB', 'alimiter=limit=0.9:level=false');
  }
  return out;
}

function buildFfmpegArgs({ cfg, mode = 'live', encoder = 'libx264', runDir = '.', recordFile = null, ffmpegInfo = null, scene = 'camera', media = null, mediaVisible = false, platform = process.platform }) {
  const q = QUALITY[cfg.quality] || QUALITY.good;
  const args = ['-hide_banner', '-nostats', '-loglevel', 'level+info', '-progress', 'pipe:1', '-stats_period', '1', '-y'];
  const v = cfg.video || {};
  const a = cfg.audio || {};
  let audioMap = null;
  let inputs = 0;

  // --- video input (index 0) ---
  // 'dshow' means "a camera or capture card on this computer": DirectShow on Windows,
  // AVFoundation on a Mac (camera and microphone opened together, like on Windows).
  if (v.type === 'dshow' && v.device && platform === 'darwin') {
    const withMic = a.source === 'device' && a.device;
    args.push('-thread_queue_size', '1024', '-f', 'avfoundation', '-framerate', String(v.captureFps || 30),
      '-i', `${v.device}:${withMic ? a.device : 'none'}`);
    if (withMic) audioMap = '0:a';
  } else if (v.type === 'dshow' && v.device) {
    const withMic = a.source === 'device' && a.device;
    args.push('-thread_queue_size', '1024', '-rtbufsize', '256M', '-f', 'dshow',
      '-i', `video=${v.device}${withMic ? `:audio=${a.device}` : ''}`);
    if (withMic) audioMap = '0:a';
  } else if (v.type === 'rtsp' && v.rtspUrl) {
    args.push('-thread_queue_size', '1024', '-rtsp_transport', 'tcp', '-i', v.rtspUrl);
    if (a.source === 'camera') audioMap = '0:a';
  } else {
    args.push('-re', '-f', 'lavfi', '-i', `testsrc2=size=${q.width}x${q.height}:rate=${q.fps}`);
  }
  inputs++;

  // --- audio input (if not already part of the camera input) ---
  if (!audioMap) {
    if (a.source === 'device' && a.device && platform === 'win32') {
      args.push('-thread_queue_size', '1024', '-f', 'dshow', '-i', `audio=${a.device}`);
    } else if (a.source === 'device' && a.device && platform === 'darwin') {
      args.push('-thread_queue_size', '1024', '-f', 'avfoundation', '-i', `none:${a.device}`);
    } else if (v.type !== 'dshow' && v.type !== 'rtsp' && a.source !== 'none') {
      args.push('-re', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000,volume=0.08');
    } else {
      // Facebook rejects streams without audio, so send silence.
      args.push('-re', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    }
    audioMap = `${inputs}:a`;
    inputs++;
  }

  // --- the projector picture (rendered by the control panel, re-read from disk 4×/s) ---
  args.push('-re', '-thread_queue_size', '4', '-f', 'image2', '-loop', '1', '-framerate', '4', '-i', PROGRAM_FILE);
  const slidesIn = inputs;
  inputs++;

  // --- media bus from ChurchStream's relay (videos, music): always flowing, black + silence when idle ---
  let mediaV = null;
  let mediaA = null;
  if (media) {
    args.push('-thread_queue_size', '4', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-video_size', `${q.width}x${q.height}`, '-framerate', String(q.fps),
      '-i', `tcp://127.0.0.1:${media.video}`);
    mediaV = inputs++;
    args.push('-thread_queue_size', '8', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', `tcp://127.0.0.1:${media.audio}`);
    mediaA = inputs++;
  }

  // --- filters: camera + projector picture + camera inset → name/caption text → split ---
  const pixFmt = splitEncoder(encoder).name === 'h264_qsv' ? 'nv12' : 'yuv420p';
  const fit = `scale=${q.width}:${q.height}:force_original_aspect_ratio=decrease,pad=${q.width}:${q.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
  const pip = pipGeometry(q);
  const pos = scenePositions(scene, q);
  const composed =
    `[0:v]fps=${q.fps},${fit},split=2[cam][camsmall];` +
    `[${slidesIn}:v]fps=${q.fps},${fit}[slides];` +
    `[camsmall]scale=${pip.w}:${pip.h},pad=${pip.w + 2 * pip.border}:${pip.h + 2 * pip.border}:${pip.border}:${pip.border}:color=white[pip];` +
    // Hidden layers sit just off the right edge; moving them in/out is an instant command.
    `[cam][slides]overlay@slides=x=${pos.slidesX}:y=0:eof_action=repeat[s1];` +
    `[s1][pip]overlay@pip=x=${pos.pipX}:y=${pip.y}[s2];` +
    (mediaV !== null ? `[${mediaV}:v]setsar=1,format=yuv420p[media];[s2][media]overlay@media=x=${mediaVisible ? 0 : q.width + 8}:y=0[s3];` : '') +
    `[${mediaV !== null ? 's3' : 's2'}]${overlayFilters(q, { textAlign: supportsTextAlign(ffmpegInfo), tickerSpeed: cfg.tickerSpeed }).join(',')}`;
  // Sound: microphone/sound desk (cleaned up if chosen; + videos and music from the relay),
  // then the loudness meter.
  const micChain = ['aresample=48000:async=1', ...micFilters(a)].join(',');
  const audio = mediaA !== null
    ? `[${audioMap}]${micChain}[mic];[${mediaA}:a]aresample=48000[med];[mic][med]amix=inputs=2:normalize=0:duration=first:dropout_transition=0,ebur128=framelog=info[aout]`
    : `[${audioMap}]${micChain},ebur128=framelog=info[aout]`;
  const fc = mode === 'live'
    ? `${composed},split=2[vmain][vpv];[vmain]format=${pixFmt}[venc];[vpv]fps=1,scale=480:-2[vprev];${audio}`
    : `${composed},fps=1,scale=480:-2[vprev];${audio}`;
  args.push('-filter_complex', fc);

  if (mode === 'live') {
    const dests = destinationsFor(cfg);
    const slaves = dests.map((d) => `[f=flv:onfail=ignore]${teeEscape(d.url)}`);
    if (recordFile) slaves.push(`[f=matroska:onfail=ignore]${teeEscape(fwd(path.relative(runDir, recordFile)))}`);
    if (!slaves.length) throw new Error('Nothing to stream to. Add a YouTube or Facebook stream key in Settings, or turn on recording.');
    args.push('-map', '[venc]', '-map', '[aout]', ...encoderArgs(encoder, q),
      '-c:a', 'aac', '-b:a', `${q.abit}k`, '-ar', '48000', '-ac', '2',
      '-flags', '+global_header', '-f', 'tee', '-use_fifo', '1',
      '-fifo_options', 'attempt_recovery=1:recover_any_error=1:recovery_wait_time=3:max_recovery_attempts=0:drop_pkts_on_overflow=1:restart_with_keyframe=1:queue_size=300',
      slaves.join('|'));
  } else {
    args.push('-map', '[aout]', '-f', 'null', '-');
  }
  args.push('-map', '[vprev]', '-update', '1', '-q:v', '7', 'preview.jpg');
  return args;
}

function redact(line, secrets) {
  let s = String(line);
  for (const k of secrets) if (k && k.length > 3) s = s.split(k).join('••••');
  return s;
}

/** Supervises the FFmpeg process: start/stop, auto-restart, status parsing. */
class Streamer extends EventEmitter {
  constructor({ getConfig, runDir, recordingsDir, ffmpeg, getEncoder, relay = null }) {
    super();
    this.getConfig = getConfig;
    this.runDir = runDir;
    this.recordingsDir = recordingsDir;
    this.ffmpeg = ffmpeg; // { path, version, major }
    this.getEncoder = getEncoder;
    this.relay = relay;
    this.proc = null;
    this.want = 'off';
    this.retries = 0;
    this.restartTimer = null;
    this.status = this.blankStatus();
  }

  // Show or hide the video layer (a playing video covers everything except names/ticker).
  setMediaVisible(on) {
    on = !!on;
    if (on === !!this.mediaVisible) return;
    this.mediaVisible = on;
    const p = this.proc;
    if (!p || !p.stdin.writable || !this.relay) return;
    const q = QUALITY[this.getConfig().quality] || QUALITY.good;
    try { p.stdin.write(`coverlay@media -1 x ${on ? 0 : q.width + 8}\n`); } catch { /* restarting */ }
  }

  // Switch what the stream shows without restarting FFmpeg (sent as live filter commands).
  setScene(scene) {
    if (!SCENES.includes(scene)) scene = 'camera';
    if (scene === this.scene) return;
    this.scene = scene;
    this.status.scene = scene;
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    const q = QUALITY[this.getConfig().quality] || QUALITY.good;
    const pos = scenePositions(scene, q);
    try {
      p.stdin.write(`coverlay@slides -1 x ${pos.slidesX}\n`);
      p.stdin.write(`coverlay@pip -1 x ${pos.pipX}\n`);
    } catch { /* restarting */ }
    this.emit('status', this.status);
  }

  blankStatus() {
    return { mode: 'off', state: 'off', since: null, liveSince: null, fps: 0, speed: 0, dropped: 0, loudness: null, silent: false,
      encoder: null, quality: null, message: '', problem: '', destinations: {}, recording: false };
  }

  set(patch) { Object.assign(this.status, patch); this.emit('status', this.status); }

  // Start/stop/restart run one at a time: spawn() waits (encoder check) before FFmpeg is
  // running, and an overlapping start (a double click, preview → live) would otherwise
  // launch a second FFmpeg and leave the first one running unseen.
  serial(fn) {
    const run = (this.chain || Promise.resolve()).then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  start(mode) {
    this.want = mode;
    this.retries = 0;
    clearTimeout(this.restartTimer);
    return this.serial(async () => {
      if (this.want !== mode) return;
      if (this.proc) await this.kill();
      if (this.want === mode) await this.spawn(mode);
    });
  }

  stop() {
    this.want = 'off';
    clearTimeout(this.restartTimer);
    return this.serial(async () => {
      await this.kill();
      if (this.want !== 'off') return;
      this.status = this.blankStatus();
      this.emit('status', this.status);
    });
  }

  kill() {
    const p = this.proc;
    if (!p) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 4000);
      p.once('close', () => { clearTimeout(t); resolve(); });
      try { p.stdin.write('q'); } catch { try { p.kill(); } catch { /* gone */ } } // 'q' = graceful stop, finalises recordings
    });
  }

  async spawn(mode) {
    const cfg = this.getConfig();
    const q = QUALITY[cfg.quality] || QUALITY.good;
    const encoder = mode === 'live' ? await this.getEncoder() : null;
    let recordFile = null;
    if (mode === 'live' && cfg.record) {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
      recordFile = path.join(this.recordingsDir, `Service ${stamp}.mkv`);
      require('fs').mkdirSync(this.recordingsDir, { recursive: true });
    }
    let args;
    try {
      if (this.relay) {
        await this.relay.ready;
        this.relay.configure({ width: q.width, height: q.height, fps: q.fps });
      }
      args = buildFfmpegArgs({ cfg, mode, encoder: encoder || 'libx264', runDir: this.runDir, recordFile, ffmpegInfo: this.ffmpeg, scene: this.scene || 'camera',
        media: this.relay ? this.relay.ports : null, mediaVisible: !!this.mediaVisible });
    } catch (err) {
      this.want = 'off';
      this.set({ mode: 'off', state: 'error', problem: err.message });
      return;
    }
    if (this.want !== mode || this.proc) return; // stopped or switched while getting ready
    const dests = mode === 'live' ? destinationsFor(cfg) : [];
    this.secrets = dests.map((d) => d.secret);
    this.dests = dests;
    const destinations = Object.fromEntries(dests.map((d) => [d.id, { label: d.label, state: 'connecting', since: Date.now() }]));
    this.set({ mode, state: 'starting', since: Date.now(), liveSince: this.status.liveSince && mode === 'live' ? this.status.liveSince : (mode === 'live' ? Date.now() : null),
      encoder, quality: q.label, problem: '', message: mode === 'live' ? 'Connecting…' : 'Camera preview', destinations, recording: !!recordFile, dropped: 0 });

    const proc = spawn(this.ffmpeg.path, args, { cwd: this.runDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.lastLines = [];
    this.silentSince = null;
    this.speedHist = [];
    this.slowCount = 0;
    let progress = {};
    let outBuf = '';
    let errBuf = '';

    proc.stdout.on('data', (d) => {
      outBuf += d;
      let i;
      while ((i = outBuf.indexOf('\n')) >= 0) {
        const line = outBuf.slice(0, i).trim();
        outBuf = outBuf.slice(i + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        progress[line.slice(0, eq)] = line.slice(eq + 1);
        if (line.startsWith('progress=')) { this.onProgress(progress); progress = {}; }
      }
    });
    proc.stderr.on('data', (d) => {
      errBuf += d;
      let i;
      while ((i = errBuf.search(/[\r\n]/)) >= 0) {
        const line = errBuf.slice(0, i).trim();
        errBuf = errBuf.slice(i + 1);
        if (line) this.onLog(line);
      }
    });
    proc.on('error', (err) => this.onLog('[error] ' + err.message));
    proc.on('close', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.want === 'off') return;
      const why = this.lastError() || `FFmpeg stopped (code ${code}).`;
      this.retries++;
      const delay = Math.min(30, 2 ** Math.min(this.retries, 5));
      this.set({ state: 'retrying', problem: why, message: `Reconnecting in ${delay}s…` });
      this.emit('log', `ffmpeg exited (${code}); retry ${this.retries} in ${delay}s`);
      const want = this.want;
      this.restartTimer = setTimeout(() => this.serial(async () => { if (this.want === want && !this.proc) await this.spawn(want); }), delay * 1000);
    });
  }

  onProgress(p) {
    const fps = parseFloat(p.fps) || 0;
    // FFmpeg's own fps/speed figures can describe the 1-per-second preview output, so measure
    // speed ourselves: how much stream time was produced per second of real time.
    const now = Date.now();
    const outUs = parseInt(p.out_time_us || p.out_time_ms, 10);
    const hist = (this.speedHist = (this.speedHist || []).filter((h) => now - h.t < 6000));
    if (Number.isFinite(outUs) && outUs > 0) hist.push({ t: now, us: outUs });
    let speed = 0;
    if (hist.length >= 3 && now - hist[0].t >= 4000) speed = (hist[hist.length - 1].us - hist[0].us) / 1000 / (hist[hist.length - 1].t - hist[0].t);
    const patch = { fps, speed: Math.round(speed * 100) / 100, dropped: parseInt(p.drop_frames, 10) || 0 };
    const started = fps > 0 || (Number.isFinite(outUs) && outUs > 0);
    if (this.status.state !== 'running' && started) {
      this.retries = 0;
      patch.state = 'running';
      patch.problem = '';
      patch.message = this.status.mode === 'live' ? 'Live' : 'Camera preview';
      const now = Date.now();
      for (const d of Object.values(this.status.destinations)) if (d.state === 'connecting') { d.state = 'ok'; d.since = now; }
    }
    // Destinations marked "retrying" recover after a quiet period with no new errors.
    for (const d of Object.values(this.status.destinations)) {
      if (d.state === 'retrying' && Date.now() - d.lastError > 20000) { d.state = 'ok'; d.since = Date.now(); }
    }
    if (/connection problem/.test(this.status.problem) && Object.values(this.status.destinations).every((d) => d.state === 'ok')) patch.problem = '';
    const cfg = this.getConfig();
    const silent = this.status.mode === 'live' && cfg.audio.source !== 'none' && this.silentSince && Date.now() - this.silentSince > 10000;
    patch.silent = !!silent;
    this.slowCount = this.status.mode === 'live' && speed && speed < 0.85 ? (this.slowCount || 0) + 1 : 0;
    if (this.slowCount >= 5) patch.problem = 'The computer is struggling to keep up. Try “Low bandwidth” quality in Settings.';
    else if (this.status.state === 'running' && /struggling/.test(this.status.problem)) patch.problem = '';
    this.set(patch);
  }

  onLog(raw) {
    const line = redact(raw, this.secrets || []);
    const m = line.match(/\bM:\s*(-?[\d.]+|-inf)/);
    if (m) {
      const val = m[1] === '-inf' ? -120 : parseFloat(m[1]);
      const now = Date.now();
      if (val < -55) { if (!this.silentSince) this.silentSince = now; } else this.silentSince = null;
      if (!this.lastMeter || now - this.lastMeter > 200) { this.lastMeter = now; this.status.loudness = val; this.emit('meter', val); }
      return;
    }
    if (/Recovery successful/i.test(line)) {
      // The FIFO for one destination reconnected. If only one was failing, it's that one.
      const failing = Object.values(this.status.destinations).filter((d) => d.state === 'retrying');
      if (failing.length === 1) { failing[0].state = 'ok'; failing[0].since = Date.now(); }
      if (!failing.length || failing.length === 1) this.set({ problem: /connection problem/.test(this.status.problem) ? '' : this.status.problem });
      return;
    }
    this.lastLines.push(line);
    if (this.lastLines.length > 200) this.lastLines.shift();
    this.emit('log', line);
    const isErr = /\[(error|fatal)\]/.test(line) || /(failed|refused|timed out|I\/O error|Broken pipe|Connection reset|Server error)/i.test(line);
    if (!isErr) return;
    const lower = line.toLowerCase();
    for (const d of this.dests || []) {
      if (d.host && lower.includes(d.host.toLowerCase())) {
        const st = this.status.destinations[d.id];
        if (st) { st.state = 'retrying'; st.lastError = Date.now(); }
        this.set({ problem: `${d.label} connection problem — retrying automatically.` });
        return;
      }
    }
    if (/queue (is )?full|dropping/i.test(line)) this.set({ problem: 'Upload is too slow for this quality. Try “Low bandwidth” in Settings.' });
  }

  // The most useful error from the last FFmpeg run, in plain language. FFmpeg's final lines
  // ("Nothing was written…", "Conversion failed") are only consequences, so skip those.
  lastError() {
    const noise = /Nothing was written into output|Conversion failed|Error while (filtering|decoding|processing)|Terminating (thread|demuxer)|Error closing|Task finished|Exiting normally|deprecated pixel format/i;
    const errs = (this.lastLines || []).filter((l) => /\[(error|fatal)\]/.test(l) && !noise.test(l));
    const all = errs.join('\n');
    const dests = this.dests || [];
    for (const d of dests) {
      if (d.host && all.toLowerCase().includes(d.host.toLowerCase())) {
        return d.id === 'facebook'
          ? 'Facebook did not accept the connection. Check the stream key in Settings (tick “Use a persistent stream key” in Facebook Live Producer, or copy a fresh key).'
          : `${d.label} did not accept the connection. Check the stream key in Settings.`;
      }
    }
    if (/Failed to create AV capture input device|not authorized|AVFoundation.*(permission|access)/i.test(all)) return 'macOS is blocking the camera or microphone. Open System Settings → Privacy & Security → Camera (and Microphone), turn on Terminal, then start again.';
    if (/Selected framerate .* is not supported/i.test(all)) return 'This camera does not support 30 frames per second. Try another camera or capture card.';
    if (/Video device not found|Audio device not found/i.test(all)) return 'Camera or microphone not found. Check the cable, then pick it again in Settings → Camera & sound.';
    if (/Could not find (video|audio) device|Could not run graph|Could not enumerate|dshow/i.test(all)) return 'Camera or microphone not found or busy. Close other apps using it (Zoom, Teams, Camera), check the cable, then pick it again in Settings.';
    if (/Connection refused|Cannot open connection|timed out|Network is unreachable|Host not found|getaddrinfo/i.test(all)) return 'Cannot reach the streaming service. Check the internet connection.';
    if (/Input\/output error|Server returned|handshake|tls|rtmps?/i.test(all)) return 'The streaming service refused the connection. Check the stream key in Settings.';
    if (/program\.jpg/i.test(all)) return 'Could not read the slide picture for the stream. Keep the control panel open while streaming slides.';
    const first = errs[0] || (this.lastLines || []).filter((l) => /\[(error|fatal)\]/.test(l)).pop() || '';
    return first.replace(/^\[[^\]]*\]\s*/, '').replace(/\[(error|fatal)\]\s*/, '').slice(0, 200);
  }
}

module.exports = { micFilters, SCENES, PROGRAM_FILE, pipGeometry, scenePositions, buildFfmpegArgs, overlayGeometry, encoderArgs, destinationsFor, teeEscape, Streamer, QUALITY, DESTINATIONS, redact };

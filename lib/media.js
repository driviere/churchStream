'use strict';
// Media relay: feeds the stream's FFmpeg a steady, never-ending picture and sound "bus".
//
//   video/music file ──► player FFmpeg ──raw frames/PCM──► MediaRelay ──steady 30 fps / 20 ms──► stream FFmpeg
//
// When nothing plays the relay sends black frames and silence, so the stream FFmpeg never
// waits on this input and the live stream is never interrupted when a video starts or ends.
// Volume and fades are applied here (in JavaScript) to the PCM samples.
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const RATE = 48000;          // audio sample rate
const CH = 2;                // stereo
const CHUNK_MS = 20;         // audio is sent in 20 ms chunks
const CHUNK_BYTES = (RATE * CH * 2 * CHUNK_MS) / 1000;

function listen() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

class MediaRelay extends EventEmitter {
  constructor({ ffmpegPath }) {
    super();
    this.ffmpegPath = ffmpegPath;
    this.width = 0;
    this.height = 0;
    this.fps = 0;
    this.outVideo = null; // socket from the stream FFmpeg
    this.outAudio = null;
    this.player = null;
    this.now = null;      // { id, kind: 'video'|'audio', file, title, startedAt, volume, loop }
    this.music = null;    // background music: same shape, mixed under everything
    this.frame = null;    // latest video frame from the player
    this.audioQ = [];     // PCM chunks from the player
    this.musicQ = [];
    this.gain = 1;        // current (smoothed) gains
    this.musicGain = 0;
    this.ready = this.init();
  }

  async init() {
    // Two servers the stream FFmpeg connects to, two the players connect to.
    this.srvVideoOut = await listen();
    this.srvAudioOut = await listen();
    this.srvVideoIn = await listen();
    this.srvAudioIn = await listen();
    this.srvMusicIn = await listen();
    this.srvVideoOut.on('connection', (s) => { this.outVideo?.destroy(); this.outVideo = s; s.on('error', () => {}); s.on('close', () => { if (this.outVideo === s) this.outVideo = null; }); });
    this.srvAudioOut.on('connection', (s) => { this.outAudio?.destroy(); this.outAudio = s; s.on('error', () => {}); s.on('close', () => { if (this.outAudio === s) this.outAudio = null; }); });
    this.srvVideoIn.on('connection', (s) => this.readVideo(s));
    this.srvAudioIn.on('connection', (s) => this.readAudio(s, this.audioQ));
    this.srvMusicIn.on('connection', (s) => this.readAudio(s, this.musicQ));
    return this;
  }

  get ports() {
    return { video: this.srvVideoOut.address().port, audio: this.srvAudioOut.address().port };
  }

  // Called before each stream FFmpeg start with the stream's size and frame rate.
  configure({ width, height, fps }) {
    if (width === this.width && height === this.height && fps === this.fps) return;
    this.width = width; this.height = height; this.fps = fps;
    this.frameSize = (width * height * 3) / 2; // yuv420p
    this.black = Buffer.alloc(this.frameSize);
    this.black.fill(16, 0, width * height);          // Y = 16 (black)
    this.black.fill(128, width * height);            // U, V = 128
    this.frame = null;
    this.startClocks();
  }

  startClocks() {
    clearInterval(this.videoTimer);
    clearInterval(this.audioTimer);
    // Send frames on a wall-clock schedule (catching up after any timer delay).
    let t0 = Date.now();
    let sent = 0;
    this.videoTimer = setInterval(() => {
      const due = Math.floor(((Date.now() - t0) * this.fps) / 1000);
      if (due - sent > this.fps) { t0 = Date.now(); sent = 0; return; } // way behind (e.g. sleep): resync
      for (; sent < due; sent++) this.sendFrame();
    }, Math.max(5, Math.floor(1000 / this.fps / 2)));
    let a0 = Date.now();
    let chunks = 0;
    this.audioTimer = setInterval(() => {
      const due = Math.floor((Date.now() - a0) / CHUNK_MS);
      if (due - chunks > 50) { a0 = Date.now(); chunks = 0; return; }
      for (; chunks < due; chunks++) this.sendAudio();
    }, 10);
  }

  sendFrame() {
    const s = this.outVideo;
    if (!s || s.writableNeedDrain) return; // never queue up memory if FFmpeg is slow
    s.write(this.now && this.now.kind === 'video' && this.frame ? this.frame : this.black);
  }

  sendAudio() {
    const s = this.outAudio;
    const main = this.audioQ.length ? this.audioQ.shift() : null;
    const bg = this.musicQ.length ? this.musicQ.shift() : null;
    if (!s || s.writableNeedDrain) return;
    // Mix: media (video sound / music item) + background music, with smooth gain changes.
    const out = Buffer.alloc(CHUNK_BYTES);
    const target = this.now ? (this.now.volume ?? 1) : 0;
    const mTarget = this.music ? (this.music.volume ?? 0.5) * (this.now ? 0 : 1) : 0; // music steps aside for videos
    const n = CHUNK_BYTES / 2;
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * 0.0005;
      this.musicGain += (mTarget - this.musicGain) * 0.0002;
      let v = 0;
      if (main) v += main.readInt16LE(i * 2) * this.gain;
      if (bg) v += bg.readInt16LE(i * 2) * this.musicGain;
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
    }
    s.write(out);
  }

  readVideo(sock) {
    let buf = Buffer.alloc(this.frameSize);
    let have = 0;
    sock.on('data', (d) => {
      let off = 0;
      while (off < d.length) {
        const take = Math.min(this.frameSize - have, d.length - off);
        d.copy(buf, have, off, off + take);
        have += take; off += take;
        if (have === this.frameSize) { this.frame = buf; buf = Buffer.alloc(this.frameSize); have = 0; }
      }
    });
    sock.on('error', () => {});
  }

  readAudio(sock, queue) {
    let pending = Buffer.alloc(0);
    sock.on('data', (d) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= CHUNK_BYTES) {
        queue.push(pending.subarray(0, CHUNK_BYTES));
        pending = pending.subarray(CHUNK_BYTES);
      }
      if (queue.length > 250) queue.splice(0, queue.length - 250); // keep under 5 s of backlog
    });
    sock.on('error', () => {});
  }

  // Play a video or audio file into the stream (and report when it ends).
  play(item) {
    this.stop(true);
    const kind = item.kind === 'audio' ? 'audio' : 'video';
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re'];
    if (item.loop) args.push('-stream_loop', '-1');
    if (item.seek) args.push('-ss', String(item.seek));
    args.push('-i', item.path);
    if (kind === 'video' && this.width) {
      const W = this.width;
      const H = this.height;
      args.push('-map', '0:v:0?', '-vf', `fps=${this.fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`,
        '-f', 'rawvideo', `tcp://127.0.0.1:${this.srvVideoIn.address().port}`);
    }
    args.push('-map', '0:a:0?', '-ac', String(CH), '-ar', String(RATE), '-f', 's16le', `tcp://127.0.0.1:${this.srvAudioIn.address().port}`);
    this.audioQ.length = 0;
    this.frame = null;
    const p = spawn(this.ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { err += '\n' + e.message; });
    this.player = p;
    this.now = { ...item, kind, startedAt: Date.now() - (item.seek || 0) * 1000, volume: item.volume ?? 1 };
    p.on('close', (code) => {
      if (this.player !== p) return;
      this.player = null;
      const ended = this.now;
      // Let the last of the sound play out, then go back to black + silence.
      setTimeout(() => { if (!this.player && this.now === ended) { this.now = null; this.frame = null; this.emit('change'); } }, 400);
      this.emit('ended', { item: ended, error: code ? `exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}` : '' });
    });
    this.emit('change');
  }

  stop(quiet) {
    const p = this.player;
    this.player = null;
    if (p) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    this.now = null;
    this.frame = null;
    this.audioQ.length = 0;
    if (!quiet) this.emit('change');
  }

  setVolume(v) { if (this.now) { this.now.volume = Math.max(0, Math.min(1.5, v)); this.emit('change'); } }

  // Background music (loops a list of files, plays under everything at low volume).
  playMusic(files, volume = 0.5) {
    this.stopMusic(true);
    if (!files.length) return;
    // ffconcat playlist so several songs play back to back, looping.
    const list = files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
    const listFile = path.join(os.tmpdir(), `churchstream-music-${process.pid}.ffconcat`);
    fs.writeFileSync(listFile, 'ffconcat version 1.0\n' + list + '\n');
    const p = spawn(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-stream_loop', '-1', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vn', '-ac', String(CH), '-ar', String(RATE), '-f', 's16le', `tcp://127.0.0.1:${this.srvMusicIn.address().port}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    this.musicPlayer = p;
    this.music = { files, volume, startedAt: Date.now() };
    p.on('close', () => { if (this.musicPlayer === p) { this.musicPlayer = null; this.music = null; this.emit('change'); } });
    this.emit('change');
  }

  setMusicVolume(v) { if (this.music) { this.music.volume = Math.max(0, Math.min(1, v)); this.emit('change'); } }

  stopMusic(quiet) {
    const p = this.musicPlayer;
    this.musicPlayer = null;
    if (p) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    this.music = null;
    this.musicQ.length = 0;
    if (!quiet) this.emit('change');
  }

  status() {
    return {
      now: this.now ? { id: this.now.id, kind: this.now.kind, title: this.now.title, startedAt: this.now.startedAt, volume: this.now.volume, loop: !!this.now.loop } : null,
      music: this.music ? { volume: this.music.volume, count: this.music.files.length, startedAt: this.music.startedAt } : null,
    };
  }

  close() {
    this.stop(true);
    this.stopMusic(true);
    clearInterval(this.videoTimer);
    clearInterval(this.audioTimer);
  }
}

module.exports = { MediaRelay, RATE, CH };

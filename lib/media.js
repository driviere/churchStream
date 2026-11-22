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
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const IDLE_FPS = 5;          // black pictures a second while nothing plays
const HEAD_START_MS = 200;   // picture and sound are sent this far ahead of real time

// The picture goes to the stream FFmpeg as Matroska (uncompressed I420 frames, one per cluster)
// so that each frame carries its own time: then black can be sent only a few times a second
// while nothing plays, and FFmpeg still places every frame exactly. (Raw frames would be timed
// by counting, which needs every one of the 30 a second — about 40 MB/s at 720p.)
function ebml(id, ...body) {
  const data = Buffer.concat(body.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b))));
  return Buffer.concat([idBytes(id), vsize(data.length), data]);
}
function idBytes(id) { const h = id.toString(16); return Buffer.from(h.length % 2 ? '0' + h : h, 'hex'); }
function vsize(n) { const b = Buffer.alloc(8); b[0] = 0x01; b.writeUIntBE(Math.floor(n / 2 ** 32), 1, 3); b.writeUInt32BE(n % 2 ** 32, 4); return b; } // 8-byte size
function uint(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }
const MKV_UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function mkvHeader(width, height) {
  const head = ebml(0x1a45dfa3, ebml(0x4286, uint(1)), ebml(0x42f7, uint(1)), ebml(0x42f2, uint(4)), ebml(0x42f3, uint(8)),
    ebml(0x4282, 'matroska'), ebml(0x4287, uint(4)), ebml(0x4285, uint(2)));
  const info = ebml(0x1549a966, ebml(0x2ad7b1, uint(1000000)), ebml(0x4d80, 'ChurchStream'), ebml(0x5741, 'ChurchStream'));
  const track = ebml(0xae, ebml(0xd7, uint(1)), ebml(0x73c5, uint(1)), ebml(0x83, uint(1)), ebml(0x86, 'V_UNCOMPRESSED'), ebml(0x9c, uint(0)),
    ebml(0xe0, ebml(0xb0, uint(width)), ebml(0xba, uint(height)), ebml(0x2eb524, 'I420')));
  // The Segment's size is unknown (it never ends).
  return Buffer.concat([head, idBytes(0x18538067), MKV_UNKNOWN, info, ebml(0x1654ae6b, track)]);
}
// What goes before a frame: a Cluster with the time (ms) and one SimpleBlock holding the frame.
function mkvFramePrefix(ms, frameLength) {
  const blockHead = Buffer.from([0x81, 0, 0, 0x80]); // track 1, time 0 in the cluster, keyframe
  const block = Buffer.concat([idBytes(0xa3), vsize(blockHead.length + frameLength), blockHead]);
  const time = ebml(0xe7, uint(ms));
  return Buffer.concat([idBytes(0x1f43b675), vsize(time.length + block.length + frameLength), time, block]);
}

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
    // The stream FFmpeg connects here. The picture: each frame stamped with the time since this
    // connection (plus the head start), every frame while something plays and IDLE_FPS a second
    // of black while nothing does; one can be skipped while FFmpeg is busy. The sound is timed
    // by counting, so it goes on a wall-clock schedule with the same head start and nothing is
    // ever skipped: a missing piece would make the whole stream wait.
    this.srvVideoOut.on('connection', (s) => {
      this.outVideo?.destroy();
      this.outVideo = s;
      s.setNoDelay(true);
      s.on('error', () => {});
      s.on('close', () => { if (this.outVideo === s) this.outVideo = null; });
      const t0 = Date.now() - HEAD_START_MS;
      s.write(mkvHeader(this.width, this.height));
      let last = -1;
      let next = 0;
      let playing = false;
      let timer = null;
      // Wakes only when a frame is due (or every 50 ms to notice a video starting): polling
      // every few milliseconds would itself cost more than sending the black frames.
      const tick = () => {
        if (s.destroyed) return;
        const now = Date.now();
        const live = this.currentFrame() !== this.black;
        if (live !== playing) { playing = live; next = 0; } // a video starts or ends: at once
        if (now >= next) {
          const gap = 1000 / (playing ? this.fps : IDLE_FPS);
          next = next && now - next < gap ? next + gap : now + gap;
          if (s.writableLength <= this.frameSize * this.fps * 2) { // else FFmpeg is stuck (it will be restarted)
            const ms = Math.max(last + 1, now - t0);
            last = ms;
            const pic = this.currentFrame();
            s.write(mkvFramePrefix(ms, pic.length));
            s.write(pic);
          }
        }
        timer = setTimeout(tick, Math.max(1, Math.min(playing ? 1000 : 50, next - Date.now())));
      };
      tick();
      s.on('close', () => clearTimeout(timer));
    });
    this.srvAudioOut.on('connection', (s) => {
      this.outAudio?.destroy();
      this.outAudio = s;
      s.setNoDelay(true);
      s.on('error', () => {});
      s.on('close', () => { if (this.outAudio === s) { this.outAudio = null; clearInterval(timer); } });
      const t0 = Date.now() - HEAD_START_MS;
      let sent = 0;
      const timer = setInterval(() => {
        if (s.destroyed) { clearInterval(timer); return; }
        const due = Math.floor((Date.now() - t0) / CHUNK_MS);
        if (s.writableLength > CHUNK_BYTES * 500) { sent = due; return; }
        for (; sent < due; sent++) s.write(this.mixChunk());
      }, CHUNK_MS); // a chunk is due every 20 ms; the head start covers the timer's jitter
    });
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
  }

  currentFrame() {
    return this.now && this.now.kind === 'video' && this.frame ? this.frame : this.black;
  }

  // Mix the media sound (video / music item) with background music, with smooth gain changes.
  mixChunk() {
    // Keep latency low: if the players have run ahead, drop the oldest sound.
    if (this.audioQ.length > 25) this.audioQ.splice(0, this.audioQ.length - 10); // players ran ahead: keep latency low
    if (this.musicQ.length > 25) this.musicQ.splice(0, this.musicQ.length - 10);
    const main = this.audioQ.length ? this.audioQ.shift() : null;
    const bg = this.musicQ.length ? this.musicQ.shift() : null;
    const target = this.now ? (this.now.volume ?? 1) : 0;
    const mTarget = this.music ? (this.music.volume ?? 0.5) * ((this.now && !this.now.silent) || this.ducked ? 0 : 1) : 0; // music steps aside for videos (not for a silent logo video)
    if (!main && !bg && Math.abs(this.gain - target) < 1e-4 && Math.abs(this.musicGain - mTarget) < 1e-4) return SILENCE; // never changed, so it can be shared
    const out = Buffer.alloc(CHUNK_BYTES);
    const n = CHUNK_BYTES / 2;
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * 0.0005;
      this.musicGain += (mTarget - this.musicGain) * 0.0002;
      let v = 0;
      if (main) v += main.readInt16LE(i * 2) * this.gain;
      if (bg) v += bg.readInt16LE(i * 2) * this.musicGain;
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
    }
    return out;
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

  // Does this file have a sound track, and how long is it? (Asked once per file.)
  fileInfo(file) {
    this.infoCache = this.infoCache || new Map();
    if (!this.infoCache.has(file)) {
      const r = require('child_process').spawnSync(this.ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      const err = String(r.stderr);
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
      this.infoCache.set(file, { audio: /Stream #\d+:\d+.*: Audio:/.test(err), duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0 });
    }
    return this.infoCache.get(file);
  }

  // Play a video or audio file into the stream (and report when it ends).
  play(item) {
    this.stop(true);
    const kind = item.kind === 'audio' ? 'audio' : 'video';
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re'];
    if (item.loop) args.push('-stream_loop', '-1');
    if (item.seek) args.push('-ss', String(item.seek));
    args.push('-i', item.path);
    // A video with no sound track (a silent logo or announcement video): use silence instead,
    // otherwise FFmpeg has no audio to send and refuses to start.
    const info = this.fileInfo(item.path);
    const audioIn = info.audio ? '0:a:0' : '1:a:0';
    if (!info.audio) {
      // As long as the video (minus where it starts), or endless when it repeats.
      const len = !item.loop && info.duration ? Math.max(0.1, info.duration - (item.seek || 0)) : 0;
      args.push('-f', 'lavfi', ...(len ? ['-t', len.toFixed(2)] : []), '-i', `anullsrc=r=${RATE}:cl=stereo`);
    }
    if (kind === 'video' && this.width) {
      const W = this.width;
      const H = this.height;
      // cover: fill the frame and crop the edges (a full-screen logo video); otherwise fit with black bars.
      const fit = item.cover ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
      args.push('-map', '0:v:0?', '-vf', `fps=${this.fps},${fit},setsar=1,format=yuv420p`,
        '-f', 'rawvideo', `tcp://127.0.0.1:${this.srvVideoIn.address().port}`);
    }
    args.push('-map', audioIn, '-ac', String(CH), '-ar', String(RATE), '-f', 's16le', `tcp://127.0.0.1:${this.srvAudioIn.address().port}`);
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
    for (const k of ['srvVideoOut', 'srvAudioOut', 'srvVideoIn', 'srvAudioIn', 'srvMusicIn']) { try { this[k] && this[k].close(); } catch { /* closed */ } }
  }
}

module.exports = { MediaRelay, RATE, CH, IDLE_FPS, mkvHeader, mkvFramePrefix };

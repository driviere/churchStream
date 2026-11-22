'use strict';
// Graphics on the stream (the stream page's pictures and titles): one see-through layer on top of
// every scene. The stream page draws each graphic as a PNG at the stream's size; when one goes
// on or off, FFmpeg turns the ones that are on into a single raw picture (once), and this feeds
// that picture to the stream FFmpeg 30 times a second over a local connection, timed on arrival.
//
// Why not let FFmpeg read the PNG itself? Its overlay waits for the graphics layer's next frame
// before it uses the current one, so a layer read a few times a second holds the whole stream
// back (slides then reached the stream 1.4 s later); reading it 30 times a second means decoding a
// PNG 30 times a second. Repeating a ready picture costs far less (about 4% of one core).
const { execFile } = require('child_process');
const net = require('net');
const fs = require('fs');

const IDLE_FPS = 4;

class GraphicsFeed {
  constructor({ ffmpegPath = null } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.width = 0;
    this.height = 0;
    this.fps = 30;
    this.frame = null; // raw yuva420p
    this.blank = null;
    this.out = null;
    this.idleFps = IDLE_FPS;
    this.ready = new Promise((resolve, reject) => {
      this.srv = net.createServer((s) => this.feed(s));
      this.srv.once('error', reject);
      this.srv.listen(0, '127.0.0.1', () => resolve(this));
    });
  }

  get port() { return this.srv.address() ? this.srv.address().port : null; }

  // Before each stream start: the picture's size and frame rate.
  configure({ width, height, fps }) {
    this.fps = fps || 30;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const y = width * height;
    this.blank = Buffer.alloc(y * 2 + (y >> 1)); // Y, U, V (quarter size each), A: all see-through
    this.blank.fill(16, 0, y);
    this.blank.fill(128, y, y + (y >> 1));
    this.frame = null;
    this.files = null; // what is shown has to be made again at the new size
  }

  current() { return this.frame || this.blank; }

  // The stream FFmpeg connected: the picture on a steady schedule; skipped while FFmpeg is busy.
  // While nothing is shown, only IDLE_FPS a second: the layer is off then, and each picture is
  // stamped half a second ahead (see stream.js), so the stream never waits for the next one.
  feed(s) {
    this.out?.destroy();
    this.out = s;
    s.setNoDelay(true);
    s.on('error', () => {});
    let next = 0;
    let shown = null;
    let timer = null;
    // Wakes only when a picture is due (or every 50 ms to notice a new one).
    const tick = () => {
      if (s.destroyed) return;
      const now = Date.now();
      const pic = this.current();
      if (pic !== shown) next = 0; // a new picture goes at once
      if (pic && now >= next) {
        const gap = 1000 / (this.frame ? this.fps : this.idleFps);
        next = next && now - next < gap ? next + gap : now + gap;
        if (s.writableLength === 0) { s.write(pic); shown = pic; } // else FFmpeg is busy: skip this one
      }
      timer = setTimeout(tick, Math.max(1, Math.min(50, next - Date.now())));
    };
    tick();
    s.on('close', () => { clearTimeout(timer); if (this.out === s) this.out = null; });
  }

  // Show these PNG files (in order, each on top of the one before), or nothing for [].
  show(files) {
    const list = files.filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    this.files = list;
    if (!list.length) { this.frame = null; return Promise.resolve(); }
    if (!this.width || !this.ffmpegPath) return Promise.resolve();
    const W = this.width;
    const H = this.height;
    const ins = list.flatMap((f) => ['-i', f]);
    // Each fitted to the picture's size (in case it was drawn for another size), then stacked.
    let fc = list.map((_, i) => `[${i}:v]format=rgba,scale=${W}:${H}[l${i}]`).join(';');
    let last = '[l0]';
    for (let i = 1; i < list.length; i++) { fc += `;${last}[l${i}]overlay=format=auto[m${i}]`; last = `[m${i}]`; }
    fc += `;${last}format=yuva420p[o]`;
    return new Promise((resolve, reject) => {
      execFile(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...ins, '-filter_complex', fc, '-map', '[o]', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 15000 }, (err, out) => {
          if (err || !out || out.length !== this.blank.length) { reject(new Error('The graphic could not be prepared')); return; }
          if (this.files === list) this.frame = out; // not overtaken by a newer change
          resolve();
        });
    });
  }

  close() { this.out?.destroy(); this.srv.close(); }
}

module.exports = { GraphicsFeed, IDLE_FPS };

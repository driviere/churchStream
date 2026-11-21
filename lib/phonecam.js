'use strict';
// Phone cameras: a phone opens the camera page (https, see lib/cert.js) and sends JPEG
// pictures. Here we keep the latest picture of each phone camera and feed it to the stream
// FFmpeg as an MJPEG input over a local TCP connection, at a steady frame rate: the latest
// picture is repeated as needed, and with no phone (or no picture for 3 s) a "waiting" picture
// is sent instead. So the stream never stalls when a phone drops off the Wi-Fi; the picture
// comes back by itself when the phone reconnects.
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const crypto = require('crypto');
const net = require('net');

const STALE_MS = 3000;

function listen() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const isJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

// Width and height of a JPEG (from its frame header), or null.
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const l = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + l;
  }
  return null;
}
// Every picture has this size (the phone page letterboxes into it), so the stream's picture
// never changes shape — FFmpeg would otherwise rebuild the whole stream picture.
const WIDTH = 1280;
const HEIGHT = 720;

class PhoneCams extends EventEmitter {
  constructor({ ffmpegPath = null, workDir = null, fps = 30 } = {}) {
    super();
    this.ffmpegPath = ffmpegPath;
    this.workDir = workDir;
    this.fps = fps;
    this.cams = { 1: { frame: null, at: 0, srv: null, out: null, seen: 0 }, 2: { frame: null, at: 0, srv: null, out: null, seen: 0 } };
    this.waiting = null;
    this.ready = this.init();
  }

  async init() {
    for (const n of [1, 2]) {
      const c = this.cams[n];
      c.srv = await listen();
      c.srv.on('connection', (s) => this.feed(n, s));
    }
    this.waiting = await this.makeWaiting().catch(() => null);
    // Tell the control panel when a phone connects or drops off.
    this.watch = setInterval(() => { for (const n of [1, 2]) this.status(n); }, 1000);
    this.watch.unref?.();
    return this;
  }

  get ports() { return { 1: this.cams[1].srv?.address().port, 2: this.cams[2].srv?.address().port }; }

  // A dark picture with a short message, made once by FFmpeg (or a tiny built-in one without it).
  makeWaiting() {
    return new Promise((resolve) => {
      if (!this.ffmpegPath) return resolve(null);
      const font = this.workDir ? 'fontfile=font.otf:' : '';
      const vf = `drawtext=${font}text='Waiting for the phone camera':fontcolor=white@0.85:fontsize=44:x=(w-tw)/2:y=(h-th)/2-30,` +
        `drawtext=${font}text='Open the camera page on the phone (Settings → Camera)':fontcolor=white@0.55:fontsize=26:x=(w-tw)/2:y=(h-th)/2+40`;
      const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x15181d:s=1280x720', '-vf', vf, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '4', '-f', 'mjpeg', 'pipe:1'];
      execFile(this.ffmpegPath, args, { cwd: this.workDir || undefined, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 15000 }, (err, out) => {
        if (!err && isJpeg(out)) return resolve(out);
        // No font? A plain dark picture.
        execFile(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x15181d:s=1280x720', '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', 'pipe:1'],
          { encoding: 'buffer', windowsHide: true, timeout: 15000 }, (e2, o2) => resolve(!e2 && isJpeg(o2) ? o2 : null));
      });
    });
  }

  // A picture from phone camera n.
  frame(n, buf) {
    const c = this.cams[n];
    if (!c) throw new Error('Unknown camera');
    if (!isJpeg(buf)) throw new Error('Not a picture');
    const size = jpegSize(buf);
    if (!size || size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`Pictures must be ${WIDTH}×${HEIGHT}`);
    c.frame = buf;
    c.at = Date.now();
    c.seen++;
    this.status(n);
  }

  connected(n) { const c = this.cams[n]; return !!(c && c.frame && Date.now() - c.at < STALE_MS); }

  status(n) {
    const now = this.connected(n);
    const c = this.cams[n];
    if (c.was !== now) { c.was = now; this.emit('change', { cam: n, connected: now }); }
    return now;
  }

  current(n) {
    const c = this.cams[n];
    return this.connected(n) ? c.frame : this.waiting || c.frame;
  }

  // The stream FFmpeg connected: send pictures on a steady schedule. FFmpeg times them by
  // arrival, so pictures can be skipped when it is busy, without delaying the stream.
  feed(n, s) {
    const c = this.cams[n];
    c.out?.destroy();
    c.out = s;
    s.setNoDelay(true);
    s.on('error', () => {});
    const t0 = Date.now();
    let sent = 0;
    const timer = setInterval(() => {
      if (s.destroyed) { clearInterval(timer); return; }
      const due = Math.floor(((Date.now() - t0) * this.fps) / 1000);
      const pic = this.current(n);
      if (!pic || s.writableLength > 0) { sent = due; return; } // FFmpeg is still busy with the last one: skip
      if (sent < due) { s.write(pic); sent = due; }
    }, 10);
    s.on('close', () => { clearInterval(timer); if (c.out === s) c.out = null; });
  }

  close() {
    clearInterval(this.watch);
    for (const n of [1, 2]) { this.cams[n].out?.destroy(); this.cams[n].srv?.close(); }
  }
}

// The secret part of the phone camera address, so only someone shown the QR code can send pictures.
const newToken = () => crypto.randomBytes(12).toString('base64url');

module.exports = { PhoneCams, newToken, isJpeg, jpegSize, STALE_MS, WIDTH, HEIGHT };

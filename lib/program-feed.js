'use strict';
// The live stream picture for browsers: the stream FFmpeg sends its finished picture (camera,
// slides, names, ticker — exactly what viewers see) as JPEG pictures over a local connection,
// about 15 a second. Browsers get it as /stream.mjpeg (a "motion JPEG" that an <img> plays):
// the stream page on another laptop, and the projector when "Stream on screens" is on.
const net = require('net');

const BOUNDARY = 'churchstreamframe';

class ProgramFeed {
  constructor() {
    this.clients = new Set();
    this.latest = null;
    this.latestAt = 0;
    this.buf = Buffer.alloc(0);
    this.ready = new Promise((resolve, reject) => {
      this.srv = net.createServer((s) => this.read(s));
      this.srv.once('error', reject);
      this.srv.listen(0, '127.0.0.1', () => resolve(this));
    });
  }

  get port() { return this.srv.address() ? this.srv.address().port : null; }

  // FFmpeg's output: JPEG pictures one after another. A JPEG ends with FF D9, which can't
  // appear inside the picture data, so that's where each picture is cut.
  read(s) {
    this.buf = Buffer.alloc(0);
    s.on('error', () => {});
    s.on('data', (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      let start = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      while (start >= 0) {
        const end = this.buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) break;
        this.push(this.buf.subarray(start, end + 2));
        this.buf = this.buf.subarray(end + 2);
        start = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      }
      if (start < 0) this.buf = Buffer.alloc(0);
      else if (start > 0) this.buf = this.buf.subarray(start);
      if (this.buf.length > 8 * 1024 * 1024) this.buf = Buffer.alloc(0); // not JPEG after all
    });
  }

  push(jpeg) {
    this.latest = Buffer.from(jpeg);
    this.latestAt = Date.now();
    for (const res of this.clients) this.send(res, this.latest);
  }

  send(res, jpeg) {
    if (res.writableLength > 2 * 1024 * 1024) return; // a slow connection: skip pictures, don't fall behind
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
    res.write(jpeg);
    res.write('\r\n');
  }

  live() { return !!this.latest && Date.now() - this.latestAt < 3000; }

  // GET /stream.mjpeg
  serve(req, res) {
    res.writeHead(200, { 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, 'Cache-Control': 'no-store, no-cache', Pragma: 'no-cache', Connection: 'close', 'X-Accel-Buffering': 'no' });
    this.clients.add(res);
    if (this.live()) this.send(res, this.latest);
    const off = () => this.clients.delete(res);
    req.on('close', off);
    res.on('error', off);
  }

  close() {
    for (const res of this.clients) { try { res.end(); } catch { /* gone */ } }
    this.clients.clear();
    this.srv.close();
  }
}

module.exports = { ProgramFeed, BOUNDARY };

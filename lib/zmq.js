'use strict';
// A tiny ZeroMQ client (ZMTP 3.0, NULL security, DEALER socket) — just enough to send commands
// to FFmpeg's `zmq` filter, which applies every waiting command on each frame. FFmpeg's own
// command line reads one command per 0.1–0.5 s, far too slow for fades and scene changes.
// No dependencies: the protocol is a 64-byte greeting, a READY command, then length-prefixed frames.
const net = require('net');
const { EventEmitter } = require('events');

function greeting() {
  const g = Buffer.alloc(64);
  g[0] = 0xff; g[9] = 0x7f;      // signature
  g[10] = 3; g[11] = 0;          // ZMTP 3.0
  g.write('NULL', 12, 'ascii');  // security mechanism (20 bytes, zero padded)
  g[32] = 0;                     // as-server: no
  return g;
}

function frame(body, { more = false, command = false } = {}) {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const flags = (more ? 1 : 0) | (command ? 4 : 0);
  if (b.length < 256) return Buffer.concat([Buffer.from([flags, b.length]), b]);
  const h = Buffer.alloc(9);
  h[0] = flags | 2;
  h.writeBigUInt64BE(BigInt(b.length), 1);
  return Buffer.concat([h, b]);
}

function readyCommand(socketType) {
  const name = Buffer.from('READY');
  const key = Buffer.from('Socket-Type');
  const val = Buffer.from(socketType);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(val.length);
  return frame(Buffer.concat([Buffer.from([name.length]), name, Buffer.from([key.length]), key, len, val]), { command: true });
}

// Parses frames from a stream of bytes; calls onFrame(flags, body).
function frameReader(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const flags = buf[0];
      let size;
      let head;
      if (flags & 2) { if (buf.length < 9) return; size = Number(buf.readBigUInt64BE(1)); head = 9; } else { size = buf[1]; head = 2; }
      if (buf.length < head + size) return;
      onFrame(flags, buf.subarray(head, head + size));
      buf = buf.subarray(head + size);
    }
  };
}

class ZmqCommander extends EventEmitter {
  constructor(port, host = '127.0.0.1') {
    super();
    this.port = port;
    this.host = host;
    this.sock = null;
    this.ready = false;
    this.queue = [];
    this.closed = false;
    this.pending = 0;
  }

  // Connect (and keep trying while FFmpeg starts up and opens its port).
  connect() {
    if (this.closed || this.sock) return;
    const s = net.connect(this.port, this.host);
    this.sock = s;
    let greeted = false;
    let gbuf = Buffer.alloc(0);
    let reply = [];
    const read = frameReader((flags, body) => {
      if (flags & 4) { // a command: the peer's READY
        if (!this.ready && body.subarray(1, 1 + body[0]).toString() === 'READY') {
          this.ready = true;
          this.emit('ready');
          this.flush();
        }
        return;
      }
      reply.push(body.toString('utf8'));
      if (!(flags & 1)) { // last frame of a reply: [empty delimiter, "0 Success"]
        const text = reply.filter(Boolean).join(' ');
        reply = [];
        this.pending = Math.max(0, this.pending - 1);
        if (!/^0\b/.test(text)) this.emit('error-reply', text);
      }
    });
    s.setNoDelay(true);
    s.on('connect', () => { s.write(greeting()); });
    s.on('data', (d) => {
      if (!greeted) {
        gbuf = Buffer.concat([gbuf, d]);
        if (gbuf.length < 64) return;
        greeted = true;
        s.write(readyCommand('DEALER'));
        d = gbuf.subarray(64);
        if (!d.length) return;
      }
      read(d);
    });
    const retry = () => {
      if (this.sock !== s) return;
      this.sock = null;
      this.ready = false;
      if (!this.closed) this.retryTimer = setTimeout(() => this.connect(), 150);
    };
    s.on('error', () => {});
    s.on('close', retry);
  }

  // Send commands ("target command arg"). Everything sent before FFmpeg's next frame is
  // applied together on that frame.
  send(lines) {
    for (const l of [].concat(lines)) this.queue.push(l);
    this.flush();
  }

  flush() {
    if (!this.ready || !this.sock || !this.queue.length) return;
    const out = [];
    for (const l of this.queue) { out.push(frame(Buffer.alloc(0), { more: true }), frame(l)); this.pending++; }
    this.queue = [];
    this.sock.write(Buffer.concat(out));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    if (this.sock) { this.sock.destroy(); this.sock = null; }
    this.ready = false;
  }
}

// The filter text that opens FFmpeg's command port (':' must be escaped inside filter options).
const zmqFilter = (port) => `zmq=bind_address=tcp\\\\://127.0.0.1\\\\:${port}`;

// A free local port for FFmpeg to listen on.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

module.exports = { ZmqCommander, zmqFilter, freePort, frame, greeting };

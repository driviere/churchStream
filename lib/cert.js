'use strict';
// A self-signed certificate for the phone camera page. Phones only allow a web page to use the
// camera over https, so ChurchStream runs a small https server for that page. No dependencies:
// the X.509 certificate is written here in DER (ECDSA P-256, signed with SHA-256), valid for
// this computer's network addresses. The phone shows a one-time "not private" warning, because
// no public authority signed it; after the user taps through, the camera works.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- a tiny DER writer ---
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
function oid(str) {
  const p = str.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const b = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) b.unshift(0x80 | (v & 0x7f));
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}
function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = (b) => tlv(0x04, b);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const explicit = (n, body) => tlv(0xa0 + n, body);
function time(d) {
  const p = (x) => String(x).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii')); // UTCTime (fine until 2049)
}
function ipBytes(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return Buffer.from(ip.split('.').map(Number));
  return null; // IPv6 addresses aren't needed for phones on the church Wi-Fi
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

// → { key, cert } in PEM. names: host names, ips: IPv4 addresses.
function makeCertificate({ ips = [], names = ['localhost'], days = 365, now = new Date() } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const name = seq(set(seq(oid('2.5.4.3'), utf8('ChurchStream'))), set(seq(oid('2.5.4.10'), utf8('ChurchStream'))));
  const from = new Date(now.getTime() - 24 * 3600 * 1000); // a day back: phone clocks differ
  const to = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const san = seq(...names.map((n) => tlv(0x82, Buffer.from(n, 'ascii'))), ...ips.map(ipBytes).filter(Boolean).map((b) => tlv(0x87, b)));
  const exts = seq(
    seq(oid('2.5.29.19'), bool(true), octets(seq())),                           // basicConstraints: not a CA
    seq(oid('2.5.29.15'), bool(true), octets(tlv(0x03, Buffer.from([0x07, 0x80])))), // keyUsage: digitalSignature
    seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))),               // extKeyUsage: serverAuth
    seq(oid('2.5.29.17'), octets(san)),                                          // subjectAltName
  );
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(explicit(0, int(Buffer.from([2]))), int(serial), ECDSA_SHA256, name, seq(time(from), time(to)), name, spki, explicit(3, exts));
  const sig = crypto.sign('sha256', tbs, privateKey); // DER-encoded ECDSA signature
  const der = seq(tbs, ECDSA_SHA256, bits(sig));
  const pem = (label, b) => `-----BEGIN ${label}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', der) };
}

// The certificate for this computer, kept in <dataDir>/https and made again when the network
// addresses change or it is about to expire.
function loadCertificate(dir, ips) {
  const want = [...new Set(ips)].sort();
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  try {
    const key = fs.readFileSync(keyFile, 'utf8');
    const cert = fs.readFileSync(certFile, 'utf8');
    const x = new crypto.X509Certificate(cert);
    const has = (x.subjectAltName || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('IP Address:')).map((s) => s.slice(11));
    const fresh = new Date(x.validTo).getTime() - Date.now() > 30 * 24 * 3600 * 1000;
    if (fresh && want.every((ip) => has.includes(ip))) return { key, cert };
  } catch { /* none yet, or unreadable: make one */ }
  const made = makeCertificate({ ips: ['127.0.0.1', ...want] });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 });
  fs.writeFileSync(certFile, made.cert);
  return made;
}

module.exports = { makeCertificate, loadCertificate };

'use strict';
// Updates. ChurchStream checks GitHub for a newer release (at start and every few hours) and,
// when there is one, tells everyone looking at the control panel or stream page. Nothing is
// downloaded until someone clicks Update; never while live or recording.
//
// It downloads only what changed (see update.json, written by scripts/make-update-json.js):
//   - the app pack: ChurchStream's own code, web pages and default data (~3 MB), unpacked to
//     <data>/app/<version>/ and used from the next start (scripts/launcher.cjs, lib/packs.js);
//   - FFmpeg, only when its id changed, to <data>/ffmpeg/<id>/ (lib/ffmpeg.js prefers it);
//   - when the update needs a newer program (Node runtime), it says so and links to the full
//     download instead.
// Every file is checked against the SHA-256 in update.json before it is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { readZip } = require('./unzip');
const { cmpVersion, runtimeMajor } = require('./packs');

const REPO = 'driviere/churchStream';
const API = process.env.CHURCHSTREAM_UPDATE_URL || 'https://api.github.com'; // tests point this at a local server
const CHECK_EVERY = 6 * 3600 * 1000;
const FIRST_CHECK = Number(process.env.CHURCHSTREAM_UPDATE_DELAY_MS) || 30000;

// Which FFmpeg download fits this computer.
function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return 'win-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return null;
}

// Short "what's new" from the release notes: the lines under "New in …", without the
// download table.
function notesSummary(body, max = 700) {
  const text = String(body || '').replace(/\r/g, '');
  const at = text.search(/^##\s+New in/m);
  let part = at >= 0 ? text.slice(at).split('\n').slice(1).join('\n') : text;
  part = part.split(/^##\s/m)[0].trim();
  if (part.length > max) part = part.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return part;
}

// A zip entry name that stays inside the folder it is unpacked into.
function safeEntry(name) {
  const n = String(name).replace(/\\/g, '/');
  return !!n && !n.startsWith('/') && !/^[a-zA-Z]:/.test(n) && !n.split('/').includes('..');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

class Updater extends EventEmitter {
  constructor({ version, dataDir, runtime = process.versions.node, platform = platformKey(), ffmpegId = () => null, isBusy = () => false, enabled = () => true, fetchImpl = globalThis.fetch }) {
    super();
    this.version = version;
    this.appsDir = path.join(dataDir, 'app');
    this.ffmpegDir = path.join(dataDir, 'ffmpeg');
    this.runtime = runtime;
    this.platform = platform;
    this.ffmpegId = ffmpegId;
    this.isBusy = isBusy;
    this.enabled = enabled;
    this.fetch = fetchImpl;
    this.info = null; // the newer release's update.json (+ notes)
    this.state = { current: version, checking: false, available: null, checkedAt: null, error: '', progress: null, ready: null, failed: process.env.CHURCHSTREAM_UPDATE_FAILED || null };
    this.timer = null;
    this.abort = null;
  }

  start() {
    this.timer = setTimeout(() => this.loop(), FIRST_CHECK);
    this.timer.unref?.();
  }

  loop() {
    if (this.enabled()) this.check().catch(() => {});
    this.timer = setTimeout(() => this.loop(), CHECK_EVERY);
    this.timer.unref?.();
  }

  stop() { clearTimeout(this.timer); if (this.abort) this.abort.abort(); }

  set(patch) { Object.assign(this.state, patch); this.emit('change', this.status()); }

  status() { return { ...this.state }; }

  async getJson(url) {
    const res = await this.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ChurchStream-updater' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  }

  // Look for a newer release. Quiet when offline.
  async check() {
    if (this.state.checking) return this.status();
    this.set({ checking: true, error: '' });
    try {
      const rel = await this.getJson(`${API}/repos/${REPO}/releases/latest`);
      const asset = (rel.assets || []).find((a) => a.name === 'update.json');
      if (!asset) { this.set({ checking: false, checkedAt: Date.now() }); return this.status(); } // a release from before updates existed
      const info = await this.getJson(asset.browser_download_url);
      if (!info || !info.version || !info.pack) throw new Error('The update information is incomplete');
      info.assets = Object.fromEntries((rel.assets || []).map((a) => [a.name, { url: a.browser_download_url, size: a.size }]));
      info.notes = notesSummary(rel.body);
      info.notesUrl = info.notesUrl || rel.html_url;
      const newer = cmpVersion(info.version, this.version) > 0;
      // Already downloaded and waiting for a restart?
      const ready = newer && this.readyVersion() === info.version ? info.version : null;
      this.info = newer ? info : null;
      this.set({ checking: false, checkedAt: Date.now(), available: newer ? this.describe(info) : null, ready });
    } catch (err) {
      this.set({ checking: false, checkedAt: Date.now(), error: navigatorMessage(err) });
    }
    return this.status();
  }

  // What this update means for this computer.
  describe(info) {
    const needsRuntime = runtimeMajor(this.runtime) < (Number(info.minRuntime) || 0);
    const ff = this.platform && info.ffmpeg && info.ffmpeg[this.platform];
    const haveFf = this.ffmpegId();
    const needsFf = !!(ff && haveFf && ff.id !== haveFf); // only when this computer uses ChurchStream's FFmpeg
    const size = needsRuntime ? null : (info.pack.size || 0) + (needsFf ? ff.size || 0 : 0);
    return { version: info.version, notes: info.notes || '', notesUrl: info.notesUrl || '', needs: needsRuntime ? 'full' : needsFf ? 'pack+ffmpeg' : 'pack', size,
      fullUrl: info.fullUrl || info.notesUrl || '' };
  }

  readyVersion() {
    try { const cur = JSON.parse(fs.readFileSync(path.join(this.appsDir, 'current.json'), 'utf8')); return cur.bad ? null : cur.version; } catch { return null; }
  }

  async download(name, expect) {
    const a = this.info.assets[name];
    if (!a) throw new Error(`${name} is missing from the release`);
    this.abort = new AbortController();
    const res = await this.fetch(a.url, { headers: { 'User-Agent': 'ChurchStream-updater' }, redirect: 'follow', signal: this.abort.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const chunks = [];
    let got = 0;
    for await (const c of res.body) {
      chunks.push(Buffer.from(c));
      got += c.length;
      this.progress.done += c.length;
      if (this.isBusy()) { this.abort.abort(); throw new Error('Stopped because the stream started. Update again after the service.'); }
      this.emitProgress();
    }
    const buf = Buffer.concat(chunks, got);
    if (expect.size && buf.length !== expect.size) throw new Error(`${name} is incomplete`);
    if (sha256(buf) !== String(expect.sha256 || '').toLowerCase()) throw new Error(`${name} did not match its checksum; nothing was changed`);
    return buf;
  }

  emitProgress() {
    const now = Date.now();
    if (now - (this.lastProgress || 0) < 250) return;
    this.lastProgress = now;
    this.set({ progress: { ...this.progress } });
  }

  // Unpack a checked zip into dir (via dir.tmp, so a half-finished one is never used).
  unpack(buf, dir, mode) {
    const tmp = dir + '.tmp';
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const e of readZip(buf)) {
      if (e.name.endsWith('/')) continue;
      if (!safeEntry(e.name)) throw new Error('The download contains an unexpected file name; nothing was changed');
      const out = path.join(tmp, e.name);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.read(), mode ? { mode } : undefined);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  }

  // Download and install the update (asked for by a click). Used from the next start.
  async install() {
    const info = this.info;
    if (!info) throw new Error('There is no update to install');
    if (this.isBusy()) throw new Error('Update after the service: the stream or recording is running.');
    if (this.state.progress) throw new Error('The update is already downloading');
    const d = this.describe(info);
    if (d.needs === 'full') throw new Error('This update needs the full download');
    this.progress = { done: 0, total: d.size || 0 };
    this.set({ progress: { ...this.progress }, error: '' });
    try {
      if (d.needs === 'pack+ffmpeg') {
        const ff = info.ffmpeg[this.platform];
        const buf = await this.download(ff.file, ff);
        fs.mkdirSync(this.ffmpegDir, { recursive: true });
        const safeId = String(ff.id).replace(/[^\w.-]/g, '_');
        this.unpack(buf, path.join(this.ffmpegDir, safeId), 0o755);
        fs.writeFileSync(path.join(this.ffmpegDir, 'current.json'), JSON.stringify({ id: ff.id, dir: safeId }));
      }
      const buf = await this.download(info.pack.file, info.pack);
      fs.mkdirSync(this.appsDir, { recursive: true });
      const dirName = String(info.version).replace(/[^\w.-]/g, '_');
      const dir = path.join(this.appsDir, dirName);
      this.unpack(buf, dir);
      const pack = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
      const code = fs.readFileSync(path.join(dir, 'churchstream.cjs'));
      fs.writeFileSync(path.join(this.appsDir, 'current.json'), JSON.stringify({ version: info.version, dir: dirName, sha256: sha256(code), minRuntime: pack.minRuntime || 0 }, null, 2));
      this.cleanup(dirName);
      this.progress = null;
      this.set({ progress: null, ready: info.version });
    } catch (err) {
      this.progress = null;
      this.set({ progress: null, error: navigatorMessage(err) });
      throw err;
    } finally {
      this.abort = null;
    }
    return this.status();
  }

  // Keep the newest pack and the one before it.
  cleanup(keep) {
    let dirs = [];
    try { dirs = fs.readdirSync(this.appsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return; }
    const old = dirs.filter((n) => n !== keep && !n.endsWith('.tmp')).sort(cmpVersion).reverse().slice(1);
    for (const n of [...old, ...dirs.filter((n) => n.endsWith('.tmp'))]) fs.rmSync(path.join(this.appsDir, n), { recursive: true, force: true });
  }
}

function navigatorMessage(err) {
  const m = String((err && err.message) || err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(m)) return 'No internet connection to check for updates.';
  return m;
}

// The FFmpeg the updater installed (lib/ffmpeg.js looks here first), if any.
function updatedFfmpeg(ffmpegDir, exeName) {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(ffmpegDir, 'current.json'), 'utf8'));
    const p = path.join(ffmpegDir, path.basename(cur.dir), exeName);
    return fs.existsSync(p) ? { path: p, id: cur.id } : null;
  } catch { return null; }
}

module.exports = { Updater, platformKey, notesSummary, safeEntry, updatedFfmpeg };

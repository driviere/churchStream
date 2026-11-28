#!/usr/bin/env node
'use strict';
// ChurchStream — streaming + projection for small churches.
// One small Node process (no dependencies) + one FFmpeg process.
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Keep the console window calm for volunteers: hide Node's "experimental feature" notices.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' || /experimental/i.test(String(warning))) return;
  return emitWarning.call(process, warning, ...rest);
};

const paths = require('./lib/paths');
const office = require('./lib/office');
const assets = require('./lib/assets');
const { App } = require('./lib/app');
const { loadCertificate } = require('./lib/cert');
const { bootOk } = require('./lib/packs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const PAGES = { '/control': 'control.html', '/setup': 'control.html', '/settings': 'control.html', '/display': 'display.html', '/stage': 'stage.html', '/remote': 'remote.html', '/manual': 'manual.html', '/stream': 'control.html' };
// Pages the projector / stage screens need; everything else requires the password (if one is set).
const OPEN = [/^\/(display|stage|manual)$/, /^\/stream\.mjpeg$/, /^\/manual\.md$/, /^\/api\/display\/youtube$/, /^\/events$/, /^\/(fonts|vendor|media|backgrounds)\//, /^\/(display|stage|shared)\.(js|css)$/, /^\/(favicon|logo)/];

const app = new App();
const clients = new Set();

// Addresses other devices on the church network can use, best first: real Wi-Fi/Ethernet
// before virtual adapters (Hyper-V, VirtualBox, VPNs) and "no network" 169.254.x addresses.
function lanInfo(port) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      let score = 0;
      if (/^169\.254\./.test(a.address)) score -= 100;
      if (/vethernet|virtual|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier|vpn|tun|tap|loopback|bluetooth/i.test(name)) score -= 50;
      if (/wi-?fi|wlan|wireless|ethernet|^en|^eth|^wl/i.test(name)) score += 10;
      if (/^(192\.168|10)\./.test(a.address)) score += 5;
      out.push({ url: `http://${a.address}:${port}`, ip: a.address, name, score });
    }
  }
  return out.sort((x, y) => y.score - x.score).map(({ score, ...r }) => r);
}
const lanAddresses = (port) => lanInfo(port).map((x) => x.url);

function send(res, status, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('This file is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function json(req) {
  const b = await readBody(req, 2 * 1024 * 1024);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

function authorized(req) {
  const pw = app.cfg.controlPassword;
  if (!pw) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [, pass] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(/:(.*)/s);
  return pass === pw;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  // Sound levels go only to pages that show them (not to every phone on the Wi-Fi).
  const meters = event === 'meter' || event === 'levels';
  for (const res of clients) if (!meters || res.wantsMeters) res.write(msg);
}
app.on('state', (s) => broadcast('state', s));
app.on('meter', (v) => broadcast('meter', v));
app.on('levels', (v) => broadcast('levels', v));

function serveFile(res, file, type, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const ctype = type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Byte ranges let the projector seek in videos (to stay in step with the stream).
    const range = req && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10);
      let end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache' });
      // pipeline closes the file when the browser stops reading (the projector seeking, a
      // closed page), so files aren't left open (on Windows that would stop deleting them).
      return require('stream').pipeline(fs.createReadStream(file, { start, end }), res, () => {});
    }
    res.writeHead(200, { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    require('stream').pipeline(fs.createReadStream(file), res, () => {});
  });
}

function serveAsset(res, key) {
  const buf = assets.getAsset(key);
  if (!buf) return send(res, 404, 'Not found', 'text/plain');
  const cache = /\/(fonts|vendor)\//.test(key) ? 'public, max-age=604800' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[path.extname(key).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
  res.end(buf);
}

const routes = {
  'GET /api/state': () => ({ ...app.snapshot(), lan: lanAddresses(server.address().port), lanInfo: lanInfo(server.address().port) }),
  'GET /api/search': (req, url) => app.search(url.searchParams.get('q') || ''),
  'GET /api/songs': (req, url) => app.songs.search(url.searchParams.get('q') || '', { limit: 2000, defaultHymnal: app.cfg.hymnal.default }),
  'GET /api/song': (req, url) => { const sg = app.songs.get(url.searchParams.get('id')); return sg ? { ...sg, slides: app.fit(sg.slides, 'song').slides } : { error: 'Song not found' }; },
  'POST /api/song': async (req) => {
    const body = await json(req);
    const existing = body.id && app.songs.get(body.id);
    if (existing && existing.hymnal) body.edited = true; // protect hand-edited hymns from re-imports
    const s = app.songs.save(body);
    app.changed();
    return s;
  },
  'POST /api/song/delete': async (req) => { const { id } = await json(req); app.songs.remove(id); app.changed(); return { ok: true }; },
  'GET /api/bible': (req, url) => { const r = app.bible.lookup(url.searchParams.get('ref') || '', url.searchParams.get('t') || app.cfg.bible.translation, app.bibleOpts()); return r.slides ? { ...r, slides: app.fit(r.slides, 'bible').slides } : r; },
  'POST /api/live': async (req) => { const { item, index } = await json(req); const live = app.showItem(item, index || 0); return { ok: true, item: live.item, index: live.index }; },
  'POST /api/goto': async (req) => { const b = await json(req); if (b.delta) app.step(b.delta); else app.goTo(b.index | 0); return { ok: true }; },
  'POST /api/toggle': async (req) => { const { name, value } = await json(req); app.setToggle(name, value); return { ok: true }; },
  'POST /api/lower-third': async (req) => { app.setLowerThird(await json(req)); return { ok: true }; },
  'POST /api/ticker': async (req) => { app.setTicker(await json(req)); return { ok: true }; },
  'POST /api/upload': (req, url) => app.saveUpload(req, url.searchParams.get('name') || ''),
  'GET /api/clips': () => app.mediaLibrary(),
  'POST /api/clips/delete': async (req) => app.deleteClip((await json(req)).id),
  'POST /api/media/control': async (req) => { app.mediaControl(await json(req)); return { ok: true }; },
  'POST /api/music': async (req) => { app.musicControl(await json(req)); return { ok: true }; },
  'GET /api/youtube': (req, url) => app.youtubeInfo(url.searchParams.get('url') || ''),
  'POST /api/youtube/download': async (req) => app.downloadYouTube(await json(req)),
  'POST /api/youtube/cancel': () => { app.cancelDownload(); return { ok: true }; },
  'POST /api/display/youtube': async (req) => { app.youtubeReport(await json(req)); return { ok: true }; },
  'GET /api/templates': () => app.listTemplates(),
  'GET /api/services': () => app.listServices().map(({ items, ...e }) => ({ ...e, count: items.length, titles: items.slice(0, 6).map((x) => x.title) })),
  'GET /api/service/info': () => app.exportInfo(),
  'POST /api/services/save': async (req) => { app.archivePlan((await json(req)).name); return app.listServices().length; },
  'POST /api/services/open': async (req) => app.openService((await json(req)).id),
  'POST /api/services/delete': async (req) => { app.deleteService((await json(req)).id); return { ok: true }; },
  'POST /api/plan/undo': () => app.undoPlan(),
  'POST /api/service/new': async (req) => app.newService(await json(req)),
  'POST /api/service/import': async (req) => app.importService(await readBody(req, 1024 * 1024 * 1024)),
  'POST /api/templates': async (req) => { const { name, items } = await json(req); return app.saveTemplate(name, items || app.state.plan.items); },
  'POST /api/templates/delete': async (req) => app.deleteTemplate((await json(req)).name),
  'POST /api/plan': async (req) => { app.setPlan((await json(req)).items); return { ok: true, uids: app.state.plan.items.map((x) => x.uid) }; },
  'POST /api/plan/open': async (req) => {
    const { uid, index } = await json(req);
    const it = app.state.plan.items.find((x) => x.uid === uid);
    const r = it && app.resolvePlanItem(it);
    if (!r) throw new Error('That item could not be found.');
    return r;
  },
  'POST /api/stream/start': async (req) => { const { mode, startScreen } = await json(req); await app.startStream(mode === 'live' ? 'live' : 'preview', { startScreen: !!startScreen }); return { ok: true }; },
  'POST /api/stream/stop': async (req) => { const b = await json(req).catch(() => ({})); return app.stopStream({ endScreen: !!b.endScreen, now: !!b.now }); },
  'POST /api/stream/begin': async () => { app.skipStartScreen(); return { ok: true }; },
  'POST /api/camera': async (req) => app.setCamera((await json(req)).camera),
  'POST /api/config': async (req) => { app.updateConfig(await json(req)); return { ok: true }; },
  'GET /api/devices': () => app.devices(),
  'GET /api/logs': () => app.logs.slice(-80),
  // Updates (lib/updater.js): shown by themselves; downloaded only when asked.
  'GET /api/update': () => app.snapshot().update,
  'POST /api/update/check': () => app.updateCheck(),
  'POST /api/update/install': () => app.updateInstall(),
  'POST /api/update/later': () => { app.updateLater(); return { ok: true }; },
  'POST /api/update/restart': () => restart(),
  'POST /api/projector/open': async () => {
    const m = app.cfg.projector;
    const browser = app.projector.launch(`http://127.0.0.1:${server.address().port}/display`, m.x != null ? { x: m.x, y: m.y } : null);
    app.state.projectorOpen = true;
    app.changed();
    return { ok: true, browser };
  },
  'POST /api/projector/close': async () => { app.projector.close(); app.state.projectorOpen = false; app.changed(); return { ok: true }; },
  'POST /api/projector/identify': async () => { app.identifyProjector(); return { ok: true }; },
  'POST /api/import/hymnal': async (req) => { app.importHymnal((await json(req)).id); return { ok: true }; },
  'POST /api/import/bible': async (req) => { app.importBible((await json(req)).id); return { ok: true }; },
  'POST /api/import/bible-file': async (req, url) => (url.searchParams.get('check') === '1' ? app.checkBibleFile(await readBody(req, 40 * 1024 * 1024)) : app.importBibleFile(await readBody(req, 40 * 1024 * 1024), {
    name: url.searchParams.get('name'), abbrev: url.searchParams.get('abbrev'), licensed: url.searchParams.get('licensed') === '1' })),
  'POST /api/import/songs': async (req, url) => (url.searchParams.get('check') === '1'
    ? app.checkSongFile(url.searchParams.get('name') || '', await readBody(req, 20 * 1024 * 1024))
    : app.importSongFile(url.searchParams.get('name') || '', await readBody(req, 20 * 1024 * 1024), { book: url.searchParams.get('book') || '' })),
  'POST /api/media/settings': async (req) => { const b = await json(req); return app.mediaSettings(b.key, b.patch || {}); },
  'POST /api/bible/remove': async (req) => app.removeBible((await json(req)).id),
  'POST /api/media': async (req, url) => {
    const name = app.saveMedia(url.searchParams.get('kind'), await readBody(req), (req.headers['content-type'] || '').split(';')[0], url.searchParams.get('name') || '');
    return { ok: true, name };
  },
  'POST /api/media/remove': async (req) => { const { kind } = await json(req); app.updateConfig({ theme: { [kind]: '' } }); return { ok: true }; },
  'GET /api/backgrounds': () => app.backgrounds(),
  'POST /api/program-image': async (req, url) => ({ ok: true, updated: app.saveProgramImage(await readBody(req, 4 * 1024 * 1024), url.searchParams.get('key') || '', url.searchParams.get('at')) }),
  'POST /api/backgrounds/delete': async (req) => { app.deleteBackground((await json(req)).id); return { ok: true }; },
  // The phone camera addresses (for the QR codes), behind the password.
  'GET /api/phone-camera/info': () => phoneInfo(),
  // The studio on the stream page: scenes, Preview → Program, transitions.
  'GET /api/studio': () => app.studioInfo(),
  'POST /api/studio/preview': async (req) => app.studioPreview((await json(req)).id),
  'POST /api/studio/take': async (req) => { const b = await json(req); return app.studioTake(b.type, b.ms); },
  'POST /api/studio/show': async (req) => { const b = await json(req); return app.studioShow(b.id, b.type, b.ms); },
  'POST /api/studio/tbar': async (req) => app.studioTbar((await json(req)).pos),
  'POST /api/studio/scene': async (req) => app.saveScene((await json(req)).scene),
  'POST /api/studio/scene/delete': async (req) => app.deleteScene((await json(req)).id),
  'POST /api/studio/audio': async (req) => { const b = await json(req); return app.setAudioMix(b.id, b); },
  // Graphics: the picture for channel n (a PNG drawn by the stream page), on/off, the pictures.
  'POST /api/studio/gfx': async (req, url) => app.saveGfx(url.searchParams.get('n'), await readBody(req, 8 * 1024 * 1024), url.searchParams.get('label') || ''),
  'POST /api/studio/gfx/show': async (req) => { const b = await json(req); return app.showGfx(b.n, b.on); },
  'POST /api/studio/graphic': async (req) => { const b = await json(req); return app.graphicUpdate(b.id, b); },
  'POST /api/studio/graphic/delete': async (req) => app.graphicDelete((await json(req)).id),
  'POST /api/phone-camera/renew': () => { app.renewPhoneToken(); return phoneInfo(); },
};

// --- Phone camera page, on https (phones only allow the camera on secure pages) ---
let httpsServer = null;
let httpsError = '';
function phoneInfo() {
  const port = httpsServer && httpsServer.listening ? httpsServer.address().port : null;
  const ips = lanInfo(0).map((x) => x.ip);
  const link = (ip, cam) => `https://${ip}:${port}/phone-camera?cam=${cam}&k=${app.cfg.phoneToken}`;
  return { port, error: port ? '' : httpsError || 'The phone camera page isn’t running.', ips, cam1: ips.map((ip) => link(ip, 1)), cam2: ips.map((ip) => link(ip, 2)), cam3: ips.map((ip) => link(ip, 3)), cam4: ips.map((ip) => link(ip, 4)) };
}

async function phoneRequest(req, res) {
  const url = new URL(req.url, 'https://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/phone-camera' || p === '/phone-camera/')) return serveAsset(res, 'public/phonecam.html');
    if (req.method === 'GET' && /^\/(phonecam\.js|favicon\.svg)$/.test(p)) return serveAsset(res, 'public' + p);
    if (req.method === 'POST' && p === '/api/phone-camera/frame') {
      const body = await readBody(req, 3 * 1024 * 1024);
      return send(res, 200, app.phoneFrame(url.searchParams.get('cam'), url.searchParams.get('k'), body));
    }
    return send(res, 404, 'Not found', 'text/plain');
  } catch (err) {
    return send(res, err.status || 400, { error: err.message || String(err) });
  }
}

function startHttps(port, attempts = 10) {
  let cert;
  try {
    cert = loadCertificate(path.join(paths.dataDir, 'https'), lanInfo(0).map((x) => x.ip));
  } catch (err) {
    httpsError = 'Couldn’t make the certificate for the phone camera page: ' + err.message;
    console.error('  ' + httpsError);
    return;
  }
  httpsServer = https.createServer({ key: cert.key, cert: cert.cert }, phoneRequest);
  httpsServer.keepAliveTimeout = 30000;
  httpsServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) { httpsServer = null; return startHttps(port + 1, attempts - 1); }
    httpsError = 'The phone camera page couldn’t start: ' + err.message;
  });
  httpsServer.listen(port, '0.0.0.0');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad address');
  }

  if (!OPEN.some((re) => re.test(p)) && !authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ChurchStream"', 'Content-Type': 'text/plain' });
    return res.end('Password required');
  }

  try {
    if (p === '/') {
      res.writeHead(302, { Location: app.cfg.setupComplete ? '/control' : '/setup' });
      return res.end();
    }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(app.snapshot())}\n\n`);
      // Older pages didn't ask for meters and still expect them.
      res.wantsMeters = url.searchParams.get('meters') === '1' || !url.searchParams.has('v');
      clients.add(res);
      // A real event (not a comment) so pages can tell the connection is alive.
      const ping = setInterval(() => res.write('event: ping\ndata: 0\n\n'), 20000);
      // A stream page is open: the control panel hides its simple camera/scene switches.
      const streamPage = url.searchParams.get('page') === 'stream';
      if (streamPage) app.setStreamPages(app.streamPages + 1);
      req.on('close', () => { clearInterval(ping); clients.delete(res); if (streamPage) app.setStreamPages(app.streamPages - 1); });
      return;
    }
    if (req.method === 'POST' && p === '/api/convert/presentation') {
      // A PowerPoint file → PDF, made by PowerPoint (or Keynote/LibreOffice) on this computer.
      let r;
      try { r = await office.presentationToPdf(await readBody(req, 300 * 1024 * 1024), url.searchParams.get('name') || '', { tmpDir: paths.runDir }); } catch (err) { return send(res, 400, { error: err.message }); }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': r.pdf.length, 'Cache-Control': 'no-store', 'X-Converted-By': r.via });
      return res.end(r.pdf);
    }
    if (req.method === 'GET' && p === '/api/songs/export') {
      let out;
      try { out = app.exportSongs(url.searchParams.get('book') || 'own'); } catch (err) { return send(res, 400, { error: err.message }); }
      const file = out.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.churchsongs';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': out.buffer.length, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}` });
      return res.end(out.buffer);
    }
    if (req.method === 'GET' && p === '/api/service/export') {
      const { name, buffer } = app.exportService({ name: url.searchParams.get('name'), media: url.searchParams.get('media') !== '0' });
      const file = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Service') + '.churchservice';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buffer.length, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}` });
      return res.end(buffer);
    }
    const handler = routes[`${req.method} ${p}`];
    if (handler) return send(res, 200, (await handler(req, url)) ?? { ok: true });
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Unknown API' });
    // The live stream picture (open like the projector page: it's what viewers see anyway).
    if (p === '/stream.mjpeg') return app.feed.serve(req, res);
    if (p === '/studio/preview.mjpeg') return app.studioFeeds.preview.serve(req, res);
    if (p === '/studio/multiview.mjpeg') return app.studioFeeds.multiview.serve(req, res);
    if (p === '/preview.jpg') return serveFile(res, path.join(paths.runDir, 'preview.jpg'), 'image/jpeg');
    if (p.startsWith('/media/')) {
      const name = path.basename(p);
      return serveFile(res, path.join(paths.mediaDir, name), null, req);
    }
    if (PAGES[p]) return serveAsset(res, 'public/' + PAGES[p]);
    if (p === '/favicon.ico') return serveAsset(res, 'public/favicon.svg');
    return serveAsset(res, 'public' + p);
  } catch (err) {
    send(res, 400, { error: err.message || String(err) });
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* no browser */ }
}

function listen(port, attempts = 10) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) return listen(port + 1, attempts - 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    const p = server.address().port;
    const local = `http://localhost:${p}`;
    console.log('');
    console.log('  ChurchStream is running.');
    console.log(`  Control panel:   ${local}/control`);
    for (const a of lanAddresses(p)) console.log(`  From a tablet:   ${a}/control      Stage screen: ${a}/stage`);
    console.log(`  Projector page:  ${local}/display`);
    startHttps(app.cfg.httpsPort || 8443);
    console.log(app.ffmpeg ? `  FFmpeg:          ${app.ffmpeg.version}` : '  FFmpeg:          NOT FOUND - streaming is disabled until it is installed.');
    console.log('');
    console.log(paths.isSea ? '  Close this window to stop ChurchStream.' : '  Press Ctrl+C to stop.');
    console.log('');
    // Where to find the control panel (the Mac app opens it when its Dock icon is clicked).
    try { fs.writeFileSync(path.join(paths.runDir, 'url.txt'), `${local}/control`); fs.writeFileSync(path.join(paths.runDir, 'server.pid'), String(process.pid)); } catch { /* not needed */ }
    bootOk(paths.runDir); // this start worked (an updated app pack is kept: lib/packs.js)
    if (app.updater.state.failed) console.log(`  The update to ${app.updater.state.failed} could not start, so this computer stays on ${app.snapshot().version}.`);
    let restarted = false;
    try { restarted = fs.existsSync(path.join(paths.runDir, 'restarted')); fs.rmSync(path.join(paths.runDir, 'restarted'), { force: true }); } catch { /* fine */ }
    if (paths.isSea && !process.env.CHURCHSTREAM_NO_BROWSER && !restarted) openBrowser(`${local}${app.cfg.setupComplete ? '/control' : '/setup'}`);
    if (app.cfg.setupComplete && app.cfg.projector.autoLaunch) {
      try { app.projector.launch(`http://127.0.0.1:${p}/display`, app.cfg.projector.x != null ? app.cfg.projector : null); app.state.projectorOpen = true; } catch { /* manual */ }
    }
  });
}

// Restart ChurchStream (to use a downloaded update). The port is freed first so the new copy
// takes the same address and open pages reconnect by themselves.
function restart() {
  if (app.streamer.status.mode === 'live') throw new Error('Restart after the service: the stream or recording is running.');
  if (!paths.isSea) throw new Error('Restart ChurchStream by hand (it is not the installed program).');
  const port = server.address().port;
  const macApp = /\.app\/Contents\/Resources$/.test(paths.appRoot);
  setTimeout(() => {
    stopping = true;
    server.close();
    app.shutdown();
    setTimeout(() => {
      // The new copy doesn't open another browser tab: the open pages reconnect by themselves.
      try { fs.writeFileSync(path.join(paths.runDir, 'restarted'), String(Date.now())); } catch { /* a new tab then */ }
      if (macApp) {
        // The Mac app (scripts/mac-app/launcher.applescript) sees this and starts ChurchStream again.
        try { fs.writeFileSync(path.join(paths.runDir, 'restart'), String(Date.now())); } catch { /* the app then says it stopped */ }
      } else {
        const env = { ...process.env };
        delete env.CHURCHSTREAM_PACK;
        delete env.CHURCHSTREAM_UPDATE_FAILED;
        if (process.platform === 'win32') {
          // In a new window, like double-clicking ChurchStream.exe.
          spawn('cmd', ['/c', 'start', '"ChurchStream"', `"${process.execPath}"`, '--port', String(port)], { detached: true, stdio: 'ignore', env, windowsVerbatimArguments: true }).unref();
        } else {
          spawn(process.execPath, ['--port', String(port)], { detached: true, stdio: 'ignore', env }).unref();
        }
      }
      process.exit(0);
    }, 1700);
  }, 300); // let this answer reach the browser first
  return { ok: true, restarting: true };
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  // Wait for FFmpeg to finish the recording (up to 5 s), then exit.
  const done = setTimeout(() => process.exit(0), 5000);
  Promise.resolve(app.shutdown()).catch(() => {}).then(() => { clearTimeout(done); process.exit(0); });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, shutdown); } catch { /* unsupported */ } }
// On a Mac, keep the laptop and its screens awake while ChurchStream is open (built-in
// caffeinate; it ends by itself when ChurchStream does).
if (process.platform === 'darwin') {
  try { require('child_process').spawn('caffeinate', ['-d', '-i', '-m', '-w', String(process.pid)], { stdio: 'ignore', detached: false }).on('error', () => {}); } catch { /* not available */ }
}

const portArg = process.argv.indexOf('--port');
listen(portArg > 0 ? parseInt(process.argv[portArg + 1], 10) : (parseInt(process.env.PORT, 10) || app.cfg.port || 8080));

module.exports = { server, app };

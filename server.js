#!/usr/bin/env node
'use strict';
// ChurchStream — streaming + projection for small churches.
// One small Node process (no dependencies) + one FFmpeg process.
const http = require('http');
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
const assets = require('./lib/assets');
const { App } = require('./lib/app');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const PAGES = { '/control': 'control.html', '/setup': 'control.html', '/settings': 'control.html', '/display': 'display.html', '/stage': 'stage.html', '/remote': 'remote.html' };
// Pages the projector / stage screens need; everything else requires the password (if one is set).
const OPEN = [/^\/(display|stage)$/, /^\/api\/display\/youtube$/, /^\/events$/, /^\/(fonts|vendor|media|backgrounds)\//, /^\/(display|stage|shared)\.(js|css)$/, /^\/favicon/];

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
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
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
  for (const res of clients) res.write(msg);
}
app.on('state', (s) => broadcast('state', s));
app.on('meter', (v) => broadcast('meter', v));

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
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
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
  'GET /api/song': (req, url) => app.songs.get(url.searchParams.get('id')) || { error: 'Song not found' },
  'POST /api/song': async (req) => {
    const body = await json(req);
    const existing = body.id && app.songs.get(body.id);
    if (existing && existing.hymnal) body.edited = true; // protect hand-edited hymns from re-imports
    const s = app.songs.save(body);
    app.changed();
    return s;
  },
  'POST /api/song/delete': async (req) => { const { id } = await json(req); app.songs.remove(id); app.changed(); return { ok: true }; },
  'GET /api/bible': (req, url) => app.bible.lookup(url.searchParams.get('ref') || '', url.searchParams.get('t') || app.cfg.bible.translation),
  'POST /api/live': async (req) => { const { item, index } = await json(req); app.showItem(item, index || 0); return { ok: true }; },
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
  'POST /api/plan': async (req) => { app.setPlan((await json(req)).items); return { ok: true }; },
  'POST /api/plan/open': async (req) => {
    const { uid, index } = await json(req);
    const it = app.state.plan.items.find((x) => x.uid === uid);
    const r = it && app.resolvePlanItem(it);
    if (!r) throw new Error('That item could not be found.');
    return r;
  },
  'POST /api/stream/start': async (req) => { const { mode } = await json(req); await app.startStream(mode === 'live' ? 'live' : 'preview'); return { ok: true }; },
  'POST /api/stream/stop': async () => { await app.stopStream(); return { ok: true }; },
  'POST /api/config': async (req) => { app.updateConfig(await json(req)); return { ok: true }; },
  'GET /api/devices': () => app.devices(),
  'GET /api/logs': () => app.logs.slice(-80),
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
  'POST /api/media': async (req, url) => {
    const name = app.saveMedia(url.searchParams.get('kind'), await readBody(req), (req.headers['content-type'] || '').split(';')[0]);
    return { ok: true, name };
  },
  'POST /api/media/remove': async (req) => { const { kind } = await json(req); app.updateConfig({ theme: { [kind]: '' } }); return { ok: true }; },
  'GET /api/backgrounds': () => app.backgrounds(),
  'POST /api/program-image': async (req, url) => ({ ok: true, updated: app.saveProgramImage(await readBody(req, 4 * 1024 * 1024), url.searchParams.get('key') || '') }),
  'POST /api/backgrounds/delete': async (req) => { app.deleteBackground((await json(req)).id); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

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
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
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
    console.log(app.ffmpeg ? `  FFmpeg:          ${app.ffmpeg.version}` : '  FFmpeg:          NOT FOUND - streaming is disabled until it is installed.');
    console.log('');
    console.log(paths.isSea ? '  Close this window to stop ChurchStream.' : '  Press Ctrl+C to stop.');
    console.log('');
    if (paths.isSea && !process.env.CHURCHSTREAM_NO_BROWSER) openBrowser(`${local}${app.cfg.setupComplete ? '/control' : '/setup'}`);
    if (app.cfg.setupComplete && app.cfg.projector.autoLaunch) {
      try { app.projector.launch(`http://127.0.0.1:${p}/display`, app.cfg.projector.x != null ? app.cfg.projector : null); app.state.projectorOpen = true; } catch { /* manual */ }
    }
  });
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  app.shutdown();
  setTimeout(() => process.exit(0), 1600);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, shutdown); } catch { /* unsupported */ } }

const portArg = process.argv.indexOf('--port');
listen(portArg > 0 ? parseInt(process.argv[portArg + 1], 10) : (parseInt(process.env.PORT, 10) || app.cfg.port || 8080));

module.exports = { server, app };

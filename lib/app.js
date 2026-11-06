'use strict';
// Application state and actions. The HTTP layer (server.js) is a thin wrapper around this.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const paths = require('./paths');
const config = require('./config');
const assets = require('./assets');
const ffmpegLib = require('./ffmpeg');
const { Overlay, captionText } = require('./overlay');
const { Streamer, overlayGeometry, QUALITY, PROGRAM_FILE } = require('./stream');
const { atomicWrite } = require('./overlay');
const { SongLibrary, HYMNALS, pickVerses, verseCount } = require('./songs');
const { Bible } = require('./bible');
const { Projector } = require('./projector');
const hymnals = require('./importers/hymnals');
const { MediaRelay } = require('./media');
const { sabbathInfo, fillTokens } = require('./sun');
const bibleImport = require('./importers/bible');
const youtube = require('./youtube');
const { YtDownloader } = require('./ytdl');
const { writeZip } = require('./zip');
const { readZip } = require('./unzip');

class App extends EventEmitter {
  constructor() {
    super();
    for (const d of [paths.dataDir, paths.runDir, paths.mediaDir]) fs.mkdirSync(d, { recursive: true });
    assets.seedDefaults();
    this.cfg = config.load();

    const font = assets.getAsset('public/fonts/Inter-SemiBold.otf');
    if (font) fs.writeFileSync(path.join(paths.runDir, 'font.otf'), font);

    this.overlay = new Overlay(paths.runDir);
    // The projector picture for the stream. The control panel renders it; start with black.
    this.programFile = path.join(paths.runDir, PROGRAM_FILE);
    this.programKey = null;
    fs.writeFileSync(this.programFile, Buffer.from(BLACK_JPEG, 'base64'));
    this.songs = new SongLibrary(paths.songsDir);
    this.bible = new Bible(paths.bibleDir);
    this.projector = new Projector({ profileDir: path.join(paths.runDir, 'projector-browser') });
    this.ffmpeg = ffmpegLib.locate(this.cfg.ffmpegPath);
    this.encoderPromise = null;

    // Videos and music are fed into the stream through the media relay (never restarts the stream).
    this.relay = this.ffmpeg && !process.env.CHURCHSTREAM_NO_MEDIA ? new MediaRelay({ ffmpegPath: this.ffmpeg.path }) : null;
    this.streamer = new Streamer({
      getConfig: () => this.cfg,
      runDir: paths.runDir,
      recordingsDir: paths.recordingsDir,
      ffmpeg: this.ffmpeg || { path: 'ffmpeg' },
      getEncoder: () => this.encoder(),
      relay: this.relay,
    });
    // YouTube links play in YouTube's own player on the projector (the room); see display.js.
    this.yt = { now: null, music: null };
    this.ytdl = new YtDownloader({ toolsDir: path.join(paths.dataDir, 'tools') });
    this.download = null; // { state: 'working'|'done'|'error', message, percent, title, clip }
    if (this.relay) {
      this.relay.on('change', () => {
        this.streamer.setMediaVisible(!!(this.relay.now && this.relay.now.kind === 'video'));
        this.changed('media');
      });
      this.relay.on('ended', ({ item, error }) => { this.logs.push(`media ended: ${item && item.title}${error ? ' — ' + error : ''}`); });
    }
    this.streamer.on('status', () => this.changed('stream'));
    this.streamer.on('meter', (v) => this.emit('meter', v));
    this.logs = [];
    this.streamer.on('log', (l) => { this.logs.push(l); if (this.logs.length > 200) this.logs.shift(); });

    setInterval(() => { if (this.cfg.location && this.cfg.location.lat !== null) this.changed('clock'); }, 60000).unref();
    this.state = {
      live: null,                 // { item, index }
      black: false,
      clear: false,
      logo: false,
      lowerThird: { visible: false, name: '', title: '' },
      ticker: { visible: false, text: '' },
      identify: 0,                // timestamp until which the projector shows "This is the projector"
      task: null,                 // { label, running, error, result }
      plan: this.loadPlan(),
      projectorOpen: false,
    };
  }

  encoder() {
    if (this.cfg.encoder && this.cfg.encoder !== 'auto') return Promise.resolve(this.cfg.encoder);
    if (!this.ffmpeg) return Promise.resolve('libx264');
    if (!this.encoderPromise) this.encoderPromise = ffmpegLib.detectEncoder(this.ffmpeg.path);
    return this.encoderPromise;
  }

  // ---- state broadcast ---------------------------------------------------------------
  changed(what = 'state') {
    if (what !== 'stream') this.syncOverlay();
    if (this.relay) this.relay.ducked = !!this.yt.now; // stream music steps aside for a YouTube video too
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => this.emit('state', this.snapshot()), 15);
  }

  snapshot() {
    return {
      ...this.state,
      stream: this.streamer.status,
      config: config.publicView(this.cfg),
      library: { songs: this.songs.counts(), hymnals: HYMNALS, translations: this.bible.list() },
      ffmpeg: this.ffmpeg ? { ok: true, version: this.ffmpeg.version } : { ok: false },
      media: this.mediaStatus(),
      download: this.download,
      sabbath: this.sabbath(),
      platform: process.platform,
      now: Date.now(),
    };
  }

  // What the stream overlays should show right now.
  syncOverlay() {
    const s = this.state;
    const lt = s.lowerThird;
    if (lt.visible && (lt.name || lt.title)) this.overlay.setLowerThird(lt.name, lt.title);
    else this.overlay.setLowerThird('', '');
    const tk = s.ticker;
    this.overlay.setTicker(tk.visible && tk.text ? fillTokens(tk.text, this.sabbath()) : '');
    const slide = s.live && s.live.item.slides[s.live.index];
    const scene = this.effectiveScene();
    this.streamer.setScene(scene);
    // Words along the bottom only make sense over the camera; the slides already show them.
    const showCaption = scene === 'camera' && this.cfg.streamCaptions && slide && !s.black && !s.clear && !s.logo && !lt.visible;
    const q = QUALITY[this.cfg.quality] || QUALITY.good;
    this.overlay.setCaption(showCaption ? captionText(slide, { maxChars: overlayGeometry(q).captionMaxChars }) : '');
  }

  // Sunset / Sabbath times for the church's location (null until a location is set).
  sabbath() {
    const loc = this.cfg.location || {};
    const lat = loc.lat === null || loc.lat === '' ? NaN : Number(loc.lat);
    const lng = loc.lng === null || loc.lng === '' ? NaN : Number(loc.lng);
    const info = sabbathInfo(lat, lng);
    return info ? { label: info.label, isSabbath: info.isSabbath, tokens: info.tokens } : null;
  }

  // 'auto' shows the slides with a camera inset while words are on screen, the camera otherwise.
  effectiveScene() {
    const want = this.cfg.streamScene || 'camera';
    if (want !== 'auto') return want;
    const s = this.state;
    const words = s.live && s.live.item.slides[s.live.index] && !s.black && !s.clear && !s.logo;
    return words ? 'pip' : 'camera';
  }

  saveProgramImage(buf, key) {
    if (!buf || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Expected a JPEG image');
    if (key && key === this.programKey) return false;
    this.programKey = key || null;
    atomicWrite(this.programFile, buf);
    return true;
  }

  // ---- live slides -------------------------------------------------------------------
  showItem(item, index = 0) {
    if (!item || !Array.isArray(item.slides) || !item.slides.length) throw new Error('Nothing to show.');
    const clean = {
      key: item.key || crypto.randomUUID(),
      kind: item.kind || 'text',
      title: String(item.title || ''),
      subtitle: String(item.subtitle || ''),
      songId: item.songId || undefined,
      background: cleanBg(item.background),
      autoAdvance: cleanAuto(item.autoAdvance),
      countdown: item.kind === 'countdown' ? withTarget(cleanCountdown(item.countdown)) : undefined,
      media: item.kind === 'media' ? cleanMedia(item.media) : undefined,
      slides: item.slides.map((sl) => ({ label: sl.label || '', text: String(sl.text || ''), ref: sl.ref || '', verses: sl.verses || null, background: cleanBg(sl.background), image: cleanBg(sl.image) || undefined,
        part: ['leader', 'people', 'all'].includes(sl.part) ? sl.part : undefined })),
    };
    // {sunset}, {sabbath-ends}, … in typed text become the real times for this church.
    if (clean.kind === 'text' || clean.kind === 'countdown') {
      const sab = this.sabbath();
      for (const sl of clean.slides) if (/\{(sunset|sabbath-|next-sabbath)/.test(sl.text)) sl.text = fillTokens(sl.text, sab);
      if (clean.countdown) { clean.countdown.message = fillTokens(clean.countdown.message, sab); clean.countdown.endText = fillTokens(clean.countdown.endText, sab); }
    }
    // Keep a running countdown's end time when the same item is shown again.
    const prev = this.state.live && this.state.live.item;
    if (clean.countdown && prev && prev.key === clean.key && prev.countdown && sameCountdown(prev.countdown, clean.countdown)) clean.countdown.target = prev.countdown.target;
    this.state.live = { item: clean, index: Math.max(0, Math.min(index, clean.slides.length - 1)) };
    this.state.clear = false;
    this.state.logo = false;
    this.scheduleAuto();
    // A video/music item plays as soon as it goes on screen; anything else stops it.
    const playing = this.relay && this.relay.now;
    if (clean.kind === 'media') {
      const current = clean.media.type === 'youtube' ? this.yt.now : playing;
      if (!current || current.id !== clean.key) this.playMedia(clean);
    } else {
      if (playing) this.relay.stop();
      this.yt.now = null;
    }
    this.changed();
  }

  // ---- videos & music ----------------------------------------------------------------
  mediaPath(id) {
    const file = String(id || '').replace(/^media:/, '');
    if (!/^clip-[\w-]+\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac)$/i.test(file)) throw new Error('Unknown media file');
    return path.join(paths.mediaDir, file);
  }

  mediaStatus() {
    const r = this.relay ? this.relay.status() : { now: null, music: null };
    const y = this.yt;
    return {
      now: y.now || r.now,
      music: y.music ? { youtube: y.music.youtube, title: y.music.title, volume: y.music.volume, startedAt: y.music.startedAt } : r.music,
    };
  }

  playMedia(item) {
    const m = item.media || {};
    if (m.type === 'youtube') {
      if (this.relay && this.relay.now) this.relay.stop();
      this.yt.now = { id: item.key, kind: 'youtube', title: item.title, youtube: m.youtube, loop: !!m.loop, volume: Math.min(1, m.volume ?? 1),
        startedAt: Date.now() - (m.youtube.start || 0) * 1000, paused: false, duration: m.duration || 0 };
      return;
    }
    this.yt.now = null;
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    this.relay.play({ id: item.key, kind: m.type === 'audio' ? 'audio' : 'video', path: this.mediaPath(m.file), title: item.title, loop: !!m.loop,
      volume: this.cfg.mediaSound === 'desk' ? 0 : (m.volume ?? 1) });
  }

  mediaControl({ action, volume }) {
    const live = this.state.live && this.state.live.item;
    const y = this.yt.now;
    if (y || (live && live.kind === 'media' && live.media.type === 'youtube')) {
      const now = Date.now();
      if (action === 'stop') this.yt.now = null;
      else if (action === 'play' || action === 'restart') { if (live && live.kind === 'media') this.playMedia(live); }
      else if (action === 'pause' && y && !y.paused) { y.paused = true; y.pausedAt = now; }
      else if (action === 'resume' && y && y.paused) { y.startedAt += now - y.pausedAt; y.paused = false; delete y.pausedAt; }
      if (volume !== undefined && this.yt.now) this.yt.now.volume = Math.max(0, Math.min(1, Number(volume)));
      this.changed('media');
      return;
    }
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    if (action === 'stop') this.relay.stop();
    else if (action === 'play' || action === 'restart') { if (live && live.kind === 'media') this.playMedia(live); }
    if (volume !== undefined) this.relay.setVolume(Number(volume));
    this.changed('media');
  }

  musicControl({ action, files, volume, youtube: yt, title }) {
    if (action === 'play' && yt) {
      const y = youtube.clean(yt);
      if (!y.id && !y.list) throw new Error('That YouTube link wasn’t understood.');
      if (this.relay) this.relay.stopMusic(true);
      const v = Math.max(0, Math.min(1, Number(volume ?? this.cfg.musicVolume ?? 0.4)));
      this.yt.music = { youtube: y, title: String(title || 'YouTube'), volume: v, startedAt: Date.now() };
      this.updateConfig({ musicYouTube: { ...y, title: this.yt.music.title } });
      this.changed('media');
      return;
    }
    if (action === 'stop' && this.yt.music) { this.yt.music = null; this.changed('media'); return; }
    if (volume !== undefined && action !== 'play' && this.yt.music) {
      this.yt.music.volume = Math.max(0, Math.min(1, Number(volume)));
      this.updateConfig({ musicVolume: this.yt.music.volume });
      this.changed('media');
      return;
    }
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    if (action === 'play') {
      const paths_ = (files || []).map((f) => this.mediaPath(f));
      if (!paths_.length) throw new Error('Choose at least one music file.');
      this.yt.music = null;
      this.relay.playMusic(paths_, this.cfg.mediaSound === 'desk' ? 0 : (volume ?? this.cfg.musicVolume ?? 0.4));
      this.updateConfig({ musicFiles: files });
    } else if (action === 'stop') this.relay.stopMusic();
    if (volume !== undefined && action !== 'play') { this.relay.setMusicVolume(Number(volume)); this.updateConfig({ musicVolume: Number(volume) }); }
    this.changed('media');
  }

  async saveUpload(req, name) {
    const ext = String(path.extname(name || '')).toLowerCase().replace('.', '');
    const kinds = { mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio' };
    if (!kinds[ext]) throw new Error('Please choose an MP4, MOV, WebM or MKV video, or an MP3, M4A, WAV, OGG or FLAC music file.');
    const file = `clip-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    const dest = path.join(paths.mediaDir, file);
    await new Promise((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(dest);
      req.on('data', (c) => { size += c.length; if (size > 4 * 1024 ** 3) { req.destroy(); reject(new Error('File is larger than 4 GB.')); } });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    }).catch((err) => { try { fs.unlinkSync(dest); } catch { /* none */ } throw err; });
    return this.addClip({ file, type: kinds[ext], name: String(name).replace(/\.[^.]+$/, ''), duration: await this.probeDuration(dest) });
  }

  addClip({ file, type, name, duration, source }) {
    const info = { id: 'media:' + file, file, type, name, duration, ...(source ? { source } : {}) };
    const lib = this.mediaLibrary().filter((x) => x.file !== file);
    lib.unshift(info);
    fs.writeFileSync(path.join(paths.mediaDir, 'clips.json'), JSON.stringify(lib, null, 1));
    this.changed('media');
    return info;
  }

  // ---- YouTube -------------------------------------------------------------------------
  youtubeInfo(url) { return youtube.info(url); }

  // The projector reports what YouTube's player found out (length, end of the video).
  youtubeReport({ key, startedAt, duration, ended }) {
    const y = this.yt.now;
    if (!y || y.id !== key || Math.abs(y.startedAt - Number(startedAt)) > 5) return;
    if (duration > 0 && !y.duration) { y.duration = Math.round(duration); this.changed('media'); }
    if (ended && !y.loop) { this.yt.now = null; this.changed('media'); }
  }

  // Save a YouTube video (or its sound) into the media library. Runs in the background.
  downloadYouTube({ url, kind }) {
    if (this.download && this.download.state === 'working') throw new Error('A download is already running.');
    const y = youtube.parseYouTube(url);
    if (!y || !y.id) throw new Error('Paste a link to one YouTube video (not a playlist).');
    const type = kind === 'audio' ? 'audio' : 'video';
    const base = `clip-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    this.download = { state: 'working', message: 'Starting…', percent: 0, kind: type, url: youtube.watchUrl(y) };
    this.changed('media');
    let lastPush = 0;
    const set = (patch) => { Object.assign(this.download, patch); const t = Date.now(); if (t - lastPush > 400 || patch.state) { lastPush = t; this.changed('media'); } };
    this.ytdl.fetch({ url: youtube.watchUrl({ id: y.id }), kind: type, ffmpegPath: this.ffmpeg && this.ffmpeg.path, outDir: paths.mediaDir, base,
      onStatus: (message) => set({ message }), onProgress: (p) => set({ percent: p, message: `Downloading… ${Math.round(p * 100)}%` }) })
      .then(async (r) => {
        const duration = r.duration || await this.probeDuration(path.join(paths.mediaDir, r.file));
        const clip = this.addClip({ file: r.file, type, name: r.title || 'YouTube video', duration, source: youtube.watchUrl({ id: y.id }) });
        set({ state: 'done', percent: 1, message: `Saved “${clip.name}”`, clip });
      })
      .catch((err) => {
        for (const f of fs.readdirSync(paths.mediaDir)) if (f.startsWith(base)) { try { fs.unlinkSync(path.join(paths.mediaDir, f)); } catch { /* busy */ } }
        set({ state: 'error', message: err.message });
      });
    return { ok: true };
  }

  cancelDownload() { this.ytdl.cancel(); }

  probeDuration(file) {
    if (!this.ffmpeg) return Promise.resolve(0);
    return ffmpegLib.run(this.ffmpeg.path, ['-hide_banner', '-i', file], 15000).then(({ out }) => {
      const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      return m ? Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0;
    });
  }

  mediaLibrary() {
    try {
      return JSON.parse(fs.readFileSync(path.join(paths.mediaDir, 'clips.json'), 'utf8')).filter((x) => fs.existsSync(path.join(paths.mediaDir, x.file)));
    } catch { return []; }
  }

  deleteClip(id) {
    const file = this.mediaPath(id);
    if (this.relay && this.relay.now && this.relay.now.path === file) this.relay.stop();
    try { fs.unlinkSync(file); } catch { /* gone */ }
    const lib = this.mediaLibrary().filter((x) => x.id !== id);
    fs.writeFileSync(path.join(paths.mediaDir, 'clips.json'), JSON.stringify(lib, null, 1));
    this.changed('media');
    return lib;
  }

  // Items with "advance automatically" (announcements, countdown) step on by themselves and loop.
  scheduleAuto() {
    clearTimeout(this.autoTimer);
    const live = this.state.live;
    const secs = live && live.item.autoAdvance;
    if (!secs || live.item.slides.length < 2) return;
    this.autoTimer = setTimeout(() => {
      const l = this.state.live;
      if (!l || l !== live) return;
      l.index = (l.index + 1) % l.item.slides.length;
      this.scheduleAuto();
      this.changed();
    }, secs * 1000);
  }

  setTicker({ text, visible }) {
    const t = this.state.ticker;
    if (text !== undefined) t.text = String(text).replace(/\s+/g, ' ').slice(0, 400);
    if (visible !== undefined) t.visible = !!visible;
    this.changed();
  }

  // ---- saved services & service files --------------------------------------------------
  // A service is the order of service plus everything it needs on another computer: the
  // words of its songs and (optionally) its pictures, backgrounds and videos.
  historyDir() { return path.join(paths.dataDir, 'services'); }

  // Keep a copy of the current order of service (before it is replaced, or when asked).
  archivePlan(name, { auto = false } = {}) {
    const items = this.state.plan.items;
    if (!items.length) return null;
    fs.mkdirSync(this.historyDir(), { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const entry = { name: String(name || '').trim().slice(0, 80) || defaultServiceName(now), saved: now.toISOString(), auto, items };
    // Don't keep identical automatic copies back to back.
    const last = this.listServices()[0];
    const same = (x) => JSON.stringify(x.map(({ uid, ...r }) => r));
    if (last && same(last.items) === same(items) && (auto || last.name === entry.name)) return last;
    fs.writeFileSync(path.join(this.historyDir(), `${stamp}.json`), JSON.stringify(entry, null, 1));
    // Automatic copies: keep the newest 40.
    const autos = this.listServices().filter((x) => x.auto);
    for (const old of autos.slice(40)) { try { fs.unlinkSync(path.join(this.historyDir(), old.id)); } catch { /* gone */ } }
    return entry;
  }

  listServices() {
    let files = [];
    try { files = fs.readdirSync(this.historyDir()).filter((f) => f.endsWith('.json')); } catch { return []; }
    return files.sort().reverse().map((f) => {
      try { const e = JSON.parse(fs.readFileSync(path.join(this.historyDir(), f), 'utf8')); return { id: f, ...e }; } catch { return null; }
    }).filter(Boolean);
  }

  openService(id) {
    const e = this.listServices().find((x) => x.id === id);
    if (!e) throw new Error('That service was not found.');
    this.replacePlan(e.items, 'Before opening “' + e.name + '”');
    return { ok: true, name: e.name };
  }

  deleteService(id) {
    if (!/^[\w.-]+\.json$/.test(String(id))) throw new Error('Unknown service');
    try { fs.unlinkSync(path.join(this.historyDir(), id)); } catch { /* gone */ }
    return this.listServices();
  }

  // Replace the order of service, keeping the old one in Recent first.
  replacePlan(items, why) {
    this.archivePlan(why ? `${defaultServiceName(new Date())} (${why})` : '', { auto: true });
    this.setPlan(items);
  }

  // New service: blank, the usual order (the default template) or a named template.
  newService({ from } = {}) {
    let items = [];
    if (from === 'default') {
      const t = this.listTemplates().find((x) => x.name === this.cfg.defaultTemplate) || null;
      if (!t) throw new Error('No usual order is set yet. Save one in Templates and mark it with ★.');
      items = t.items;
    } else if (from && from !== 'blank') {
      const t = this.listTemplates().find((x) => x.name === from);
      if (!t) throw new Error('That template was not found.');
      items = t.items;
    }
    this.replacePlan(items.map((it) => ({ ...it })), 'before New service');
    return { ok: true };
  }

  // Media files an order of service uses (pictures, backgrounds, videos, music).
  serviceMedia(items) {
    const names = new Set();
    const add = (v) => { const m = /^media:([\w.-]+)$/.exec(String(v || '')); if (m) names.add(m[1]); };
    for (const it of items) {
      add(it.background);
      for (const v of Object.values(it.slideBackgrounds || {})) add(v);
      for (const sl of it.slides || []) { add(sl.image); add(sl.background); }
      if (it.media) add(it.media.file);
    }
    return [...names].filter((n) => fs.existsSync(path.join(paths.mediaDir, n)));
  }

  // Build a .churchservice file (a zip).
  exportService({ name, media = true } = {}) {
    const items = this.state.plan.items;
    if (!items.length) throw new Error('The order of service is empty.');
    const songs = [];
    for (const it of items) {
      if (it.kind !== 'song' || !it.songId) continue;
      const sg = this.songs.get(it.songId);
      if (sg && !songs.some((x) => x.id === sg.id)) songs.push({ id: sg.id, title: sg.title, hymnal: sg.hymnal, number: sg.number, author: sg.author, copyright: sg.copyright, ccli: sg.ccli, sections: sg.sections });
    }
    const files = media ? this.serviceMedia(items) : [];
    const clips = this.mediaLibrary().filter((c) => files.includes(c.file));
    const manifest = {
      format: 'churchstream-service', version: 1,
      name: String(name || '').trim() || defaultServiceName(new Date()),
      saved: new Date().toISOString(), church: this.cfg.churchName || '',
      items: items.map(({ uid, ...rest }) => rest), songs, clips, media: files,
    };
    const entries = [{ name: 'service.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) }];
    for (const f of files) entries.push({ name: 'media/' + f, data: fs.readFileSync(path.join(paths.mediaDir, f)) });
    return { name: manifest.name, buffer: writeZip(entries) };
  }

  // How big a saved file would be (so the dialog can say so before saving).
  exportInfo() {
    const items = this.state.plan.items;
    const files = this.serviceMedia(items);
    const size = (f) => { try { return fs.statSync(path.join(paths.mediaDir, f)).size; } catch { return 0; } };
    return { items: items.length, titles: items.map((x) => x.title), media: files.length, mediaBytes: files.reduce((a, f) => a + size(f), 0) };
  }

  // Open a .churchservice file: add its songs and media here, then load its order of service.
  importService(buf) {
    let entries;
    try { entries = readZip(buf); } catch { throw new Error('This isn’t a ChurchStream service file (.churchservice).'); }
    const main = entries.find((e) => e.name === 'service.json');
    let m;
    try { m = main && JSON.parse(main.read().toString('utf8')); } catch { m = null; }
    if (!m || m.format !== 'churchstream-service' || !Array.isArray(m.items)) throw new Error('This isn’t a ChurchStream service file (.churchservice).');
    if (m.version > 1) throw new Error('This service was saved by a newer ChurchStream. Please update this computer first.');
    // Media: copy files that aren't here yet.
    let added = 0;
    for (const e of entries) {
      const mm = /^media\/([\w.-]{1,120})$/.exec(e.name);
      if (!mm || !/\.(png|jpe?g|webp|svg|mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac)$/i.test(mm[1])) continue;
      const dest = path.join(paths.mediaDir, mm[1]);
      if (fs.existsSync(dest)) continue;
      fs.writeFileSync(dest, e.read());
      added++;
    }
    for (const c of Array.isArray(m.clips) ? m.clips : []) {
      if (c && /^clip-[\w-]+\.\w{2,4}$/.test(String(c.file)) && fs.existsSync(path.join(paths.mediaDir, c.file)) && !this.mediaLibrary().some((x) => x.file === c.file)) {
        this.addClip({ file: c.file, type: c.type === 'audio' ? 'audio' : 'video', name: String(c.name || c.file), duration: Number(c.duration) || 0, source: c.source });
      }
    }
    // Songs: use this computer's copy when it's the same hymn; otherwise add the song.
    const idMap = {};
    let newSongs = 0;
    for (const sg of Array.isArray(m.songs) ? m.songs : []) {
      if (!sg || !sg.id) continue;
      const here = this.songs.get(sg.id);
      const same = here && JSON.stringify(here.sections) === JSON.stringify(sg.sections);
      if (same || (here && sg.hymnal && here.hymnal === sg.hymnal && here.number === sg.number)) { idMap[sg.id] = here.id; continue; }
      const saved = this.songs.save({ ...sg, id: undefined, edited: !!sg.hymnal });
      idMap[sg.id] = saved.id;
      newSongs++;
    }
    const items = m.items.map((it) => (it.kind === 'song' && it.songId && idMap[it.songId] ? { ...it, songId: idMap[it.songId] } : { ...it }));
    const missing = items.filter((it) => it.kind === 'song' && !this.songs.get(it.songId)).length;
    const have = new Set(this.bible.list().map((t) => t.id));
    const bibles = [...new Set(items.filter((it) => it.kind === 'bible' && it.translation && !have.has(it.translation)).map((it) => it.translation))];
    this.replacePlan(items, 'before opening “' + (m.name || 'a service') + '”');
    this.archivePlan(m.name);
    this.changed('media');
    return { ok: true, name: m.name || 'Service', items: items.length, newSongs, media: added, missing, bibles };
  }

  // ---- service templates -------------------------------------------------------------
  templatesFile() { return path.join(paths.dataDir, 'templates.json'); }

  listTemplates() {
    try { return JSON.parse(fs.readFileSync(this.templatesFile(), 'utf8')); } catch { return []; }
  }

  saveTemplate(name, items) {
    name = String(name || '').trim().slice(0, 80);
    if (!name) throw new Error('Give the template a name.');
    const clean = (items || []).slice(0, 200).map(({ uid, ...rest }) => rest);
    const list = this.listTemplates().filter((t) => t.name !== name);
    list.push({ name, items: clean, saved: new Date().toISOString() });
    list.sort((a, b) => a.name.localeCompare(b.name));
    fs.writeFileSync(this.templatesFile(), JSON.stringify(list, null, 1));
    return list;
  }

  deleteTemplate(name) {
    const list = this.listTemplates().filter((t) => t.name !== name);
    fs.writeFileSync(this.templatesFile(), JSON.stringify(list, null, 1));
    return list;
  }

  goTo(index) {
    if (!this.state.live) return;
    const n = this.state.live.item.slides.length;
    this.state.live.index = Math.max(0, Math.min(index, n - 1));
    this.state.clear = false;
    this.scheduleAuto();
    this.changed();
  }

  step(delta) {
    const live = this.state.live;
    if (!live) return;
    const next = live.index + delta;
    if (next >= 0 && next < live.item.slides.length) return this.goTo(next);
    // Past the end of an item: move to the next/previous item in the service plan.
    const items = this.state.plan.items;
    const at = items.findIndex((it) => it.uid === live.item.key);
    if (at < 0) return;
    const target = items[at + (delta > 0 ? 1 : -1)];
    if (!target) return;
    const resolved = this.resolvePlanItem(target);
    if (resolved) this.showItem(resolved, delta > 0 ? 0 : resolved.slides.length - 1);
  }

  setToggle(name, value) {
    if (!['black', 'clear', 'logo'].includes(name)) throw new Error('Unknown toggle');
    this.state[name] = value === undefined ? !this.state[name] : !!value;
    if (this.state[name] && name !== 'clear') for (const k of ['black', 'logo']) if (k !== name) this.state[k] = false;
    this.changed();
  }

  setLowerThird({ name, title, visible }) {
    const lt = this.state.lowerThird;
    if (name !== undefined) lt.name = String(name).slice(0, 80);
    if (title !== undefined) lt.title = String(title).slice(0, 120);
    if (visible !== undefined) lt.visible = !!visible;
    this.changed();
  }

  identifyProjector() {
    this.state.identify = Date.now() + 6000;
    this.changed();
    setTimeout(() => this.changed(), 6100);
  }

  // ---- service plan ------------------------------------------------------------------
  loadPlan() {
    try { return JSON.parse(fs.readFileSync(paths.planFile, 'utf8')); } catch { return { items: [] }; }
  }

  setPlan(items, { undo = false } = {}) {
    // Keep the last 30 orders of service so a change can be undone.
    const before = this.state.plan ? this.state.plan.items : [];
    if (!undo) {
      this.undoStack = this.undoStack || [];
      if (JSON.stringify(before) !== JSON.stringify(items)) this.undoStack.push(before);
      if (this.undoStack.length > 30) this.undoStack.shift();
    }
    this.state.plan = {
      items: (items || []).slice(0, 200).map((it) => ({
        uid: it.uid || crypto.randomUUID(),
        kind: it.kind,
        title: String(it.title || ''),
        subtitle: String(it.subtitle || ''),
        songId: it.songId, ref: it.ref, translation: it.translation,
        verses: it.kind === 'song' ? cleanVerses(it.verses) : undefined,
        count: Number.isFinite(+it.count) ? Math.min(+it.count, 500) : undefined,
        slides: it.kind === 'text' || it.kind === 'countdown' ? it.slides
          : it.kind === 'images' ? (it.slides || []).slice(0, 300).map((sl) => ({ label: String(sl.label || ''), text: '', image: cleanBg(sl.image) })).filter((sl) => sl.image) : undefined,
        autoAdvance: cleanAuto(it.autoAdvance) || undefined,
        countdown: it.kind === 'countdown' ? cleanCountdown(it.countdown) : undefined,
        media: it.kind === 'media' ? cleanMedia(it.media) : undefined,
        background: cleanBg(it.background),
        slideBackgrounds: cleanSlideBgs(it.slideBackgrounds),
      })),
    };
    fs.writeFileSync(paths.planFile, JSON.stringify(this.state.plan, null, 1));
    this.changed();
  }

  undoPlan() {
    const prev = (this.undoStack || []).pop();
    if (!prev) return { ok: false };
    this.setPlan(prev, { undo: true });
    return { ok: true };
  }

  resolvePlanItem(it) {
    const r = this.resolvePlanItemContent(it);
    if (!r) return r;
    const per = it.slideBackgrounds || {};
    return { ...r, background: it.background || '', slides: r.slides.map((sl, i) => ({ ...sl, background: per[i] || '' })) };
  }

  resolvePlanItemContent(it) {
    if (it.kind === 'song') {
      const s = this.songs.get(it.songId);
      if (!s) return s;
      const verses = cleanVerses(it.verses);
      return { key: it.uid, kind: 'song', title: s.title, subtitle: hymnLabel(s), slides: pickVerses(s.slides, verses), songId: s.id, verses, verseCount: verseCount(s.slides) };
    }
    if (it.kind === 'bible') {
      const r = this.bible.lookup(it.ref, it.translation || this.cfg.bible.translation);
      return r.slides && { key: it.uid, kind: 'bible', title: r.title, subtitle: r.translation, slides: r.slides, ref: it.ref, translation: it.translation };
    }
    if (it.kind === 'text') return { key: it.uid, kind: 'text', title: it.title, subtitle: '', slides: it.slides || [], autoAdvance: it.autoAdvance };
    if (it.kind === 'media') return { key: it.uid, kind: 'media', title: it.title, subtitle: it.subtitle || '', slides: [{ label: it.title, text: '' }], media: it.media };
    if (it.kind === 'images') return { key: it.uid, kind: 'images', title: it.title, subtitle: it.subtitle || '', slides: it.slides || [], autoAdvance: it.autoAdvance };
    if (it.kind === 'countdown') {
      const slides = it.slides && it.slides.length ? it.slides : [{ label: '', text: '' }];
      return { key: it.uid, kind: 'countdown', title: it.title, subtitle: '', slides, autoAdvance: it.autoAdvance || (slides.length > 1 ? 8 : 0), countdown: it.countdown };
    }
    return null;
  }

  // ---- search ------------------------------------------------------------------------
  search(q) {
    const bible = this.bible.lookup(q, this.cfg.bible.translation);
    return {
      bible: bible.slides ? { ref: bible.ref, title: bible.title, translation: bible.translation, slides: bible.slides } : null,
      books: bible.slides ? [] : this.bible.suggest(q),
      songs: this.songs.search(q, { limit: 25, defaultHymnal: this.cfg.hymnal.default }),
    };
  }

  // ---- streaming ---------------------------------------------------------------------
  async startStream(mode) {
    if (!this.ffmpeg) throw new Error(process.platform === 'win32' ? 'FFmpeg was not found. Put ffmpeg.exe in the "ffmpeg" folder next to ChurchStream.exe.' : 'FFmpeg was not found. Put ffmpeg in the "ffmpeg" folder next to ChurchStream (or install it with Homebrew: brew install ffmpeg).');
    this.syncOverlay();
    await this.streamer.start(mode);
  }

  stopStream() { return this.streamer.stop(); }

  // ---- settings ----------------------------------------------------------------------
  updateConfig(patch) {
    patch = JSON.parse(JSON.stringify(patch || {}));
    // Masked values coming back from the browser mean "unchanged".
    for (const k of ['youtube', 'facebook']) if (patch.outputs?.[k]?.key?.startsWith?.('••••')) delete patch.outputs[k].key;
    if (patch.outputs?.custom?.url?.startsWith?.('••••')) delete patch.outputs.custom.url;
    if (patch.controlPassword === '••••') delete patch.controlPassword;
    for (const k of ['youtube', 'facebook']) if (patch.outputs?.[k]?.key) patch.outputs[k].key = String(patch.outputs[k].key).trim();
    if (patch.lowerThirdPresets) patch.lowerThirdPresets = patch.lowerThirdPresets.slice(0, 30);
    const before = JSON.stringify([this.cfg.video, this.cfg.audio, this.cfg.quality]);
    this.cfg = config.update(patch);
    if (patch.ffmpegPath !== undefined) { this.ffmpeg = ffmpegLib.locate(this.cfg.ffmpegPath); this.encoderPromise = null; if (this.ffmpeg) this.streamer.ffmpeg = this.ffmpeg; }
    if (patch.encoder !== undefined) this.encoderPromise = null;
    // Restart a running preview so camera/mic changes take effect immediately.
    if (this.streamer.status.mode === 'preview' && before !== JSON.stringify([this.cfg.video, this.cfg.audio, this.cfg.quality])) {
      this.streamer.start('preview').catch(() => {});
    }
    this.changed();
    return this.cfg;
  }

  async devices() {
    const devs = this.ffmpeg ? await ffmpegLib.listDevices(this.ffmpeg.path) : { video: [], audio: [], note: 'FFmpeg not found.' };
    return { ...devs, monitors: await ffmpegLib.listMonitors() };
  }

  // ---- long-running tasks (downloads) --------------------------------------------------
  runTask(label, fn) {
    if (this.state.task && this.state.task.running) throw new Error('Please wait for the current download to finish.');
    this.state.task = { label, running: true, error: '', result: null };
    this.changed();
    const progress = (msg) => { this.state.task.label = msg; this.changed(); };
    fn(progress).then((result) => {
      this.state.task = { label: '', running: false, error: '', result };
      this.changed();
    }).catch((err) => {
      this.state.task = { label, running: false, error: err.message, result: null };
      this.changed();
    });
  }

  importHymnal(id) {
    this.runTask(`Downloading ${hymnals.SOURCES[id] ? hymnals.SOURCES[id].name : id}…`, async (progress) => {
      const r = await hymnals.importHymnal(id, this.songs, { tmpDir: paths.runDir, onProgress: progress });
      return `${r.hymnal}: ${r.added} added, ${r.updated} updated${r.kept ? `, ${r.kept} edited hymns kept` : ''}.`;
    });
  }

  // A Bible file the church is licensed to use: converted and kept on this computer only.
  importBibleFile(buf, { name, abbrev, licensed } = {}) {
    if (!licensed) throw new Error('Please confirm that your church is licensed to use this translation.');
    const r = bibleImport.parseBibleFile(buf);
    const ab = String(abbrev || r.abbrev || '').trim().slice(0, 12);
    const nm = String(name || r.name || '').trim().slice(0, 80);
    if (!ab) throw new Error('Give the translation a short name, e.g. NRSV.');
    if (!nm) throw new Error('Give the translation a name, e.g. New Revised Standard Version.');
    const id = ab.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'bible';
    const existing = this.bible.load(id);
    if (existing && existing.source !== 'import') throw new Error(`${existing.abbrev} is already installed. Use a different short name.`);
    bibleImport.writeTranslation(paths.bibleDir, id, { name: nm, abbrev: ab, books: r.books, source: 'import', imported: new Date().toISOString() });
    this.bible.cache.delete(id);
    this.changed();
    return { ok: true, id, name: nm, abbrev: ab, books: r.booksWithText, replaced: !!existing };
  }

  // Read a Bible file without saving it: what it is and how much of the Bible it has.
  checkBibleFile(buf) {
    const r = bibleImport.parseBibleFile(buf);
    return { name: r.name, abbrev: r.abbrev, books: r.booksWithText };
  }

  removeBible(id) {
    const t = this.bible.load(id);
    if (!t) throw new Error('That translation was not found.');
    if (t.source !== 'import') throw new Error('Only imported translations can be removed here.');
    for (const f of [t.id + '.json.gz', t.id + '.json']) { try { fs.unlinkSync(path.join(paths.bibleDir, f)); } catch { /* none */ } }
    this.bible.cache.delete(t.id);
    if (this.cfg.bible.translation === t.id) {
      const next = this.bible.list()[0];
      this.updateConfig({ bible: { translation: next ? next.id : 'kjv' } });
    }
    this.changed();
    return { ok: true };
  }

  importBible(id) {
    this.runTask('Downloading Bible…', async (progress) => {
      const r = await bibleImport.downloadTranslation(id, paths.bibleDir, { onProgress: progress });
      this.bible.cache.delete(id);
      return `${r.name} is ready.`;
    });
  }

  saveMedia(kind, buf, contentType) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[contentType];
    if (!ext) throw new Error('Please choose a PNG, JPG, WebP or SVG image.');
    if (!['background', 'logo', 'slide'].includes(kind)) throw new Error('Unknown image type');
    if (kind === 'slide') {
      // Sermon/presentation slides are kept as files and referenced by their items.
      const name = `slide-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(paths.mediaDir, name), buf);
      return 'media:' + name;
    }
    if (kind === 'logo') {
      for (const f of fs.readdirSync(paths.mediaDir)) if (/^logo[.-]/.test(f)) fs.unlinkSync(path.join(paths.mediaDir, f));
      const name = `logo-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(paths.mediaDir, name), buf);
      this.updateConfig({ theme: { logo: name } });
      return name;
    }
    // Backgrounds are kept as a library: uploading never replaces an earlier one.
    const name = `bg-${Date.now().toString(36)}.${ext}`;
    fs.writeFileSync(path.join(paths.mediaDir, name), buf);
    this.changed();
    return 'media:' + name;
  }

  backgrounds() {
    let builtin = [];
    try { builtin = JSON.parse(assets.getAsset('public/backgrounds/index.json').toString('utf8')); } catch { /* none */ }
    const custom = fs.readdirSync(paths.mediaDir)
      .filter((f) => /^(bg|background)-[\w]+\.(png|jpe?g|webp|svg)$/i.test(f))
      .map((f) => ({ id: 'media:' + f, file: f, mtime: fs.statSync(path.join(paths.mediaDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return { builtin: builtin.map((b) => ({ ...b, id: 'builtin:' + b.id })), custom };
  }

  deleteBackground(id) {
    const file = String(id || '').replace(/^media:/, '');
    if (!/^(bg|background)-[\w]+\.(png|jpe?g|webp|svg)$/i.test(file)) throw new Error('That background cannot be deleted.');
    try { fs.unlinkSync(path.join(paths.mediaDir, file)); } catch { /* already gone */ }
    const gone = (v) => v === 'media:' + file || v === file;
    if (gone(this.cfg.theme.background)) this.updateConfig({ theme: { background: '' } });
    const items = this.state.plan.items.map((it) => ({
      ...it,
      background: gone(it.background) ? '' : it.background,
      slideBackgrounds: Object.fromEntries(Object.entries(it.slideBackgrounds || {}).filter(([, v]) => !gone(v))),
    }));
    this.setPlan(items);
  }

  shutdown() {
    this.projector.close();
    if (this.relay) this.relay.close();
    const p = this.streamer.proc;
    if (p) { try { p.stdin.write('q'); } catch { /* ignore */ } setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 1500); }
  }
}

function cleanMedia(m) {
  m = m && typeof m === 'object' ? m : {};
  if (m.type === 'youtube') {
    return {
      type: 'youtube',
      youtube: youtube.clean(m.youtube),
      duration: Math.max(0, Math.round(Number(m.duration) || 0)),
      loop: !!m.loop,
      volume: Math.max(0, Math.min(1, Number(m.volume ?? 1))),
    };
  }
  return {
    file: /^media:clip-[\w-]+\.\w{2,4}$/.test(String(m.file || '')) ? m.file : '',
    type: m.type === 'audio' ? 'audio' : 'video',
    duration: Math.max(0, Math.round(Number(m.duration) || 0)),
    loop: !!m.loop,
    volume: Math.max(0, Math.min(1.5, Number(m.volume ?? 1))),
    room: m.room !== false,
  };
}

function cleanAuto(v) {
  const n = Math.round(Number(v) || 0);
  return n >= 2 && n <= 600 ? n : 0;
}

// Countdown: { mode: 'minutes' | 'until', minutes, until: 'HH:MM', message, endText }
function cleanCountdown(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    mode: c.mode === 'until' ? 'until' : 'minutes',
    minutes: Math.max(1, Math.min(180, Math.round(Number(c.minutes) || 5))),
    until: /^\d{1,2}:\d{2}$/.test(String(c.until || '')) ? String(c.until) : '11:00',
    message: String(c.message ?? 'Our service begins in').slice(0, 120),
    endText: String(c.endText ?? 'Welcome!').slice(0, 120),
  };
}

function withTarget(c) {
  const now = new Date();
  if (c.mode === 'minutes') return { ...c, target: now.getTime() + c.minutes * 60000 };
  const [h, m] = c.until.split(':').map(Number);
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  // A time that has already passed by more than an hour means tomorrow; just passed means "now".
  if (t.getTime() < now.getTime() - 3600000) t.setDate(t.getDate() + 1);
  return { ...c, target: t.getTime() };
}

function sameCountdown(a, b) {
  return a.mode === b.mode && a.minutes === b.minutes && a.until === b.until;
}

// A background is '' (use the default), 'builtin:<id>' or 'media:<file>'.
function cleanVerses(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 30))].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

function defaultServiceName(d) {
  return 'Service ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function cleanBg(v) {
  v = String(v || '');
  return /^(builtin:[a-z0-9-]{1,40}|media:[\w.-]{1,80})$/i.test(v) ? v : '';
}

function cleanSlideBgs(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) if (/^\d{1,3}$/.test(k) && cleanBg(v)) out[k] = cleanBg(v);
  }
  return Object.keys(out).length ? out : undefined;
}

// 64×36 black JPEG, used until the control panel sends the first projector picture.
const BLACK_JPEG = '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgUFBcUFxsbGxsbGyAeICEhISAgICAhISEkJCQqKiokJCQhISQkKCgqKi4vLisrKisvLzIyMjw8OTlGRkhWVmf/xABLAAEBAAAAAAAAAAAAAAAAAAAACAEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIACQAQAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJ/AAAAAAAAAAAAAAAAAAAAAAAB//9k=';

function hymnLabel(s) {
  if (!s.number) return s.author || '';
  return `${s.hymnal === 'CH1941' ? 'Church Hymnal' : s.hymnal === 'SDAH' ? 'SDA Hymnal' : 'Hymn'} ${s.number}`;
}

module.exports = { App, hymnLabel };

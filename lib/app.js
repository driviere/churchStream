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
const { Streamer, overlayGeometry, QUALITY, PROGRAM_FILE, hasCamera2 } = require('./stream');
const { atomicWrite } = require('./overlay');
const { SongLibrary, HYMNALS, pickVerses, verseCount } = require('./songs');
const songImport = require('./importers/songs');
const { fitSlides } = require('./fit');
const { Bible } = require('./bible');
const { Projector } = require('./projector');
const hymnals = require('./importers/hymnals');
const { MediaRelay } = require('./media');
const { PhoneCams, newToken } = require('./phonecam');
const { ProgramFeed } = require('./program-feed');
const compositor = require('./compositor');
const { GraphicsFeed } = require('./graphics');
const { sabbathInfo, fillTokens } = require('./sun');
const bibleImport = require('./importers/bible');
const youtube = require('./youtube');
const { YtDownloader } = require('./ytdl');
const { writeZip } = require('./zip');
const { Updater } = require('./updater');
const VERSION = require('./version');
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
    // Phone cameras (a phone's browser sends pictures; see lib/phonecam.js and server.js).
    if (!this.cfg.phoneToken) this.cfg = config.update({ phoneToken: newToken() });
    this.phone = this.ffmpeg ? new PhoneCams({ ffmpegPath: this.ffmpeg.path, workDir: paths.runDir }) : null;
    if (this.phone) this.phone.on('change', () => this.changed());
    // The finished stream picture for browsers (/stream.mjpeg).
    this.feed = new ProgramFeed();
    // The stream page's Preview and multiview pictures (the studio, lib/compositor.js).
    this.studioFeeds = { preview: new ProgramFeed(), multiview: new ProgramFeed() };
    this.streamPages = 0; // stream pages (/stream) open right now
    this.graphics = new GraphicsFeed({ ffmpegPath: this.ffmpeg ? this.ffmpeg.path : null }); // pictures and titles on the stream
    this.streamer = new Streamer({
      getConfig: () => this.cfg,
      runDir: paths.runDir,
      recordingsDir: paths.recordingsDir,
      ffmpeg: this.ffmpeg || { path: 'ffmpeg' },
      getEncoder: () => this.encoder(),
      relay: this.relay,
      phone: this.phone,
      feed: this.feed,
      feeds: this.studioFeeds,
      graphics: this.graphics,
      overlay: this.overlay,
    });
    this.streamer.camera = Math.max(1, Math.min(4, Number(this.cfg.activeCamera) || 1));
    this.streamer.on('camera', (n) => { this.cfg = config.update({ activeCamera: n }); this.changed(); });
    this.phase = null; // { kind: 'start' | 'end', until } while a start or end screen is on the stream
    // YouTube links play in YouTube's own player on the projector (the room); see display.js.
    this.yt = { now: null, music: null };
    this.ytdl = new YtDownloader({ toolsDir: path.join(paths.dataDir, 'tools') });
    this.download = null; // { state: 'working'|'done'|'error', message, percent, title, clip }
    if (this.relay) {
      this.relay.on('change', () => {
        this.streamer.setMediaVisible(!!(this.relay.now && this.relay.now.kind === 'video'));
        this.changed('media');
      });
      this.relay.on('ended', ({ item, error }) => {
        this.logs.push(`media ended: ${item && item.title}${error ? ' — ' + error : ''}`);
        if (error && item && item.id === 'logo') this.logoFailedAt = Date.now(); // don't retry a broken logo video over and over
      });
    }
    this.streamer.on('status', () => {
      // The stream picture stopped: the screens go back to the slides.
      if (this.state && this.state.streamOnScreens && this.streamer.status.mode === 'off' && this.streamer.want === 'off') { this.state.streamOnScreens = false; this.changed(); }
      this.changed('stream');
    });
    this.streamer.on('meter', (v) => this.emit('meter', v));
    this.streamer.on('levels', (v) => this.emit('levels', v));
    this.logs = [];
    this.streamer.on('log', (l) => { this.logs.push(l); if (this.logs.length > 200) this.logs.shift(); });
    setTimeout(() => this.prefetchMedia(this.state && this.state.plan && this.state.plan.items), 2000);

    // Updates (lib/updater.js): checked by themselves, shown to everyone, installed on a click.
    this.updater = new Updater({ version: VERSION, dataDir: paths.dataDir, ffmpegId: () => (this.ffmpeg && this.ffmpeg.id) || null,
      isBusy: () => this.streamer.status.mode === 'live', enabled: () => this.cfg.checkUpdates !== false });
    this.updateHidden = false; // "Later": hidden until ChurchStream starts again
    this.updater.on('change', (st) => {
      if (st.available && st.available.version !== this.announcedUpdate) {
        this.announcedUpdate = st.available.version;
        console.log(`  Update available: ChurchStream ${st.available.version} (open the control panel to update).`);
      }
      this.changed();
    });
    // Packaged ChurchStream only (in development the code comes from git).
    if (paths.isSea || process.env.CHURCHSTREAM_UPDATE_URL) this.updater.start();

    setInterval(() => { if (this.cfg.location && this.cfg.location.lat !== null) this.changed('clock'); }, 60000).unref();
    this.state = {
      live: null,                 // { item, index }
      black: false,
      clear: false,
      logo: false,
      streamOnScreens: false,     // the projector shows the live stream picture (/stream.mjpeg)
      gfx: { 1: { on: false, label: '' }, 2: { on: false, label: '' } }, // the stream page's graphics channels (pictures, titles)
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
  // Called from timers and events too, so a problem here is logged rather than stopping
  // ChurchStream in the middle of a service.
  changed(what = 'state') {
    try {
      if (what !== 'stream') this.syncOverlay();
    } catch (err) { this.logError('overlay', err); }
    if (this.relay) this.relay.ducked = !!this.yt.now; // stream music steps aside for a YouTube video too
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => {
      try { this.emit('state', this.snapshot()); } catch (err) { this.logError('state', err); }
    }, 15);
  }

  logError(where, err) {
    const line = `${new Date().toISOString()} ${where}: ${err && err.message ? err.message : err}`;
    if (Array.isArray(this.logs)) { this.logs.push(line); if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500); }
    console.error(line);
  }

  snapshot() {
    return {
      ...this.state,
      stream: { ...this.streamer.status, phase: this.phase ? { kind: this.phase.kind, until: this.phase.until } : null },
      streamPageOpen: this.streamPages > 0,
      studioOn: this.streamer.studioOn(),
      studioSupported: !!(this.ffmpeg && this.ffmpeg.zmq),
      config: config.publicView(this.cfg),
      library: { songs: this.songs.counts(), hymnals: HYMNALS, translations: this.bible.list() },
      ffmpeg: this.ffmpeg ? { ok: true, version: this.ffmpeg.version } : { ok: false },
      media: this.mediaStatus(),
      phoneCams: this.phone ? Object.fromEntries([1, 2, 3, 4].map((n) => [n, this.phone.connected(n)])) : null,
      download: this.download,
      version: VERSION,
      update: { ...this.updater.status(), hidden: this.updateHidden, canInstall: paths.isSea || !!process.env.CHURCHSTREAM_UPDATE_URL },
      sabbath: this.sabbath(),
      platform: process.platform,
      now: Date.now(),
    };
  }

  // What the stream overlays should show right now.
  // A video logo plays on the stream's video layer while Logo is on (silently, repeating).
  syncLogoVideo() {
    if (!this.relay) return;
    const theme = this.cfg.theme || {};
    const want = this.state.logo && /\.(mp4|m4v|mov|webm)$/i.test(theme.logo || '') && fs.existsSync(path.join(paths.mediaDir, theme.logo));
    const playing = this.relay.now && this.relay.now.id === 'logo';
    if (want && !playing && !(this.relay.now && this.relay.now.id !== 'logo') && !(Date.now() - (this.logoFailedAt || 0) < 10000)) {
      try { this.relay.play({ id: 'logo', kind: 'video', path: path.join(paths.mediaDir, theme.logo), title: 'Logo', loop: true, volume: 0, silent: true, cover: theme.logoSize === 'full' }); } catch { /* no FFmpeg */ }
    } else if (!want && playing) this.relay.stop();
  }

  syncOverlay() {
    this.syncLogoVideo();
    const s = this.state;
    const lt = s.lowerThird;
    if (lt.visible && (lt.name || lt.title)) this.overlay.setLowerThird(lt.name, lt.title);
    else this.overlay.setLowerThird('', '');
    const tk = s.ticker;
    this.overlay.setTicker(tk.visible && tk.text ? fillTokens(tk.text, this.sabbath()) : '');
    const slide = s.live && s.live.item.slides[s.live.index];
    const scene = this.effectiveScene();
    let overCamera = scene === 'camera';
    if (this.streamer.studioOn()) {
      this.syncStudio(scene);
      const st = this.streamer.studio;
      const onAir = st.scenes[st.live];
      overCamera = !!onAir && !onAir.layers.some((l) => l.source === 'slides' || l.source === 'media');
    } else this.streamer.setScene(scene);
    // Words along the bottom only make sense over the camera; the slides already show them.
    const showCaption = overCamera && this.cfg.streamCaptions && slide && !s.black && !s.clear && !s.logo && !lt.visible;
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

  // The studio follows the control panel's simple switches (Camera 1/2, Stream shows, Auto)
  // while no stream page is open. With a stream page open, its operator chooses the scenes;
  // only the start and end screens still take over the stream (and give it back afterwards).
  syncStudio(view) {
    const st = this.streamer.studio;
    if (this.phase) {
      if (!this.phaseScene) {
        const back = st.scenes[st.live] || compositor.simpleScene(this.cfg, 'camera', this.cfg.activeCamera);
        // The studio may be busy (a transition, the T-bar held): try again shortly.
        if (this.streamer.studioShow(compositor.simpleScene(this.cfg, 'slides'), 'cut')) this.phaseScene = back;
        else this.retryStudio();
      }
      return;
    }
    if (this.phaseScene) {
      const back = this.phaseScene;
      this.phaseScene = null;
      if (this.streamPages > 0) { this.streamer.studioShow(back, 'fade', 600); return; }
      this.simpleKey = null;
    }
    const key = `${view}:${this.cfg.activeCamera}`;
    if (this.streamPages > 0 && this.simpleKey) { this.simpleKey = key; return; }
    if (key === this.simpleKey) return;
    if (this.streamer.studioShow(compositor.simpleScene(this.cfg, view, this.cfg.activeCamera || 1), 'cut')) this.simpleKey = key;
    else this.retryStudio();
  }

  retryStudio() {
    clearTimeout(this.studioRetry);
    this.studioRetry = setTimeout(() => this.changed(), 500);
  }

  // --- the studio (the stream page) -------------------------------------------------------------
  studioInfo() {
    const cfg = this.cfg;
    const st = this.streamer.studio;
    const ids = compositor.sourceIds(cfg, { media: !!this.relay });
    return {
      available: this.streamer.studioOn(),
      settings: cfg.studio,
      scenes: compositor.allScenes(cfg),
      sources: [...ids, 'black'].map((id) => ({ id, name: compositor.sourceName(cfg, id) })),
      tiles: ids, // the multiview picture: these sources, 4 across
      size: this.gfxSize(), // graphics are drawn at this size
      state: st.state(),
      running: !!this.streamer.proc,
    };
  }

  sceneById(id) {
    const sc = compositor.findScene(this.cfg, id) || (id === 'black' ? { id: 'black', name: 'Black', layers: [] } : null);
    if (sc) return sc;
    // A source on its own ("put Camera 3 in Preview" from the multiview).
    const src = compositor.sourceIds(this.cfg, { media: !!this.relay }).find((x) => x === id);
    if (src) return { id: src, name: compositor.sourceName(this.cfg, src), layers: [{ source: src, x: 0, y: 0, w: 1, h: 1 }] };
    throw new Error('That scene no longer exists.');
  }

  studioPreview(id) { this.streamPagesUsed(); this.streamer.studioPreview(this.sceneById(id)); return this.studioInfo().state; }
  studioTake(type, ms) {
    this.streamPagesUsed();
    const t = type || this.cfg.studio.transition.type;
    this.streamer.studioTake(t, ms || this.cfg.studio.transition.ms);
    return this.studioInfo().state;
  }
  studioShow(id, type, ms) {
    this.streamPagesUsed();
    this.streamer.studioShow(this.sceneById(id), type || this.cfg.studio.transition.type, ms || this.cfg.studio.transition.ms);
    return this.studioInfo().state;
  }
  studioTbar(pos) { this.streamPagesUsed(); this.streamer.studioTbar(pos); return this.studioInfo().state; }
  // The stream page took charge: the control panel's switches stop steering the stream.
  streamPagesUsed() { if (!this.simpleKey) this.simpleKey = 'stream-page'; }

  saveScene(scene) {
    const clean = compositor.cleanScene(scene);
    if (!clean) throw new Error('Not a scene');
    const list = (this.cfg.scenes || []).filter((x) => x.id !== clean.id);
    const at = (this.cfg.scenes || []).findIndex((x) => x.id === clean.id);
    list.splice(at < 0 ? list.length : at, 0, clean);
    if (list.length > 60) throw new Error('That is a lot of scenes. Delete some first.');
    this.cfg = config.update({ scenes: list });
    this.streamer.studioRefresh(clean);
    this.changed();
    return { scene: clean };
  }

  deleteScene(id) {
    this.cfg = config.update({ scenes: (this.cfg.scenes || []).filter((x) => x.id !== id) });
    this.changed();
    return { ok: true };
  }

  // --- graphics on the stream page ---------------------------------------------------------
  graphicUpdate(id, patch = {}) {
    const list = (this.cfg.graphics || []).map((g) => (g.id === id ? {
      ...g,
      ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 40) } : {}),
      ...(patch.position !== undefined && ['tr', 'tl', 'br', 'bl', 'lower', 'full'].includes(patch.position) ? { position: patch.position } : {}),
    } : g));
    this.cfg = config.update({ graphics: list });
    this.changed();
    return { ok: true };
  }

  graphicDelete(id) {
    const g = (this.cfg.graphics || []).find((x) => x.id === id);
    if (g) { try { fs.unlinkSync(path.join(paths.mediaDir, g.file)); } catch { /* gone */ } }
    this.cfg = config.update({ graphics: (this.cfg.graphics || []).filter((x) => x.id !== id) });
    this.changed();
    return { ok: true };
  }

  // The picture for graphics channel n, drawn by the stream page: a PNG at the stream's size.
  saveGfx(n, buf, label) {
    n = Number(n) === 2 ? 2 : 1;
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Expected a PNG picture');
    atomicWrite(path.join(paths.runDir, `gfx${n}.png`), buf);
    this.state.gfx[n] = { ...this.state.gfx[n], label: String(label || '').slice(0, 80) };
    this.changed();
    return { ok: true };
  }

  // A graphics channel (1 picture, 2 title) on or off. The layer shows the ones that are on,
  // the title on top; with none on, the layer is switched off.
  async showGfx(n, on) {
    n = Number(n) === 2 ? 2 : 1;
    this.state.gfx[n] = { ...this.state.gfx[n], on: !!on };
    const files = [1, 2].filter((k) => this.state.gfx[k].on).map((k) => path.join(paths.runDir, `gfx${k}.png`));
    if (!files.length) this.streamer.gfxShow(false); // off at once
    try {
      await this.graphics.show(files);
    } catch (err) {
      // Not on the stream after all: don't show it as on.
      if (on) this.state.gfx[n] = { ...this.state.gfx[n], on: false };
      this.changed();
      throw new Error(`The picture couldn't be put on the stream (${err.message}). Try again.`);
    }
    if (files.length) this.streamer.gfxShow(true); // on once the picture is ready
    this.changed();
    return { ok: true };
  }

  // The size graphics are drawn at: the size the stream picture is built at.
  gfxSize() {
    const q = this.streamer.composeQ || compositor.composeSize(this.cfg);
    return { width: q.width, height: q.height };
  }

  // The sound mixer on the stream page: { gain (0–4, 1 = as it comes), mute }.
  setAudioMix(id, patch = {}) {
    if (!['mic', 'media', 'mic2', 'master'].includes(id)) throw new Error('Unknown sound source');
    const cur = (this.cfg.audioMix && this.cfg.audioMix[id]) || { gain: 1, mute: false };
    const next = {
      gain: patch.gain !== undefined ? Math.max(0, Math.min(4, Number(patch.gain) || 0)) : cur.gain,
      mute: patch.mute !== undefined ? !!patch.mute : cur.mute,
    };
    this.cfg = config.update({ audioMix: { [id]: next } });
    this.streamer.audioLevel(id, next.mute ? 0 : next.gain);
    this.changed();
    return next;
  }

  setStreamPages(n) {
    this.streamPages = Math.max(0, n);
    // The control panel's switches take over again from their next change (not at once: a
    // stream page that is only reloading must not make the stream jump).
    if (!this.streamPages && this.simpleKey) this.simpleKey = `${this.effectiveScene()}:${this.cfg.activeCamera}`;
    this.changed();
  }

  // 'auto' shows the slides with a camera inset while words are on screen, the camera otherwise.
  effectiveScene() {
    if (this.phase) return 'slides'; // the start/end screen fills the stream
    const want = this.cfg.streamScene || 'camera';
    if (want !== 'auto') return want;
    const s = this.state;
    const words = s.live && s.live.item.slides[s.live.index] && !s.black && !s.clear && !s.logo;
    return words ? 'pip' : 'camera';
  }

  saveProgramImage(buf, key, at = 0) {
    if (!buf || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Expected a JPEG image');
    if (key && key === this.programKey) return false;
    // Drawn from an older state than the picture already used: it arrived late, keep the newer one.
    at = Number(at) || 0;
    if (at && this.programAt && at < this.programAt) return false;
    if (at) this.programAt = at;
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
        part: ['leader', 'people', 'all'].includes(sl.part) ? sl.part : undefined, src: Number.isInteger(sl.src) ? sl.src : undefined })),
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
    // Words that don't fit at the smallest text size continue on the next slide. (Slides that
    // already fit are unchanged, so showing an item again keeps its slides.) The index the
    // caller asked for is the slide before splitting.
    const f = this.fit(clean.slides, clean.kind);
    if (f.slides.length !== clean.slides.length) {
      const at = f.orig.indexOf(Math.max(0, Math.min(index, clean.slides.length - 1)));
      clean.slides = f.slides;
      index = at < 0 ? 0 : at;
    }
    this.state.live = { item: clean, index: Math.max(0, Math.min(index, clean.slides.length - 1)) };
    this.state.clear = false;
    this.state.logo = false;
    this.scheduleAuto();
    // A video/music item plays as soon as it goes on screen; anything else stops it.
    const playing = this.relay && this.relay.now;
    if (clean.kind === 'media') {
      const current = clean.media.type === 'youtube' ? this.yt.now : playing;
      if (!current || current.id !== clean.key) {
        // A missing file: the item is still shown (with its title), and the volunteer is told why.
        try { this.playMedia(clean); } catch (err) { this.changed(); throw err; }
      }
    } else {
      if (playing) this.relay.stop();
      this.yt.now = null;
    }
    this.changed();
    return this.state.live;
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

  // Play a video / music item, from the start or from `at` seconds in.
  playMedia(item, at = null) {
    const m = item.media || {};
    if (m.type === 'youtube') {
      if (this.relay && this.relay.now) this.relay.stop();
      const from = at != null ? at : (m.youtube.start || 0);
      this.yt.now = { id: item.key, kind: 'youtube', title: item.title, youtube: m.youtube, loop: !!m.loop, volume: Math.min(1, m.volume ?? 1),
        startedAt: Date.now() - from * 1000, run: Date.now(), paused: false, duration: m.duration || 0 };
      return;
    }
    this.yt.now = null;
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    let file;
    try { file = this.mediaPath(m.file); } catch { file = ''; }
    if (!file || !fs.existsSync(file)) throw new Error(`“${item.title}” isn't on this computer any more. Remove it from the order of service and add the file again with + Add → Video, music or YouTube.`);
    this.relay.play({ id: item.key, kind: m.type === 'audio' ? 'audio' : 'video', path: file, title: item.title, loop: !!m.loop,
      volume: this.streamVolume(m.volume ?? 1), roomVolume: m.volume ?? 1, seek: at || 0 });
  }

  // With the sound desk sending the room's sound to the stream, the stream itself adds none
  // (it would be heard twice); the room (projector computer) still plays at the chosen volume.
  streamVolume(v) { return this.cfg.mediaSound === 'desk' ? 0 : v; }
  setMediaVolume(v) {
    if (!this.relay || !this.relay.now) return;
    this.relay.now.roomVolume = Math.max(0, Math.min(1.5, Number(v)));
    this.relay.setVolume(this.streamVolume(Number(v)));
  }

  // Jump to `at` seconds in the video / music item on screen (starting it if it isn't playing).
  seekMedia(at) {
    const live = this.state.live && this.state.live.item;
    if (!live || live.kind !== 'media') throw new Error('Show the video or music first.');
    const y = this.yt.now;
    const dur = (y && y.id === live.key && y.duration) || live.media.duration || 0;
    at = Math.max(0, Number(at) || 0);
    if (dur) at = Math.min(at, Math.max(0, dur - 0.5));
    if (live.media.type === 'youtube') {
      if (y && y.id === live.key) y.startedAt = (y.paused ? y.pausedAt : Date.now()) - at * 1000;
      else this.playMedia(live, at);
      return;
    }
    const now = this.relay && this.relay.now;
    if (now && now.id === live.key) this.relay.play({ ...now, seek: at });
    else this.playMedia(live, at);
  }

  mediaControl({ action, volume, at }) {
    if (action === 'seek') { this.seekMedia(at); this.changed('media'); return; }
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
    if (volume !== undefined) this.setMediaVolume(volume);
    this.changed('media');
  }

  // Change a video's or music item's settings after it was added: repeat, play in the room,
  // volume, and (YouTube) where it starts. Saved in the order of service, and applied to the
  // item on screen and to the clip playing now.
  mediaSettings(key, patch = {}) {
    const p = {};
    if (patch.loop !== undefined) p.loop = !!patch.loop;
    if (patch.room !== undefined) p.room = !!patch.room;
    if (patch.volume !== undefined) p.volume = Number(patch.volume);
    if (patch.start !== undefined) p.start = Math.max(0, Math.round(Number(patch.start) || 0));
    const apply = (m) => {
      const next = { ...m, ...p };
      if (m.type === 'youtube' && p.start !== undefined) next.youtube = { ...m.youtube, start: p.start };
      delete next.start;
      return cleanMedia(next);
    };
    let found = false;
    const items = this.state.plan.items.map((it) => {
      if (it.uid !== key || it.kind !== 'media') return it;
      found = true;
      return { ...it, media: apply(it.media || {}) };
    });
    if (found) this.setPlan(items);
    const live = this.state.live && this.state.live.item;
    if (live && live.key === key && live.kind === 'media') {
      live.media = apply(live.media || {});
      found = true;
      // The clip playing now.
      const now = this.relay && this.relay.now;
      if (now && now.id === key) {
        if (p.volume !== undefined) this.setMediaVolume(p.volume);
        if (p.loop !== undefined && p.loop !== !!now.loop) {
          // Restart from the same place with (or without) repeating.
          const dur = live.media.duration || 0;
          const at = (Date.now() - now.startedAt) / 1000;
          this.relay.play({ ...now, loop: p.loop, seek: dur ? at % dur : at });
        }
      }
      const y = this.yt.now;
      if (y && y.id === key) {
        if (p.loop !== undefined) y.loop = p.loop;
        if (p.volume !== undefined) y.volume = Math.max(0, Math.min(1, p.volume));
      }
    }
    if (!found) throw new Error('That video is no longer in the order of service.');
    this.changed();
    return { ok: true };
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
      const v = Number(volume ?? this.cfg.musicVolume ?? 0.4);
      this.relay.playMusic(paths_, this.streamVolume(v));
      if (this.relay.music) this.relay.music.roomVolume = v;
      this.updateConfig({ musicFiles: files });
    } else if (action === 'stop') this.relay.stopMusic();
    if (volume !== undefined && action !== 'play') {
      this.relay.setMusicVolume(this.streamVolume(Number(volume)));
      if (this.relay.music) this.relay.music.roomVolume = Math.max(0, Math.min(1, Number(volume)));
      this.updateConfig({ musicVolume: Number(volume) });
    }
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
      req.on('data', (c) => { size += c.length; if (size > 4 * 1024 ** 3) req.destroy(new Error('File is larger than 4 GB.')); });
      // pipeline closes the file however the upload ends (finished, too big, or the browser gave up).
      require('stream').pipeline(req, fs.createWriteStream(dest), (err) => (err ? reject(err.code === 'ERR_STREAM_PREMATURE_CLOSE' ? new Error('The upload stopped before the end. Try again.') : err) : resolve()));
    }).catch((err) => { try { fs.unlinkSync(dest); } catch { /* none */ } throw err; });
    if (this.relay && this.relay.probe) this.relay.probe(dest);
    return this.addClip({ file, type: kinds[ext], name: String(name).replace(/\.[^.]+$/, ''), duration: await this.probeDuration(dest) });
  }

  // Look at the clips in the order of service in the background, so putting one on screen
  // doesn't make ChurchStream wait while FFmpeg reads the file.
  prefetchMedia(items) {
    if (!this.relay || !this.relay.probe) return;
    for (const it of items || []) {
      if (it.kind !== 'media' || !it.media || it.media.type === 'youtube') continue;
      try { this.relay.probe(this.mediaPath(it.media.file)); } catch { /* not a clip */ }
    }
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
        // Cancelled on purpose: just clear it, it isn't a problem to report.
        if (err.message === 'Download cancelled.') { this.download = null; this.changed('media'); return; }
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
    // A file too big to open on the other computer (imports take up to 1 GB) is refused here,
    // with a way out, rather than saved and found unusable later.
    const total = files.reduce((n, f) => { try { return n + fs.statSync(path.join(paths.mediaDir, f)).size; } catch { return n; } }, 0);
    if (total > 1000 * 1024 * 1024) throw new Error(`The videos and music in this service add up to ${(total / 1024 ** 3).toFixed(1)} GB, too large for one service file. Save it without videos and music, and copy the video files separately.`);
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
    if (!['black', 'clear', 'logo', 'streamOnScreens'].includes(name)) throw new Error('Unknown toggle');
    this.state[name] = value === undefined ? !this.state[name] : !!value;
    if (this.state[name] && name !== 'clear') for (const k of ['black', 'logo', 'streamOnScreens']) if (k !== name) this.state[k] = false;
    // The stream picture needs FFmpeg running: start the camera preview if nothing is running.
    if (name === 'streamOnScreens' && this.state[name] && this.streamer.status.mode === 'off' && this.ffmpeg) this.streamer.start('preview').catch(() => {});
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
    this.prefetchMedia(this.state.plan.items);
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
    const withBg = r.slides.map((sl, i) => ({ ...sl, background: per[i] || '' }));
    // Too many words for one screen at the smallest text size: continue on the next slide.
    // Each part remembers the slide it came from (src), e.g. for per-slide backgrounds.
    const f = this.fit(withBg, r.kind);
    return { ...r, background: it.background || '', slides: f.slides.map((sl, j) => ({ ...sl, src: f.orig[j] })) };
  }

  bibleOpts() { return { versesPerSlide: this.cfg.bible.versesPerSlide === 0 ? 0 : 1 }; }

  fit(slides, kind) { return fitSlides(slides, { kind, theme: this.cfg.theme }); }

  refitLive() {
    const live = this.state.live;
    if (!live || ['images', 'media', 'countdown'].includes(live.item.kind)) return;
    const planIt = this.state.plan.items.find((x) => x.uid === live.item.key);
    const fresh = planIt && this.resolvePlanItem(planIt);
    if (fresh) {
      // Keep the place: the first part of the slide that was on screen.
      const cur = live.item.slides[live.index];
      let at;
      if (live.item.kind === 'bible' && cur && cur.verses && cur.verses.length) {
        // Bible: the same verse (the grouping may have changed), in the same chapter.
        const chapter = (ref) => String(ref || '').replace(/:\d.*$/, '');
        at = fresh.slides.findIndex((sl) => chapter(sl.ref) === chapter(cur.ref) && (sl.verses || []).some((v) => v.n === cur.verses[0].n));
      } else {
        at = cur && cur.src != null ? fresh.slides.findIndex((sl) => sl.src === cur.src) : 0;
      }
      at = Math.max(0, at);
      live.item = { ...live.item, slides: fresh.slides };
      live.index = Math.min(at, fresh.slides.length - 1);
    } else {
      const f = this.fit(live.item.slides, live.item.kind);
      live.index = Math.max(0, f.orig.indexOf(live.index));
      live.item = { ...live.item, slides: f.slides };
    }
  }

  resolvePlanItemContent(it) {
    if (it.kind === 'song') {
      const s = this.songs.get(it.songId);
      if (!s) return s;
      const verses = cleanVerses(it.verses);
      return { key: it.uid, kind: 'song', title: s.title, subtitle: hymnLabel(s), slides: pickVerses(s.slides, verses), songId: s.id, verses, verseCount: verseCount(s.slides) };
    }
    if (it.kind === 'bible') {
      const r = this.bible.lookup(it.ref, it.translation || this.cfg.bible.translation, this.bibleOpts());
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
    const bible = this.bible.lookup(q, this.cfg.bible.translation, this.bibleOpts());
    return {
      bible: bible.slides ? { ref: bible.ref, title: bible.title, translation: bible.translation, slides: this.fit(bible.slides, 'bible').slides } : null,
      books: bible.slides ? [] : this.bible.suggest(q),
      songs: this.songs.search(q, { limit: 25, defaultHymnal: this.cfg.hymnal.default }),
    };
  }

  // ---- streaming ---------------------------------------------------------------------
  async startStream(mode, opts = {}) {
    if (!this.ffmpeg) throw new Error(process.platform === 'win32' ? 'FFmpeg was not found. Put ffmpeg.exe in the "ffmpeg" folder next to ChurchStream.exe.' : 'FFmpeg was not found. Put ffmpeg in the "ffmpeg" folder next to ChurchStream (or install it with Homebrew: brew install ffmpeg).');
    this.syncOverlay();
    const wasLive = this.streamer.status.mode === 'live';
    // Going live again cancels a pending end screen (it would otherwise end this stream too).
    if (this.phase && this.phase.kind === 'end') this.setPhase(null);
    // Already running in this mode (e.g. "Go live" on a second device): don't restart FFmpeg,
    // which would drop YouTube/Facebook for a moment and split the recording.
    if (this.streamer.status.mode === mode && this.streamer.want === mode && this.streamer.proc) return;
    if (mode === 'live' && !wasLive && opts.startScreen) this.beginStartScreen();
    await this.streamer.start(mode);
  }

  // "Starting soon": a countdown fills the stream (and the screens) until the service begins,
  // then the stream goes back to the view chosen in "Stream shows".
  beginStartScreen() {
    const st = this.cfg.startScreen || {};
    const minutes = Math.max(1, Math.min(60, Math.round(Number(st.minutes) || 5)));
    this.showItem({ key: 'start-screen', kind: 'countdown', title: 'Starting soon', slides: [{ label: '', text: '' }],
      countdown: { mode: 'minutes', minutes, message: st.message || 'Our service begins in', endText: 'Welcome!' } });
    this.setPhase('start', this.state.live.item.countdown.target);
  }

  setPhase(kind, until) {
    clearTimeout(this.phaseTimer);
    this.phase = kind ? { kind, until } : null;
    if (kind) {
      this.phaseTimer = setTimeout(() => {
        const was = this.phase;
        this.phase = null;
        if (was && was.kind === 'end') this.streamer.stop().then(() => this.changed('stream')).catch(() => {});
        this.changed();
      }, Math.max(0, until - Date.now()));
    }
    this.changed();
  }

  // Start the service now, ending the start screen early.
  skipStartScreen() { if (this.phase && this.phase.kind === 'start') this.setPhase(null); }

  // End the stream. With the end screen: "Thank you for watching" fills the stream for a few
  // seconds first. Asking again (or now: true) ends it straight away.
  async stopStream(opts = {}) {
    const live = this.streamer.status.mode === 'live';
    if (live && opts.endScreen && !opts.now && !(this.phase && this.phase.kind === 'end')) {
      const es = this.cfg.endScreen || {};
      const secs = Math.max(5, Math.min(300, Math.round(Number(es.seconds) || 30)));
      const text = String(es.text || 'Thank you for worshipping with us').trim();
      this.showItem({ key: 'end-screen', kind: 'text', title: 'Thank you', slides: [{ label: '', text: this.cfg.churchName ? `${text}\n\n${this.cfg.churchName}` : text }] });
      this.setPhase('end', Date.now() + secs * 1000);
      return { ending: secs };
    }
    this.setPhase(null);
    await this.streamer.stop();
    return { ok: true };
  }

  // Camera 1 or 2 on air.
  setCamera(n) {
    n = Math.round(Number(n)) || 1;
    if (this.streamer.studioOn()) {
      if (!compositor.cameraNumbers(this.cfg).includes(n)) throw new Error(`Set up camera ${n} in Settings → Camera & sound first.`);
    } else {
      n = n === 2 ? 2 : 1;
      if (n === 2 && !hasCamera2(this.cfg)) throw new Error('Set up a second camera in Settings → Camera & sound first.');
    }
    this.cfg = config.update({ activeCamera: n });
    this.streamer.setCamera(n);
    this.changed();
    return { camera: n };
  }

  // ---- settings ----------------------------------------------------------------------
  updateConfig(patch) {
    patch = JSON.parse(JSON.stringify(patch || {}));
    // Masked values coming back from the browser mean "unchanged".
    for (const k of ['youtube', 'facebook']) if (patch.outputs?.[k]?.key?.startsWith?.('••••')) delete patch.outputs[k].key;
    if (patch.outputs?.custom?.url?.startsWith?.('••••')) delete patch.outputs.custom.url;
    if (patch.controlPassword === '••••') delete patch.controlPassword;
    for (const k of ['youtube', 'facebook']) if (patch.outputs?.[k]?.key) patch.outputs[k].key = String(patch.outputs[k].key).trim();
    if (patch.lowerThirdPresets) patch.lowerThirdPresets = patch.lowerThirdPresets.slice(0, 30);
    const before = JSON.stringify([this.cfg.video, this.cfg.video2, this.cfg.video3, this.cfg.video4, this.cfg.audio, this.cfg.audio2, this.cfg.quality, this.cfg.studioEnabled]);
    this.cfg = config.update(patch);
    if (patch.ffmpegPath !== undefined) { this.ffmpeg = ffmpegLib.locate(this.cfg.ffmpegPath); this.encoderPromise = null; if (this.ffmpeg) {
      this.streamer.ffmpeg = this.ffmpeg;
      this.graphics.ffmpegPath = this.ffmpeg.path;
      if (this.relay) { this.relay.ffmpegPath = this.ffmpeg.path; this.relay.infoCache = new Map(); }
      if (this.phone) this.phone.ffmpegPath = this.ffmpeg.path;
    } }
    if (patch.encoder !== undefined) this.encoderPromise = null;
    if (patch.video2 !== undefined || patch.video3 !== undefined || patch.video4 !== undefined) this.streamer.camerasReset(); // a changed camera is tried again
    // A new smallest text size: prepare the item on screen again (split more, or less).
    if ((patch.theme && (patch.theme.minText !== undefined || patch.theme.overflow !== undefined)) || (patch.bible && patch.bible.versesPerSlide !== undefined)) this.refitLive();
    // No second camera any more: camera 1 goes back on air.
    if (!compositor.cameraNumbers(this.cfg).includes(this.cfg.activeCamera || 1) || (!this.streamer.studioOn() && !hasCamera2(this.cfg) && this.cfg.activeCamera === 2)) { this.cfg = config.update({ activeCamera: 1 }); this.streamer.setCamera(1); }
    // Restart a running preview so camera/mic changes take effect immediately.
    if (this.streamer.status.mode === 'preview' && before !== JSON.stringify([this.cfg.video, this.cfg.video2, this.cfg.video3, this.cfg.video4, this.cfg.audio, this.cfg.audio2, this.cfg.quality, this.cfg.studioEnabled])) {
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

  // Songs from a file (Import songs…). book: a songbook code to file them under (e.g. 'AY'),
  // '' to keep each song's own, or 'own' for plain songs. Songs you've edited are kept.
  checkSongFile(name, buf) {
    const r = songImport.parseSongFile(name, buf);
    const nums = r.songs.map((x) => x.number).filter(Boolean);
    return { format: r.format, count: r.songs.length, book: r.book, from: nums.length ? Math.min(...nums) : null, to: nums.length ? Math.max(...nums) : null,
      numbered: nums.length, titles: r.songs.slice(0, 3).map((x) => (x.number ? x.number + '. ' : '') + x.title) };
  }

  importSongFile(name, buf, { book = '' } = {}) {
    const r = songImport.parseSongFile(name, buf);
    const code = book === 'own' ? '' : String(book || (r.book && r.book.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    let added = 0; let replaced = 0; let kept = 0;
    for (const sg of r.songs) {
      if (!sg.sections || !sg.sections.length) continue;
      const hymnal = book === 'own' ? '' : code || sg.hymnal || '';
      const number = hymnal ? sg.number || null : null;
      let existing = hymnal && number ? this.songs.byNumber(hymnal, number) : null;
      if (!existing && !hymnal) {
        const t = String(sg.title || '').toLowerCase().trim();
        existing = [...this.songs.songs.values()].find((x) => !x.hymnal && x.title.toLowerCase().trim() === t) || null;
      }
      if (existing && existing.edited) { kept++; continue; }
      this.songs.save({ title: sg.title, author: sg.author, copyright: sg.copyright, ccli: sg.ccli, sections: sg.sections, hymnal, number, id: existing ? existing.id : undefined });
      if (existing) replaced++; else added++;
    }
    this.changed();
    return { ok: true, added, replaced, kept, book: code || null };
  }

  // A .churchsongs file of one songbook ('own' = songs not in a hymnal).
  exportSongs(book) {
    const songs = this.songs.list(book);
    if (!songs.length) throw new Error('There are no songs to save.');
    const name = book === 'own' ? 'Our songs' : HYMNALS[book] || book;
    return { name, buffer: songImport.writeChurchSongs(songs, book === 'own' ? null : { code: book, name }) };
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

  saveMedia(kind, buf, contentType, label = '') {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[contentType];
    if (!ext) throw new Error('Please choose a PNG, JPG, WebP or SVG image.');
    if (!['background', 'logo', 'slide', 'graphic'].includes(kind)) throw new Error('Unknown image type');
    if (kind === 'graphic') {
      // A picture for the stream page's graphics (a logo in the corner, a QR code, a flyer).
      if (ext === 'svg') throw new Error('Please choose a PNG, JPG or WebP picture.');
      const id = 'g' + Date.now().toString(36);
      const name = `gfx-${id}.${ext}`;
      fs.writeFileSync(path.join(paths.mediaDir, name), buf);
      const list = [...(this.cfg.graphics || []), { id, name: (label || 'Picture').slice(0, 40), file: name, position: 'tr' }].slice(-40);
      this.cfg = config.update({ graphics: list });
      this.changed();
      return name;
    }
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

  // A picture from a phone camera page. The token is the secret part of its address.
  phoneFrame(cam, token, buf) {
    if (!this.phone) throw new Error('Phone cameras need FFmpeg.');
    if (!token || token !== this.cfg.phoneToken) { const e = new Error('This camera address is out of date. Scan the QR code again.'); e.status = 403; throw e; }
    const n = Math.max(1, Math.min(4, Math.round(Number(cam)) || 1));
    this.phone.frame(n, buf);
    const v = this.cfg[compositor.CAMERA_KEYS[n - 1]];
    return { ok: true, onAir: !!v && v.type === 'phone', camera: n };
  }

  // New phone camera address: phones using the old QR code stop sending.
  renewPhoneToken() {
    this.cfg = config.update({ phoneToken: newToken() });
    this.changed();
    return { token: this.cfg.phoneToken };
  }

  // ---- updates -------------------------------------------------------------------------
  async updateCheck() { this.updateHidden = false; return this.updater.check(); }
  updateLater() { this.updateHidden = true; this.changed(); }
  async updateInstall() {
    const st = await this.updater.install();
    this.changed();
    return st;
  }

  shutdown() {
    this.updater.stop();
    this.projector.close();
    if (this.relay) this.relay.close();
    if (this.phone) this.phone.close();
    this.feed.close();
    this.graphics.close();
    for (const f of Object.values(this.studioFeeds)) f.close();
    // 'q' lets FFmpeg finish the recording file (Streamer.kill force-stops it after 4 s).
    return this.streamer.kill();
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
  return `${s.hymnal === 'CH1941' ? 'Church Hymnal' : s.hymnal === 'SDAH' ? 'SDA Hymnal' : s.hymnal === 'AY' ? 'AY Sing' : 'Hymn'} ${s.number}`;
}

module.exports = { App, hymnLabel };

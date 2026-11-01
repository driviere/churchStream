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
const { SongLibrary, HYMNALS } = require('./songs');
const { Bible } = require('./bible');
const { Projector } = require('./projector');
const hymnals = require('./importers/hymnals');
const { MediaRelay } = require('./media');
const bibleImport = require('./importers/bible');

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
    this.relay = this.ffmpeg ? new MediaRelay({ ffmpegPath: this.ffmpeg.path }) : null;
    this.streamer = new Streamer({
      getConfig: () => this.cfg,
      runDir: paths.runDir,
      recordingsDir: paths.recordingsDir,
      ffmpeg: this.ffmpeg || { path: 'ffmpeg' },
      getEncoder: () => this.encoder(),
      relay: this.relay,
    });
    if (this.relay) {
      this.relay.on('change', () => {
        this.streamer.setMediaVisible(!!(this.relay.now && this.relay.now.kind === 'video'));
        this.changed('media');
      });
      this.relay.on('ended', ({ error }) => { if (error) this.logs.push('media: ' + error); });
    }
    this.streamer.on('status', () => this.changed('stream'));
    this.streamer.on('meter', (v) => this.emit('meter', v));
    this.logs = [];
    this.streamer.on('log', (l) => { this.logs.push(l); if (this.logs.length > 200) this.logs.shift(); });

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
      media: this.relay ? this.relay.status() : { now: null, music: null },
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
    this.overlay.setTicker(tk.visible && tk.text ? tk.text : '');
    const slide = s.live && s.live.item.slides[s.live.index];
    const scene = this.effectiveScene();
    this.streamer.setScene(scene);
    // Words along the bottom only make sense over the camera; the slides already show them.
    const showCaption = scene === 'camera' && this.cfg.streamCaptions && slide && !s.black && !s.clear && !s.logo && !lt.visible;
    const q = QUALITY[this.cfg.quality] || QUALITY.good;
    this.overlay.setCaption(showCaption ? captionText(slide, { maxChars: overlayGeometry(q).captionMaxChars }) : '');
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
      slides: item.slides.map((sl) => ({ label: sl.label || '', text: String(sl.text || ''), ref: sl.ref || '', verses: sl.verses || null, background: cleanBg(sl.background), image: cleanBg(sl.image) || undefined })),
    };
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
      if (!playing || playing.id !== clean.key) this.playMedia(clean);
    } else if (playing) this.relay.stop();
    this.changed();
  }

  // ---- videos & music ----------------------------------------------------------------
  mediaPath(id) {
    const file = String(id || '').replace(/^media:/, '');
    if (!/^clip-[\w-]+\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac)$/i.test(file)) throw new Error('Unknown media file');
    return path.join(paths.mediaDir, file);
  }

  playMedia(item) {
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    const m = item.media || {};
    this.relay.play({ id: item.key, kind: m.type === 'audio' ? 'audio' : 'video', path: this.mediaPath(m.file), title: item.title, loop: !!m.loop,
      volume: this.cfg.mediaSound === 'desk' ? 0 : (m.volume ?? 1) });
  }

  mediaControl({ action, volume }) {
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    const live = this.state.live && this.state.live.item;
    if (action === 'stop') this.relay.stop();
    else if (action === 'play' || action === 'restart') { if (live && live.kind === 'media') this.playMedia(live); }
    if (volume !== undefined) this.relay.setVolume(Number(volume));
    this.changed('media');
  }

  musicControl({ action, files, volume }) {
    if (!this.relay) throw new Error('FFmpeg is needed to play videos and music.');
    if (action === 'play') {
      const paths_ = (files || []).map((f) => this.mediaPath(f));
      if (!paths_.length) throw new Error('Choose at least one music file.');
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
    const info = { id: 'media:' + file, file, type: kinds[ext], name: String(name).replace(/\.[^.]+$/, ''), duration: await this.probeDuration(dest) };
    const lib = this.mediaLibrary().filter((x) => x.file !== file);
    lib.unshift(info);
    fs.writeFileSync(path.join(paths.mediaDir, 'clips.json'), JSON.stringify(lib, null, 1));
    this.changed('media');
    return info;
  }

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

  setPlan(items) {
    this.state.plan = {
      items: (items || []).slice(0, 200).map((it) => ({
        uid: it.uid || crypto.randomUUID(),
        kind: it.kind,
        title: String(it.title || ''),
        subtitle: String(it.subtitle || ''),
        songId: it.songId, ref: it.ref, translation: it.translation,
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

  resolvePlanItem(it) {
    const r = this.resolvePlanItemContent(it);
    if (!r) return r;
    const per = it.slideBackgrounds || {};
    return { ...r, background: it.background || '', slides: r.slides.map((sl, i) => ({ ...sl, background: per[i] || '' })) };
  }

  resolvePlanItemContent(it) {
    if (it.kind === 'song') {
      const s = this.songs.get(it.songId);
      return s && { key: it.uid, kind: 'song', title: s.title, subtitle: hymnLabel(s), slides: s.slides, songId: s.id };
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
    if (!this.ffmpeg) throw new Error('FFmpeg was not found. Put ffmpeg.exe in the "ffmpeg" folder next to ChurchStream.exe.');
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

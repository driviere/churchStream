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

    this.streamer = new Streamer({
      getConfig: () => this.cfg,
      runDir: paths.runDir,
      recordingsDir: paths.recordingsDir,
      ffmpeg: this.ffmpeg || { path: 'ffmpeg' },
      getEncoder: () => this.encoder(),
    });
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
      now: Date.now(),
    };
  }

  // What the stream overlays should show right now.
  syncOverlay() {
    const s = this.state;
    const lt = s.lowerThird;
    if (lt.visible && (lt.name || lt.title)) this.overlay.setLowerThird(lt.name, lt.title);
    else this.overlay.setLowerThird('', '');
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
      slides: item.slides.map((sl) => ({ label: sl.label || '', text: String(sl.text || ''), ref: sl.ref || '', verses: sl.verses || null, background: cleanBg(sl.background) })),
    };
    this.state.live = { item: clean, index: Math.max(0, Math.min(index, clean.slides.length - 1)) };
    this.state.clear = false;
    this.state.logo = false;
    this.changed();
  }

  goTo(index) {
    if (!this.state.live) return;
    const n = this.state.live.item.slides.length;
    this.state.live.index = Math.max(0, Math.min(index, n - 1));
    this.state.clear = false;
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
        slides: it.kind === 'text' ? it.slides : undefined,
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
    if (it.kind === 'text') return { key: it.uid, kind: 'text', title: it.title, subtitle: '', slides: it.slides || [] };
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
    if (!['background', 'logo'].includes(kind)) throw new Error('Unknown image type');
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
    const p = this.streamer.proc;
    if (p) { try { p.stdin.write('q'); } catch { /* ignore */ } setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 1500); }
  }
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

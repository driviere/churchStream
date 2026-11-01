import { connect, fitText, slideHtml, escapeHtml, currentSlide, bgInfo, effectiveBg, countdownParts } from '/shared.js';

const $ = (id) => document.getElementById(id);
const layers = [$('layerA'), $('layerB')];
let front = 0;
let shownKey = null;
let lastBg = null;
let lastLogo = null;
let identifyTimer = null;
let countdown = null;
let lastAnn = null;

function tickCountdown() {
  if (!countdown) return;
  const p = countdownParts(countdown.cd, Date.now() + countdown.skew);
  const el = $('count');
  el.classList.toggle('done', p.done);
  el.children[0].textContent = p.message;
  el.children[1].textContent = p.time;
}
setInterval(tickCountdown, 250);

function syncPlayer(el, media, playing, state, isVideo) {
  if (!media) {
    if (!el.paused) el.pause();
    if (el.dataset.key) { el.removeAttribute('src'); el.load(); el.dataset.key = ''; }
    return;
  }
  const src = '/media/' + encodeURIComponent(media.file.replace(/^media:/, ''));
  const key = src + '|' + playing.startedAt;
  el.muted = isVideo ? !media.room : false;
  el.loop = !!media.loop;
  el.volume = Math.max(0, Math.min(1, playing.volume ?? 1));
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.src = src;
  const startAt = () => {
    const skew = state.now - Date.now();
    let t = Math.max(0, (Date.now() + skew - playing.startedAt) / 1000);
    if (media.loop && el.duration) t %= el.duration;
    if (t > 0.3 && (!el.duration || t < el.duration)) el.currentTime = t;
    el.play().catch(() => {});
  };
  el.addEventListener('loadedmetadata', startAt, { once: true });
}

let musicKey = '';
function syncMusic(state) {
  const el = $('music');
  const m = state.media && state.media.music;
  const files = state.config.musicFiles || [];
  const on = !!(m && !m.youtube && files.length && state.config.musicRoom !== false);
  const key = on ? files.join('|') + '|' + m.startedAt : '';
  el.volume = on ? Math.max(0, Math.min(1, (m.volume ?? 0.4) * (state.media.now ? 0 : 1))) : 0;
  if (key === musicKey) return;
  musicKey = key;
  el.pause();
  if (!on) return;
  let i = 0;
  const next = () => { el.src = '/media/' + encodeURIComponent(files[i % files.length].replace(/^media:/, '')); i++; el.play().catch(() => {}); };
  el.onended = next;
  next();
}
// ---- YouTube: played by YouTube's own embedded player (needs internet) -----------------
let ytApi = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => { resolve(window.YT); if (last) render(last); };
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = () => { ytApi = null; resolve(null); }; // offline: try again next time
      document.head.appendChild(sc);
    });
  }
  return ytApi;
}
const report = (body) => fetch('/api/display/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

class YtSlot {
  constructor(elId, { sync }) { this.elId = elId; this.syncPos = sync; this.player = null; this.ready = false; this.want = null; this.loaded = ''; this.reported = ''; }

  async set(want) {
    this.want = want;
    if (!want && !this.player) return;
    if (!this.player) {
      const YT = await loadYT();
      if (!YT || this.player || !this.want) return;
      this.player = new YT.Player(this.elId, {
        width: '100%', height: '100%', host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, modestbranding: 1 },
        events: { onReady: () => { this.ready = true; this.apply(); }, onStateChange: (e) => this.onState(e) },
      });
      return;
    }
    if (this.ready) this.apply();
  }

  pos(w) { return Math.max(0, ((w.paused ? w.pausedAt : Date.now() + w.skew) - w.startedAt) / 1000); }

  apply() {
    const p = this.player;
    const w = this.want;
    if (!w) { if (this.loaded) { try { p.stopVideo(); } catch { /* */ } this.loaded = ''; } return; }
    const y = w.youtube;
    const key = `${y.id}|${y.list}|${w.startedAt}`;
    if (key !== this.loaded) {
      this.loaded = key;
      if (y.list && (!y.id || !this.syncPos)) { p.loadPlaylist({ list: y.list, listType: 'playlist', index: 0 }); p.setLoop(true); p.setShuffle(false); }
      else p.loadVideoById({ videoId: y.id, startSeconds: this.syncPos ? this.pos(w) : y.start || 0 });
    }
    try {
      p.unMute();
      p.setVolume(Math.round(Math.max(0, Math.min(1, w.volume)) * 100));
      const st = p.getPlayerState();
      if (w.paused) { if (st === 1 || st === 3) p.pauseVideo(); }
      else if (st === 2 || st === 5 || st === -1) p.playVideo();
      // Keep the projector in step with the control panel's clock (pause, resume, restart).
      if (this.syncPos && st === 1 && !y.list) {
        let t = this.pos(w);
        const d = p.getDuration();
        if (w.loop && d) t %= d;
        if (Math.abs(p.getCurrentTime() - t) > 2.5 && (!d || t < d)) p.seekTo(t, true);
      }
    } catch { /* player still starting */ }
  }

  onState(e) {
    const w = this.want;
    if (!w) return;
    if (e.data === 1 && w.key && this.reported !== this.loaded) {
      this.reported = this.loaded;
      report({ key: w.key, startedAt: w.startedAt, duration: this.player.getDuration() });
    }
    if (e.data === 0) {
      if (w.loop && !w.youtube.list) { this.player.seekTo(0, true); this.player.playVideo(); }
      else if (w.key) report({ key: w.key, startedAt: w.startedAt, ended: true });
    }
  }
}
const ytVideo = new YtSlot('ytPlayer', { sync: true });
const ytMusic = new YtSlot('ytMusicPlayer', { sync: false });
setInterval(() => { if (ytVideo.ready) ytVideo.apply(); }, 2000);

function syncYouTube(state, item, playing) {
  const skew = state.now - Date.now();
  // Without internet YouTube's player can't load: keep the normal screen instead of a black box.
  const api = !!(window.YT && window.YT.Player);
  const on = !!(playing && playing.kind === 'youtube' && item && item.key === playing.id);
  ytVideo.set(on ? { ...playing, key: playing.id, skew } : null);
  $('yt').classList.toggle('hidden', !on || !api || state.black || state.logo);
  const m = state.media && state.media.music;
  const mon = !!(m && m.youtube);
  ytMusic.set(mon ? { youtube: m.youtube, startedAt: m.startedAt, volume: (m.volume ?? 0.4) * (state.media.now ? 0 : 1), skew } : null);
  $('ytm').classList.toggle('hidden', !mon || !api || state.black);
  if (mon) $('ytm').querySelector('b').textContent = m.title || '';
}

const bgLayers = [$('bgA'), $('bgB')];
let bgFront = 0;

function showText(slide, isBible, scale = 1) {
  const key = slide ? slide.text + '|' + (slide.ref || '') + '|' + scale : null;
  if (key === shownKey) return;
  shownKey = key;
  const next = layers[1 - front];
  const cur = layers[front];
  if (slide) {
    const t = next.firstElementChild;
    t.className = 'screen-text' + (isBible ? ' bible' : '');
    t.innerHTML = slideHtml(slide);
    next.classList.remove('hidden');
    fitText(t, { max: 8.5 * scale });
  }
  cur.classList.add('hidden');
  if (slide) front = 1 - front;
}

function render(state) {
  $('offline').classList.toggle('show', !state);
  if (!state) return;
  const theme = state.config.theme || {};
  const liveItem = state.live && state.live.item;
  const bg = bgInfo(effectiveBg(currentSlide(state), liveItem, theme));
  if (bg.url !== lastBg) {
    lastBg = bg.url;
    // Cross-fade between two background layers.
    const next = bgLayers[1 - bgFront];
    next.style.backgroundImage = bg.url ? `url("${bg.url}")` : '';
    next.classList.toggle('has-image', bg.photo);
    next.classList.remove('hidden');
    bgLayers[bgFront].classList.add('hidden');
    bgFront = 1 - bgFront;
    $('screen').classList.toggle('light-bg', bg.light);
  }
  const logoKey = (theme.logo || '') + '|' + (state.config.churchName || '');
  if (logoKey !== lastLogo) {
    lastLogo = logoKey;
    $('logo').innerHTML = (theme.logo ? `<img src="/media/${escapeHtml(theme.logo)}" alt="">` : '') +
      (state.config.churchName && !theme.logo ? `<div class="name">${escapeHtml(state.config.churchName)}</div>` : '');
  }

  // Lower third on the projector (optional; always on the stream).
  const lt = state.lowerThird || {};
  const ltOn = !!(state.config.lowerThirdOnProjector && lt.visible && (lt.name || lt.title) && !state.black && !state.logo);
  if (ltOn) { $('lt').firstElementChild.textContent = lt.name || ''; $('lt').lastElementChild.textContent = lt.title || ''; }
  $('lt').classList.toggle('hidden', !ltOn);
  if ($('screen').classList.contains('has-lt') !== ltOn) {
    $('screen').classList.toggle('has-lt', ltOn);
    shownKey = null; // re-fit the words into the smaller space
  }

  // Ticker along the bottom (optional on the projector; always available on the stream).
  const tk = state.ticker || {};
  const tickOn = !!(state.config.tickerOnProjector && tk.visible && tk.text && !state.black);
  const span = $('ticker').firstElementChild;
  if (tickOn && span.textContent !== tk.text) {
    span.textContent = tk.text;
    const secs = Math.max(8, tk.text.length / ({ slow: 4, fast: 11 }[state.config.tickerSpeed] || 7));
    $('ticker').style.setProperty('--tick-dur', secs + 's');
  }
  $('ticker').classList.toggle('hidden', !tickOn);
  $('screen').classList.toggle('has-ticker', tickOn);

  const slide = currentSlide(state);
  const item = state.live && state.live.item;
  const hideText = state.clear || state.logo || state.black;
  // Countdowns have their own layout; their slides are the rotating announcements.
  const isCount = !!(item && item.kind === 'countdown' && !state.logo && !state.black);
  countdown = isCount ? { cd: item.countdown, skew: state.now - Date.now(), clear: state.clear } : null;
  $('count').classList.toggle('hidden', !isCount);
  if (isCount) {
    const ann = state.clear || !slide || !slide.text ? '' : slide.text;
    if (ann !== lastAnn) {
      lastAnn = ann;
      $('count').lastElementChild.innerHTML = ann ? `<div class="screen-text">${escapeHtml(ann)}</div>` : '';
      const t = $('count').lastElementChild.firstElementChild;
      if (t) fitText(t, { max: 6, min: 3 });
    }
    tickCountdown();
  }
  // Picture slides (sermon PDFs / images) fill the screen instead of text.
  const pic = !hideText && !isCount && slide && slide.image ? bgInfo(slide.image).url : '';
  const imgEl = $('img').firstElementChild;
  if (pic && imgEl.getAttribute('src') !== pic) imgEl.setAttribute('src', pic);
  $('img').classList.toggle('hidden', !pic);
  // Videos play full screen on the projector, in step with the stream; music items and
  // background music can also play through this computer's speakers ("in the room").
  const playing = state.media && state.media.now;
  const isMedia = !!(item && item.kind === 'media' && item.media);
  const mediaOn = isMedia && playing && playing.id === item.key;
  syncPlayer($('vid').firstElementChild, mediaOn && item.media.type === 'video' && !state.black ? item.media : null, playing, state, true);
  syncPlayer($('aud'), mediaOn && item.media.type === 'audio' && item.media.room ? item.media : null, playing, state, false);
  $('vid').classList.toggle('hidden', !(mediaOn && item.media.type === 'video' && !state.black && !state.logo));
  syncMusic(state);
  syncYouTube(state, item, playing);
  showText(hideText || isCount || pic || isMedia ? null : slide, item && item.kind === 'bible', theme.textScale || 1);
  $('ref').textContent = !hideText && !isCount && slide && slide.ref ? slide.ref : '';
  $('tag').textContent = !hideText && !isCount && item && item.kind === 'song' && item.subtitle ? item.subtitle : '';
  $('logo').classList.toggle('hidden', !state.logo);
  $('black').classList.toggle('hidden', !state.black);

  const ident = state.identify && state.identify > state.now;
  $('identify').classList.toggle('hidden', !ident);
  clearTimeout(identifyTimer);
  if (ident) identifyTimer = setTimeout(() => $('identify').classList.add('hidden'), state.identify - state.now);
}

let last = null;
connect((s) => { if (s) last = s; render(s); });
addEventListener('resize', () => { shownKey = null; if (last) render(last); });
document.fonts && document.fonts.ready.then(() => { shownKey = null; if (last) render(last); });

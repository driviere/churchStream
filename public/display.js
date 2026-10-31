import { connect, fitText, slideHtml, escapeHtml, currentSlide } from '/shared.js';

const $ = (id) => document.getElementById(id);
const layers = [$('layerA'), $('layerB')];
let front = 0;
let shownKey = null;
let lastBg = null;
let lastLogo = null;
let identifyTimer = null;

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
  const bg = theme.background ? `/media/${theme.background}` : '';
  if (bg !== lastBg) {
    lastBg = bg;
    $('bg').style.backgroundImage = bg ? `url("${bg}")` : '';
    $('bg').classList.toggle('has-image', !!bg);
  }
  const logoKey = (theme.logo || '') + '|' + (state.config.churchName || '');
  if (logoKey !== lastLogo) {
    lastLogo = logoKey;
    $('logo').innerHTML = (theme.logo ? `<img src="/media/${escapeHtml(theme.logo)}" alt="">` : '') +
      (state.config.churchName && !theme.logo ? `<div class="name">${escapeHtml(state.config.churchName)}</div>` : '');
  }

  const slide = currentSlide(state);
  const item = state.live && state.live.item;
  const hideText = state.clear || state.logo || state.black;
  showText(hideText ? null : slide, item && item.kind === 'bible', theme.textScale || 1);
  $('ref').textContent = !hideText && slide && slide.ref ? slide.ref : '';
  $('tag').textContent = !hideText && item && item.kind === 'song' && item.subtitle ? item.subtitle : '';
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

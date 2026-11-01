// Helpers shared by the projector, stage screen and control panel.

// Shrink text until it fits its box. Sizes are in cqh (percent of screen height), so the
// result is identical for thumbnails and the real projector. Song lines are kept whole when
// that still gives a readable size; otherwise text wraps.
function fits(el) {
  // The text element is capped at its box (max-width/max-height: 100%), so any overflow
  // shows up as scroll size larger than its own client size.
  return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
}

function search(el, lo, hi) {
  el.style.fontSize = hi + 'cqh';
  if (fits(el)) return hi;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'cqh';
    if (fits(el)) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'cqh';
  return lo;
}

export function fitText(el, { max = 8.5, min = 3.2 } = {}) {
  if (!el || !el.parentElement) return;
  if (!el.classList.contains('bible')) {
    el.style.whiteSpace = 'pre';
    const size = search(el, min, max);
    if (size >= Math.min(5.4, max * 0.65) && fits(el)) return;
  }
  el.style.whiteSpace = '';
  search(el, min, max);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// HTML for a slide's text. Bible slides show small verse numbers.
export function slideHtml(slide) {
  if (!slide) return '';
  if (slide.verses && slide.verses.length > 1) {
    return slide.verses.map((v) => `<sup>${v.n}</sup>${escapeHtml(v.text)}`).join(' ');
  }
  return escapeHtml(slide.text);
}

// Live-updating state over Server-Sent Events (auto-reconnects).
export function connect(onState, onMeter) {
  let es;
  const open = () => {
    es = new EventSource('/events');
    es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
    if (onMeter) es.addEventListener('meter', (e) => onMeter(JSON.parse(e.data)));
    es.onerror = () => { onState(null); };
  };
  open();
  return () => es && es.close();
}

export function currentSlide(state) {
  const live = state && state.live;
  return live ? live.item.slides[live.index] : null;
}

// Backgrounds: '' (default), 'builtin:<id>' (ships with ChurchStream) or 'media:<file>' (your own).
const LIGHT_BACKGROUNDS = new Set(['paper']);
export function bgInfo(value) {
  const v = String(value || '');
  if (!v) return { url: '', light: false, photo: false };
  if (v.startsWith('builtin:')) {
    const id = v.slice(8);
    return { url: `/backgrounds/${encodeURIComponent(id)}.svg`, light: LIGHT_BACKGROUNDS.has(id), photo: false };
  }
  const file = v.startsWith('media:') ? v.slice(6) : v; // older settings stored just the file name
  return { url: `/media/${encodeURIComponent(file)}`, light: false, photo: true };
}

// Which background a slide uses: its own, else its item's, else the general default.
export function effectiveBg(slide, item, theme) {
  return (slide && slide.background) || (item && item.background) || (theme && theme.background) || '';
}

// Countdown timers. `cd.target` (ms) is set by the server when the countdown goes live.
export function countdownTarget(cd, now = Date.now()) {
  if (!cd) return null;
  if (cd.target) return cd.target;
  if (cd.mode === 'until') {
    const [h, m] = String(cd.until || '11:00').split(':').map(Number);
    const t = new Date(now); t.setHours(h, m, 0, 0);
    if (t.getTime() < now - 3600000) t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  return now + (cd.minutes || 5) * 60000;
}

export function countdownParts(cd, now = Date.now()) {
  if (!cd) return null;
  const ms = countdownTarget(cd, now) - now;
  if (ms <= 0) return { done: true, time: '', message: cd.endText || '' };
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return { done: false, time: h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`, message: cd.message || '' };
}

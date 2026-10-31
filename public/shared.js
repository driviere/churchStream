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

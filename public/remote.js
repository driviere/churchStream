// Phone remote: big Next / Back buttons, what's on screen and what's next, and the order of
// service to jump to. Works on any phone on the church Wi-Fi; nothing to install.
import { connect, fitText, slideHtml, bgInfo, effectiveBg, themeClasses, escapeHtml } from '/shared.js';

const $ = (id) => document.getElementById(id);
let S = null;

const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then((r) => r.json()).then((d) => { if (d && d.error) throw new Error(d.error); return d; })
  .catch((err) => { $('offline').textContent = err.message; $('offline').classList.add('show'); setTimeout(() => $('offline').classList.remove('show'), 3000); });
const buzz = () => { if (navigator.vibrate) navigator.vibrate(12); };

const KIND = (it) => {
  if (it.kind === 'bible') return 'READING';
  if (it.kind === 'text') return it.autoAdvance ? 'LOOP' : 'TEXT';
  if (it.kind === 'countdown') return 'COUNTDOWN';
  if (it.kind === 'images') return 'SLIDES';
  if (it.kind === 'media') return it.media && it.media.type === 'audio' ? 'MUSIC' : 'VIDEO';
  const m = String(it.subtitle || '').match(/(\d+)$/);
  return m ? 'HYMN ' + m[1] : 'SONG';
};

async function showPlanItem(uid, index = 0) {
  const it = await post('/api/plan/open', { uid });
  if (it && it.slides) await post('/api/live', { item: it, index });
}

async function step(d) {
  buzz();
  if (!S) return;
  if (!S.live) {
    // Nothing on screen yet: Next starts the first item in the order of service.
    const first = S.plan.items[0];
    if (d > 0 && first) await showPlanItem(first.uid, 0);
    return;
  }
  await post('/api/goto', { delta: d });
}

$('go').onclick = () => step(1);
$('back').onclick = () => step(-1);
for (const name of ['clear', 'logo', 'black']) $(name).onclick = () => { buzz(); post('/api/toggle', { name }); };

// Swipe the picture: left = next, right = back.
let x0 = null;
$('mini').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
$('mini').addEventListener('touchend', (e) => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  x0 = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
});
// A Bluetooth clicker or keyboard works here too.
addEventListener('keydown', (e) => {
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
});

let lastWords = null;
function render(s) {
  $('offline').textContent = 'Reconnecting to ChurchStream…';
  $('offline').classList.toggle('show', !s);
  if (!s) return;
  S = s;
  const cfg = s.config;
  const live = s.live;
  const item = live && live.item;
  const slide = item && item.slides[live.index];
  $('church').textContent = cfg.churchName || 'ChurchStream';
  const st = s.stream || {};
  const pill = $('status');
  pill.className = 'pill' + (st.mode === 'live' ? ' live' : '');
  pill.lastElementChild.textContent = st.mode === 'live' ? 'LIVE' : st.mode === 'preview' ? 'Preview' : 'Not live';

  // The picture, as the projector shows it.
  const theme = cfg.theme || {};
  const info = bgInfo(effectiveBg(slide, item, theme));
  $('screen').className = 'screen' + (info.light ? ' light-bg' : '') + (themeClasses(theme) ? ' ' + themeClasses(theme) : '');
  $('bg').className = 'screen-bg' + (info.photo ? ' has-image' : '');
  $('bg').style.backgroundImage = info.url ? `url("${info.url}")` : '';
  const hide = s.black || s.clear || s.logo || !slide || slide.image || (item && (item.kind === 'media' || item.kind === 'countdown'));
  const words = hide ? (s.black ? '' : s.logo ? escapeHtml(cfg.churchName || 'Logo') : item ? escapeHtml(item.kind === 'countdown' ? 'Countdown' : item.kind === 'media' ? '▶ ' + item.title : slide && slide.image ? 'Picture slide' : '') : '') : slideHtml(slide);
  const key = words + '|' + (s.black ? 'b' : '') + $('screen').className;
  if (key !== lastWords) {
    lastWords = key;
    $('words').className = 'screen-text' + (item && item.kind === 'bible' ? ' bible' : '');
    $('words').innerHTML = words;
    $('screen').style.background = s.black ? '#000' : '';
    $('bg').style.opacity = s.black ? '0' : '1';
    requestAnimationFrame(() => fitText($('words'), { max: 8.5 * (theme.textScale || 1) }));
  }
  $('title').textContent = item ? item.title : 'Nothing on screen yet';
  $('pos').textContent = item ? `${live.index + 1} of ${item.slides.length}` : '';

  // What Next will show.
  const items = s.plan.items;
  const at = item ? items.findIndex((x) => x.uid === item.key) : -1;
  let next = '';
  if (!item) next = items[0] ? `Starts “${items[0].title}”` : 'Add items to the order of service on the main computer.';
  else if (live.index + 1 < item.slides.length) { const n = item.slides[live.index + 1]; next = n.image ? 'Next picture' : n.text; }
  else if (at >= 0 && items[at + 1]) next = `Next item: ${items[at + 1].title}`;
  else next = 'End of the service';
  $('next').textContent = next;

  for (const name of ['clear', 'logo', 'black']) $(name).classList.toggle('on', !!s[name]);

  $('plan').innerHTML = items.length
    ? items.map((it, i) => `<li><button data-uid="${escapeHtml(it.uid)}" class="${i === at ? 'live' : at >= 0 && i < at ? 'done' : ''}"><span class="k ${escapeHtml(it.kind)}">${escapeHtml(KIND(it))}</span><span class="t">${escapeHtml(it.title)}</span></button></li>`).join('')
    : '<li class="empty">The order of service is empty.</li>';
}
$('plan').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-uid]');
  if (b) { buzz(); showPlanItem(b.dataset.uid, 0); }
});
addEventListener('resize', () => { lastWords = null; if (S) render(S); });

connect(render);

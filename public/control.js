import { html, render, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from '/vendor/preact-htm.js';
import { connect, fitText, textSizes, WRAP_GAIN, slideHtml, bgInfo, effectiveBg, countdownParts, fillSabbath, logoParts, themeClasses, FONTS, PARTS } from '/shared.js';

let SAB = null; // latest sunset / Sabbath times from the server (for previews)

// ---------------------------------------------------------------------------------------
// tiny helpers
const api = async (path, body) => {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.error)) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
};
const get = (path, params) => api(path + (params ? '?' + new URLSearchParams(params) : ''));

const toastBus = new EventTarget();
const toast = (msg, kind = 'info', action = null) => toastBus.dispatchEvent(new CustomEvent('t', { detail: { msg, kind, action, id: Math.random() } }));
// Open the projector window. On a Mac without Chrome or Edge it opens in Safari instead.
const openProjector = () => api('/api/projector/open', {}).then((r) => {
  if (r && r.browser === 'safari') toast('Opened in Safari: drag the window to the projector screen, then press Control-Command-F for full screen. (Google Chrome does this by itself.)', 'info');
}).catch(fail);
// Undo the last change to the order of service (removing an item, New service, opening one…).
const undoPlan = () => api('/api/plan/undo', {}).then((r) => toast(r.ok ? 'Undone' : 'Nothing to undo')).catch(fail);
const undoToast = (msg) => toast(msg, 'info', { label: 'Undo', run: undoPlan });
const fail = (err) => toast(err.message || String(err), 'error');
const meterBus = new EventTarget();
const levelsBus = new EventTarget(); // the sound mixer's level per source (stream page)

const navigate = (path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); };
const fmtTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60; return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`; };
const hymnLabel = (s) => (s.number ? `${s.hymnal === 'CH1941' ? 'Church Hymnal' : s.hymnal === 'SDAH' ? 'SDA Hymnal' : s.hymnal === 'AY' ? 'AY Sing' : 'Hymn'} ${s.number}` : (s.author || ''));
const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

function parseSections(body) {
  const out = [];
  for (const block of String(body).split(/\n\s*\n/)) {
    let lines = block.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    if (!lines.length) continue;
    let label = '';
    const m = lines[0].trim().match(/^\[(.+)\]$/);
    if (m) { label = m[1]; lines = lines.slice(1); }
    if (lines.length) out.push({ label, text: lines.join('\n') });
  }
  return out;
}
const sectionsToText = (sections) => sections.map((s) => (s.label ? `[${s.label}]\n` : '') + s.text).join('\n\n');

// ---------------------------------------------------------------------------------------
// icons (inline SVG, 18px)
const I = (d, extra = '') => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ...${extra ? { style: extra } : {}}>${d}</svg>`;
const icons = {
  search: () => I(html`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`),
  music: () => I(html`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`),
  book: () => I(html`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>`),
  text: () => I(html`<path d="M4 7V4h16v3M9 20h6M12 4v16"/>`),
  plus: () => I(html`<path d="M12 5v14M5 12h14"/>`),
  x: () => I(html`<path d="M18 6 6 18M6 6l12 12"/>`),
  grip: () => I(html`<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>`),
  left: () => I(html`<path d="m15 18-6-6 6-6"/>`),
  right: () => I(html`<path d="m9 18 6-6-6-6"/>`),
  lock: () => I(html`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`),
  phone: () => I(html`<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>`),
  gear: () => I(html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
  edit: () => I(html`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  radio: () => I(html`<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>`),
  monitor: () => I(html`<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`),
  check: () => I(html`<path d="M20 6 9 17l-5-5"/>`),
  alert: () => I(html`<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>`),
  back: () => I(html`<path d="M19 12H5M12 19l-7-7 7-7"/>`),
  image: () => I(html`<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>`),
  play: () => I(html`<path d="M7 4v16l13-8z" fill="currentColor"/>`),
  sun: () => I(html`<path d="M17 18a5 5 0 0 0-10 0M12 9V2M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>`),
  stop: () => I(html`<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>`),
  pause: () => I(html`<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>`),
  yt: () => I(html`<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>`),
  download: () => I(html`<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>`),
  upload: () => I(html`<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>`),
  film: () => I(html`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>`),
};

// ---------------------------------------------------------------------------------------
// the projected screen, used for thumbnails and the mini projector view
// Slides split to fit the screens (lib/fit.js) → the slides as typed, for editing.
function unsplit(item) {
  if (!item || !item.slides || !item.slides.some((sl) => sl.src != null)) return item;
  const out = [];
  for (const sl of item.slides) {
    const prev = out[out.length - 1];
    if (prev && sl.src != null && prev.src === sl.src) prev.text += '\n' + sl.text;
    else out.push({ ...sl, label: String(sl.label || '').replace(/\s*\(\d+\/\d+\)$/, '') });
  }
  return { ...item, slides: out };
}

function Screen({ slide, kind, subtitle, theme = {}, churchName = '', black, clear, logo, bg, lt, countdown, skew = 0 }) {
  const ref = useRef();
  const scale = theme.textScale || 1;
  const isCount = !!(countdown && !black && !logo);
  if (slide && slide.text && slide.text.includes('{')) slide = { ...slide, text: fillSabbath(slide.text, SAB) };
  if (countdown && /\{/.test((countdown.message || '') + (countdown.endText || ''))) countdown = { ...countdown, message: fillSabbath(countdown.message, SAB), endText: fillSabbath(countdown.endText, SAB) };
  const text = !black && !clear && !logo && slide && !isCount && !slide.image && kind !== 'media' ? slide : null;
  const ltOn = !!(lt && !black && !logo);
  const tcls = themeClasses(theme);
  useLayoutEffect(() => { if (ref.current) fitText(ref.current, textSizes(theme)); }, [text && text.text, text && text.part, scale, theme.minText, ltOn, tcls]);
  // Re-fit when the screen changes size (e.g. a hidden tab becomes visible).
  useEffect(() => {
    const el = ref.current && ref.current.closest('.screen');
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let w = 0;
    const ro = new ResizeObserver(([e]) => {
      const nw = Math.round(e.contentRect.width);
      if (nw && nw !== w) { w = nw; if (ref.current) fitText(ref.current, textSizes(theme)); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!text, scale]);
  const info = bgInfo(bg !== undefined ? bg : theme.background);
  return html`<div class=${'screen' + (info.light ? ' light-bg' : '') + (ltOn ? ' has-lt' : '') + (tcls ? ' ' + tcls : '')}>
    <div class=${'screen-bg' + (info.photo ? ' has-image' : '')} style=${info.url ? `background-image:url("${info.url}")` : ''}></div>
    ${text && html`<div class="screen-layer"><div ref=${ref} class=${'screen-text' + (kind === 'bible' ? ' bible' : '')} dangerouslySetInnerHTML=${{ __html: slideHtml(text) }}></div></div>`}
    ${text && text.ref && html`<div class="screen-ref">${text.ref}</div>`}
    ${text && kind === 'song' && subtitle && html`<div class="screen-tag">${subtitle}</div>`}
    ${!black && !logo && !clear && slide && slide.image && html`<div class="screen-img"><img src=${bgInfo(slide.image).url} alt="" loading="lazy" /></div>`}
    ${!black && !logo && kind === 'media' && html`<div class="screen-logo"><div class="name" style="font-size:6cqh">${slide ? '▶ ' + slide.label : ''}</div></div>`}
    ${isCount && html`<${CountdownFace} cd=${countdown} skew=${skew} ann=${!clear && slide ? slide.text : ''} />`}
    ${ltOn && html`<div class="screen-lt"><div class="n">${lt.name}</div><div class="t">${lt.title}</div></div>`}
    ${logo && (() => { const lp = logoParts(theme, churchName); return html`<div class=${lp.cls}>${lp.img && (lp.video ? html`<video src=${lp.img} muted loop autoplay playsinline></video>` : html`<img src=${lp.img} alt="" />`)}${lp.name && html`<div class=${'name' + (lp.img ? ' under' : '')}>${lp.name}</div>`}</div>`; })()}
    ${black && html`<div class="screen-black"></div>`}
  </div>`;
}

// A ticking countdown face (same markup and styles as the projector).
function CountdownFace({ cd, skew = 0, ann }) {
  const [, tick] = useState(0);
  const annRef = useRef();
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(id); }, []);
  useLayoutEffect(() => { if (annRef.current) fitText(annRef.current, { max: 6, min: 3 }); }, [ann]);
  const p = countdownParts(cd, Date.now() + skew);
  return html`<div class=${'screen-count' + (p.done ? ' done' : '')}>
    <div class="msg">${p.message}</div><div class="time">${p.time}</div>
    <div class="ann">${ann && html`<div ref=${annRef} class="screen-text">${ann}</div>`}</div>
  </div>`;
}

function Meter({ compact }) {
  const bar = useRef();
  const label = useRef();
  useEffect(() => {
    const on = (e) => {
      const v = e.detail;
      const pct = Math.max(0, Math.min(100, ((v + 60) / 60) * 100)); // -60 LUFS → 0%, 0 → 100%
      if (bar.current) bar.current.style.width = pct + '%';
      if (label.current) label.current.textContent = v < -50 ? 'No sound' : v < -35 ? 'Quiet' : v < -12 ? 'Good' : 'Too loud';
    };
    meterBus.addEventListener('m', on);
    return () => meterBus.removeEventListener('m', on);
  }, []);
  return html`<div class="meter-row"><span>${compact ? '' : 'Sound'}</span><div class="meter"><i ref=${bar}></i></div><span ref=${label} class="meter-label"></span></div>`;
}

function PreviewImage({ running }) {
  const [t, setT] = useState(Date.now());
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!running) { setOk(false); return undefined; }
    const id = setInterval(() => setT(Date.now()), 1500);
    return () => clearInterval(id);
  }, [running]);
  return html`<div class="preview">
    ${!running && html`<span>Camera is off</span>`}
    ${running && !ok && html`<span>Starting camera…</span>`}
    ${running && html`<img src=${'/preview.jpg?t=' + t} onLoad=${() => setOk(true)} onError=${(e) => { e.target.style.visibility = 'hidden'; }} style=${ok ? '' : 'visibility:hidden'} alt="Camera preview" />`}
  </div>`;
}

function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const t = e.detail;
      setList((l) => [...l.slice(-2), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : t.action ? 7000 : 3000);
    };
    toastBus.addEventListener('t', on);
    return () => toastBus.removeEventListener('t', on);
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${list.map((t) => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}${t.action && html`<button class="toast-act" onClick=${() => { setList((l) => l.filter((x) => x.id !== t.id)); t.action.run(); }}>${t.action.label}</button>`}</div>`)}</div>`;
}

// Has anything in an editor changed since it opened?
function useChanged(...vals) {
  const first = useRef(JSON.stringify(vals));
  return JSON.stringify(vals) !== first.current;
}

let modalSeq = 0;
// dirty: something typed would be lost, so Escape, the ✕ and a click beside the dialog ask first.
function Modal({ title, onClose, children, footer, wide, dirty }) {
  const close = () => { if (!dirty || confirm('Close without saving? Your changes will be lost.')) onClose(); };
  const ref = useRef();
  const [id] = useState(() => 'modal-title-' + ++modalSeq);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      // Keep Tab inside the dialog.
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  // Focus moves into the dialog when it opens (its first box, or the dialog), and back after.
  useEffect(() => {
    const before = document.activeElement;
    const el = ref.current;
    const first = el && (el.querySelector('[autofocus]') || el.querySelector('.body input, .body textarea, .body select'));
    (first || el).focus({ preventScroll: true });
    return () => { if (before && before.focus && document.contains(before)) before.focus({ preventScroll: true }); };
  }, []);
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}>
    <div ref=${ref} tabindex="-1" class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby=${id}>
      <header><h2 id=${id}>${title}</h2><span class="spacer"></span><button class="btn ghost icon" onClick=${close} aria-label="Close">${icons.x()}</button></header>
      <div class="body">${children}</div>
      ${footer && html`<footer>${footer}</footer>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// status pill in the top bar
// Now, by ChurchStream's clock (a tablet's own clock can be minutes out).
const serverNow = (s) => Date.now() + (s.now - (s.receivedAt || s.now));

function StreamStatus({ s }) {
  const st = s.stream;
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  if (st.mode !== 'live') {
    return html`<div class=${'status' + (st.state === 'error' ? ' warn' : '')}><span class="dot"></span>${st.mode === 'preview' ? 'Preview · not live' : 'Not live'}</div>`;
  }
  const dests = Object.values(st.destinations || {});
  const health = st.problem ? html`<span class="bad">${st.state === 'retrying' ? 'Reconnecting' : 'Check connection'}</span>` : html`<span class="ok">Connection good</span>`;
  return html`<div class=${'status live' + (st.problem ? ' warn' : '')} title=${dests.map((d) => `${d.label}: ${d.state}`).join(', ')}>
    <span class="dot"></span>Live · <span style="font-variant-numeric:tabular-nums">${fmtTime(Math.max(0, serverNow(s) - (st.liveSince || serverNow(s))))}</span>
    <span class="sep extra">·</span><span class="extra">${health}</span>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// omnibox: songs, hymn numbers and Bible references in one search
// The rows of a search reply, in the order shown.
const searchRows = (res) => {
  if (!res) return [];
  const r = [];
  if (res.bible) r.push({ type: 'bible', data: res.bible });
  for (const b of res.books) r.push({ type: 'book', data: b });
  for (const s of res.songs) r.push({ type: 'song', data: s });
  return r;
};

function Omnibox({ onOpen, onShow, onAdd, onNewSong, locked }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef();

  useEffect(() => {
    const k = (e) => { if (e.key === '/' && !isTyping(e)) { e.preventDefault(); input.current.focus(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  // Each reply remembers what it was for; a slow reply to an earlier query is ignored.
  const latest = useRef('');
  useEffect(() => {
    latest.current = q.trim();
    if (!q.trim()) { setRes(null); return undefined; }
    const t = setTimeout(() => get('/api/search', { q }).then((r) => { if (latest.current === q.trim()) { setRes({ ...r, q: q.trim() }); setSel(0); } }).catch(() => {}), 110);
    return () => clearTimeout(t);
  }, [q]);

  const rows = useMemo(() => searchRows(res), [res]);

  const act = async (row, how) => {
    if (!row) return;
    if (row.type === 'book') { setQ(row.data + ' '); input.current.focus(); return; }
    try {
      const item = row.type === 'bible'
        ? { key: 'bible:' + row.data.ref, kind: 'bible', title: row.data.title, subtitle: row.data.translation, slides: row.data.slides, ref: row.data.title, translation: row.data.translation.toLowerCase() }
        : await get('/api/song', { id: row.data.id }).then((s) => ({ key: 'song:' + s.id, kind: 'song', title: s.title, subtitle: hymnLabel(s), slides: s.slides, songId: s.id }));
      if (how === 'show') onShow(item); else if (how === 'add') onAdd(item); else onOpen(item);
      setOpen(false);
      if (how !== 'open') { setQ(''); input.current.blur(); }
    } catch (err) { fail(err); }
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const how = e.shiftKey && !locked ? 'add' : 'show';
      // Typed faster than the search answered (e.g. "123" + Enter): search for what's typed now
      // and use its first result, never the results for "12".
      if (!res || res.q !== q.trim()) {
        if (!q.trim()) return;
        get('/api/search', { q }).then((r) => act(searchRows(r)[0], how)).catch(fail);
        return;
      }
      act(rows[sel], how);
    }
    else if (e.key === 'Escape') { setOpen(false); if (!q) input.current.blur(); setQ(''); }
  };

  const songs = rows.filter((r) => r.type === 'song');
  return html`<div class="omni">
    ${icons.search()}
    <input ref=${input} class="input" placeholder="Type a hymn number, song or verse…" value=${q}
      onInput=${(e) => { setQ(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)} onKeyDown=${onKey}
      onBlur=${() => setTimeout(() => setOpen(false), 150)} aria-label="Search" />
    ${open && q.trim() && res && html`<div class="results" onMouseDown=${(e) => e.preventDefault()}>
      ${res.bible && html`<div class="group">Bible</div>`}
      ${rows.map((row, i) => row.type === 'bible' && html`
        <div class=${'result' + (i === sel ? ' sel' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => act(row, 'open')}>
          <span class="num">${icons.book()}</span>
          <div class="grow"><div class="t">${row.data.title}</div><div class="s">${row.data.slides[0].text}</div></div>
          <div class="acts"><button class="btn small" onClick=${(e) => { e.stopPropagation(); act(row, 'add'); }}>Add</button><button class="btn small primary" onClick=${(e) => { e.stopPropagation(); act(row, 'show'); }}>Show</button></div>
        </div>`)}
      ${res.books.length > 0 && html`<div class="group">Books</div>`}
      ${rows.map((row, i) => row.type === 'book' && html`
        <div class=${'result' + (i === sel ? ' sel' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => act(row)}>
          <span class="num">${icons.book()}</span><div class="t">${row.data}</div><div class="s">Type a chapter and verse</div>
        </div>`)}
      ${songs.length > 0 && html`<div class="group">Songs</div>`}
      ${rows.map((row, i) => row.type === 'song' && html`
        <div class=${'result' + (i === sel ? ' sel' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => act(row, 'open')}>
          <span class="num">${row.data.number ? row.data.number : icons.music()}</span>
          <div class="grow"><div class="t">${row.data.title}</div><div class="s">${[row.data.hymnal === 'CH1941' ? 'Church Hymnal' : row.data.hymnal === 'SDAH' ? 'SDA Hymnal' : row.data.hymnal === 'AY' ? 'AY Sing ' + row.data.number : '', row.data.firstLine].filter(Boolean).join(' · ')}</div></div>
          <div class="acts"><button class="btn small" onClick=${(e) => { e.stopPropagation(); act(row, 'add'); }}>Add</button><button class="btn small primary" onClick=${(e) => { e.stopPropagation(); act(row, 'show'); }}>Show</button></div>
        </div>`)}
      ${!rows.length && html`<div class="empty">Nothing found for “${q}”.${!locked && html`<br/><button class="btn small" style="margin-top:10px" onClick=${() => { onNewSong(q); setOpen(false); }}>Create a song called “${q}”</button>`}</div>`}
      <div class="foot"><kbd>Enter</kbd> show now${!locked && html` · <kbd>Shift</kbd>+<kbd>Enter</kbd> add to service`} · click to preview</div>
    </div>`}
  </div>`;
}

// A small pop-up menu for adding things to the order of service.
function AddMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef();
  const toggle = (e) => {
    if (open) { setOpen(false); return; }
    // The order-of-service strip scrolls (and clips), so place the menu on the page itself.
    const r = e.currentTarget.getBoundingClientRect();
    const w = 290;
    setPos({ left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), bottom: innerHeight - r.top + 8, width: w });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current || !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', close); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', esc); };
  }, [open]);
  return html`<div class="add-menu" ref=${ref}>
    <button class="plan-add" aria-haspopup="menu" aria-expanded=${open} onClick=${toggle}>${icons.plus()} Add</button>
    ${open && pos && html`<div class="menu" role="menu" style=${`left:${pos.left}px;bottom:${pos.bottom}px;width:${pos.width}px`}>${items.map(([t, d, fn]) => html`
      <button role="menuitem" onClick=${() => { setOpen(false); fn(); }}><b>${t}</b><span>${d}</span></button>`)}</div>`}
  </div>`;
}

// ---------------------------------------------------------------------------------------
// order of service: a horizontal strip along the bottom
const kindLabel = (it) => {
  if (it.kind === 'bible') return 'READING';
  if (it.kind === 'text') return it.autoAdvance ? 'LOOP' : 'TEXT';
  if (it.kind === 'countdown') return 'COUNTDOWN';
  if (it.kind === 'images') return it.autoAdvance ? 'SLIDESHOW' : 'SLIDES';
  if (it.kind === 'media') return it.media && it.media.type === 'audio' ? 'MUSIC' : it.media && it.media.type === 'youtube' ? 'YOUTUBE' : 'VIDEO';
  const m = String(it.subtitle || '').match(/^(SDA Hymnal|Church Hymnal|Hymn)\s+(\d+)$/);
  return m ? `${m[1] === 'Church Hymnal' ? 'CH' : 'HYMN'} ${m[2]}` : 'SONG';
};

function Plan({ s, locked, selectedKey, onOpen, onEdit, onNewSong, onNewText, onNewCountdown, onNewSlides, onNewMedia, onNewSunset, onNewResponsive, onTemplates, onServices, onNewService }) {
  const items = s.plan.items;
  const live = s.live;
  const liveAt = live ? items.findIndex((x) => x.uid === live.item.key) : -1;
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const list = useRef();

  const save = (next) => api('/api/plan', { items: next }).catch(fail);
  // Undo is offered only once it really was removed (Undo would otherwise undo something else).
  const remove = (uid) => {
    const it = items.find((x) => x.uid === uid);
    api('/api/plan', { items: items.filter((x) => x.uid !== uid) }).then(() => undoToast(`Removed “${it ? it.title : 'item'}”`)).catch(fail);
  };

  // Reordering: with a mouse, just drag. On touch screens a swipe scrolls the list, a tap
  // opens the item, and press-and-hold (about half a second) picks a card up to drag it.
  const dragging = useRef(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return undefined;
    const block = (e) => { if (dragging.current) e.preventDefault(); }; // stop the list scrolling while a card is held
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);
  const start = (e, i) => {
    if (e.button > 0 || e.target.closest('.x, .ed')) return;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let mode = 'press'; // press → drag | scroll
    let hold = null;
    const begin = () => { if (locked) { mode = 'scroll'; return; } mode = 'drag'; dragging.current = true; setDrag(i); setOver(i); if (navigator.vibrate) navigator.vibrate(15); };
    if (touch) hold = setTimeout(() => { if (mode === 'press') begin(); }, 450);
    const move = (ev) => {
      if (mode === 'scroll') return;
      if (mode === 'press') {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        if (touch) { mode = 'scroll'; clearTimeout(hold); return; } // a swipe: let the list scroll
        begin();
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const li = el && el.closest('li[data-i]');
      if (li && list.current.contains(li)) setOver(Number(li.dataset.i));
      // Near the edges, scroll the list so far-away positions can be reached.
      const r = list.current.getBoundingClientRect();
      if (ev.clientX < r.left + 40) list.current.scrollLeft -= 12;
      else if (ev.clientX > r.right - 40) list.current.scrollLeft += 12;
    };
    const end = (ev) => {
      clearTimeout(hold);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      const was = mode;
      mode = 'done';
      dragging.current = false;
      if (was === 'press') { if (ev.type === 'pointerup') onOpen(items[i].uid); return; }
      if (was !== 'drag') return;
      setDrag(null);
      setOver((o) => {
        if (ev.type === 'pointerup' && o !== null && o !== i) { const next = items.slice(); const [m] = next.splice(i, 1); next.splice(o, 0, m); save(next); }
        return null;
      });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  };

  return html`<section class="card plan-card" aria-label="Order of service">
    <div class="plan-head"><b>Order of service</b><button class="btn small ghost" onClick=${onNewService}>New</button><button class="btn small ghost" onClick=${onServices}>Save / open</button><button class="btn small ghost" onClick=${onTemplates}>Templates</button><span>${items.length ? 'Next moves on by itself at the end of each item · drag (or press and hold) to reorder' : ''}</span></div>
    ${items.length === 0 && html`<div class="plan-empty">Search above, then press <kbd>Shift</kbd>+<kbd>Enter</kbd> (or “Add”) to build the order of service.</div>`}
    <ul class="plan" ref=${list}>
      ${items.map((it, i) => {
        const isLive = i === liveAt;
        const n = isLive ? live.item.slides.length : it.count || 0;
        return html`<li key=${it.uid} data-i=${i} onPointerDown=${(e) => start(e, i)} tabindex="0" role="button" aria-label=${`${kindLabel(it)}: ${it.title}`}
          onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(it.uid); } }}
          class=${[it.uid === selectedKey && 'sel', isLive && 'live', liveAt >= 0 && i < liveAt && 'done', drag === i && 'dragging', over === i && drag !== null && drag !== i && 'over'].filter(Boolean).join(' ')}>
          <span class=${'k ' + it.kind}>${kindLabel(it)}</span>
          <span class="t">${it.title}</span>
          ${it.kind === 'song' && it.verses && it.verses.length > 0 && html`<span class="verses-tag">v. ${it.verses.join(', ')}</span>`}
          ${n > 0 && html`<span class="dots">${Array.from({ length: Math.min(n, 12) }, (_, d) => html`<i class=${isLive ? (d === live.index ? 'now' : d < live.index ? 'past' : '') : ''}></i>`)}</span>`}
          <button class="ed" title="Edit" aria-label=${'Edit ' + it.title} onClick=${(e) => { e.stopPropagation(); onEdit(it.uid); }}>${icons.edit()}</button>
          <button class="x" title="Remove" aria-label=${'Remove ' + it.title} onClick=${(e) => { e.stopPropagation(); remove(it.uid); }}>${icons.x()}</button>
        </li>`;
      })}
      <li style="flex:0 0 auto;padding:0;border:0;background:none;min-height:0">
        <${AddMenu} items=${[
          ['Song or chorus', 'Type or paste the words; kept in your song library', onNewSong],
          ['Text or announcements', 'Words you type; can change by themselves', onNewText],
          ['Responsive reading', 'Leader and congregation take turns', onNewResponsive],
          ['Slides', 'PowerPoint, PDF or pictures', onNewSlides],
          ['Countdown', 'Before the service, with announcements', onNewCountdown],
          ['Sunset times', 'When this Sabbath ends and the next begins', onNewSunset],
          ...(onNewMedia ? [['Video, music or YouTube', 'Mission Spotlight, special music, a YouTube link', onNewMedia]] : []),
        ]} />
      </li>
    </ul>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// slide grid (centre card)
const SlideCard = ({ slide, i, item, s, isLive, isNext, onClick, onBackground }) => html`
  <div class=${'slide-card' + (isLive ? ' live' : '') + (isNext ? ' next' : '')}>
    <button class="slide-hit" onClick=${onClick} aria-label=${'Show slide ' + (i + 1)}>
      <${Screen} slide=${slide} kind=${item.kind} subtitle=${item.subtitle} theme=${s.config.theme} bg=${effectiveBg(slide, item, s.config.theme)}
        countdown=${item.kind === 'countdown' ? item.countdown : null} skew=${s.now - (s.receivedAt || s.now)} />
    </button>
    ${onBackground && html`<button class="bg-btn" title="Background for this slide" aria-label=${'Background for slide ' + (i + 1)} onClick=${onBackground}>${icons.image()}</button>`}
    <div class="meta"><span class="lbl">${slide.label || (item.kind === 'bible' ? slide.ref : `Slide ${i + 1}`)}${slide.background ? html` <span class="own-bg" title="This slide has its own background">●</span>` : ''}</span>
      ${isLive ? html`<span class="tag live">ON SCREEN</span>` : isNext ? html`<span class="tag next">NEXT</span>` : html`<span class="tag num">${i + 1}</span>`}</div>
  </div>`;

function Slides({ s, item, onShowSlide, onAdd, onEdit, inPlan, active, onBackground, onVerses }) {
  const live = s.live;
  const isLiveItem = live && item && live.item.key === item.key;
  const liveIdx = isLiveItem ? live.index : -1;
  useEffect(() => {
    if (liveIdx < 0) return;
    const el = document.querySelector('.slide-card.live');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [liveIdx, item && item.key]);

  return html`<section class=${'card slides-card' + (active ? ' active' : '')}>
    ${!item ? html`<div class="empty" style="margin:auto"><b>Nothing selected yet</b><br/>Type a hymn number (e.g. <kbd>100</kbd>), a song title or a verse (e.g. <kbd>John 3:16</kbd>) in the search bar,<br/>or tap an item in the order of service below.</div>` : html`
      <div class="item-head">
        <div class="grow">
          <h1>${item.title}</h1>
          <div class="sub">${[item.subtitle, `${item.slides.length} slide${item.slides.length === 1 ? '' : 's'}`, 'tap any slide to show it'].filter(Boolean).join(' · ')}</div>
        </div>
        ${onEdit && html`<button class="btn small" onClick=${onEdit}>${icons.edit()} Edit</button>`}
        ${inPlan && item.kind !== 'media' && html`<button class="btn small" onClick=${() => onBackground(null)}>${icons.image()} Background</button>`}
        ${!inPlan && html`<button class="btn small" onClick=${onAdd}>${icons.plus()} Add to service</button>`}
      </div>
      ${inPlan && item.kind === 'song' && item.verseCount > 1 && (() => {
        const all = Array.from({ length: item.verseCount }, (_, k) => k + 1);
        const on = item.verses && item.verses.length ? item.verses : all;
        const toggle = (v) => {
          const next = on.includes(v) ? on.filter((x) => x !== v) : [...on, v].sort((a, b) => a - b);
          if (!next.length) return toast('Keep at least one verse');
          onVerses(next.length === all.length ? null : next);
        };
        return html`<div class="verse-pick" role="group" aria-label="Verses to sing">
          <span class="muted">Verses to sing</span>
          ${all.map((v) => html`<button class=${'vchip' + (on.includes(v) ? ' on' : '')} aria-pressed=${on.includes(v)} onClick=${() => toggle(v)}>${v}</button>`)}
          ${on.length < all.length && html`<button class="btn small ghost" onClick=${() => onVerses(null)}>All verses</button>`}
        </div>`;
      })()}
      ${live && !isLiveItem && html`<div class="jump">${icons.radio()}<span class="grow">On screen now: <b>${live.item.title}</b></span><button class="btn small" onClick=${() => onShowSlide(null)}>Go to it</button></div>`}
      ${item.kind === 'media' ? html`<${MediaPanel} key=${item.key} s=${s} item=${item} isLive=${isLiveItem} onShow=${() => onShowSlide(0)} />` : html`
      <div class="slides-scroll"><div class="slides">
        ${item.slides.map((sl, i) => html`<${SlideCard} key=${i} slide=${sl} i=${i} item=${item} s=${s} isLive=${i === liveIdx} isNext=${isLiveItem && i === liveIdx + 1} onClick=${() => onShowSlide(i)} onBackground=${inPlan ? () => onBackground(i) : null} />`)}
      </div></div>`}`}
  </section>`;
}

// ---------------------------------------------------------------------------------------
// right column: screens, stream, name on stream
function NameOnStream({ s }) {
  const lt = s.lowerThird;
  const presets = s.config.lowerThirdPresets || [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const isOn = (p) => lt.visible && lt.name === p.name && lt.title === p.title;
  const tap = (p) => api('/api/lower-third', isOn(p) ? { visible: false } : { name: p.name, title: p.title, visible: true }).catch(fail);
  const custom = lt.visible && !presets.some(isOn);
  const showNew = (keep) => {
    if (!name.trim()) return;
    const p = { name: name.trim(), title: title.trim() };
    api('/api/lower-third', { ...p, visible: true }).catch(fail);
    if (keep) api('/api/config', { lowerThirdPresets: [...presets, p] }).then(() => toast('Saved for next time')).catch(fail);
    setAdding(false); setName(''); setTitle('');
  };
  return html`<div class="card">
    <div class="card-head"><b>Names (lower third)</b>${lt.visible && html`<span class="tag live" style="margin-left:auto">SHOWING</span>`}</div>
    <div class="pills">
      ${presets.map((p, i) => html`<button key=${i} class=${'pill' + (isOn(p) ? ' on' : '')} title=${p.title} onClick=${() => tap(p)}>${p.name}${isOn(p) ? ' ✓' : ''}</button>`)}
      ${custom && html`<button class="pill on" onClick=${() => api('/api/lower-third', { visible: false }).catch(fail)}>${lt.name} ✓</button>`}
      <button class="pill add" onClick=${() => setAdding(!adding)}>+ New name</button>
    </div>
    ${adding && html`<div class="stack" style="margin-top:10px">
      <input class="input" placeholder="Name, e.g. Pastor James Okafor" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && showNew(false)} autofocus />
      <input class="input" placeholder="Title, e.g. Senior Pastor" value=${title} onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && showNew(false)} />
      <div class="row"><button class="btn primary grow" disabled=${!name.trim()} onClick=${() => showNew(false)}>Show now</button><button class="btn" disabled=${!name.trim()} onClick=${() => showNew(true)}>Show & save</button></div>
    </div>`}
    <label class="switch" style="min-height:40px;margin-top:6px"><input type="checkbox" checked=${!!s.config.lowerThirdOnProjector} onChange=${(e) => api('/api/config', { lowerThirdOnProjector: e.target.checked }).catch(fail)} /><span>Also show on the projector screens</span></label>
    <div class="hint">Tap a name to show it on the ${s.config.lowerThirdOnProjector ? 'stream and the screens' : 'stream'}; tap again to hide.</div>
  </div>`;
}

function TickerCard({ s }) {
  const tk = s.ticker || { text: '', visible: false };
  const [text, setText] = useState(tk.text);
  useEffect(() => { if (!document.activeElement || document.activeElement.dataset.role !== 'ticker') setText(tk.text); }, [tk.text]);
  const show = (visible) => api('/api/ticker', { text, visible }).catch(fail);
  return html`<div class="card vol-hide">
    <div class="card-head"><b>Ticker</b>${tk.visible && html`<span class="tag live" style="margin-left:auto">SCROLLING</span>`}</div>
    <textarea class="input" data-role="ticker" rows="2" style="resize:vertical" placeholder="e.g. Welcome! Potluck lunch after the service · Prayer meeting Wednesday 7 pm" value=${text}
      onInput=${(e) => setText(e.target.value)} onBlur=${() => tk.visible && text !== tk.text && show(true)}></textarea>
    <div class="row" style="margin-top:8px">
      ${tk.visible ? html`<button class="btn on red grow" onClick=${() => show(false)}>Stop ticker</button>` : html`<button class="btn primary grow" disabled=${!text.trim()} onClick=${() => show(true)}>Start ticker</button>`}
      <select class="select" style="width:auto" value=${s.config.tickerSpeed || 'normal'} onChange=${(e) => api('/api/config', { tickerSpeed: e.target.value }).catch(fail)} title="Speed (applies next time the stream starts)">
        <option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select>
    </div>
    <label class="switch" style="min-height:40px;margin-top:6px"><input type="checkbox" checked=${!!s.config.tickerOnProjector} onChange=${(e) => api('/api/config', { tickerOnProjector: e.target.checked }).catch(fail)} /><span>Also on the projector screens</span></label>
    <div class="hint">Scrolls along the bottom of the stream.</div>
  </div>`;
}

// What the stream shows (camera, slides, both, auto), and words on the camera view.
function StreamScene({ s }) {
  const cfg = s.config;
  return html`
      <div>
        <div class="seg-label">Stream shows</div>
        <div class="seg" role="radiogroup" aria-label="What the stream shows">
          ${[['camera', 'Camera'], ['slides', 'Slides'], ['pip', 'Slides + camera'], ['auto', 'Auto']].map(([id, label]) => html`
            <button role="radio" aria-checked=${(cfg.streamScene || 'camera') === id} class=${(cfg.streamScene || 'camera') === id ? 'on' : ''}
              onClick=${() => api('/api/config', { streamScene: id }).catch(fail)}>${label}</button>`)}
        </div>
        <div class="hint" style="margin-top:6px">${{
          camera: 'The camera, full screen.',
          slides: 'Exactly what is on the projector.',
          pip: 'The projector picture with the camera in a small window.',
          auto: 'Slides + camera while words are on screen; just the camera when the screens are clear.',
        }[cfg.streamScene || 'camera']}</div>
      </div>
      ${(cfg.streamScene || 'camera') !== 'slides' && (cfg.streamScene || 'camera') !== 'pip' && html`
        <label class="switch" style="min-height:36px"><input type="checkbox" checked=${cfg.streamCaptions} onChange=${(e) => api('/api/config', { streamCaptions: e.target.checked }).catch(fail)} /><span>Words along the bottom of the camera view</span></label>`}`;
}

// The projector shows the live stream picture (exactly what online viewers see) instead of the slides.
function StreamOnScreens({ s }) {
  const on = !!s.streamOnScreens;
  return html`<label class="switch" style="min-height:36px;margin-top:8px" title="The projector shows the stream: camera, slides, names and ticker"><input type="checkbox" checked=${on}
    onChange=${(e) => api('/api/toggle', { name: 'streamOnScreens', value: e.target.checked }).catch(fail)} /><span>Show the live stream on the screens${on && s.stream.mode === 'preview' ? ' (camera preview)' : ''}</span></label>`;
}

function Aside({ s, onGoLive, onStop, active }) {
  const st = s.stream;
  const cfg = s.config;
  const slide = s.live && s.live.item.slides[s.live.index];
  const configured = Object.values(cfg.outputs).some((o) => o.enabled && o.hasKey) || cfg.record;
  const dests = Object.entries(st.destinations || {});
  return html`<aside class=${'aside' + (active ? ' active' : '')}>
    <div class="card mini">
      <div class="card-head"><b>Screens</b>
        <span class="note-r">${s.projectorOpen
          ? html`<button class="btn small ghost" onClick=${() => api('/api/projector/close', {}).catch(fail)}>Close window</button>`
          : html`<button class="btn small" onClick=${openProjector}>Open on projector</button>`}</span></div>
      ${s.streamOnScreens && !s.black
        ? html`<div class="screen-thumb feed"><img src="/stream.mjpeg" alt="The live stream on the screens" /></div>`
        : html`<${Screen} slide=${slide} kind=${s.live && s.live.item.kind} subtitle=${s.live && s.live.item.subtitle} theme=${cfg.theme} bg=${effectiveBg(slide, s.live && s.live.item, cfg.theme)} churchName=${cfg.churchName} black=${s.black} clear=${s.clear} logo=${s.logo}
        lt=${cfg.lowerThirdOnProjector && s.lowerThird.visible && (s.lowerThird.name || s.lowerThird.title) ? s.lowerThird : null}
        countdown=${s.live && s.live.item.kind === 'countdown' ? s.live.item.countdown : null} skew=${s.now - (s.receivedAt || s.now)} />`}
      <${StreamOnScreens} s=${s} />
    </div>

    <div class="card stack vol-hide">
      <div class="card-head" style="margin:0"><b>Live stream</b>
        <span class="note-r">${st.mode === 'live'
          ? html`<span class="dests">${dests.map(([id, d]) => html`<span class="dest" key=${id}><span class=${'dot ' + d.state}></span>${d.label}</span>`)}${st.recording && html`<span class="dest"><span class="dot ok"></span>Rec</span>`}</span>`
          : st.mode === 'preview'
            ? html`<button class="btn small ghost" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop preview</button>`
            : html`<button class="btn small ghost" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Preview camera</button>`}</span></div>
      ${st.mode !== 'off' ? html`<${PreviewImage} running=${true} /><${Meter} />` : html`<div class="muted" style="font-size:13px">Camera is off. ${configured ? 'It starts when you go live.' : ''}</div>`}
      <${StreamPhase} s=${s} />
      ${s.streamPageOpen && s.studioOn
        ? html`<div class="note stream-elsewhere"><span><b>The stream is being run from the stream page.</b> Cameras, scenes and transitions are on that screen. Go live and End stay here too.</span></div>`
        : html`<${CameraSwitch} s=${s} /><${StreamScene} s=${s} />`}
      <${RecordingOptions} s=${s} compact=${true} />
      ${!configured
        ? html`<button class="btn big" onClick=${() => navigate('/settings#streaming')}>Set up YouTube & Facebook</button>`
        : st.mode === 'live'
          ? html`<button class="btn big" onClick=${onStop}>End live stream</button>`
          : html`<button class="btn big danger" onClick=${onGoLive}>${icons.radio()} Go live</button>`}
    </div>

    <${NameOnStream} s=${s} />
    <${TickerCard} s=${s} />
    <${MusicCard} s=${s} />
  </aside>`;
}

// ---------------------------------------------------------------------------------------
// dialogs
function broadcastTitle(cfg, sermon) {
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return String(cfg.broadcastTitle || '{church} · Sabbath Service · {date}')
    .replace(/\{church\}/g, cfg.churchName || 'Our Church').replace(/\{date\}/g, date).replace(/\{sermon\}/g, sermon || '')
    .replace(/\s*[·|-]\s*$/, '').replace(/\s+/g, ' ').trim();
}

function TitleHelper({ s }) {
  const [sermon, setSermon] = useState('');
  const uses = /\{sermon\}/.test(s.config.broadcastTitle || '');
  const title = broadcastTitle(s.config, sermon);
  const yt = s.config.outputs.youtube.enabled && s.config.outputs.youtube.hasKey;
  const fb = s.config.outputs.facebook.enabled && s.config.outputs.facebook.hasKey;
  return html`<div class="note" style="margin-top:12px">
    <div class="label" style="margin-bottom:4px">Broadcast title</div>
    ${uses && html`<input class="input" style="margin-bottom:6px" placeholder="Sermon title (optional)" value=${sermon} onInput=${(e) => setSermon(e.target.value)} />`}
    <div class="row"><b class="grow" style="color:var(--text)">${title}</b><button class="btn small" onClick=${() => navigator.clipboard.writeText(title).then(() => toast('Title copied'), () => fail(new Error('Could not copy')))}>Copy</button></div>
    <div style="margin-top:6px">Paste it into ${yt ? html`<a href="https://studio.youtube.com" target="_blank" rel="noopener">YouTube Studio</a>` : ''}${yt && fb ? ' and ' : ''}${fb ? html`<a href="https://www.facebook.com/live/producer" target="_blank" rel="noopener">Facebook Live Producer</a>` : ''}${!yt && !fb ? 'YouTube Studio or Facebook Live Producer' : ''}. The pattern is set in Settings → YouTube & Facebook.</div>
  </div>`;
}

const camUsable = (v) => !!v && ((v.type === 'dshow' && !!v.device) || (v.type === 'rtsp' && !!v.rtspUrl) || v.type === 'testsrc' || v.type === 'phone');
const hasCam2 = (cfg) => camUsable(cfg.video2);
const CAMERA_KEYS = ['video', 'video2', 'video3', 'video4'];
// The cameras that are set up: 1 and 2, plus 3 and 4 with the studio (scenes on the stream page).
const cameraNumbers = (s) => [1, ...[2, 3, 4].filter((n) => (n === 2 || s.studioOn) && camUsable(s.config[CAMERA_KEYS[n - 1]]))];
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "Starting soon" / "Thank you for watching" on the stream, with a way to skip ahead.
function StreamPhase({ s }) {
  const ph = s.stream.phase;
  const [, tick] = useState(0);
  useEffect(() => { if (!ph) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [ph && ph.until]);
  if (!ph) return null;
  const left = Math.max(0, Math.round((ph.until - serverNow(s)) / 1000));
  return html`<div class="note row" style="margin:0;gap:8px">
    <span class="grow">${ph.kind === 'start'
      ? html`<b>Starting screen</b> on the stream until ${clock(ph.until)}`
      : html`<b>Thank-you screen</b> · the stream ends in ${left} s`}</span>
    ${ph.kind === 'start'
      ? html`<button class="btn small" onClick=${() => api('/api/stream/begin', {}).catch(fail)}>Start service now</button>`
      : html`<button class="btn small danger" onClick=${() => api('/api/stream/stop', { now: true }).catch(fail)}>End now</button>`}
  </div>`;
}

// Camera 1 / Camera 2 on air.
function CameraSwitch({ s }) {
  const cfg = s.config;
  const cams = cameraNumbers(s);
  if (cams.length < 2) return null;
  const downList = s.stream.camerasDown || (s.stream.camera2 === 'down' ? [2] : []);
  const down = downList.includes(2);
  const cur = downList.includes(cfg.activeCamera) ? 1 : cfg.activeCamera || 1;
  return html`<div>
    <div class="seg-label">Camera on air <span class="muted" style="font-weight:400">(keys ${cams.join(', ').replace(/, (\d)$/, ' and $1')})</span></div>
    <div class="seg" role="radiogroup" aria-label="Camera on air" style=${`grid-template-columns:repeat(${cams.length},1fr)`}>
      ${cams.map((n) => html`<button role="radio" aria-checked=${cur === n} class=${cur === n ? 'on' : ''} disabled=${downList.includes(n)} onClick=${() => api('/api/camera', { camera: n }).catch(fail)}>${cams.length > 2 ? n : `Camera ${n}`}${downList.includes(n) ? ' ⚠' : ''}</button>`)}
    </div>
    ${downList.filter((n) => n !== 2).map((n) => html`<div class="hint" style="margin-top:6px;color:var(--danger,#d92d20)">Camera ${n} stopped; the stream carries on without it. It comes back by itself once it works again.</div>`)}
    ${down && html`<div class="hint" style="margin-top:6px;color:var(--danger,#d92d20)">Camera 2 stopped, so the stream is showing camera 1. Check its cable; it comes back by itself within about 30 seconds of working again.</div>`}
    ${s.stream.camera2 === 'back' && html`<div class="hint" style="margin-top:6px;color:var(--ok)">Camera 2 is back.</div>`}
  </div>`;
}

// Recording on this computer: on/off, quality, and each camera on its own. Shown on the Live
// stream card (easy to find) and in Settings.
const STREAM_GB = { low: 0.6, good: 1.2, high: 2.1 };
function RecordingOptions({ s, compact }) {
  const cfg = s.config;
  const live = s.stream.mode === 'live';
  const size = { low: '480p', good: '720p', high: '1080p' }[cfg.quality] || '720p';
  const opts = compact ? [
    ['stream', `Same as stream (${size}) · ${STREAM_GB[cfg.quality] || 1.2} GB/h`],
    ['hd', '720p high · 2.3 GB/h'],
    ['fullhd', '1080p high · 3.6 GB/h'],
    ['best', '1080p best · 5.5 GB/h'],
  ] : [
    ['stream', `Same as the stream (${size}) · about ${STREAM_GB[cfg.quality] || 1.2} GB per hour`],
    ['hd', '720p, high quality · about 2.3 GB per hour'],
    ['fullhd', '1080p, high quality · about 3.6 GB per hour'],
    ['best', '1080p, best · about 5.5 GB per hour'],
  ];
  const q = cfg.recordQuality || 'stream';
  const gpu = s.stream.encoder && !/libx264/.test(s.stream.encoder);
  return html`<div class="stack" style="gap:6px">
    <label class="switch" style="min-height:36px"><input type="checkbox" checked=${!!cfg.record} onChange=${(e) => save({ record: e.target.checked })} /><span>Record this service on this computer</span></label>
    ${cfg.record && html`
      <select class="select" aria-label="Recording quality" value=${q} onChange=${(e) => save({ recordQuality: e.target.value })}>
        ${opts.map(([id, label]) => html`<option value=${id}>${label}</option>`)}</select>
      ${!compact && html`<div class="hint" style="margin-top:0">${q === 'stream'
        ? 'Saves exactly what viewers see, with no extra work for the computer.'
        : html`Saved at higher quality than the stream, for editing or uploading later. It's encoded separately${gpu ? ' on the graphics card' : html`, which uses <b>more processor</b> without a graphics encoder`}.`}</div>`}
      ${hasCam2(cfg) || !compact ? html`<label class="switch" style="min-height:32px"><input type="checkbox" checked=${!!cfg.recordCameras} onChange=${(e) => save({ recordCameras: e.target.checked })} /><span>Also record each camera on its own${compact ? '' : ' (no slides or names)'}</span></label>` : ''}
      ${live && html`<div class="hint" style="margin-top:0">Changes apply the next time you go live.</div>`}
      ${!compact && html`<div class="hint" style="margin-top:0">Recordings are saved in the <b>ChurchStream-data${s.platform === 'win32' ? '\\' : '/'}recordings</b> folder${cfg.recordCameras ? ', with each camera as its own file (“… - Camera 1.mkv”)' : ''}.</div>`}`}
  </div>`;
}

function GoLiveDialog({ s, onClose }) {
  const st = s.stream;
  const cfg = s.config;
  const [loud, setLoud] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (st.mode === 'off') api('/api/stream/start', { mode: 'preview' }).catch(() => {});
    const on = (e) => setLoud(e.detail);
    meterBus.addEventListener('m', on);
    return () => meterBus.removeEventListener('m', on);
  }, []);
  const dests = [cfg.outputs.youtube.enabled && cfg.outputs.youtube.hasKey && 'YouTube', cfg.outputs.facebook.enabled && cfg.outputs.facebook.hasKey && 'Facebook', cfg.outputs.custom.enabled && cfg.outputs.custom.hasKey && 'Custom server'].filter(Boolean);
  const sound = loud !== null && loud > -50;
  const go = async () => {
    setBusy(true);
    try { await api('/api/stream/start', { mode: 'live', startScreen: !!(cfg.startScreen && cfg.startScreen.enabled) }); onClose(); toast('You are live'); } catch (err) { fail(err); setBusy(false); }
  };
  return html`<${Modal} title="Ready to go live?" onClose=${onClose} footer=${html`
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn danger" disabled=${busy} onClick=${go}>${busy ? 'Starting…' : 'Go live now'}</button>`}>
    <${PreviewImage} running=${st.mode !== 'off'} />
    <div style="margin-top:12px"><${Meter} /></div>
    <ul class="checklist">
      <li><span class=${st.state === 'running' ? 'ok' : 'bad'}>${st.state === 'running' ? icons.check() : icons.alert()}</span>Camera ${st.state === 'running' ? 'is working' : st.problem ? '— ' + st.problem : 'is starting…'}</li>
      <li><span class=${sound ? 'ok' : 'bad'}>${sound ? icons.check() : icons.alert()}</span>${cfg.audio.source === 'none' ? 'No microphone selected — the stream will be silent' : sound ? 'Sound is coming through' : 'No sound yet — say something into the microphone'}</li>
      <li><span class=${dests.length ? 'ok' : 'bad'}>${dests.length ? icons.check() : icons.alert()}</span>${dests.length ? `Streaming to ${dests.join(' and ')}` : 'Recording only (no YouTube/Facebook key set)'}${cfg.record && dests.length ? ' + recording' : ''}</li>
    </ul>
    <div class="row wrap" style="margin-top:12px;gap:8px">
      <label class="switch" style="min-height:36px"><input type="checkbox" checked=${!!(cfg.startScreen && cfg.startScreen.enabled)} onChange=${(e) => save({ startScreen: { enabled: e.target.checked } })} /><span>Start with a countdown on the stream</span></label>
      ${cfg.startScreen && cfg.startScreen.enabled && html`<select class="select" style="width:auto" aria-label="Countdown length" value=${cfg.startScreen.minutes || 5} onChange=${(e) => save({ startScreen: { minutes: +e.target.value } })}>
        ${[2, 5, 10, 15, 20, 30].map((m) => html`<option value=${m}>${m} minutes</option>`)}</select>`}
    </div>
    ${cfg.startScreen && cfg.startScreen.enabled && html`<div class="hint" style="margin-top:0">Viewers (and the screens) see “${cfg.startScreen.message || 'Our service begins in'}” counting down; then the stream switches to “${{ camera: 'Camera', slides: 'Slides', pip: 'Slides + camera', auto: 'Auto' }[cfg.streamScene || 'camera']}”. You can start sooner.</div>`}
    <${TitleHelper} s=${s} />
    <p class="hint">On YouTube and Facebook, the broadcast may take 10–30 seconds to appear.</p>
  </${Modal}>`;
}

function StopDialog({ s, onClose }) {
  const [busy, setBusy] = useState(false);
  const es = s.config.endScreen || {};
  const end = async () => {
    setBusy(true);
    let r;
    // If ending failed the stream is still live: say so and keep the dialog open.
    try { r = await api('/api/stream/stop', { endScreen: !!es.enabled }); } catch (err) { fail(err); setBusy(false); return; }
    onClose();
    toast(r && r.ending ? `Showing the thank-you screen; the stream ends in ${r.ending} seconds` : 'Stream ended');
  };
  return html`<${Modal} title="End the live stream?" onClose=${onClose} footer=${html`
      <button class="btn" onClick=${onClose}>Keep streaming</button>
      <button class="btn danger" disabled=${busy} onClick=${end}>${es.enabled ? 'Thank viewers, then end' : 'End stream'}</button>`}>
    <label class="switch" style="min-height:36px"><input type="checkbox" checked=${!!es.enabled} onChange=${(e) => save({ endScreen: { enabled: e.target.checked } })} /><span>First show “${es.text || 'Thank you for worshipping with us'}” for</span>
      <select class="select" style="width:auto;margin-left:4px" aria-label="Seconds" value=${es.seconds || 30} onClick=${(e) => e.preventDefault()} onChange=${(e) => save({ endScreen: { seconds: +e.target.value } })}>
        ${[10, 20, 30, 60].map((n) => html`<option value=${n}>${n} seconds</option>`)}</select></label>
    <p class="muted" style="margin:8px 0 0">Viewers will see the broadcast end. Any recording is saved to the Recordings folder.</p>
  </${Modal}>`;
}

function SongEditor({ song, addToService, onClose, onSaved }) {
  const [title, setTitle] = useState(song.title || '');
  const [author, setAuthor] = useState(song.author || '');
  const [lyrics, setLyrics] = useState(song.sections ? sectionsToText(song.sections) : '');
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => parseSections(lyrics), [lyrics]);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api('/api/song', { id: song.id, title, author, lyrics, hymnal: song.hymnal, number: song.number, copyright: song.copyright, ccli: song.ccli });
      if (!addToService) toast('Song saved');
      onSaved && onSaved(saved);
      onClose();
    } catch (err) { fail(err); setBusy(false); }
  };
  const del = async () => {
    if (!confirm(`Delete “${song.title}”?`)) return;
    try { await api('/api/song/delete', { id: song.id }); } catch (err) { fail(err); return; }
    toast('Song deleted');
    onSaved && onSaved(null);
    onClose();
  };
  const dirty = useChanged(title, author, lyrics);
  return html`<${Modal} wide dirty=${dirty && !busy} title=${song.id ? 'Edit song' : 'New song'} onClose=${onClose} footer=${html`
      ${song.id && html`<button class="btn ghost" onClick=${del}>Delete</button>`}<span class="spacer"></span>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy || !title.trim() || !sections.length} onClick=${save}>${addToService ? 'Save and add to service' : 'Save song'}</button>`}>
    <div class="editor">
      <div>
        <div class="two" style="gap:10px">
          <div class="field"><label class="label">Title</label><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} autofocus /></div>
          <div class="field"><label class="label">Author (optional)</label><input class="input" value=${author} onInput=${(e) => setAuthor(e.target.value)} /></div>
        </div>
        <label class="label">Lyrics</label>
        <textarea class="textarea" style="min-height:340px" value=${lyrics} onInput=${(e) => setLyrics(e.target.value)} placeholder=${'Paste the lyrics here.\n\nA blank line starts a new slide.\n\n[Chorus]\nOptional labels go in square brackets.'}></textarea>
        <div class="hint">${song.hymnal ? 'Edited hymns are kept if you download the hymnal again.' : 'A blank line starts a new slide.'}</div>
      </div>
      <div>
        <label class="label">Preview — ${sections.length} slide${sections.length === 1 ? '' : 's'}</label>
        <div class="preview-list">${sections.map((sl, i) => html`<div key=${i}><div class="lbl">${sl.label || `Slide ${i + 1}`}</div><${Screen} slide=${sl} kind="song" /></div>`)}</div>
      </div>
    </div>
  </${Modal}>`;
}

const AUTO_CHOICES = [[0, 'Off — I press Next'], [5, 'Every 5 seconds'], [8, 'Every 8 seconds'], [12, 'Every 12 seconds'], [20, 'Every 20 seconds']];

function TextEditor({ onClose, onAdd, onShow, initial, onSave, preset }) {
  const editing = !!(initial && onSave);
  const [title, setTitle] = useState(editing ? initial.title : (preset ? preset.title : ''));
  const [text, setText] = useState(editing ? sectionsToText(initial.slides) : (preset ? preset.text : ''));
  const [auto, setAuto] = useState((initial && initial.autoAdvance) || 0);
  const [busy, setBusy] = useState(false);
  const slides = useMemo(() => parseSections(text), [text]);
  const name = () => title.trim() || slides[0]?.text.split('\n')[0] || 'Text';
  const item = () => ({ key: 'text:' + Date.now(), kind: 'text', title: name(), subtitle: '', slides, autoAdvance: auto });
  const footer = editing
    ? html`<button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy || !slides.length} onClick=${async () => { setBusy(true); await onSave(name(), slides, auto); onClose(); }}>Save changes</button>`
    : html`<button class="btn" disabled=${!slides.length} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!slides.length} onClick=${() => { onShow(item()); onClose(); }}>Show now</button>`;
  const dirty = useChanged(title, text, auto);
  return html`<${Modal} dirty=${dirty && !busy} title=${editing ? 'Edit text slides' : 'Text slides'} onClose=${onClose} footer=${footer}>
    <div class="field"><label class="label">Name (shown in the order of service)</label><input class="input" value=${title} placeholder="e.g. Announcements" onInput=${(e) => setTitle(e.target.value)} /></div>
    <label class="label">Text</label>
    <textarea class="textarea" style="min-height:220px" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Welcome to our service!\n\nA blank line starts a new slide.'} autofocus=${editing}></textarea>
    <div class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'} · a blank line starts a new slide · sunset times: <kbd>{sunset}</kbd> <kbd>{sabbath-begins}</kbd> <kbd>{sabbath-ends}</kbd> <kbd>{next-sabbath-begins}</kbd></div>
    ${/\{(sunset|sabbath-|next-sabbath)/.test(text) && html`<div class="note" style="margin-top:8px;white-space:pre-line">${!SAB ? 'Set your church’s location in Settings → General so ChurchStream can work out sunset times.' : fillSabbath(slides.map((x) => x.text).join('\n\n'), SAB)}</div>`}
    <div class="field" style="margin-top:14px"><label class="label">Change slides automatically (loops — good for announcements)</label>
      <select class="select" value=${auto} onChange=${(e) => setAuto(+e.target.value)}>${AUTO_CHOICES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>
  </${Modal}>`;
}

// Responsive readings: the leader and the congregation take turns; the last part is read by all.
const isResponsive = (it) => !!(it && it.slides && it.slides.length && it.slides.every((x) => x.part));
const PART_WORDS = { leader: 'Leader', people: 'Congregation', all: 'All' };
function parseResponsive(text) {
  const paras = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let next = 'leader';
  return paras.map((p) => {
    const m = /^(leader|minister|pastor|l|congregation|people|c|p|all|a)\s*:\s*/i.exec(p);
    let part = next;
    if (m) {
      const w = m[1].toLowerCase();
      part = /^(leader|minister|pastor|l)$/.test(w) ? 'leader' : /^(all|a)$/.test(w) ? 'all' : 'people';
      p = p.slice(m[0].length);
    }
    next = part === 'leader' ? 'people' : 'leader';
    return { label: PART_WORDS[part], text: p, part };
  });
}
const responsiveText = (slides) => slides.map((x) => `${PART_WORDS[x.part] || 'Leader'}: ${x.text}`).join('\n\n');

function ResponsiveEditor({ onClose, onAdd, onShow, initial, onSave }) {
  const editing = !!(initial && onSave);
  const [title, setTitle] = useState(editing ? initial.title : '');
  const [text, setText] = useState(editing ? responsiveText(initial.slides) : '');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const slides = useMemo(() => parseResponsive(text), [text]);
  // Fill in from a Bible passage: verses alternate leader / congregation, the last is read by all.
  const fromBible = async () => {
    if (!ref.trim()) return;
    setBusy(true);
    try {
      const r = await get('/api/search', { q: ref.trim() });
      if (!r.bible) throw new Error('Type a passage like “Psalm 100” or “Isaiah 40:28-31”.');
      const verses = r.bible.slides.flatMap((sl) => (sl.verses && sl.verses.length ? sl.verses : [{ n: '', text: sl.text }]));
      const parts = verses.map((v, i) => (i === verses.length - 1 && verses.length > 2 ? 'all' : i % 2 ? 'people' : 'leader'));
      setText(verses.map((v, i) => `${PART_WORDS[parts[i]]}: ${v.text}`).join('\n\n'));
      if (!title.trim()) setTitle(r.bible.title + (r.bible.translation ? ' (' + r.bible.translation + ')' : ''));
    } catch (err) { fail(err); }
    setBusy(false);
  };
  const name = () => title.trim() || 'Responsive reading';
  const item = () => ({ key: 'text:' + Date.now(), kind: 'text', title: name(), subtitle: 'Responsive reading', slides });
  const footer = editing
    ? html`<button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${!slides.length} onClick=${async () => { await onSave(name(), slides); onClose(); }}>Save changes</button>`
    : html`<button class="btn" disabled=${!slides.length} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!slides.length} onClick=${() => { onShow(item()); onClose(); }}>Show now</button>`;
  const dirty = useChanged(title, text);
  return html`<${Modal} wide dirty=${dirty && !busy} title=${editing ? 'Edit responsive reading' : 'Responsive reading'} onClose=${onClose} footer=${footer}>
    <div class="editor">
      <div>
        <div class="field"><label class="label" for="rr-ref">Start from a Bible passage (optional)</label>
          <div class="key-row"><input id="rr-ref" class="input" placeholder="e.g. Psalm 100 or Isaiah 40:28-31" value=${ref} onInput=${(e) => setRef(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && fromBible()} />
            <button class="btn" disabled=${busy || !ref.trim()} onClick=${fromBible}>${busy ? 'Finding…' : 'Fill in'}</button></div></div>
        <div class="field"><label class="label" for="rr-title">Name (shown in the order of service)</label><input id="rr-title" class="input" value=${title} placeholder="e.g. Psalm 100" onInput=${(e) => setTitle(e.target.value)} /></div>
        <label class="label" for="rr-text">Reading</label>
        <textarea id="rr-text" class="textarea" style="min-height:240px" value=${text} onInput=${(e) => setText(e.target.value)}
          placeholder=${'Leader: Make a joyful noise unto the Lord, all ye lands.\n\nCongregation: Serve the Lord with gladness: come before his presence with singing.\n\nAll: For the Lord is good; his mercy is everlasting.'}></textarea>
        <div class="hint">Start each part with <b>Leader:</b>, <b>Congregation:</b> or <b>All:</b>, with a blank line between parts. Parts without a name take turns. The congregation's words are shown in gold so everyone knows when to read.</div>
      </div>
      <div><label class="label">Preview · ${slides.length} slide${slides.length === 1 ? '' : 's'}</label>
        <div class="preview-list">${slides.map((sl, i) => html`<div key=${i}><div class="lbl">${i + 1}. ${sl.label}</div><${Screen} slide=${sl} kind="text" /></div>`)}</div></div>
    </div>
  </${Modal}>`;
}

// Countdown before the service, with optional announcements rotating underneath.
function CountdownEditor({ onClose, onAdd, onShow, initial, onSave }) {
  const editing = !!(initial && onSave);
  const cd0 = (initial && initial.countdown) || {};
  const [title, setTitle] = useState((initial && initial.title) || 'Countdown');
  const [mode, setMode] = useState(cd0.mode || 'minutes');
  const [minutes, setMinutes] = useState(cd0.minutes || 5);
  const [until, setUntil] = useState(cd0.until || '11:00');
  const [message, setMessage] = useState(cd0.message ?? 'Our service begins in');
  const [endText, setEndText] = useState(cd0.endText ?? 'Welcome!');
  const [text, setText] = useState(initial ? sectionsToText((initial.slides || []).filter((x) => x.text)) : '');
  const [auto, setAuto] = useState((initial && initial.autoAdvance) || 8);
  const slides = useMemo(() => parseSections(text), [text]);
  const countdown = { mode, minutes: +minutes || 5, until, message, endText };
  const item = () => ({ key: 'countdown:' + Date.now(), kind: 'countdown', title: title.trim() || 'Countdown', subtitle: '', countdown, slides: slides.length ? slides : [{ label: '', text: '' }], autoAdvance: slides.length > 1 ? auto : 0 });
  const footer = editing
    ? html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${async () => { const it = item(); await onSave(it); onClose(); }}>Save changes</button>`
    : html`<button class="btn" onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button><button class="btn primary" onClick=${() => { onShow(item()); onClose(); }}>Start now</button>`;
  const dirty = useChanged(title, mode, minutes, until, message, endText, text, auto);
  return html`<${Modal} wide dirty=${dirty} title=${editing ? 'Edit countdown' : 'Countdown'} onClose=${onClose} footer=${footer}>
    <div class="editor">
      <div>
        <div class="choices" style="margin-bottom:12px">
          <button class=${'choice' + (mode === 'minutes' ? ' on' : '')} onClick=${() => setMode('minutes')}><b>Count down</b><span>A number of minutes from when it starts</span></button>
          <button class=${'choice' + (mode === 'until' ? ' on' : '')} onClick=${() => setMode('until')}><b>Until a time</b><span>E.g. the service starts at 11:00</span></button>
        </div>
        ${mode === 'minutes'
          ? html`<div class="field"><label class="label">Minutes</label><input class="input" type="number" min="1" max="180" value=${minutes} onInput=${(e) => setMinutes(e.target.value)} /></div>`
          : html`<div class="field"><label class="label">Service starts at</label><input class="input" type="time" value=${until} onInput=${(e) => setUntil(e.target.value)} /></div>`}
        <div class="two" style="gap:10px">
          <div class="field"><label class="label">Words above the timer</label><input class="input" value=${message} onInput=${(e) => setMessage(e.target.value)} /></div>
          <div class="field"><label class="label">When it reaches zero</label><input class="input" value=${endText} onInput=${(e) => setEndText(e.target.value)} /></div>
        </div>
        <label class="label">Announcements under the timer (optional — a blank line starts the next one)</label>
        <textarea class="textarea" style="min-height:150px" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Potluck lunch after the service\n\nPrayer meeting Wednesday 7 pm\n\nPathfinders meet Sunday at 10'}></textarea>
        ${slides.length > 1 && html`<div class="field" style="margin-top:10px"><label class="label">Change announcement</label>
          <select class="select" value=${auto} onChange=${(e) => setAuto(+e.target.value)}>${AUTO_CHOICES.filter(([v]) => v).map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>`}
        <div class="field" style="margin-top:10px"><label class="label">Name in the order of service</label><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} /></div>
      </div>
      <div><label class="label">Preview</label><${Screen} slide=${slides[0] || { text: '' }} kind="countdown" countdown=${countdown} /></div>
    </div>
  </${Modal}>`;
}

const fmtDur = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

// Where a video / music item is, as a bar to drag or tap. While it's being dragged it shows
// where it will jump to; letting go jumps there (once).
function Scrubber({ shown, dur, loop, onSeek }) {
  const [drag, setDrag] = useState(null);
  const at = drag ?? shown;
  const pct = dur ? Math.min(100, (at / dur) * 100) : 0;
  return html`<div class="media-progress grow">
    <input type="range" class="scrub" min="0" max=${dur || 1} step="0.1" value=${dur ? Math.min(at, dur) : 0} disabled=${!dur}
      style=${`--p:${pct}%`} aria-label="Position" aria-valuetext=${`${fmtDur(at)} of ${dur ? fmtDur(dur) : 'unknown'}`}
      onInput=${(e) => setDrag(+e.target.value)}
      onChange=${(e) => { setDrag(null); onSeek(+e.target.value); }}
      onBlur=${() => setDrag(null)} />
    <span class="muted">${fmtDur(at)} / ${dur ? fmtDur(dur) : '–:––'}${loop ? ' · loops' : ''}</span></div>`;
}

// ‹ 10 s and 10 s › for a precise jump on a touch screen.
const SkipButtons = ({ shown, dur, onSeek }) => html`
  <button class="btn big ghost" title="Back 10 seconds" aria-label="Back 10 seconds" onClick=${() => onSeek(Math.max(0, shown - 10))}>‹ 10 s</button>
  <button class="btn big ghost" title="Forward 10 seconds" aria-label="Forward 10 seconds" disabled=${!dur} onClick=${() => onSeek(Math.min(dur, shown + 10))}>10 s ›</button>`;

// Jump to a place in the item: put it on screen first if it isn't (so dragging before Play works).
const seekTo = async (isLive, onShow, at) => {
  try {
    if (!isLive) await onShow();
    await api('/api/media/control', { action: 'seek', at });
  } catch (err) { fail(err); }
};

// Video / music item: big transport controls instead of a slide grid.
// A video/music item's current settings: from the item on screen, else the order of service.
function currentMedia(s, item) {
  if (s.live && s.live.item.key === item.key && s.live.item.media) return s.live.item.media;
  const p = s.plan.items.find((x) => x.uid === item.key);
  return (p && p.media) || item.media || {};
}

// Settings that can be changed after a video, music or YouTube item was added.
function MediaSettings({ s, item }) {
  const m = currentMedia(s, item);
  const yt = m.type === 'youtube';
  const set = (patch) => api('/api/media/settings', { key: item.key, patch }).catch(fail);
  const [start, setStart] = useState(fmtDur((m.youtube && m.youtube.start) || 0));
  return html`<div class="media-settings">
    <label class="switch"><input type="checkbox" checked=${!!m.loop} onChange=${(e) => set({ loop: e.target.checked })} /><span>Repeat until stopped</span></label>
    ${!yt && html`<label class="switch"><input type="checkbox" checked=${m.room !== false} onChange=${(e) => set({ room: e.target.checked })} /><span>${m.type === 'audio' ? 'Also play through this computer (for the room)' : 'Play the sound in the room too'}</span></label>`}
    <label class="row" style="gap:8px">${icons.music()}<span class="muted" style="font-size:13px">Volume</span>
      <input type="range" min="0" max=${yt ? 1 : 1.5} step="0.05" value=${m.volume ?? 1} onChange=${(e) => set({ volume: +e.target.value })} aria-label="Volume" /></label>
    ${yt && html`<label class="row" style="gap:8px"><span class="muted" style="font-size:13px">Start at</span>
      <input class="input" style="width:80px" value=${start} onInput=${(e) => setStart(e.target.value)} placeholder="0:00"
        onBlur=${() => { const [a, b] = start.split(':').map(Number); const secs = b === undefined ? a : a * 60 + b; if (Number.isFinite(secs)) set({ start: secs }); }} aria-label="Start at" /></label>`}
  </div>`;
}

function MediaPanel(props) {
  return props.item.media && props.item.media.type === 'youtube' ? html`<${YouTubePanel} ...${props} />` : html`<${FilePanel} ...${props} />`;
}

const ytThumb = (y) => (y && y.id ? `https://i.ytimg.com/vi/${y.id}/hqdefault.jpg` : '');

// A YouTube item: plays in YouTube's player on the projector (needs internet).
function YouTubePanel({ s, item, isLive, onShow }) {
  const m = currentMedia(s, item);
  const playing = s.media && s.media.now && s.media.now.id === item.key ? s.media.now : null;
  const [, tick] = useState(0);
  useEffect(() => { if (!playing || playing.paused) return undefined; const id = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(id); }, [playing && playing.startedAt, playing && playing.paused]);
  const skew = s.now - (s.receivedAt || s.now);
  const elapsed = playing ? ((playing.paused ? playing.pausedAt : Date.now() + skew) - playing.startedAt) / 1000 : 0;
  const dur = (playing && playing.duration) || m.duration || 0;
  const shown = m.loop && dur ? elapsed % dur : Math.min(elapsed, dur || elapsed);
  const ctl = (body) => api('/api/media/control', body).catch(fail);
  return html`<div class="media-panel">
    <div class="media-view">
      ${ytThumb(m.youtube) ? html`<img src=${ytThumb(m.youtube)} alt="" style="width:100%;height:100%;object-fit:cover;opacity:${playing ? 1 : 0.75}" onError=${(e) => { e.target.style.display = 'none'; }} />` : html`<div class="media-audio">${icons.yt()}<span>${item.title}</span></div>`}
      ${playing && html`<span class="tag live" style="position:absolute;top:12px;left:12px">${playing.paused ? 'PAUSED' : 'PLAYING ON THE PROJECTOR'}</span>`}
    </div>
    <div class="media-bar">
      ${playing
        ? html`${playing.paused
            ? html`<button class="btn big primary" onClick=${() => ctl({ action: 'resume' })}>${icons.play()} Resume</button>`
            : html`<button class="btn big" onClick=${() => ctl({ action: 'pause' })}>${icons.pause()} Pause</button>`}
               <button class="btn big" onClick=${() => ctl({ action: 'stop' })}>${icons.stop()} Stop</button>
               <button class="btn big ghost" onClick=${() => ctl({ action: 'restart' })}>From the start</button>
               <${SkipButtons} shown=${shown} dur=${dur} onSeek=${(t) => seekTo(true, onShow, t)} />`
        : html`<button class="btn big primary" onClick=${() => (isLive ? ctl({ action: 'play' }) : onShow())}>${icons.play()} Play</button>`}
      <${Scrubber} shown=${shown} dur=${dur} loop=${m.loop} onSeek=${(t) => seekTo(isLive, onShow, t)} />
    </div>
    <${MediaSettings} s=${s} item=${item} />
    <div class="hint" style="padding:0 18px 16px">Plays from YouTube on the projector, so it needs internet. The live stream shows a “now playing” card (or the camera), and online viewers hear it only through your microphones. To put the video itself into the stream, download it instead (+ Add → Video, music or YouTube).</div>
  </div>`;
}

// A video / music file from the media library.
function FilePanel({ s, item, isLive, onShow }) {
  const m = currentMedia(s, item);
  const playing = s.media && s.media.now && s.media.now.id === item.key ? s.media.now : null;
  const [, tick] = useState(0);
  const paused = !!(playing && playing.paused);
  useEffect(() => { if (!playing || paused) return undefined; const id = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(id); }, [playing && playing.startedAt, paused]);
  const skew = s.now - (s.receivedAt || s.now);
  const elapsed = playing ? ((paused ? playing.pausedAt : Date.now() + skew) - playing.startedAt) / 1000 : 0;
  const dur = m.duration || 0;
  const shown = m.loop && dur ? elapsed % dur : Math.min(elapsed, dur || elapsed);
  const src = '/media/' + encodeURIComponent((m.file || '').replace(/^media:/, ''));
  const ctl = (body) => api('/api/media/control', body).catch(fail);
  return html`<div class="media-panel">
    <div class="media-view">
      ${m.type === 'video'
        ? html`<video src=${src} muted preload="metadata" ref=${(el) => {
          if (!el) return;
          if (playing && Math.abs(el.currentTime - shown) > 1) el.currentTime = shown;
          if (playing && !paused) { if (el.paused) el.play().catch(() => {}); } else if (!el.paused) el.pause();
        }}></video>`
        : html`<div class="media-audio">${icons.music()}<span>${item.title}</span></div>`}
      ${playing && html`<span class="tag live" style="position:absolute;top:12px;left:12px">${paused ? 'PAUSED' : m.type === 'video' ? 'PLAYING ON SCREEN & STREAM' : 'PLAYING'}</span>`}
    </div>
    <div class="media-bar">
      ${playing
        ? html`${paused
            ? html`<button class="btn big primary" onClick=${() => ctl({ action: 'resume' })}>${icons.play()} Resume</button>`
            : html`<button class="btn big" onClick=${() => ctl({ action: 'pause' })}>${icons.pause()} Pause</button>`}
               <button class="btn big" onClick=${() => ctl({ action: 'stop' })}>${icons.stop()} Stop</button>
               <button class="btn big ghost" onClick=${() => ctl({ action: 'restart' })}>From the start</button>
               <${SkipButtons} shown=${shown} dur=${dur} onSeek=${(t) => seekTo(true, onShow, t)} />`
        : html`<button class="btn big primary" onClick=${() => (isLive ? api('/api/media/control', { action: 'play' }).catch(fail) : onShow())}>${icons.play()} Play</button>`}
      <${Scrubber} shown=${shown} dur=${dur} loop=${m.loop} onSeek=${(t) => seekTo(isLive, onShow, t)} />
    </div>
    <${MediaSettings} s=${s} item=${item} />
    <div class="hint" style="padding:0 18px 16px">${m.type === 'video'
      ? 'The video fills the projector and the stream while it plays (names and the ticker stay on top). Background music pauses during the video.'
      : 'The music plays on the stream' + (m.room !== false ? ' and through this computer’s speakers.' : '.')}</div>
  </div>`;
}

function uploadClip(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } if (x.status >= 400 || d.error) reject(new Error(d.error || 'Upload failed')); else resolve(d); };
    x.onerror = () => reject(new Error('Upload failed'));
    x.send(file);
  });
}

function useClips() {
  const [clips, setClips] = useState(null);
  const load = () => get('/api/clips').then(setClips).catch(fail);
  useEffect(() => { load(); }, []);
  return [clips, load, setClips];
}

function ClipList({ clips, selected, onPick, onDelete, type }) {
  const list = (clips || []).filter((c) => !type || c.type === type);
  if (!clips) return html`<div class="muted">Loading…</div>`;
  if (!list.length) return html`<div class="note">Nothing here yet. Add a file above.</div>`;
  return html`<div class="clip-list">${list.map((c) => html`<div class=${'clip' + (selected && selected.includes(c.id) ? ' on' : '')} key=${c.id} onClick=${() => onPick(c)}>
    <span class="clip-icon">${c.type === 'video' ? icons.film() : icons.music()}</span>
    <span class="grow"><b>${c.name}</b><span class="muted"> · ${c.type === 'video' ? 'video' : 'music'}${c.duration ? ' · ' + fmtDur(c.duration) : ''}</span></span>
    ${onDelete && html`<button class="btn ghost small" onClick=${(e) => { e.stopPropagation(); onDelete(c); }}>Delete</button>`}
  </div>`)}</div>`;
}

function pickFiles(accept, multiple, onFiles) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
  inp.onchange = () => onFiles([...inp.files]);
  inp.click();
}
const MEDIA_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac,.m4a';

// Add a video (Mission Spotlight, special music, …) or a music track to the order of service.
// Paste a YouTube link: play it from YouTube, or save a copy to this computer.
function YouTubeBox({ s, onItem, onDownloaded }) {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loop, setLoop] = useState(false);
  const dl = s.download;
  // A download that finished before this was opened (e.g. last week's) isn't picked again.
  const doneRef = useRef(dl && dl.state === 'done' && dl.clip ? dl.clip.id : null);
  useEffect(() => {
    if (dl && dl.state === 'done' && dl.clip && doneRef.current !== dl.clip.id) { doneRef.current = dl.clip.id; onDownloaded(dl.clip); }
  }, [dl && dl.state, dl && dl.clip && dl.clip.id]);
  const check = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try { setInfo(await get('/api/youtube?url=' + encodeURIComponent(url.trim()))); } catch (err) { setInfo(null); fail(err); }
    setBusy(false);
  };
  const item = () => ({ key: 'yt:' + Date.now(), kind: 'media', title: info.title, subtitle: info.author || '', slides: [{ label: info.title, text: '' }],
    media: { type: 'youtube', youtube: { id: info.id, list: info.list, start: info.start }, loop, volume: 1 } });
  const download = (kind) => api('/api/youtube/download', { url: url.trim(), kind }).catch(fail);
  const working = dl && dl.state === 'working';
  return html`<div class="yt-box">
    <div class="row">
      <span class="yt-logo">${icons.yt()}</span>
      <input class="input grow" placeholder="Paste a YouTube link (Share → Copy link)" value=${url}
        onInput=${(e) => { setUrl(e.target.value); setInfo(null); }} onKeyDown=${(e) => e.key === 'Enter' && check()} />
      <button class="btn" disabled=${busy || !url.trim()} onClick=${check}>${busy ? 'Checking…' : 'Find'}</button>
    </div>
    ${info && html`<div class="yt-found">
      ${ytThumb(info) && html`<img src=${ytThumb(info)} alt="" onError=${(e) => { e.target.style.display = 'none'; }} />`}
      <div class="grow">
        <b>${info.title}</b>${info.author && html`<div class="muted">${info.author}</div>`}
        <label class="switch" style="min-height:36px"><input type="checkbox" checked=${loop} onChange=${(e) => setLoop(e.target.checked)} /><span>Repeat until stopped</span></label>
        <div class="row wrap" style="margin-top:6px">
          <button class="btn" onClick=${() => onItem(item(), 'add')}>Add to service</button>
          <button class="btn primary" onClick=${() => onItem(item(), 'show')}>${icons.play()} Play from YouTube</button>
        </div>
        <div class="row wrap" style="margin-top:8px">
          <button class="btn small" disabled=${working || !info.id} onClick=${() => download('video')}>${icons.download()} Download video</button>
          <button class="btn small" disabled=${working || !info.id} onClick=${() => download('audio')}>${icons.download()} Download sound only</button>
        </div>
        <div class="hint">Play from YouTube: needs internet, shows on the projector only. Download: saves a copy here so it plays offline and goes into the live stream with sound — only for videos you have permission to use.</div>
      </div>
    </div>`}
    ${dl && (dl.state === 'working' || dl.state === 'error') && html`<div class=${'yt-dl ' + dl.state}>
      ${dl.state === 'working' && html`<div class="track"><i style=${`width:${Math.round((dl.percent || 0) * 100)}%`}></i></div>`}
      <span>${dl.message}</span>
      ${dl.state === 'working' && html`<button class="btn ghost small" onClick=${() => api('/api/youtube/cancel', {}).catch(fail)}>Cancel</button>`}
    </div>`}
  </div>`;
}

function MediaDialog({ s, onClose, onAdd, onShow }) {
  const [clips, load, setClips] = useClips();
  const [pick, setPick] = useState(null);
  const [title, setTitle] = useState('');
  const [loop, setLoop] = useState(false);
  const [room, setRoom] = useState(true);
  const [up, setUp] = useState('');
  const upload = () => pickFiles(MEDIA_ACCEPT, true, async (files) => {
    let last = null;
    for (const f of files) {
      try { last = await uploadClip(f, (p) => setUp(`Uploading ${f.name}… ${Math.round(p * 100)}%`)); } catch (err) { fail(err); }
    }
    setUp(''); await load();
    if (last) { setPick(last); setTitle(last.name); }
  });
  const del = async (c) => {
    if (!confirm(`Delete “${c.name}” from this computer?`)) return;
    try {
      const l = await api('/api/clips/delete', { id: c.id });
      if (Array.isArray(l)) setClips(l);
      if (pick && pick.id === c.id) { setPick(null); setTitle(''); } // it's gone: can't be added any more
    } catch (err) { fail(err); }
  };
  const item = () => ({ key: 'media:' + Date.now(), kind: 'media', title: title.trim() || pick.name, subtitle: '', slides: [{ label: title || pick.name, text: '' }],
    media: { file: pick.id, type: pick.type, duration: pick.duration, loop, room, volume: 1 } });
  return html`<${Modal} wide title="Video, music or YouTube" onClose=${onClose} footer=${html`
      <button class="btn" disabled=${!pick} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!pick} onClick=${() => { onShow(item()); onClose(); }}>Play now</button>`}>
    <div class="row wrap" style="margin-bottom:12px">
      <button class="btn primary" disabled=${!!up} onClick=${upload}>${icons.plus()} Add video or music…</button>
      <span class="muted">${up || 'MP4, MOV or WebM videos (e.g. Mission Spotlight); MP3 or M4A music. Files stay on this computer.'}</span>
    </div>
    <${YouTubeBox} s=${s} onItem=${(it, how) => { if (how === 'add') onAdd(it); else onShow(it); onClose(); }}
      onDownloaded=${async (c) => { await load(); setPick(c); setTitle(c.name); }} />
    <${ClipList} clips=${clips} selected=${pick ? [pick.id] : []} onPick=${(c) => { setPick(c); setTitle(c.name); }} onDelete=${del} />
    ${pick && html`<div class="two" style="margin-top:14px;gap:12px">
      <div class="field"><label class="label">Name in the order of service</label><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} /></div>
      <div><label class="switch"><input type="checkbox" checked=${loop} onChange=${(e) => setLoop(e.target.checked)} /><span>Repeat until stopped</span></label>
        <label class="switch"><input type="checkbox" checked=${room} onChange=${(e) => setRoom(e.target.checked)} /><span>Play the sound through this computer too (for the room)</span></label></div>
    </div>`}
  </${Modal}>`;
}

// Edit a video, music or YouTube item: its name, repeating, and (for files) the room speakers.
function MediaEditor({ initial, onClose, onSave }) {
  const m = initial.media || {};
  const [title, setTitle] = useState(initial.title);
  const [loop, setLoop] = useState(!!m.loop);
  const [room, setRoom] = useState(m.room !== false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const t = title.trim() || initial.title;
    await onSave(t, { ...m, loop, ...(m.type === 'youtube' ? {} : { room }) });
    onClose();
  };
  const dirty = useChanged(title, loop, room);
  return html`<${Modal} dirty=${dirty && !busy} title=${m.type === 'audio' ? 'Edit music' : m.type === 'youtube' ? 'Edit YouTube video' : 'Edit video'} onClose=${onClose} footer=${html`
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy} onClick=${save}>Save changes</button>`}>
    <div class="field"><label class="label">Name in the order of service</label><input class="input" value=${title} autofocus onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /></div>
    <label class="switch"><input type="checkbox" checked=${loop} onChange=${(e) => setLoop(e.target.checked)} /><span>Repeat until stopped</span></label>
    ${m.type !== 'youtube' && html`<label class="switch"><input type="checkbox" checked=${room} onChange=${(e) => setRoom(e.target.checked)} /><span>Play the sound through this computer too (for the room)</span></label>`}
    <div class="hint">To use a different file or link, remove this item and add the new one with + Add.</div>
  </${Modal}>`;
}

// Background music: plays quietly under everything (and pauses for videos).
function MusicCard({ s }) {
  const [clips, load] = useClips();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(s.config.musicFiles || []);
  const music = s.media && s.media.music;
  const songs = (clips || []).filter((c) => c.type === 'audio');
  const toggle = (c) => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]);
  const play = () => api('/api/music', { action: 'play', files: sel.length ? sel : songs.map((c) => c.id), volume: s.config.musicVolume }).catch(fail);
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const last = s.config.musicYouTube;
  const playYt = async (y) => {
    try {
      const info = y || await get('/api/youtube?url=' + encodeURIComponent(ytUrl.trim()));
      await api('/api/music', { action: 'play', youtube: { id: info.id, list: info.list, start: info.start }, title: info.title, volume: s.config.musicVolume });
      setYtOpen(false); setYtUrl('');
    } catch (err) { fail(err); }
  };
  return html`<div class="card vol-hide">
    <div class="card-head"><b>Background music</b>${music && html`<span class="tag live" style="margin-left:auto">PLAYING</span>`}</div>
    ${music
      ? html`${music.youtube && html`<div class="muted" style="margin-bottom:8px">${icons.yt()} ${music.title} · from YouTube</div>`}
             <div class="row"><button class="btn on red grow" onClick=${() => api('/api/music', { action: 'stop' }).catch(fail)}>${icons.stop()} Stop music</button></div>`
      : html`<div class="row"><button class="btn primary grow" disabled=${!songs.length} onClick=${play}>${icons.play()} Play ${sel.length ? sel.length + ' song' + (sel.length === 1 ? '' : 's') : 'all'}</button>
              <button class="btn" onClick=${() => { setOpen(!open); load(); }}>${open ? 'Done' : 'Choose'}</button>
              <button class="btn" title="Play a YouTube video or playlist" onClick=${() => setYtOpen(!ytOpen)}>${icons.yt()}</button></div>`}
    ${ytOpen && !music && html`<div style="margin-top:10px">
      <div class="row"><input class="input grow" placeholder="YouTube video or playlist link" value=${ytUrl} onInput=${(e) => setYtUrl(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ytUrl.trim() && playYt()} />
        <button class="btn primary" disabled=${!ytUrl.trim()} onClick=${() => playYt()}>Play</button></div>
      ${last && html`<button class="btn small ghost" style="margin-top:6px" onClick=${() => playYt(last)}>${icons.play()} ${last.title}</button>`}
      <div class="hint">Plays from YouTube on the projector, in a small “now playing” card in the corner (YouTube requires its player to stay visible). Needs internet; reaches the stream only through your microphones.</div></div>`}
    <label class="meter-row" style="margin-top:10px">Volume<input class="grow" type="range" min="0" max="1" step="0.05" value=${music ? music.volume : (s.config.musicVolume ?? 0.4)}
      onChange=${(e) => (music ? api('/api/music', { volume: +e.target.value }) : api('/api/config', { musicVolume: +e.target.value })).catch(fail)} /></label>
    ${open && !music && html`<div style="margin-top:10px">
      <button class="btn small" onClick=${() => pickFiles('audio/*,.m4a,.mp3', true, async (files) => { for (const f of files) { try { await uploadClip(f, () => {}); } catch (err) { fail(err); } } load(); })}>${icons.plus()} Add music files…</button>
      <div style="margin-top:8px"><${ClipList} clips=${clips} type="audio" selected=${sel} onPick=${toggle} /></div></div>`}
    <label class="switch" style="min-height:40px;margin-top:6px"><input type="checkbox" checked=${s.config.musicRoom !== false} onChange=${(e) => api('/api/config', { musicRoom: e.target.checked }).catch(fail)} /><span>Also play through this computer (for the room)</span></label>
    <div class="hint">${songs.length ? 'Loops the chosen songs on the stream. Pauses automatically while a video plays.' : 'Add a few quiet instrumental tracks (MP3/M4A) to play before and after the service.'}</div>
  </div>`;
}

// Slides: a PowerPoint file, a PDF or picture files become slides.
async function uploadSlideImage(blob) {
  const res = await fetch('/api/media?kind=slide', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');
  return d.name;
}

const PPT_RE = /\.(pptx|ppt|ppsx|pps|pptm|odp|key)$/i;
const SLIDE_ACCEPT = '.pptx,.ppt,.ppsx,.pps,.pptm,.odp,.key,application/pdf,.pdf,image/png,image/jpeg,image/webp';
function SlidesImport({ onClose, onAdd, onShow, initial, onSave }) {
  const editing = !!(initial && onSave);
  const [title, setTitle] = useState(editing ? initial.title : '');
  const [slides, setSlides] = useState(editing ? initial.slides.filter((sl) => sl.image).map((sl) => ({ label: sl.label || '', text: '', image: sl.image })) : []);
  const [busy, setBusy] = useState('');
  const [auto, setAuto] = useState((editing && initial.autoAdvance) || 0);
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= slides.length) return; const next = slides.slice(); [next[i], next[j]] = [next[j], next[i]]; setSlides(next); };
  // A PDF (bytes) → slide pictures, 1920 px wide.
  const renderPdf = async (bytes, out) => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      setBusy(`Preparing slide ${i} of ${doc.numPages}…`);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, 1920 / base.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      out.push({ label: `Slide ${out.length + 1}`, text: '', image: await uploadSlideImage(blob) });
      setSlides([...out]);
    }
  };
  const addFiles = async (list) => {
    const files = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    if (!title) setTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    const out = [...slides];
    try {
      for (const f of files) {
        if (PPT_RE.test(f.name)) {
          setBusy(`Opening ${f.name} in PowerPoint… (this can take a minute)`);
          const res = await fetch('/api/convert/presentation?' + new URLSearchParams({ name: f.name }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'The presentation could not be opened.'); }
          await renderPdf(new Uint8Array(await res.arrayBuffer()), out);
        } else if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          setBusy('Opening ' + f.name + '…');
          await renderPdf(new Uint8Array(await f.arrayBuffer()), out);
        } else if (/^image\//.test(f.type)) {
          setBusy('Adding ' + f.name + '…');
          out.push({ label: `Slide ${out.length + 1}`, text: '', image: await uploadSlideImage(f) });
          setSlides([...out]);
        }
      }
    } catch (err) { fail(err); }
    setBusy('');
  };
  const pick = () => pickFiles(SLIDE_ACCEPT, true, addFiles);
  const onDrop = (e) => { e.preventDefault(); if (!busy && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };
  const item = () => ({ key: 'images:' + Date.now(), kind: 'images', title: title.trim() || 'Slides', subtitle: '', slides: numbered(), autoAdvance: auto });
  const ready = slides.length > 0 && !busy;
  // Slides named “Slide 3” follow their new place after reordering; names typed elsewhere stay.
  const numbered = () => slides.map((sl, i) => ({ ...sl, label: /^Slide \d+$/.test(sl.label || '') || !sl.label ? `Slide ${i + 1}` : sl.label }));
  const footer = editing
    ? html`<button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${!ready} onClick=${async () => { setBusy('Saving…'); await onSave(title.trim() || 'Slides', numbered(), auto); onClose(); }}>Save changes</button>`
    : html`<button class="btn" disabled=${!ready} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!ready} onClick=${() => { onShow(item()); onClose(); }}>Show now</button>`;
  const dirty = useChanged(title, slides.map((x) => x.image), auto);
  return html`<${Modal} wide dirty=${dirty && !busy} title=${editing ? 'Edit slides' : 'Slides'} onClose=${onClose} footer=${footer}>
    <div class="note" style="margin-bottom:14px">Pick a <b>PowerPoint</b> file, a PDF, or pictures (one per slide). You can also drop them here. PowerPoint on this computer opens the file, so the slides look exactly the same. Animations, videos and sounds inside it don't carry over. From Google Slides, choose File → Download → PDF.</div>
    <div class="row wrap" style="margin-bottom:12px" onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
      <button class="btn primary" disabled=${!!busy} onClick=${pick}>${icons.plus()} ${slides.length ? 'Add more…' : 'Choose PowerPoint, PDF or pictures…'}</button>
      ${busy && html`<span class="muted">${busy}</span>`}
      ${slides.length > 0 && !busy && html`<span class="muted">${slides.length} slide${slides.length === 1 ? '' : 's'} ready</span>`}
    </div>
    <div class="two" style="gap:10px">
      <div class="field"><label class="label">Name in the order of service</label><input class="input" value=${title} placeholder="e.g. Sermon — The Good Shepherd" onInput=${(e) => setTitle(e.target.value)} /></div>
      <div class="field"><label class="label">Change slides automatically</label><select class="select" value=${auto} onChange=${(e) => setAuto(+e.target.value)}>${AUTO_CHOICES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>
    </div>
    ${slides.length > 0 && html`<div class="bg-grid" style="max-height:340px;overflow:auto;padding:4px">${slides.map((sl, i) => html`<div class="bg-tile" key=${i}>
      <div class="bg-thumb" style=${`background:#000 url("${bgInfo(sl.image).url}") center/contain no-repeat;cursor:default`}></div>
      <div class="row" style="justify-content:space-between;gap:2px"><span class="bg-name">${i + 1}</span>
        <span class="row" style="gap:2px">
          <button class="btn ghost small" disabled=${i === 0} title="Move earlier" aria-label=${'Move slide ' + (i + 1) + ' earlier'} onClick=${() => move(i, -1)}>‹</button>
          <button class="btn ghost small" disabled=${i === slides.length - 1} title="Move later" aria-label=${'Move slide ' + (i + 1) + ' later'} onClick=${() => move(i, 1)}>›</button>
          <button class="btn ghost small" onClick=${() => setSlides(slides.filter((_, j) => j !== i))}>Remove</button></span></div></div>`)}</div>`}
  </${Modal}>`;
}

// Edit a Bible reading: change the passage or the translation.
function BibleEditor({ s, initial, onClose, onSave }) {
  const have = (s.library && s.library.translations) || [];
  const [ref, setRef] = useState(initial.ref || initial.title || '');
  const [tr, setTr] = useState(String(initial.translation || (initial.subtitle || '')).toLowerCase() || s.config.bible.translation);
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ref.trim()) { setFound(null); setError(''); return undefined; }
    let gone = false;
    const t = setTimeout(() => get('/api/bible', { ref: ref.trim(), t: tr })
      .then((r) => { if (gone) return; if (r.error || !r.slides) { setFound(null); setError(r.error || 'Not found'); } else { setFound(r); setError(''); } })
      .catch((err) => { if (!gone) { setFound(null); setError(err.message); } }), 250);
    return () => { gone = true; clearTimeout(t); };
  }, [ref, tr]);
  const save = async () => {
    if (!found) return;
    setBusy(true);
    await onSave({ title: found.title, subtitle: found.translation, ref: found.title, translation: tr, slides: found.slides });
    onClose();
  };
  const dirty = useChanged(ref, tr);
  return html`<${Modal} wide dirty=${dirty && !busy} title="Edit reading" onClose=${onClose} footer=${html`
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy || !found} onClick=${save}>Save changes</button>`}>
    <div class="editor">
      <div>
        <div class="field"><label class="label">Passage</label><input class="input" value=${ref} autofocus placeholder="e.g. John 3:16-18 or Ps 23" onInput=${(e) => setRef(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /></div>
        <div class="field"><label class="label">Translation</label>
          <select class="select" value=${tr} onChange=${(e) => setTr(e.target.value)}>
            ${!have.some((t) => t.id === tr) && html`<option value=${tr}>${tr.toUpperCase()}</option>`}
            ${have.map((t) => html`<option value=${t.id}>${t.name} (${t.abbrev})</option>`)}
          </select></div>
        <div class="hint">${error || (found ? `${found.title} · ${found.translation} · ${found.slides.length} slide${found.slides.length === 1 ? '' : 's'}` : '')}</div>
      </div>
      <div><label class="label">Preview</label>
        <div class="preview-list">${(found ? found.slides : []).slice(0, 30).map((sl, i) => html`<div key=${i}><div class="lbl">${sl.ref}</div><${Screen} slide=${sl} kind="bible" /></div>`)}</div></div>
    </div>
  </${Modal}>`;
}

// Save the order of service as a reusable template, or start from one.
function TemplatesDialog({ s, onClose }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState('Sabbath Divine Service');
  useEffect(() => { get('/api/templates').then(setList).catch(fail); }, []);
  const saveIt = async () => { try { setList(await api('/api/templates', { name, items: s.plan.items })); toast('Template saved'); } catch (err) { fail(err); } };
  const load = async (t) => {
    if (s.plan.items.length && !confirm(`Replace the current order of service with “${t.name}”?`)) return;
    try { await api('/api/plan', { items: t.items }); } catch (err) { fail(err); return; }
    toast(`Loaded “${t.name}”`);
    onClose();
  };
  const del = async (t) => {
    if (!confirm(`Delete the template “${t.name}”?`)) return;
    try { const l = await api('/api/templates/delete', { name: t.name }); if (Array.isArray(l)) setList(l); } catch (err) { fail(err); }
  };
  return html`<${Modal} title="Service templates" onClose=${onClose}>
    <label class="label">Save this order of service (${s.plan.items.length} items) as</label>
    <div class="key-row"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /><button class="btn primary" disabled=${!name.trim() || !s.plan.items.length} onClick=${saveIt}>Save</button></div>
    <div class="hint">Saving with an existing name replaces it.</div>
    <label class="label" style="margin-top:20px">Start from a template</label>
    ${!list ? html`<div class="muted">Loading…</div>` : !list.length ? html`<div class="note">No templates yet. Build your usual order of service once (opening hymn, scripture reading, prayer, children's story, sermon, closing hymn…), then save it here.</div>` : html`
      <div style="display:grid;gap:8px">${list.map((t) => html`<div class="row" key=${t.name}>
        <div class="grow"><b>${t.name}</b><div class="hint" style="margin:0">${t.items.length} items · ${t.items.slice(0, 4).map((x) => x.title).join(', ')}${t.items.length > 4 ? '…' : ''}</div></div>
        <button class=${'btn small' + (s.config.defaultTemplate === t.name ? ' on' : ' ghost')} title="Use as our usual order (New → Our usual order)" aria-label=${'Use “' + t.name + '” as our usual order'}
          onClick=${() => save({ defaultTemplate: s.config.defaultTemplate === t.name ? '' : t.name }, s.config.defaultTemplate === t.name ? 'No usual order' : `“${t.name}” is now your usual order`)}>${s.config.defaultTemplate === t.name ? '★ Usual' : '☆'}</button>
        <button class="btn small primary" onClick=${() => load(t)}>Use</button><button class="btn small ghost" onClick=${() => del(t)}>Delete</button></div>`)}</div>`}
    <div class="hint" style="margin-top:10px">★ marks your usual order: <b>New → Our usual order</b> starts from it.</div>
  </${Modal}>`;
}

const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const fmtWhen = (iso) => { const d = new Date(iso); return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

// Start a new order of service: blank, our usual order, or a template. The current one is
// kept in Save / open → Recent first.
function NewServiceDialog({ s, onClose, onTemplates }) {
  const [list, setList] = useState(null);
  useEffect(() => { get('/api/templates').then(setList).catch(fail); }, []);
  const usual = s.config.defaultTemplate && (list || []).find((t) => t.name === s.config.defaultTemplate);
  const start = async (from) => {
    try { await api('/api/service/new', { from }); (s.plan.items.length ? undoToast : toast)('New service started'); onClose(); } catch (err) { fail(err); }
  };
  return html`<${Modal} title="New service" onClose=${onClose}>
    <div class="choices" style="grid-template-columns:1fr">
      <button class="choice" disabled=${!usual} onClick=${() => start('default')}><b>★ Our usual order</b>
        <span>${usual ? `${usual.items.length} items · ${usual.items.slice(0, 5).map((x) => x.title).join(', ')}${usual.items.length > 5 ? '…' : ''}` : 'Not set yet: save your usual order in Templates and mark it with ★.'}</span></button>
      <button class="choice" onClick=${() => start('blank')}><b>Blank</b><span>An empty order of service.</span></button>
      ${(list || []).filter((t) => t.name !== s.config.defaultTemplate).map((t) => html`<button class="choice" key=${t.name} onClick=${() => start(t.name)}><b>${t.name}</b><span>Template · ${t.items.length} items</span></button>`)}
    </div>
    ${s.plan.items.length > 0 && html`<div class="hint">The current order of service (${s.plan.items.length} items) is kept in <b>Save / open → Recent</b>.</div>`}
    ${!usual && html`<button class="btn small" style="margin-top:10px" onClick=${onTemplates}>Open Templates</button>`}
  </${Modal}>`;
}

// A printable order of service (bulletin): print it or save it as a PDF from the browser.
function printBulletin(s, name) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t = s.config.theme || {};
  const detail = (it) => {
    if (it.kind === 'song') return [it.subtitle, it.verses && it.verses.length ? 'verses ' + it.verses.join(', ') : ''].filter(Boolean).join(' · ');
    if (it.kind === 'bible') return [it.ref, (it.translation || '').toUpperCase()].filter(Boolean).join(' · ');
    if (it.kind === 'text' && it.subtitle) return it.subtitle;
    if (it.kind === 'media') return it.media && it.media.type === 'audio' ? 'Music' : 'Video';
    return '';
  };
  const items = s.plan.items.filter((it) => it.kind !== 'countdown');
  const sab = s.sabbath && s.sabbath.tokens;
  const w = window.open('', '_blank');
  if (!w) { fail(new Error('Allow pop-ups for ChurchStream to print the order of service.')); return; }
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)}</title><style>
    @page { margin: 18mm; }
    body { font: 12pt/1.5 Georgia, Cambria, 'Times New Roman', serif; color: #111; max-width: 640px; margin: 24px auto; padding: 0 16px; }
    header { text-align: center; margin-bottom: 22px; }
    header img { max-height: 72px; max-width: 220px; }
    h1 { font-size: 22pt; margin: 8px 0 2px; font-weight: 600; }
    .date { color: #555; font-style: italic; }
    ol { list-style: none; padding: 0; margin: 0; }
    li { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px dotted #bbb; }
    li b { font-weight: 600; } li .dots { flex: 1; }
    li .d { color: #444; text-align: right; }
    footer { margin-top: 24px; text-align: center; color: #555; font-size: 10.5pt; }
    .actions { text-align: center; margin: 20px 0; } .actions button { font: 600 11pt system-ui, sans-serif; padding: 10px 18px; border-radius: 10px; border: 0; background: #0f766e; color: #fff; cursor: pointer; }
    @media print { .actions { display: none; } body { margin: 0 auto; } }
  </style></head><body>
    <div class="actions"><button onclick="print()">Print or save as PDF</button></div>
    <header>${t.logo ? `<img src="/media/${encodeURIComponent(t.logo)}" alt="">` : ''}
      <h1>${esc(s.config.churchName || 'Order of Service')}</h1><div class="date">${esc(name)}</div></header>
    <ol>${items.map((it) => `<li><b>${esc(it.title)}</b><span class="dots"></span><span class="d">${esc(detail(it))}</span></li>`).join('')}</ol>
    <footer>${sab && sab['sabbath-ends'] ? `Sabbath ends at sunset: ${esc(sab['sabbath-ends'])}` : ''}</footer>
  </body></html>`);
  w.document.close();
}

// Save a service to a file to share with other computers, open one, or go back to a recent one.
function ServicesDialog({ s, onClose }) {
  const [tab, setTab] = useState(s.plan.items.length ? 'save' : 'open');
  const [name, setName] = useState('');
  const [info, setInfo] = useState(null);
  const [withMedia, setWithMedia] = useState(true);
  const [recent, setRecent] = useState(null);
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const loadRecent = () => get('/api/services').then(setRecent).catch(fail);
  useEffect(() => {
    get('/api/service/info').then((d) => { setInfo(d); }).catch(() => {});
    loadRecent();
    const d = new Date();
    setName('Sabbath ' + d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);
  const download = () => {
    const a = document.createElement('a');
    a.href = '/api/service/export?' + new URLSearchParams({ name: name.trim(), media: withMedia ? '1' : '0' });
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Saving “' + (name.trim() || 'Service') + '.churchservice” to Downloads');
  };
  const keep = async () => { try { await api('/api/services/save', { name: name.trim() }); toast('Saved on this computer'); loadRecent(); setTab('recent'); } catch (err) { fail(err); } };
  const openFile = async (f) => {
    if (!f) return;
    if (!/\.churchservice$|\.zip$/i.test(f.name)) { fail(new Error('Choose a .churchservice file.')); return; }
    setBusy('Opening ' + f.name + '…');
    try {
      const res = await fetch('/api/service/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || 'Could not open the file');
      const extra = [d.newSongs && `${d.newSongs} song${d.newSongs === 1 ? '' : 's'} added`, d.media && `${d.media} picture/video file${d.media === 1 ? '' : 's'} added`].filter(Boolean).join(' · ');
      undoToast(`Opened “${d.name}” (${d.items} items)${extra ? ' · ' + extra : ''}`);
      if (d.missing) fail(new Error(`${d.missing} song${d.missing === 1 ? ' is' : 's are'} missing words. Add them from the search box.`));
      if (d.bibles && d.bibles.length) toast(`Readings use ${d.bibles.join(', ').toUpperCase()}, which isn’t on this computer: they show in your default Bible. Add it in Settings → Bible.`);
      onClose();
    } catch (err) { fail(err); }
    setBusy('');
  };
  const pick = () => pickFiles('.churchservice,.zip', false, ([f]) => openFile(f));
  const openRecent = async (r) => {
    if (s.plan.items.length && !confirm(`Open “${r.name}”? The current order of service is kept in Recent.`)) return;
    try { await api('/api/services/open', { id: r.id }); undoToast(`Opened “${r.name}”`); onClose(); } catch (err) { fail(err); }
  };
  const del = async (r) => { if (confirm(`Delete “${r.name}” from this computer?`)) { await api('/api/services/delete', { id: r.id }).catch(fail); loadRecent(); } };
  const tabs = [['save', 'Save this service'], ['open', 'Open a file'], ['recent', 'Recent']];
  return html`<${Modal} wide title="Services" onClose=${onClose}>
    <div class="seg" role="tablist" style="margin-bottom:18px;grid-template-columns:repeat(3,minmax(0,1fr))">${tabs.map(([k, t]) => html`<button role="tab" aria-selected=${tab === k} class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${t}</button>`)}</div>
    ${tab === 'save' && (!s.plan.items.length ? html`<div class="note">The order of service is empty. Add hymns, readings and more first, or open a service.</div>` : html`
      <div class="field"><label class="label" for="svc-name">Name</label><input id="svc-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></div>
      <div class="svc-box">
        <div class="label" style="margin:0">What's included · ${s.plan.items.length} items</div>
        <div class="svc-titles">${s.plan.items.map((x) => x.title).join(' · ')}</div>
        <div class="hint" style="margin-top:6px">Songs are saved with their words, so they open even on a computer without them.</div>
        ${info && info.media > 0 && html`<label class="switch" style="margin-top:8px"><input type="checkbox" checked=${withMedia} onChange=${(e) => setWithMedia(e.target.checked)} />
          <span>Include pictures, backgrounds and videos (${info.media} file${info.media === 1 ? '' : 's'}, ${fmtBytes(info.mediaBytes)})</span></label>`}
      </div>
      <div class="svc-actions">
        <button class="btn big primary" onClick=${download}>${icons.download()} Save to a file</button>
        <button class="btn big" onClick=${keep}>Keep on this computer</button>
      </div>
      <div class="row" style="margin-bottom:10px"><button class="btn small" onClick=${() => printBulletin(s, name.trim() || 'Order of Service')}>Print the order of service…</button>
        <span class="hint" style="margin:0">A simple bulletin to print or save as a PDF.</span></div>
      <div class="hint">The file (<b>.churchservice</b>) goes to your Downloads folder. Email it, send it on WhatsApp or copy it with a USB stick, then open it in ChurchStream on the other computer (Save / open → Open a file).</div>`)}
    ${tab === 'open' && html`
      <button class=${'svc-drop' + (drag ? ' over' : '')} disabled=${!!busy} onClick=${pick}
        onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
        onDrop=${(e) => { e.preventDefault(); setDrag(false); openFile(e.dataTransfer.files[0]); }}>
        ${icons.upload()}
        <b>${busy || 'Open a service file'}</b><span>${busy ? 'Adding its songs and pictures…' : 'or drop a .churchservice file here'}</span>
      </button>
      ${s.plan.items.length > 0 && html`<div class="note" style="margin-top:12px">Opening replaces the current order of service. The current one is kept in <b>Recent</b> first, so you can switch back.</div>`}`}
    ${tab === 'recent' && (!recent ? html`<div class="muted">Loading…</div>` : !recent.length ? html`<div class="note">Nothing yet. Services you save here, and earlier orders of service (kept automatically when you start a new one or open a file), appear in this list.</div>` : html`
      <div class="svc-list">${recent.map((r) => html`<div class="svc-row" key=${r.id}>
        <div class="grow"><b>${r.name}</b><div class="muted" style="font-size:12px">${fmtWhen(r.saved)} · ${r.count} items${r.auto ? ' · kept automatically' : ''} · ${r.titles.join(', ')}${r.count > r.titles.length ? '…' : ''}</div></div>
        <button class="btn small ghost" onClick=${() => del(r)} aria-label=${'Delete ' + r.name}>Delete</button>
        <button class="btn small primary" onClick=${() => openRecent(r)}>Open</button>
      </div>`)}</div>
      <div class="hint">To send one of these to another computer, open it, then use <b>Save this service</b>.</div>`)}
  </${Modal}>`;
}

// ---------------------------------------------------------------------------------------
// backgrounds: built-in library + your own uploads
let bgCache = null;
const bgListeners = new Set();
const loadBackgrounds = () => get('/api/backgrounds').then((d) => { bgCache = d; bgListeners.forEach((f) => f(d)); return d; });
function useBackgrounds() {
  const [data, setData] = useState(bgCache);
  useEffect(() => {
    bgListeners.add(setData);
    if (!bgCache) loadBackgrounds().catch(fail);
    return () => bgListeners.delete(setData);
  }, []);
  return data;
}

function uploadBackgrounds(onDone) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  inp.onchange = async () => {
    let last = null;
    for (const f of inp.files) {
      if (f.size > 15 * 1024 * 1024) { fail(new Error(`${f.name} is too large (max 15 MB).`)); continue; }
      const res = await fetch('/api/media?kind=background', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const d = await res.json().catch(() => ({}));
      if (d.error) fail(new Error(d.error)); else last = d.name;
    }
    await loadBackgrounds();
    if (last) { toast(inp.files.length > 1 ? 'Backgrounds added' : 'Background added'); onDone && onDone(last); }
  };
  inp.click();
}

function BackgroundGallery({ value, onPick, defaultTile }) {
  const data = useBackgrounds();
  if (!data) return html`<div class="muted">Loading backgrounds…</div>`;
  const del = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this background? Slides using it go back to the default.')) return;
    await api('/api/backgrounds/delete', { id }).catch(fail);
    loadBackgrounds();
  };
  const tile = (id, name, url, extra) => html`<div class="bg-tile">
    <button class=${'bg-thumb' + ((value || '') === id ? ' on' : '')} style=${url ? `background-image:url("${url}")` : ''} onClick=${() => onPick(id)} aria-label=${name} aria-pressed=${(value || '') === id}>
      ${(value || '') === id && html`<span class="bg-check">${icons.check()}</span>`}
    </button>
    <div class="bg-name">${name}</div>${extra}
  </div>`;
  return html`<div>
    <div class="bg-section">Yours</div>
    <div class="bg-grid">
      <div class="bg-tile"><button class="bg-thumb bg-add" onClick=${() => uploadBackgrounds(onPick)}>${icons.plus()}<span>Add your own</span></button><div class="bg-name">Photos or images</div></div>
      ${data.custom.map((b) => tile(b.id, 'Your image', bgInfo(b.id).url, html`<button class="bg-del" title="Delete" aria-label="Delete background" onClick=${(e) => del(e, b.id)}>${icons.x()}</button>`))}
    </div>
    <div class="bg-section">Built in</div>
    <div class="bg-grid">
      ${defaultTile && tile('', defaultTile.label, bgInfo(defaultTile.bg).url)}
      ${data.builtin.map((b) => tile(b.id, b.name, bgInfo(b.id).url))}
    </div>
  </div>`;
}

function BackgroundDialog({ s, item, slideIndex, onClose, onSaved }) {
  const plan = s.plan.items.find((x) => x.uid === item.key) || {};
  const [scope, setScope] = useState(slideIndex === null ? 'item' : 'slide');
  // A slide split to fit the screens saves its background on the slide it came from.
  const i = slideIndex === null ? 0 : (item && item.slides && item.slides[slideIndex] && item.slides[slideIndex].src != null ? item.slides[slideIndex].src : slideIndex);
  const current = scope === 'slide' ? ((plan.slideBackgrounds || {})[i] || '') : (plan.background || '');
  const [pick, setPick] = useState(current);
  useEffect(() => setPick(current), [scope]);
  // The slide the button was pressed on (after splitting), for the preview and its name.
  const slide = item.slides[slideIndex ?? 0] || item.slides[0];
  const previewBg = scope === 'slide' ? (pick || plan.background || s.config.theme.background) : (pick || s.config.theme.background);
  const apply = async () => {
    const items = s.plan.items.map((x) => {
      if (x.uid !== item.key) return x;
      if (scope === 'item') return { ...x, background: pick };
      const per = { ...(x.slideBackgrounds || {}) };
      if (pick) per[i] = pick; else delete per[i];
      return { ...x, slideBackgrounds: per };
    });
    try { await api('/api/plan', { items }); await onSaved(); onClose(); } catch (err) { fail(err); }
  };
  const hasSlideOverrides = Object.keys(plan.slideBackgrounds || {}).length > 0;
  return html`<${Modal} wide title=${'Background — ' + item.title} onClose=${onClose} footer=${html`
      <span class="muted" style="margin-right:auto;font-size:13px">${scope === 'item' && hasSlideOverrides ? 'Slides with their own background keep it.' : ''}</span>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${apply}>Use this background</button>`}>
    <div class="bg-dialog">
      <div>
        ${slideIndex !== null && html`<div class="choices" style="margin-bottom:14px">
          <button class=${'choice' + (scope === 'slide' ? ' on' : '')} onClick=${() => setScope('slide')}><b>Only this slide</b><span>${slide.label || 'Slide ' + ((slideIndex ?? 0) + 1)}</span></button>
          <button class=${'choice' + (scope === 'item' ? ' on' : '')} onClick=${() => setScope('item')}><b>Every slide of this item</b><span>${item.slides.length} slides</span></button>
        </div>`}
        <${BackgroundGallery} value=${pick} onPick=${setPick} defaultTile=${scope === 'slide'
          ? { label: 'Same as the item', bg: plan.background || s.config.theme.background }
          : { label: 'Use the default', bg: s.config.theme.background }} />
      </div>
      <div class="bg-preview"><label class="label">Preview</label><${Screen} slide=${slide} kind=${item.kind} subtitle=${item.subtitle} theme=${s.config.theme} bg=${previewBg || ''} />
        <div class="hint">The default background for everything is set in Settings → Appearance.</div></div>
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------------------
// main operator screen
// Per-device settings kept in this browser (e.g. volunteer mode on the deacon's tablet).
function useLocalPref(key, initial) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x === null ? initial : JSON.parse(x); } catch { return initial; } });
  const set = (x) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* private mode */ } };
  return [v, set];
}

// Volunteer mode: a simple screen for whoever is running the slides. Settings, stream setup,
// editing and removing are hidden. Leave it by pressing and holding the chip for 2 seconds.
function VolunteerToggle({ on, setOn }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(null);
  const leftAt = useRef(0);
  const since = useRef(0);
  // key: a different button element, so letting go of the hold isn't taken as a tap on it.
  if (!on) return html`<button key="vol-on" class="btn icon round" title="Volunteer mode: a simple screen for running the slides" aria-label="Turn on volunteer mode"
    onClick=${() => { if (Date.now() - leftAt.current < 800) return; setOn(true); toast('Volunteer mode on · press and hold the chip at the top to leave'); }}>${icons.lock()}</button>`;
  const leave = () => { clearTimeout(timer.current); since.current = 0; leftAt.current = Date.now(); setHolding(false); setOn(false); toast('Volunteer mode off'); };
  const start = () => { since.current = Date.now(); setHolding(true); timer.current = setTimeout(leave, 2000); };
  // Released after holding long enough (even if the timer was late on a busy computer).
  const stop = () => { clearTimeout(timer.current); const held = since.current && Date.now() - since.current; since.current = 0; setHolding(false); if (held >= 2000) leave(); };
  return html`<button key="vol-chip" class=${'vol-chip' + (holding ? ' holding' : '')} title="Press and hold for 2 seconds to leave volunteer mode"
    onPointerDown=${start} onPointerUp=${stop} onPointerLeave=${stop} onPointerCancel=${stop} onContextMenu=${(e) => e.preventDefault()}
    onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(); }} onKeyUp=${stop}>
    ${icons.lock()}<span>Volunteer mode</span><i></i></button>`;
}

function ControlView({ s }) {
  const [vol, setVol] = useLocalPref('cs-volunteer', false);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [tab, setTab] = useState('slides'); // only matters on tablets/phones
  const st = s.stream;

  // Follow the live item when nothing else is selected.
  const item = selected || (s.live ? s.live.item : null);
  const inPlan = item && s.plan.items.some((x) => x.uid === item.key);

  // The server may split slides that are too full for the screens; show its version.
  const show = (it, index = 0) => api('/api/live', { item: it, index }).then((d) => { setSelected(d && d.item ? { ...it, ...d.item, songId: it.songId, ref: it.ref, translation: it.translation } : it); }).catch(fail);
  const addToPlan = (it) => {
    const entry = { kind: it.kind, title: it.title, subtitle: it.subtitle, songId: it.songId, ref: it.ref, translation: it.translation, count: it.slides.length,
      slides: it.kind === 'text' || it.kind === 'countdown' || it.kind === 'images' ? it.slides : undefined, autoAdvance: it.autoAdvance, countdown: it.countdown, media: it.media };
    return api('/api/plan', { items: [...s.plan.items, entry] }).then((d) => { toast(`Added “${it.title}”`); return d; }).catch(fail);
  };
  const openPlan = (uid) => api('/api/plan/open', { uid }).then((it) => { setSelected(it); setTab('slides'); }).catch(fail);
  const showSlide = (i) => {
    if (i === null) { setSelected(null); return; }
    if (s.live && item && s.live.item.key === item.key) return api('/api/goto', { index: i }).catch(fail);
    return show(item, i);
  };
  const step = (d) => {
    if (!s.live && item) return show(item, 0);
    api('/api/goto', { delta: d }).catch(fail);
  };
  const toggle = (name) => api('/api/toggle', { name }).catch(fail);
  const toggleLogo = () => { toggle('logo'); if (!s.logo && !(s.config.theme || {}).logo) toast('Tip: upload your church logo in Settings → General'); };

  // After the live item moves on (e.g. Next past the end), keep the centre in sync.
  const liveKey = s.live && s.live.item.key;
  const prevLive = useRef(liveKey);
  useEffect(() => {
    if (prevLive.current && selected && selected.key === prevLive.current && liveKey !== prevLive.current) setSelected(null);
    prevLive.current = liveKey;
  }, [liveKey]);

  useEffect(() => {
    const k = (e) => {
      if (!vol && !isTyping(e) && !dialog && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoPlan(); return; }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || dialog) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
      else if (e.key === 'b' || e.key === 'B' || e.key === '.') toggle('black');
      else if (e.key === 'c' || e.key === 'C') toggle('clear');
      else if (e.key === 'l' || e.key === 'L') toggleLogo();
      else if (e.key === 'n' || e.key === 'N') api('/api/lower-third', { visible: !s.lowerThird.visible }).catch(fail);
      else if (/^[1-4]$/.test(e.key) && cameraNumbers(s).includes(+e.key) && !(s.streamPageOpen && s.studioOn)) api('/api/camera', { camera: +e.key }).catch(fail);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const editSong = async (it = item) => {
    try { setDialog({ type: 'song', song: await get('/api/song', { id: songIdOf(it) }) }); } catch (err) { fail(err); }
  };
  // Every kind of item has an editor.
  const editItem = (it) => {
    if (!it) return;
    if (it.kind === 'song') return editSong(it);
    if (it.kind === 'text') return setDialog({ type: isResponsive(it) ? 'responsive' : 'text', item: unsplit(it) });
    if (it.kind === 'countdown') return setDialog({ type: 'countdown', item: it });
    if (it.kind === 'images') return setDialog({ type: 'slides', item: it });
    if (it.kind === 'media') return setDialog({ type: 'media-edit', item: it });
    if (it.kind === 'bible') return setDialog({ type: 'bible', item: it });
  };
  const editPlan = (uid) => api('/api/plan/open', { uid }).then((it) => { setSelected(it); setTab('slides'); editItem(it); }).catch(fail);
  // Text items live inside the order of service, so editing saves the plan (and refreshes the
  // projector if that item is on screen right now).
  // Save edited text / countdown slides. Items in the order of service are saved there and
  // reloaded (so their item and per-slide backgrounds stay); items only being previewed or
  // shown keep their background and are updated in place.
  const saveEdited = async (uid, patch, liveIndex) => {
    const n = patch.slides.length;
    let it;
    if (s.plan.items.some((x) => x.uid === uid)) {
      const keepBgs = (per) => Object.fromEntries(Object.entries(per || {}).filter(([k]) => +k < n));
      const items = s.plan.items.map((x) => (x.uid === uid ? { ...x, ...patch, count: n, slideBackgrounds: keepBgs(x.slideBackgrounds) } : x));
      await api('/api/plan', { items });
      it = await api('/api/plan/open', { uid });
    } else {
      const prev = (item && item.key === uid && item) || (s.live && s.live.item.key === uid && s.live.item) || {};
      it = { ...prev, ...patch, key: uid, subtitle: prev.subtitle || '',
        slides: patch.slides.map((sl, i) => ({ ...sl, background: (prev.slides && prev.slides[i] && prev.slides[i].background) || '' })) };
    }
    if (s.live && s.live.item.key === uid) await api('/api/live', { item: it, index: liveIndex(Math.min(s.live.index, n - 1)) });
    setSelected(it);
    toast('Saved');
  };
  const saveText = (uid, title, slides, autoAdvance = 0) =>
    saveEdited(uid, { kind: 'text', title, slides, autoAdvance }, (i) => i).catch(fail);
  const saveCountdown = (uid, edited) =>
    saveEdited(uid, { kind: 'countdown', title: edited.title, slides: edited.slides, autoAdvance: edited.autoAdvance, countdown: edited.countdown }, () => 0).catch(fail);
  const saveImages = (uid, title, slides, autoAdvance) =>
    saveEdited(uid, { kind: 'images', title, slides, autoAdvance }, (i) => i).catch(fail);
  const saveMedia = (uid, title, media) =>
    saveEdited(uid, { kind: 'media', title, media, slides: [{ label: title, text: '' }] }, () => 0).catch(fail);
  const saveBible = (uid, edited) => saveEdited(uid, { kind: 'bible', ...edited }, () => 0).catch(fail);
  // After a background change, reload the item (and refresh the screens if it is showing).
  // Sing only some verses of a hymn in the order of service.
  const setVerses = async (uid, verses) => {
    try {
      const items = s.plan.items.map((x) => (x.uid === uid ? { ...x, verses: verses || undefined } : x));
      await api('/api/plan', { items });
      const it = await api('/api/plan/open', { uid });
      await api('/api/plan', { items: items.map((x) => (x.uid === uid ? { ...x, count: it.slides.length } : x)) });
      if (s.live && s.live.item.key === uid) await api('/api/live', { item: it, index: Math.min(s.live.index, it.slides.length - 1) });
      setSelected(it);
    } catch (err) { fail(err); }
  };
  const refreshItem = async (uid) => {
    const it = await api('/api/plan/open', { uid });
    if (s.live && s.live.item.key === uid) await api('/api/live', { item: it, index: s.live.index });
    setSelected(it);
  };
  const songIdOf = (it) => it && (it.songId || (it.key.startsWith('song:') ? it.key.slice(5) : null));
  const planSong = item && item.kind === 'song' && s.plan.items.find((x) => x.uid === item.key);

  const live = s.live;
  return html`<div class=${'shell' + (vol ? ' volunteer' : '')}>
    <div class="topbar">
      <div class="brand"><img src="/logo.svg" alt="" /><span>${s.config.churchName || 'ChurchStream'}</span></div>
      <${Omnibox} locked=${vol} onOpen=${(it) => { setSelected(it); setTab('slides'); }} onShow=${(it) => { show(it); setTab('slides'); }} onAdd=${addToPlan} onNewSong=${(t) => setDialog({ type: 'song', song: { title: t } })} />
      <span class="spacer"></span>
      ${s.sabbath && s.sabbath.label && html`<div class=${'status sun' + (s.sabbath.isSabbath ? ' sabbath' : '')} title="Sunset times for your church's location (Settings → General)">${icons.sun()}<span class="extra-sun">${s.sabbath.label}</span></div>`}
      <${StreamStatus} s=${s} />
      <${VolunteerToggle} on=${vol} setOn=${setVol} />
      ${/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && html`<button class="btn icon round vol-hide" title="Connect a phone or tablet" aria-label="Connect a phone or tablet" onClick=${() => navigate('/settings#devices')}>${icons.phone()}</button>`}
      <a class="btn icon round vol-hide" href="/manual" target="_blank" rel="noopener" title="User manual" aria-label="User manual">?</a>
      <button class="btn icon round vol-hide" title="Settings" aria-label="Settings" onClick=${() => navigate('/settings')}>${icons.gear()}</button>
    </div>
    ${st.problem && html`<div class=${'banner' + (st.state === 'retrying' || st.state === 'error' ? ' red' : '')}>${icons.alert()}<span class="grow">${st.problem}${st.message && st.state === 'retrying' ? ' ' + st.message : ''}</span>
      <button class="btn small" onClick=${() => navigate('/settings#advanced')}>Details</button>
      ${st.mode !== 'off' && html`<button class="btn small" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop</button>`}</div>`}
    ${st.silent && html`<div class="banner red">${icons.alert()}<span class="grow"><b>No sound for 10 seconds.</b> Check that the microphone or sound desk is on and connected.</span></div>`}
    ${s.task && (s.task.running || s.task.error) && html`<div class=${'banner' + (s.task.error ? ' red' : '')}><span class="grow">${s.task.error || s.task.label}</span></div>`}
    <nav class="tabs">
      <button class=${tab === 'slides' ? 'on' : ''} onClick=${() => setTab('slides')}>Slides</button>
      <button class=${tab === 'output' ? 'on' : ''} onClick=${() => setTab('output')}>Screens & stream${st.mode === 'live' ? ' ●' : ''}</button>
    </nav>
    <div class="main">
      <${Slides} s=${s} item=${item} inPlan=${inPlan} active=${tab === 'slides'} onShowSlide=${showSlide} onAdd=${() => addToPlan({ ...item, songId: songIdOf(item) }).then((d) => { const uid = d && d.uids && d.uids[d.uids.length - 1]; if (uid) openPlan(uid); })} onEdit=${item && (item.kind !== 'song' || songIdOf(item)) ? () => editItem(item) : null} onBackground=${(i) => setDialog({ type: 'bg', item, slideIndex: i })}
        onVerses=${(verses) => setVerses(item.key, verses)} />
      <${Aside} s=${s} active=${tab === 'output'} onGoLive=${() => setDialog({ type: 'golive' })} onStop=${() => setDialog({ type: 'stop' })} />
    </div>
    <div class="bottom">
      <${Plan} s=${s} locked=${vol} selectedKey=${item && item.key} onOpen=${openPlan} onEdit=${editPlan} onNewSong=${() => setDialog({ type: 'song', song: {}, addToService: true })} onNewText=${() => setDialog({ type: 'text' })}
        onNewCountdown=${() => setDialog({ type: 'countdown' })} onNewSlides=${() => setDialog({ type: 'slides' })} onNewMedia=${() => setDialog({ type: 'media' })}
        onNewResponsive=${() => setDialog({ type: 'responsive' })}
        onNewSunset=${() => setDialog({ type: 'text', preset: { title: 'Sunset times', text: 'This Sabbath ends at sunset\n{sabbath-ends}\n\nNext Sabbath begins\n{next-sabbath-begins}' } })} onTemplates=${() => setDialog({ type: 'templates' })}
        onServices=${() => setDialog({ type: 'services' })} onNewService=${() => setDialog({ type: 'newservice' })} />
      <div class="controls">
        <button class="btn" onClick=${() => step(-1)} title="Previous (←)">‹ Back${live && html`<small>${live.index + 1} of ${live.item.slides.length}</small>`}</button>
        <button class="btn primary next" onClick=${() => step(1)} title="Next (→, Space or a clicker)">Next ${icons.right()}</button>
        <button class=${'btn' + (s.clear ? ' on' : '')} onClick=${() => toggle('clear')} title="Hide the words, keep the background (C)">Clear<small>C</small></button>
        <button class=${'btn' + (s.logo ? ' on' : '')} onClick=${toggleLogo} title="Show the church logo (L)">Logo<small>L</small></button>
        <button class=${'btn black' + (s.black ? ' on' : '')} onClick=${() => toggle('black')} title="Black screen (B)">${s.black ? 'Black ✓' : 'Black'}<small>B</small></button>
      </div>
    </div>
    ${dialog && dialog.type === 'golive' && html`<${GoLiveDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'stop' && html`<${StopDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'bg' && html`<${BackgroundDialog} s=${s} item=${dialog.item} slideIndex=${dialog.slideIndex} onClose=${() => setDialog(null)} onSaved=${() => refreshItem(dialog.item.key)} />`}
    ${dialog && dialog.type === 'text' && html`<${TextEditor} preset=${dialog.preset} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (title, slides, auto) => saveText(dialog.item.key, title, slides, auto) : null} />`}
    ${dialog && dialog.type === 'responsive' && html`<${ResponsiveEditor} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (title, slides) => saveText(dialog.item.key, title, slides, 0) : null} />`}
    ${dialog && dialog.type === 'countdown' && html`<${CountdownEditor} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (it) => saveCountdown(dialog.item.key, it) : null} />`}
    ${dialog && dialog.type === 'templates' && html`<${TemplatesDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'services' && html`<${ServicesDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'newservice' && html`<${NewServiceDialog} s=${s} onClose=${() => setDialog(null)} onTemplates=${() => setDialog({ type: 'templates' })} />`}
    ${dialog && dialog.type === 'slides' && html`<${SlidesImport} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (title, slides, auto) => saveImages(dialog.item.key, title, slides, auto) : null} />`}
    ${dialog && dialog.type === 'media-edit' && html`<${MediaEditor} initial=${dialog.item} onClose=${() => setDialog(null)} onSave=${(title, media) => saveMedia(dialog.item.key, title, media)} />`}
    ${dialog && dialog.type === 'bible' && html`<${BibleEditor} s=${s} initial=${dialog.item} onClose=${() => setDialog(null)} onSave=${(edited) => saveBible(dialog.item.key, edited)} />`}
    ${dialog && dialog.type === 'media' && html`<${MediaDialog} s=${s} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)} />`}
    ${dialog && dialog.type === 'song' && html`<${SongEditor} song=${dialog.song} addToService=${dialog.addToService} onClose=${() => setDialog(null)} onSaved=${(saved) => {
      if (!saved) { setSelected(null); return; }
      // The order-of-service entry being edited, only if it is this song (not some other hymn
      // that happened to be selected when "Create a song" was used).
      const same = planSong && planSong.songId === saved.id;
      const it = { key: same ? planSong.uid : 'song:' + saved.id, kind: 'song', title: saved.title, subtitle: hymnLabel(saved), slides: saved.slides, songId: saved.id };
      if (same) refreshItem(planSong.uid).catch(fail); else setSelected(it);
      // The song is on the screens now: put the corrected words up straight away.
      const lv = s.live && s.live.item;
      if (lv && lv.kind === 'song' && (lv.songId === saved.id || lv.key === 'song:' + saved.id) && !(same && lv.key === planSong.uid)) {
        const inPlanNow = s.plan.items.some((x) => x.uid === lv.key);
        (inPlanNow ? api('/api/plan/open', { uid: lv.key }) : Promise.resolve({ ...it, key: lv.key }))
          .then((fresh) => api('/api/live', { item: fresh, index: Math.min(s.live.index, fresh.slides.length - 1) })).catch(fail);
      }
      // Added from + Add: open it as an item of the order of service.
      if (dialog.addToService) addToPlan(it).then((d) => { const uid = d && d.uids && d.uids[d.uids.length - 1]; if (uid) openPlan(uid); });
    }} />`}
  </div>`;
}

// ---------------------------------------------------------------------------------------
// settings sections (shared by the setup wizard and the settings page)
function useDevices() {
  const [devs, setDevs] = useState(null);
  const load = useCallback(() => { setDevs(null); get('/api/devices').then(setDevs).catch((e) => setDevs({ video: [], audio: [], monitors: [], note: e.message })); }, []);
  useEffect(load, []);
  return [devs, load];
}

const save = (patch, msg) => api('/api/config', patch).then(() => msg && toast(msg)).catch(fail);

function SectionGeneral({ s }) {
  const cfg = s.config;
  const [name, setName] = useState(cfg.churchName);
  const [pw, setPw] = useState(cfg.controlPassword);
  return html`<div>
    <div class="field"><label class="label">Church name</label><input class="input" value=${name} placeholder="e.g. Grace Community Church" onInput=${(e) => setName(e.target.value)} onBlur=${() => save({ churchName: name })} />
      <div class="hint">Shown under your logo (if you turn that on), or on its own when no logo image is set.</div></div>
    <${LogoField} s=${s} />
    <${LocationField} s=${s} />
    <div class="field"><label class="label">Control panel password (optional)</label><input class="input" type="password" value=${pw} placeholder="No password" onInput=${(e) => setPw(e.target.value)} onBlur=${() => save({ controlPassword: pw })} />
      <div class="hint">Set one if your Wi-Fi is open to visitors. The projector and stage screens never need it.</div></div>
  </div>`;
}

// The church logo: shown full screen when "Logo" is pressed (projector and stream).
function LogoField({ s }) {
  const theme = s.config.theme || {};
  const [busy, setBusy] = useState(false);
  const pick = () => pickFiles('image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg,video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm', false, async ([f]) => {
    if (!f) return;
    if (/^video\//.test(f.type) || /\.(mp4|m4v|mov|webm)$/i.test(f.name)) {
      // A video logo: stored with the other videos, played muted and repeating.
      if (f.size > 500 * 1024 * 1024) { fail(new Error('That video is over 500 MB. Please choose a shorter one.')); return; }
      setBusy(true);
      try {
        const res = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');
        await api('/api/config', { theme: { logo: d.file, logoSize: 'full' } }); // a video logo starts full screen
        toast('Video logo saved');
      } catch (err) { fail(err); }
      setBusy(false);
      return;
    }
    const type = f.type || { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[(f.name.split('.').pop() || '').toLowerCase()] || '';
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(type)) { fail(new Error('Please choose a PNG, JPG, WebP or SVG image. (iPhone photos: share them as JPG first.)')); return; }
    if (f.size > 12 * 1024 * 1024) { fail(new Error('That image is over 12 MB. Please choose a smaller one.')); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/media?kind=logo', { method: 'POST', headers: { 'Content-Type': type }, body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');
      toast('Logo saved');
    } catch (err) { fail(err); }
    setBusy(false);
  });
  const sizes = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['full', 'Full screen']];
  return html`<div class="field"><label class="label">Church logo</label>
    <div class="logo-field">
      <div class="logo-preview"><${Screen} slide=${null} theme=${theme} bg=${effectiveBg(null, null, theme)} churchName=${s.config.churchName} logo=${true} /></div>
      <div class="grow">
        <div class="row wrap">
          <button class="btn primary" disabled=${busy} onClick=${pick}>${busy ? 'Uploading…' : theme.logo ? 'Change logo…' : 'Upload a picture or video…'}</button>
          ${theme.logo && html`<button class="btn ghost" onClick=${() => api('/api/media/remove', { kind: 'logo' }).then(() => toast('Logo removed')).catch(fail)}>Remove</button>`}
        </div>
        ${theme.logo && theme.logoSize !== 'full' && html`<label class="switch" style="margin-top:8px"><input type="checkbox" checked=${!!theme.logoName} onChange=${(e) => save({ theme: { logoName: e.target.checked } })} /><span>Show the church name under the logo</span></label>`}
        ${theme.logo && html`<div class="choices" style="margin-top:8px">${sizes.map(([v, t]) => html`<button class=${'choice' + ((theme.logoSize || 'medium') === v ? ' on' : '')} onClick=${() => save({ theme: { logoSize: v } })}><b>${t}</b></button>`)}</div>`}
        <div class="hint">Shown on the projector and the stream when you press <b>Logo</b>. A picture (a PNG with a transparent background looks best) or a short video (MP4, MOV or WebM), which plays silently and repeats. <b>Full screen</b> fills the whole screen. ${theme.logo ? '' : 'Until you upload one, the church name is shown.'}</div>
      </div>
    </div></div>`;
}

function LocationField({ s }) {
  const loc = s.config.location || {};
  const [lat, setLat] = useState(loc.lat ?? '');
  const [lng, setLng] = useState(loc.lng ?? '');
  const saveLoc = (a = lat, b = lng) => {
    const la = parseFloat(a); const lo = parseFloat(b);
    if (a === '' && b === '') return save({ location: { lat: null, lng: null } });
    if (a === '' || b === '') return; // still typing the other one
    if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180)) return fail(new Error('Latitude must be between -90 and 90, longitude between -180 and 180.'));
    save({ location: { lat: la, lng: lo } }, 'Location saved');
  };
  const paste = (v) => { // accept "10.6596, -61.5019" pasted from Google Maps into either box
    const m = String(v).match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (m) { setLat(m[1]); setLng(m[2]); saveLoc(m[1], m[2]); return true; }
    return false;
  };
  const locate = () => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition((p) => { const a = p.coords.latitude.toFixed(4); const b = p.coords.longitude.toFixed(4); setLat(a); setLng(b); saveLoc(a, b); },
      () => fail(new Error('This computer could not find its location. Paste the coordinates from Google Maps instead.')), { timeout: 15000 })
    : fail(new Error('Location is not available here.'));
  return html`<div class="field"><label class="label">Church location (for sunset and Sabbath times)</label>
    <div class="key-row">
      <input class="input" inputmode="decimal" placeholder="Latitude, e.g. 10.6596" value=${lat} onInput=${(e) => { if (!paste(e.target.value)) setLat(e.target.value); }} onBlur=${() => saveLoc()} />
      <input class="input" inputmode="decimal" placeholder="Longitude, e.g. -61.5019" value=${lng} onInput=${(e) => { if (!paste(e.target.value)) setLng(e.target.value); }} onBlur=${() => saveLoc()} />
      <button class="btn" onClick=${locate}>Use this computer’s location</button>
    </div>
    <div class="hint">In Google Maps, right-click your church and click the numbers at the top to copy them, then paste here. ${s.sabbath ? html`<b>${s.sabbath.label}</b> · this Sabbath: ${s.sabbath.tokens['sabbath-begins']} → ${s.sabbath.tokens['sabbath-ends']}` : ''}</div></div>`;
}

// Sound for online viewers: clean-up, microphone level and lip-sync delay.
function SoundCleanup({ s }) {
  const a = s.config.audio || {};
  const [gain, setGain] = useState(a.gainDb || 0);
  const [delay, setDelay] = useState(a.delayMs || 0);
  useEffect(() => { setGain(a.gainDb || 0); setDelay(a.delayMs || 0); }, [a.gainDb, a.delayMs]);
  const live = s.stream.mode === 'live';
  const levels = [['off', 'Off', 'The sound exactly as it comes in'], ['light', 'Light', 'Removes hum and fan noise, evens out voices'], ['strong', 'Strong', 'For noisy rooms or a distant microphone']];
  return html`<div class="field sound-box">
    <label class="label">Sound for online viewers</label>
    <div class="choices" style="margin-bottom:12px">${levels.map(([v, t, d]) => html`<button class=${'choice' + ((a.cleanup || 'off') === v ? ' on' : '')} onClick=${() => save({ audio: { cleanup: v } })}><b>${t}</b><span>${d}</span></button>`)}</div>
    <label class="meter-row" for="mic-gain"><span style="min-width:92px;font-weight:600;color:var(--text)">Mic level</span>
      <input id="mic-gain" class="grow" type="range" min="-12" max="12" step="1" value=${gain} onInput=${(e) => setGain(+e.target.value)} onChange=${(e) => save({ audio: { gainDb: +e.target.value } })} />
      <span class="meter-label">${gain > 0 ? '+' : ''}${gain} dB</span></label>
    <label class="meter-row" for="lip-sync" style="margin-top:8px"><span style="min-width:92px;font-weight:600;color:var(--text)">Lip-sync</span>
      <input id="lip-sync" class="grow" type="range" min="0" max="800" step="20" value=${delay} onInput=${(e) => setDelay(+e.target.value)} onChange=${(e) => save({ audio: { delayMs: +e.target.value } })} />
      <span class="meter-label">${delay ? delay + ' ms' : 'Off'}</span></label>
    <div class="hint">Lip-sync: if people's mouths move <b>after</b> you hear them on the stream, move this right until they match (usually 100–300 ms with an HDMI capture card). Watch the meter while someone speaks to set the mic level: aim for the green, just touching orange.
      ${live ? html` <b>These apply the next time the stream starts</b> (they change the stream's sound and need a restart).` : ' The preview restarts to apply them.'}</div>
  </div>`;
}

function SectionCamera({ s, autoPreview }) {
  const cfg = s.config;
  const [devs, reload] = useDevices();
  const [rtsp, setRtsp] = useState(cfg.video.rtspUrl);
  const v = cfg.video;
  const a = cfg.audio;
  useEffect(() => {
    if (autoPreview && s.stream.mode === 'off') api('/api/stream/start', { mode: 'preview' }).catch(() => {});
  }, []);
  const types = [
    ['dshow', s.platform === 'darwin' ? 'Camera or capture card' : 'USB camera or capture card', s.platform === 'darwin' ? 'The built-in camera, USB webcams, HDMI capture devices or an iPhone (Continuity Camera)' : 'Webcams and HDMI-to-USB capture devices'],
    ['rtsp', 'Network (IP) camera', 'PTZ and IP cameras on your network'],
    ['phone', 'Phone (scan a QR code)', 'A phone’s camera over the church Wi-Fi — nothing to install'],
    ['testsrc', 'Test pattern', 'Try everything without a camera'],
  ];
  return html`<div class="two">
    <div>
      <label class="label">Camera type</label>
      <div class="choices" style="grid-template-columns:1fr">
        ${types.map(([id, t, d]) => html`<button class=${'choice' + (v.type === id ? ' on' : '')} onClick=${() => save({ video: { type: id }, audio: id === 'rtsp' && a.source === 'device' && !a.device ? { source: 'camera' } : {} })}><b>${t}</b><span>${d}</span></button>`)}
      </div>
      ${v.type === 'dshow' && html`<div class="field"><label class="label">Camera</label>
        <div class="row"><select class="select" value=${v.device} onChange=${(e) => save({ video: { device: e.target.value } })}>
          <option value="">${devs ? (devs.video.length ? 'Choose a camera…' : 'No cameras found') : 'Looking for cameras…'}</option>
          ${devs && devs.video.map((d) => html`<option value=${d}>${d}</option>`)}
          ${v.device && devs && !devs.video.includes(v.device) && html`<option value=${v.device}>${v.device} (not connected)</option>`}
        </select><button class="btn" onClick=${reload} title="Look again">Refresh</button></div></div>`}
      ${v.type === 'rtsp' && html`<div class="field"><label class="label">Camera address (RTSP)</label>
        <input class="input" value=${rtsp} placeholder="rtsp://user:password@192.168.1.50:554/stream1" onInput=${(e) => setRtsp(e.target.value)} onBlur=${() => save({ video: { rtspUrl: rtsp.trim() } })} />
        <div class="hint">Found in your camera's manual or app. Usually starts with rtsp://</div></div>`}
      ${v.type === 'phone' && html`<${PhoneCamSetup} s=${s} cam=${1} />`}
      ${s.studioOn && html`<${CameraName} s=${s} n=${1} />`}
      <${SecondCamera} s=${s} devs=${devs} />
      <div class="field"><label class="label">Sound</label>
        <select class="select" value=${a.source === 'device' ? 'device:' + a.device : a.source} onChange=${(e) => {
          const val = e.target.value;
          save({ audio: val.startsWith('device:') ? { source: 'device', device: val.slice(7) } : { source: val } });
        }}>
          ${devs && devs.audio.map((d) => html`<option value=${'device:' + d}>${d}</option>`)}
          ${a.source === 'device' && a.device && devs && !devs.audio.includes(a.device) && html`<option value=${'device:' + a.device}>${a.device} (not connected)</option>`}
          ${a.source === 'device' && !a.device && html`<option value="device:">Choose a microphone…</option>`}
          ${v.type === 'rtsp' && html`<option value="camera">Sound from the camera</option>`}
          <option value="none">No sound (silent stream)</option>
        </select>
        <div class="hint">For the best sound, connect the sound desk to the computer (or to the capture card) and pick it here.</div></div>
      ${s.studioOn && html`<div class="field"><label class="label">Second microphone (optional)</label>
        <select class="select" value=${(s.config.audio2 && s.config.audio2.device) || ''} onChange=${(e) => save({ audio2: { device: e.target.value } })}>
          <option value="">None</option>
          ${devs && devs.audio.filter((d) => !(a.source === 'device' && d === a.device)).map((d) => html`<option value=${d}>${d}</option>`)}
          ${s.config.audio2 && s.config.audio2.device && devs && !devs.audio.includes(s.config.audio2.device) && html`<option value=${s.config.audio2.device}>${s.config.audio2.device} (not connected)</option>`}
        </select>
        <div class="hint">For example a radio microphone or a second sound card. It gets its own fader on the stream page.</div></div>`}
      <div class="field"><label class="label">Sound of videos and background music on the stream</label>
        <select class="select" value=${s.config.mediaSound || 'direct'} onChange=${(e) => save({ mediaSound: e.target.value })}>
          <option value="direct">Mix it straight into the stream (recommended)</option>
          <option value="desk">It already reaches the stream through our sound desk</option>
        </select>
        <div class="hint">Choose the second option only if this computer's sound goes into your sound desk and the desk feeds the stream — otherwise viewers would hear it twice.</div></div>
      <${SoundCleanup} s=${s} />
      ${devs && devs.note && html`<div class="note">${devs.note}</div>`}
    </div>
    <div>
      <label class="label">Preview</label>
      <${PreviewImage} running=${s.stream.mode !== 'off'} />
      <div style="margin-top:12px"><${Meter} /></div>
      ${s.stream.problem && html`<div class="note" style="margin-top:12px;color:#ffd2d3">${s.stream.problem}</div>`}
      <div class="row" style="margin-top:12px">
        ${s.stream.mode === 'off'
          ? html`<button class="btn" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Start preview</button>`
          : s.stream.mode === 'preview' && html`<button class="btn" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Restart preview</button>`}
      </div>
    </div>
  </div>`;
}

// Cameras 2–4 (optional). Camera 2 is switched on air with Camera 1 / Camera 2 on the control
// panel; cameras 3 and 4 come with the studio (scenes on the stream page).
function SecondCamera({ s, devs }) {
  return html`<${ExtraCamera} s=${s} devs=${devs} n=${2} />
    ${s.studioOn && html`<${ExtraCamera} s=${s} devs=${devs} n=${3} />`}
    ${s.studioOn && camUsable(s.config.video3) && html`<${ExtraCamera} s=${s} devs=${devs} n=${4} />`}`;
}

function CameraName({ s, n }) {
  const key = CAMERA_KEYS[n - 1];
  const v = s.config[key] || {};
  const [name, setName] = useState(v.name || '');
  useEffect(() => { setName(v.name || ''); }, [v.name]);
  return html`<input class="input" style="margin-top:8px" aria-label=${`Name of camera ${n}`} placeholder=${`Name, e.g. ${['Pulpit', 'Platform', 'Choir', 'Balcony'][n - 1]} (optional)`} value=${name} maxlength="30"
    onInput=${(e) => setName(e.target.value)} onBlur=${() => name.trim() !== (v.name || '') && save({ [key]: { name: name.trim() } })} />`;
}

function ExtraCamera({ s, devs, n }) {
  const key = CAMERA_KEYS[n - 1];
  const v = s.config[key] || { type: 'none' };
  const [url, setUrl] = useState(v.rtspUrl || '');
  const taken = CAMERA_KEYS.filter((k) => k !== key).map((k) => s.config[k]).filter((x) => x && x.type === 'dshow').map((x) => x.device);
  const cams = devs ? devs.video.filter((d) => !taken.includes(d)) : [];
  const label = n === 2 ? 'Second camera (optional)' : `Camera ${n} (optional)`;
  return html`<div class="field"><label class="label">${label}</label>
    <select class="select" value=${v.type || 'none'} onChange=${(e) => save({ [key]: { type: e.target.value } })}>
      <option value="none">None</option>
      <option value="dshow">${s.platform === 'darwin' ? 'Camera or capture card' : 'USB camera or capture card'}</option>
      <option value="rtsp">Network (IP) camera</option>
      <option value="phone">Phone (scan a QR code)</option>
      <option value="testsrc">Test pattern (to try it out)</option>
    </select>
    ${v.type === 'phone' && html`<${PhoneCamSetup} s=${s} cam=${n} />`}
    ${v.type === 'dshow' && html`<div class="row" style="margin-top:8px"><select class="select" aria-label=${`Camera ${n}`} value=${v.device} onChange=${(e) => save({ [key]: { device: e.target.value } })}>
      <option value="">${devs ? (cams.length ? 'Choose the camera…' : 'No other camera found') : 'Looking for cameras…'}</option>
      ${cams.map((d) => html`<option value=${d}>${d}</option>`)}
      ${v.device && devs && !devs.video.includes(v.device) && html`<option value=${v.device}>${v.device} (not connected)</option>`}
    </select></div>`}
    ${v.type === 'rtsp' && html`<input class="input" style="margin-top:8px" aria-label=${`Camera ${n} address`} value=${url} placeholder="rtsp://user:password@192.168.1.51:554/stream1" onInput=${(e) => setUrl(e.target.value)} onBlur=${() => save({ [key]: { rtspUrl: url.trim() } })} />`}
    ${s.studioOn && camUsable(v) && html`<${CameraName} s=${s} n=${n} />`}
    ${n === 2 && html`<div class="hint">${hasCam2(s.config)
      ? s.studioOn ? 'Switch cameras with Camera 1 / Camera 2 on the control panel, or build scenes with them on the stream page. Sound still comes from the choice below.' : 'Switch between them with Camera 1 / Camera 2 on the control panel, or the 1 and 2 keys. Sound still comes from the choice below.'
      : 'Add a second camera (e.g. one on the pulpit and one on the platform) and switch between them during the service.'}</div>`}
  </div>`;
}

// A phone as a camera: scan the QR code with the phone, allow the camera, done.
function PhoneCamSetup({ s, cam }) {
  const [info, setInfo] = useState(null);
  const [pick, setPick] = useState(0);
  const load = () => get('/api/phone-camera/info').then(setInfo).catch(fail);
  useEffect(() => { load(); }, []);
  const links = (info && info['cam' + cam]) || [];
  const link = links[pick] || links[0];
  const on = !!(s.phoneCams && s.phoneCams[cam]);
  const renew = () => { if (confirm('Make a new camera address? Phones using the old QR code stop sending until they scan the new one.')) api('/api/phone-camera/renew', {}).then(setInfo).catch(fail); };
  const iphone = 'Show Details → visit this website';
  return html`<div class="phonecam">
    <div class=${'phonecam-status' + (on ? ' on' : '')}><i></i>${on ? `Phone connected — camera ${cam} is sending` : 'Waiting for the phone…'}</div>
    ${!info ? html`<div class="hint">Loading…</div>` : !link ? html`<div class="note">${info.error || 'This computer isn’t on a network. Connect it to the church Wi-Fi first.'}</div>` : html`<div class="phonecam-body">
      <${QrCode} text=${link} size=${168} />
      <ol class="phonecam-steps">
        <li>On the phone (on the <b>same Wi-Fi</b>), open the camera app and scan this code.</li>
        <li>The phone warns that the connection isn’t private — that’s expected for a page on your own network. Tap <b>Advanced → Proceed</b> (Android) or <b>${iphone}</b> (iPhone). Only the first time.</li>
        <li>Tap <b>Start camera</b> and allow the camera. Hold the phone sideways; keep it plugged in.</li>
      </ol>
    </div>
    ${links.length > 1 && html`<div class="row" style="margin-top:8px"><select class="select" aria-label="Network address" value=${pick} onChange=${(e) => setPick(+e.target.value)}>${info.ips.map((ip, i) => html`<option value=${i}>${ip}</option>`)}</select></div>`}
    <div class="row wrap" style="margin-top:8px">
      <button class="btn small ghost" onClick=${() => (navigator.clipboard ? navigator.clipboard.writeText(link).then(() => toast('Link copied')) : Promise.reject(new Error('Copy is not available here'))).catch(fail)}>Copy link</button>
      <button class="btn small ghost" onClick=${renew}>New address</button>
    </div>
    <div class="hint">If the phone drops off the Wi-Fi, the stream shows “Waiting for the phone camera” and the picture comes back by itself.</div>`}
  </div>`;
}

function SectionProjector({ s }) {
  const cfg = s.config;
  const [devs] = useDevices();
  const mons = (devs && devs.monitors) || [];
  const cur = cfg.projector;
  const lan = s.lan || [];
  return html`<div>
    <div class="note" style="margin-bottom:18px">Your two screens share one picture through the <b>HDMI splitter</b>, so ChurchStream drives a single projector output.</div>
    ${mons.length > 0 && html`<div class="field"><label class="label">Which display is the projector?</label>
      <div class="choices">${mons.map((m) => html`<button class=${'choice' + (cur.monitor === m.id ? ' on' : '')} onClick=${() => save({ projector: { monitor: m.id, x: m.x, y: m.y } })}><b>${m.label}</b><span>${m.primary ? 'This is usually the laptop screen' : 'Probably the HDMI output'}</span></button>`)}</div></div>`}
    ${devs && !mons.length && html`<div class="note" style="margin-bottom:16px">Open <b>${location.origin}/display</b> in a browser on the projector screen and press <kbd>F11</kbd> for full screen.</div>`}
    <div class="row wrap" style="margin-bottom:16px">
      <button class="btn primary" onClick=${openProjector}>Open projector window</button>
      <button class="btn" onClick=${() => api('/api/projector/identify', {}).catch(fail)}>Show test on projector</button>
      ${s.projectorOpen && html`<button class="btn ghost" onClick=${() => api('/api/projector/close', {}).catch(fail)}>Close it</button>`}
    </div>
    <label class="switch"><input type="checkbox" checked=${cur.autoLaunch} onChange=${(e) => save({ projector: { autoLaunch: e.target.checked } })} /><span>Open the projector automatically when ChurchStream starts</span></label>
    ${lan.length > 0 && html`<div class="note" style="margin-top:16px"><b>Stage screen for musicians:</b> open <b>${lan[0]}/stage</b> on any phone or tablet on the church Wi-Fi to see the current and next slide (QR codes in Phones & tablets).</div>`}
  </div>`;
}

function SectionStreaming({ s }) {
  const cfg = s.config;
  const o = cfg.outputs;
  const [yt, setYt] = useState('');
  const [fb, setFb] = useState('');
  const [custom, setCustom] = useState('');
  const qualities = [
    ['low', 'Low bandwidth', '480p · needs ~1.5 Mbps upload per platform'],
    ['good', 'Good', '720p · needs ~3 Mbps upload per platform'],
    ['high', 'High', '1080p · needs ~5 Mbps upload per platform'],
  ];
  const keyRow = (id, label, val, setVal, help, placeholder) => html`<div class="field">
    <label class="switch" style="min-height:32px"><input type="checkbox" checked=${o[id].enabled} onChange=${(e) => save({ outputs: { [id]: { enabled: e.target.checked } } })} /><b>${label}</b></label>
    <div class="key-row" style="margin-top:6px">
      <input class="input" type="password" autocomplete="off" value=${val} placeholder=${o[id].hasKey ? `Saved (${o[id].key || o[id].url}) — paste to replace` : placeholder} onInput=${(e) => setVal(e.target.value)} />
      <button class="btn" disabled=${!val.trim()} onClick=${() => { save({ outputs: { [id]: id === 'custom' ? { url: val.trim(), enabled: true } : { key: val.trim(), enabled: true } } }, `${label} saved`); setVal(''); }}>Save</button>
    </div>
    <div class="hint">${help}</div>
  </div>`;
  return html`<div>
    ${keyRow('youtube', 'YouTube', yt, setYt, html`In <a href="https://studio.youtube.com" target="_blank" rel="noopener">YouTube Studio</a>: <b>Create → Go live → Stream</b>, then copy the <b>Stream key</b>. It stays the same every week.`, 'Paste your YouTube stream key')}
    ${keyRow('facebook', 'Facebook', fb, setFb, html`In <a href="https://www.facebook.com/live/producer" target="_blank" rel="noopener">Facebook Live Producer</a>: choose <b>Streaming software</b> and tick <b>Use a persistent stream key</b>, then copy the key.`, 'Paste your Facebook stream key')}
    ${keyRow('custom', 'Another service (RTMP)', custom, setCustom, 'Full RTMP address including the key, e.g. rtmp://live.example.com/app/KEY', 'rtmp://…')}
    <${TitlePattern} s=${s} />
    <label class="label" style="margin-top:20px">Quality</label>
    <div class="choices">${qualities.map(([id, t, d]) => html`<button class=${'choice' + (cfg.quality === id ? ' on' : '')} onClick=${() => save({ quality: id })}><b>${t}</b><span>${d}</span></button>`)}</div>
    <div class="note" style="margin-bottom:16px">The video is encoded <b>once</b> and sent to every platform, so the computer works no harder for two platforms. Your internet upload needs to cover each platform. Check it at <a href="https://fast.com" target="_blank" rel="noopener">fast.com</a> (“Show more info”). If unsure, start with <b>Good</b>.</div>
    <label class="label" style="margin-top:20px">Recording</label>
    <${RecordingOptions} s=${s} />
  </div>`;
}

function TitlePattern({ s }) {
  const [v, setV] = useState(s.config.broadcastTitle || '');
  return html`<div class="field" style="margin-top:8px"><label class="label">Broadcast title pattern</label>
    <input class="input" value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${() => save({ broadcastTitle: v })} />
    <div class="hint">Use {church}, {date} and {sermon}. Example: ${broadcastTitle({ ...s.config, broadcastTitle: v }, 'The Good Shepherd')}. ChurchStream shows it when you go live, ready to copy into YouTube and Facebook.</div></div>`;
}

function SectionSongs({ s }) {
  const counts = s.library.songs;
  const task = s.task;
  const busy = task && task.running;
  const hymnals = [
    ['SDAH', 'Seventh-day Adventist Hymnal', '1985 · 695 hymns'],
    ['CH1941', 'Church Hymnal', '1941 · 703 hymns'],
  ];
  const [def, setDef] = useState(s.config.hymnal.default);
  return html`<div>
    <div class="choices">
      ${hymnals.map(([id, name, info]) => html`<div class="choice" style="cursor:default">
        <b>${name}</b><span>${info}</span>
        <span>${counts[id] ? html`<span style="color:var(--ok)">✓ ${counts[id]} hymns installed</span>` : 'Not installed'}</span>
        <div style="margin-top:8px"><button class=${'btn small' + (counts[id] ? '' : ' primary')} disabled=${busy} onClick=${() => api('/api/import/hymnal', { id }).catch(fail)}>${counts[id] ? 'Update' : 'Download'}</button></div>
      </div>`)}
    </div>
    ${task && (task.running || task.error || task.result) && html`<div class="note" style=${'margin-bottom:16px;' + (task.error ? 'color:#ffd2d3' : '')}>${task.error || task.label || task.result}</div>`}
    <div class="field"><label class="label">When you type just a number (e.g. 100), open the hymn from</label>
      <select class="select" value=${def} onChange=${(e) => { setDef(e.target.value); save({ hymnal: { default: e.target.value } }); }}>
        <option value="SDAH">Seventh-day Adventist Hymnal (1985)</option><option value="CH1941">Church Hymnal (1941)</option><option value="AY">Advent Youth Sing</option>
      </select><div class="hint">Type <kbd>sdah 100</kbd>, <kbd>ch 100</kbd> or <kbd>ay 25</kbd> to choose a songbook directly.</div></div>
    <div class="note">Hymn texts are downloaded from free community projects (github.com/joshpetit/sda-hymnal and github.com/adventhymnals). Many hymns are public domain, but some are still under copyright. <b>Projecting them requires your church's CCLI licence</b>, which most churches already have.</div>
    <${SongFiles} s=${s} />
  </div>`;
}

// Import songs from files, and save songs to a .churchsongs file to carry to another computer.
const SONG_ACCEPT = '.churchsongs,.txt,.docx,.xml,.cho,.chordpro,.chopro,.pro,.csv,.zip';
const BOOKS = [['AY', 'Advent Youth Sing (AY)'], ['own', 'My own songs (no songbook)'], ['SDAH', 'SDA Hymnal'], ['CH1941', 'Church Hymnal (1941)']];
function SongFiles({ s }) {
  const counts = { ...s.library.songs };
  counts.own = counts.total - Object.keys(s.library.hymnals || {}).reduce((n, h) => n + (counts[h] || 0), 0);
  const [files, setFiles] = useState(null); // [{ file, info, error }]
  const [book, setBook] = useState('own');
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState(counts.AY ? 'AY' : counts.own ? 'own' : 'SDAH');
  const send = async (f, params) => {
    const res = await fetch('/api/import/songs?' + new URLSearchParams({ name: f.name, ...params }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || 'The file could not be read.');
    return d;
  };
  const choose = (preset) => pickFiles(SONG_ACCEPT, true, async (list) => {
    if (!list || !list.length) return;
    setBusy('Reading…');
    const got = [];
    for (const f of list) { try { got.push({ file: f, info: await send(f, { check: '1' }) }); } catch (err) { got.push({ file: f, error: err.message }); } }
    const fromFile = got.find((g) => g.info && g.info.book);
    const numbered = got.some((g) => g.info && g.info.numbered > 1);
    setBook(preset || (fromFile ? fromFile.info.book.code : numbered ? 'AY' : 'own'));
    setFiles(got);
    setBusy('');
  });
  const ok = files ? files.filter((g) => g.info) : [];
  const total = ok.reduce((n, g) => n + g.info.count, 0);
  const doImport = async () => {
    setBusy('Importing…');
    let added = 0; let replaced = 0; let kept = 0;
    try {
      for (const g of ok) { const d = await send(g.file, { book }); added += d.added; replaced += d.replaced; kept += d.kept; }
      toast(`${added} songs added${replaced ? `, ${replaced} updated` : ''}${kept ? `, ${kept} you'd edited were kept` : ''}.${book === 'AY' ? ' Type “ay 25” to find AY Sing 25.' : ''}`);
      setFiles(null);
    } catch (err) { fail(err); }
    setBusy('');
  };
  const saveFile = () => {
    const a = document.createElement('a');
    a.href = '/api/songs/export?' + new URLSearchParams({ book: out });
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Saving the songs file to Downloads');
  };
  const bookName = (code) => (BOOKS.find((b) => b[0] === code) || [code, code])[1];
  const range = (i) => (i.numbered ? ` · numbers ${i.from}–${i.to}` : '');
  return html`<div>
    <div class="choices" style="margin-top:20px">
      <div class="choice" style="cursor:default">
        <b>Advent Youth Sing</b><span>AY Sing · youth songbook</span>
        <span>${counts.AY ? html`<span style="color:var(--ok)">✓ ${counts.AY} songs installed</span>` : 'Not installed · import your copy'}</span>
        <div style="margin-top:8px"><button class=${'btn small' + (counts.AY ? '' : ' primary')} disabled=${!!busy} onClick=${() => choose('AY')}>${counts.AY ? 'Import again…' : 'Import…'}</button></div>
      </div>
    </div>
    <div class="field" style="margin-top:4px"><label class="label">Choruses and other songs</label>
      ${!files ? html`<div class="row wrap">
          <button class="btn" disabled=${!!busy} onClick=${() => choose('')}>${icons.upload()} ${busy || 'Import songs…'}</button>
          <span class="hint" style="margin:0">ChurchStream songs files, text, Word, CCLI SongSelect, OpenLyrics, ChordPro or CSV.</span></div>`
        : html`<div class="svc-box">
          ${files.map((g) => html`<div key=${g.file.name} style="margin-bottom:6px"><b>${g.file.name}</b> ${g.info
            ? html`<span class="muted">· ${g.info.count} ${g.info.count === 1 ? 'song' : 'songs'}${range(g.info)} · ${g.info.format}</span><div class="muted" style="font-size:13px">${g.info.titles.join(' · ')}${g.info.count > 3 ? ' …' : ''}</div>`
            : html`<span style="color:var(--danger,#d92d20)">· ${g.error}</span>`}</div>`)}
          ${ok.length > 0 && html`<div class="field" style="margin:10px 0 0"><label class="label" for="song-book">Add them to</label>
            <select id="song-book" class="select" value=${book} onChange=${(e) => setBook(e.target.value)}>
              ${BOOKS.map(([id, label]) => html`<option value=${id}>${label}</option>`)}
            </select>
            <div class="hint">${book === 'own' ? 'Found by title or words.' : `Numbered songs can be found by number too, e.g. “${book === 'AY' ? 'ay' : book === 'CH1941' ? 'ch' : 'sdah'} ${ok[0].info.from || 1}”.`} Songs you've edited are kept.</div></div>`}
          <div class="row" style="margin-top:10px">
            ${ok.length > 0 && html`<button class="btn primary" disabled=${!!busy} onClick=${doImport}>${busy || `Import ${total} ${total === 1 ? 'song' : 'songs'}`}</button>`}
            <button class="btn ghost" disabled=${!!busy} onClick=${() => setFiles(null)}>Cancel</button></div>
        </div>`}
    </div>
    <div class="field"><label class="label">Take songs to another computer</label>
      <div class="row wrap">
        <select class="select" style="width:auto;flex:1;min-width:200px" value=${out} onChange=${(e) => setOut(e.target.value)} aria-label="Songs to save">
          ${BOOKS.filter(([id]) => counts[id]).map(([id, label]) => html`<option value=${id}>${label}${counts[id] ? ` · ${counts[id]}` : ''}</option>`)}
        </select>
        <button class="btn" disabled=${!counts[out]} onClick=${saveFile}>Save to a file…</button></div>
      <div class="hint">Saves a <b>.churchsongs</b> file to Downloads. Copy it to the other laptop (USB stick, email, WhatsApp) and open it there with <b>Import songs…</b>.</div></div>
    <p class="muted" style="margin-top:16px">${counts.total} songs in your library in total. To type in one song, search for its title in the control panel and choose “Create a song”.</p>
  </div>`;
}

function SectionBible({ s }) {
  const cfg = s.config;
  const have = s.library.translations;
  const busy = s.task && s.task.running;
  const catalog = [['kjv', 'King James Version (KJV)'], ['bsb', 'Berean Standard Bible (BSB) — modern English'], ['asv', 'American Standard Version (ASV)'], ['ylt', "Young's Literal Translation (YLT)"], ['darby', 'Darby Bible']];
  return html`<div>
    <div class="field"><label class="label">Default translation</label>
      <select class="select" value=${cfg.bible.translation} onChange=${(e) => save({ bible: { translation: e.target.value } })}>
        ${have.map((t) => html`<option value=${t.id}>${t.name} (${t.abbrev})</option>`)}
      </select></div>
    <div class="field"><label class="label">Verses on each screen</label>
      <div class="choices">${[[1, 'One verse', 'Easiest to follow'], [0, 'As many as fit', 'Fewer screens to step through']].map(([v, t, d]) => html`<button class=${'choice' + ((cfg.bible.versesPerSlide === 0 ? 0 : 1) === v ? ' on' : '')} onClick=${() => save({ bible: { versesPerSlide: v } })}><b>${t}</b><span>${d}</span></button>`)}</div>
      <div class="hint">A very long verse that doesn't fit at the smallest text size (Settings → Appearance) continues on the next screen.</div></div>
    <label class="label">Free (public domain) translations</label>
    <div style="display:grid;gap:8px;margin-bottom:16px">
      ${catalog.map(([id, name]) => html`<div class="row"><span class="grow">${name}</span>${have.some((t) => t.id === id)
        ? html`<span style="color:var(--ok)">Installed</span>`
        : html`<button class="btn small" disabled=${busy} onClick=${() => api('/api/import/bible', { id }).catch(fail)}>Download</button>`}</div>`)}
    </div>
    ${s.task && (s.task.running || s.task.error) && html`<div class="note">${s.task.error || s.task.label}</div>`}
    <${BibleImport} have=${have} />
  </div>`;
}

// Import a Bible file the church is licensed to use (NRSV, NIV, NKJV, ESV…). It is converted
// and kept on this computer only.
function BibleImport({ have }) {
  const [file, setFile] = useState(null); // { file, books, name, abbrev }
  const [name, setName] = useState('');
  const [abbrev, setAbbrev] = useState('');
  const [licensed, setLicensed] = useState(false);
  const [busy, setBusy] = useState('');
  const imported = have.filter((t) => t.imported);
  const send = async (f, params) => {
    const res = await fetch('/api/import/bible-file?' + new URLSearchParams(params), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || 'The file could not be read.');
    return d;
  };
  const choose = () => pickFiles('.json,.xml,.osis,.usfx,application/json,text/xml,application/xml', false, async ([f]) => {
    if (!f) return;
    setBusy('Reading ' + f.name + '…');
    try {
      const d = await send(f, { check: '1' });
      setFile({ file: f, books: d.books });
      setName(d.name || ''); setAbbrev(d.abbrev || ''); setLicensed(false);
    } catch (err) { fail(err); }
    setBusy('');
  });
  const doImport = async () => {
    setBusy('Importing…');
    try {
      const d = await send(file.file, { name: name.trim(), abbrev: abbrev.trim(), licensed: licensed ? '1' : '0' });
      toast(`${d.name} (${d.abbrev}) is ready${d.replaced ? ' (replaced the earlier copy)' : ''}. Choose it as the default translation above, or type e.g. “John 3:16 ${d.abbrev}”.`);
      setFile(null);
    } catch (err) { fail(err); }
    setBusy('');
  };
  const remove = async (t) => {
    if (!confirm(`Remove ${t.name} (${t.abbrev}) from this computer?`)) return;
    try { await api('/api/bible/remove', { id: t.id }); toast(`${t.abbrev} removed`); } catch (err) { fail(err); }
  };
  return html`<div class="field" style="margin-top:20px">
    <label class="label">Translations your church is licensed to use</label>
    ${imported.length > 0 && html`<div style="display:grid;gap:8px;margin-bottom:12px">${imported.map((t) => html`<div class="row" key=${t.id}>
      <span class="grow">${t.name} (${t.abbrev})${t.complete ? '' : html` <span class="muted">· New Testament</span>`}</span>
      <span class="muted" style="font-size:12px">On this computer only</span>
      <button class="btn small ghost" onClick=${() => remove(t)}>Remove</button></div>`)}</div>`}
    ${!file ? html`<div class="row wrap">
        <button class="btn" disabled=${!!busy} onClick=${choose}>${icons.upload()} ${busy || 'Import a Bible file…'}</button>
        <span class="hint" style="margin:0">JSON, or Zefania, OSIS or USFX XML.</span></div>`
      : html`<div class="svc-box">
        <div><b>${file.file.name}</b> <span class="muted">· ${file.books >= 66 ? 'the whole Bible' : file.books + ' books (New Testament included)'}</span></div>
        <div class="two" style="gap:12px;margin-top:10px">
          <div class="field" style="margin:0"><label class="label" for="bi-name">Name</label><input id="bi-name" class="input" value=${name} placeholder="e.g. New Revised Standard Version" onInput=${(e) => setName(e.target.value)} /></div>
          <div class="field" style="margin:0"><label class="label" for="bi-abbrev">Short name</label><input id="bi-abbrev" class="input" value=${abbrev} placeholder="e.g. NRSV" maxlength="12" onInput=${(e) => setAbbrev(e.target.value)} /></div>
        </div>
        <label class="switch" style="margin-top:8px"><input type="checkbox" checked=${licensed} onChange=${(e) => setLicensed(e.target.checked)} /><span>Our church is licensed to use this translation</span></label>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" disabled=${!licensed || !name.trim() || !abbrev.trim() || !!busy} onClick=${doImport}>${busy || 'Import'}</button>
          <button class="btn ghost" disabled=${!!busy} onClick=${() => setFile(null)}>Cancel</button></div>
      </div>`}
    <div class="note" style="margin-top:12px">Copyrighted translations (NIV, NKJV, NRSV, ESV…) can't be downloaded here. If your church is licensed to use one and has its text as a file, import it with the button above. It stays on this computer: it isn't shared with other computers, and saved services carry only the reading references.</div>
  </div>`;
}

function SectionAppearance({ s }) {
  const theme = s.config.theme;
  const sample = { text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.' };
  return html`<div class="two appearance">
    <div>
      <div class="field"><label class="label">Default background (used everywhere unless an item or slide has its own)</label>
        <${BackgroundGallery} value=${theme.background || 'builtin:midnight'} onPick=${(v) => save({ theme: { background: v } })} />
        <div class="hint">Your own photos are dimmed a little automatically so the words stay readable. To change one hymn or reading, open it and press “Background”.</div></div>
      <${LogoField} s=${s} />
      <div class="field"><label class="label">Control panel colours</label>
        <div class="choices">${[['light', 'Light', 'Bright and easy to read'], ['dark', 'Dark', 'Less glare in a dim room']].map(([v, t, d]) => html`<button class=${'choice' + ((s.config.uiTheme || 'light') === v ? ' on' : '')} onClick=${() => save({ uiTheme: v })}><b>${t}</b><span>${d}</span></button>`)}</div></div>
      <div class="field"><label class="label">Largest text size</label>
        <div class="choices">${[[0.85, 'Smaller'], [1, 'Normal'], [1.15, 'Larger'], [1.3, 'Largest']].map(([v, t]) => html`<button class=${'choice' + ((theme.textScale || 1) === v ? ' on' : '')} onClick=${() => save({ theme: { textScale: v } })}><b>${t}</b></button>`)}</div>
        <div class="hint">Every slide uses this size whenever its words fit. A slide with more words shrinks only as much as it needs, down to the smallest size below.</div></div>
      <div class="field"><label class="label">Smallest text size</label>
        <div class="choices">${[[3.2, 'Small', 'Fits the most words'], [4.2, 'Medium', ''], [5.2, 'Large', 'Easier from the back'], [6.5, 'Extra large', 'Big rooms, older eyes']].map(([v, t, d]) => html`<button class=${'choice' + ((theme.minText || 3.2) === v ? ' on' : '')} onClick=${() => save({ theme: { minText: v } })}><b>${t}</b>${d && html`<span>${d}</span>`}</button>`)}</div>
        ${(theme.minText || 3.2) >= 8.5 * (theme.textScale || 1) * 0.85 && html`<div class="hint" style="margin-top:4px">The smallest size is close to the largest, so most slides will be the same size.</div>`}
        <label class="switch" style="margin-top:8px"><input type="checkbox" checked=${theme.overflow !== false} onChange=${(e) => save({ theme: { overflow: e.target.checked } })} /><span>When the words don't fit at this size, continue on the next slide</span></label>
        <div class="hint">${theme.overflow !== false
          ? 'Words never get smaller than this. A slide that would need smaller text is split in two (“Verse 1 (1/2)”, “(2/2)”), keeping whole lines and whole Bible verses together. Next steps through the parts as usual.'
          : 'Words never get smaller than this, so a very full slide may not fit on the screen.'}</div></div>
      <div class="field"><label class="label" for="proj-font">Projector font</label>
        <select id="proj-font" class="select" value=${theme.font || 'inter'} onChange=${(e) => save({ theme: { font: e.target.value } })}>
          ${Object.entries(FONTS).map(([k, f]) => html`<option value=${k}>${f.label}</option>`)}</select></div>
      <div class="field"><label class="label">Where the words go</label>
        <div class="choices">${[['middle', 'Middle of the screen', 'The usual layout'], ['bottom', 'Along the bottom', 'Leaves photos and the camera inset visible']].map(([v, t, d]) => html`<button class=${'choice' + ((theme.position || 'middle') === v ? ' on' : '')} onClick=${() => save({ theme: { position: v } })}><b>${t}</b><span>${d}</span></button>`)}</div></div>
      <div class="field"><label class="label">Line up the words</label>
        <div class="choices">${[['center', 'Centred'], ['left', 'Left']].map(([v, t]) => html`<button class=${'choice' + ((theme.align || 'center') === v ? ' on' : '')} onClick=${() => save({ theme: { align: v } })}><b>${t}</b></button>`)}</div></div>
      <label class="switch"><input type="checkbox" checked=${!!theme.outline} onChange=${(e) => save({ theme: { outline: e.target.checked } })} /><span>Outline the words (easier to read over busy photos)</span></label>
    </div>
    <div class="sticky-preview"><label class="label">Preview</label><${Screen} slide=${sample} kind="song" subtitle="SDA Hymnal 108" theme=${theme} /></div>
  </div>`;
}

function SectionLowerThirds({ s }) {
  const presets = s.config.lowerThirdPresets || [];
  const presetsJson = JSON.stringify(presets);
  // Edit a local copy: the page re-renders on every live update, so the boxes must not be
  // tied directly to the saved settings or typing would be overwritten.
  const [rows, setRows] = useState(presets);
  const [focusRow, setFocusRow] = useState(-1);
  const lastSaved = useRef(presetsJson);
  const timer = useRef(null);
  const pending = useRef(null);

  // Pick up names added elsewhere (e.g. "Show & save" in the control panel).
  useEffect(() => {
    if (presetsJson !== lastSaved.current && !pending.current) { lastSaved.current = presetsJson; setRows(presets); }
  }, [presetsJson]);

  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const clean = pending.current.map((r) => ({ name: r.name.trim(), title: r.title.trim() })).filter((r) => r.name || r.title);
    pending.current = null;
    lastSaved.current = JSON.stringify(clean);
    save({ lowerThirdPresets: clean });
  };
  useEffect(() => flush, []); // save anything pending when leaving the page

  const change = (next) => {
    setRows(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  const edit = (i, key, value) => change(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const box = useRef();
  useEffect(() => {
    if (focusRow < 0 || !box.current) return;
    const el = box.current.querySelector(`input[data-row="${focusRow}"]`);
    if (el) el.focus();
    setFocusRow(-1);
  }, [focusRow]);

  return html`<div ref=${box}>
    <p class="muted" style="margin-top:0">One-tap names for the stream (and the projector screens, if that is switched on). Changes save automatically.</p>
    ${rows.map((p, i) => html`<div class="row" style="margin-bottom:8px" key=${i}>
      <input class="input" value=${p.name} placeholder="Name, e.g. Pastor James Okafor" data-row=${i}
        onInput=${(e) => edit(i, 'name', e.target.value)} onBlur=${flush} />
      <input class="input" value=${p.title} placeholder="Title, e.g. Senior Pastor" onInput=${(e) => edit(i, 'title', e.target.value)} onBlur=${flush}
        onKeyDown=${(e) => { if (e.key === 'Enter') { flush(); e.target.blur(); } }} />
      <button class="btn ghost icon" onClick=${() => { change(rows.filter((_, j) => j !== i)); flush(); }} title="Remove" aria-label=${'Remove ' + (p.name || 'name')}>${icons.x()}</button>
    </div>`)}
    <button class="btn small" onClick=${() => { change([...rows, { name: '', title: '' }]); setFocusRow(rows.length); }}>${icons.plus()} Add a name</button>
  </div>`;
}

function SectionAdvanced({ s }) {
  const [logs, setLogs] = useState([]);
  const [ff, setFf] = useState(s.config.ffmpegPath);
  const load = () => get('/api/logs').then(setLogs).catch(() => {});
  useEffect(() => { load(); }, []);
  return html`<div>
    <div class="field"><label class="label">FFmpeg</label>
      <div class="note">${s.ffmpeg.ok ? s.ffmpeg.version : html`<b>FFmpeg was not found.</b> ${s.platform === 'darwin' ? 'Put ffmpeg in the “ffmpeg” folder next to ChurchStream (or install it with Homebrew: brew install ffmpeg)' : 'Put ffmpeg.exe in the “ffmpeg” folder next to ChurchStream.exe'}, or enter its location below.`}</div>
      <div class="key-row" style="margin-top:8px"><input class="input" value=${ff} placeholder="Automatic" onInput=${(e) => setFf(e.target.value)} /><button class="btn" onClick=${() => save({ ffmpegPath: ff.trim() }, 'Saved')}>Save</button></div></div>
    <div class="field"><label class="label">Video encoder</label>
      <select class="select" value=${s.config.encoder} onChange=${(e) => save({ encoder: e.target.value })}>
        <option value="auto">Automatic (uses the graphics chip when possible)</option>
        <option value="h264_qsv">Intel Quick Sync</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="h264_amf">AMD AMF</option><option value="libx264">Software (x264)</option>
      </select>${s.stream.encoder && html`<div class="hint">In use: ${s.stream.encoder}</div>`}</div>
    <${UpdateSettings} s=${s} save=${save} />
    <div class="field"><label class="label">Studio</label>
      ${s.studioSupported
        ? html`<label class="switch"><input type="checkbox" checked=${s.config.studioEnabled !== false} onChange=${(e) => save({ studioEnabled: e.target.checked })} /><span>Scenes and transitions on the stream page</span></label>
          <div class="hint">Scenes, Preview → Program, fades and cameras 3 and 4. Uses a little more computer power (about a tenth of one processor core); on a computer that struggles, turn it off for the simple camera and slides switching. The camera preview or stream restarts.</div>`
        : html`<div class="note">This FFmpeg can’t do scenes and transitions (it has no “zmq” filter), so the stream uses the simple camera and slides switching.</div>`}</div>
    <div class="field"><label class="label">Recent log <button class="btn small ghost" onClick=${load}>Refresh</button> <button class="btn small ghost" onClick=${() => navigator.clipboard.writeText(logs.join('\n')).then(() => toast('Log copied — paste it in a message'), () => fail(new Error('Could not copy; select the text instead.')))}>Copy</button></label><div class="logbox">${logs.length ? logs.join('\n') : 'Nothing yet.'}</div></div>
  </div>`;
}

// Phones & tablets: which address to type (or scan) on other devices on the church Wi-Fi.
function QrCode({ text, size = 168 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let off = false;
    import('/vendor/qrcode.js').then(({ default: qrcode }) => {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      if (!off) setSvg(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    }).catch(() => {});
    return () => { off = true; };
  }, [text]);
  return html`<div class="qr" style=${`width:${size}px;height:${size}px`} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

function SectionDevices({ s }) {
  const [info, setInfo] = useState(null);
  const load = () => get('/api/state').then((d) => setInfo(d.lanInfo || [])).catch(fail);
  useEffect(() => { load(); }, []);
  const [pick, setPick] = useState(0);
  const list = info || [];
  const best = list[pick] || list[0];
  const copy = (t) => (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('Copied')) : Promise.reject(new Error('Copy is not available here'))).catch(fail);
  const pages = best ? [
    ['Phone remote', best.url + '/remote', 'Big Next and Back buttons and the order of service — turns any phone into the clicker.'],
    ['Control panel', best.url + '/control', 'Run the service from a phone or tablet (same as this screen).'],
    ['Stream page', best.url + '/stream', 'For a second person on another laptop: go live, cameras, names, ticker and recording, with the live picture.'],
    ['Stage screen', best.url + '/stage', 'For musicians and the speaker: current and next slide, and a clock.'],
    ['Projector', best.url + '/display', 'Only if the projector is connected to a different computer.'],
  ] : [];
  return html`<div>
    <p class="lead" style="margin-top:0">Phones, tablets and other computers on the <b>same Wi-Fi or network</b> as this computer can open ChurchStream in their web browser. Nothing needs installing.</p>
    ${!info ? html`<div class="muted">Looking up this computer’s address…</div>`
      : !list.length ? html`<div class="note">This computer isn’t connected to a network right now. Connect it to the church Wi-Fi (or a cable), then press <b>Check again</b>.</div>`
      : html`
      <div class="field"><label class="label">This computer’s address</label>
        <div class="row wrap" style="align-items:center;gap:12px">
          <span class="lan-addr">${best.url.replace('http://', '')}</span>
          <button class="btn small" onClick=${() => copy(best.url)}>Copy</button>
          <button class="btn small ghost" onClick=${load}>Check again</button>
        </div>
        ${list.length > 1 && html`<div class="hint">This computer has ${list.length} network connections. If the address above doesn’t work, try:
          ${list.map((x, i) => i !== pick && html` <button class="btn small ghost" onClick=${() => setPick(i)}>${x.ip} <span class="muted">(${x.name})</span></button>`)}</div>`}
      </div>
      <div class="lan-pages">${pages.map(([name, url, hint]) => html`<div class="lan-page" key=${name}>
        <${QrCode} text=${url} />
        <div class="grow"><b>${name}</b><div class="lan-url">${url}</div><div class="hint">${hint}</div>
          <button class="btn small" style="margin-top:6px" onClick=${() => copy(url)}>Copy link</button></div>
      </div>`)}</div>
      <div class="note" style="margin-top:16px">
        <b>How to connect:</b> scan a code with the phone’s camera, or type the address into its browser (Chrome, Safari, Edge). The phone must be on the <b>same Wi-Fi</b> as this computer, not on mobile data.
        <ul style="margin:8px 0 0;padding-left:20px;line-height:1.6">
          <li>${s.platform === 'darwin'
            ? html`Not loading? If the Mac asked whether ChurchStream may accept incoming network connections, choose <b>Allow</b> (System Settings → Network → Firewall → Options).`
            : html`Not loading? Windows may be blocking it: the first time ChurchStream started, Windows asked to allow it on networks. Choose <b>Allow</b> (or set the church Wi-Fi to a <b>Private</b> network in Windows settings).`}</li>
          <li>The address can change when the computer reconnects. To keep it the same every week, ask whoever manages the router to give this computer a fixed address (a “DHCP reservation”).</li>
          <li>${s.config.controlPassword ? 'The control panel asks for the password set in General. The stage screen and projector never do.' : 'Anyone on this Wi-Fi can open the control panel. If visitors use the same Wi-Fi, set a password in General.'}</li>
        </ul>
      </div>`}
  </div>`;
}

const SECTIONS = [
  ['general', 'General', SectionGeneral],
  ['devices', 'Phones & tablets', SectionDevices],
  ['camera', 'Camera & sound', SectionCamera],
  ['projector', 'Projector', SectionProjector],
  ['streaming', 'YouTube & Facebook', SectionStreaming],
  ['songs', 'Hymnals & songs', SectionSongs],
  ['bible', 'Bible', SectionBible],
  ['appearance', 'Appearance', SectionAppearance],
  ['lowerthirds', 'Names (lower thirds)', SectionLowerThirds],
  ['advanced', 'Advanced', SectionAdvanced],
];

function SettingsView({ s, sections = SECTIONS, onBack = null, backLabel = 'Back to control panel' }) {
  const [sec, setSec] = useState((location.hash || '#' + sections[0][0]).slice(1));
  const cur = sections.find((x) => x[0] === sec) || sections[0];
  const C = cur[2];
  return html`<div class="settings-shell">
    <div class="settings-top"><button class="btn ghost" onClick=${onBack || (() => navigate('/control'))}>${icons.back()} ${backLabel}</button><span class="spacer"></span><${StreamStatus} s=${s} /></div>
    <div class="settings">
      <nav>${sections.map(([id, label]) => html`<button class=${id === cur[0] ? 'on' : ''} onClick=${() => { setSec(id); history.replaceState({}, '', '#' + id); }}>${label}</button>`)}
        <span class="spacer"></span><button onClick=${() => window.open('/manual', '_blank')}>User manual</button>${!onBack && html`<button onClick=${() => navigate('/setup')}>Run setup again</button>`}</nav>
      <div class="content"><div><h1>${cur[1]}</h1><div style="height:14px"></div><${C} s=${s} key=${cur[0]} /></div></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// first-run setup wizard
const STEPS = [
  { id: 'welcome', title: 'Welcome to ChurchStream', lead: "Let's get your church ready in a few minutes. You can change everything later in Settings.", C: SectionGeneral },
  { id: 'camera', title: 'Camera & sound', lead: 'Pick your camera and the sound source. You should see the picture and the sound meter move.', C: SectionCamera, wide: true },
  { id: 'projector', title: 'Projector', lead: 'Choose the display output that goes to your projector and screens.', C: SectionProjector },
  { id: 'streaming', title: 'YouTube & Facebook', lead: 'Paste the stream keys for where you want to go live. You can skip this and only use the projector.', C: SectionStreaming },
  { id: 'songs', title: 'Hymnals', lead: 'Download the hymnals your church sings from. Each one takes about a minute.', C: SectionSongs },
  { id: 'done', title: "You're all set", lead: '' },
];

function SetupView({ s }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const finish = async () => {
    await api('/api/config', { setupComplete: true }).catch(fail);
    if (s.stream.mode === 'preview') api('/api/stream/stop', {}).catch(() => {});
    navigate('/control');
  };
  const next = () => {
    if (step.id === 'camera' && s.stream.mode === 'preview') api('/api/stream/stop', {}).catch(() => {});
    setI(i + 1);
    scrollTo(0, 0);
  };
  return html`<div class="setup">
    <div class="setup-top"><div class="brand"><img src="/logo.svg" alt="" /><span>ChurchStream</span></div>
      <div class="steps">${STEPS.map((_, j) => html`<i class=${j <= i ? 'done' : ''}></i>`)}</div></div>
    <div class="setup-body" style=${step.wide ? 'width:min(980px,100%)' : ''}>
      <h1>${step.title}</h1>
      ${step.lead && html`<p class="lead">${step.lead}</p>`}
      ${step.C && html`<${step.C} s=${s} autoPreview=${true} key=${step.id} />`}
      ${step.id === 'done' && html`<div>
        <p class="lead">Here's how a typical Sabbath works:</p>
        <ol style="line-height:2;padding-left:20px;margin:0 0 8px">
          <li><b>Build the service:</b> type a hymn number, song name or verse, press <kbd>Shift</kbd>+<kbd>Enter</kbd>.</li>
          <li><b>During the service:</b> press <kbd>→</kbd>, <kbd>Space</kbd> or the big <b>Next</b> button (a presentation clicker works too).</li>
          <li><b>Go live</b> when you're ready. ChurchStream checks the camera and sound first.</li>
          <li><b>Black</b> (<kbd>B</kbd>) blanks the screens; <b>Clear</b> (<kbd>C</kbd>) hides the words.</li>
        </ol>
        ${s.lan && s.lan.length > 0 && html`<div class="note">To run it from a tablet, open <b>${s.lan[0]}/control</b> on the church Wi-Fi. (The address and QR codes are always in Settings → Phones & tablets.)</div>`}
      </div>`}
      <div class="setup-actions">
        ${i > 0 && html`<button class="btn big" onClick=${() => setI(i - 1)}>Back</button>`}
        <span class="spacer"></span>
        ${i < STEPS.length - 1
          ? html`${step.id !== 'welcome' && html`<button class="btn big ghost" onClick=${next}>Skip</button>`}<button class="btn big primary" onClick=${next}>Continue</button>`
          : html`<button class="btn big primary" onClick=${finish}>Open the control panel</button>`}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// The projector picture for the live stream. The control panel draws what the projector
// shows (background + words, black, logo) onto a canvas and sends it to ChurchStream, which
// mixes it into the stream for the "Slides" and "Slides + camera" views.
const imgCache = new Map();
const loadImg = (url) => {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; }));
  }
  return imgCache.get(url);
};

function programKey(s) {
  const live = s.live;
  const slide = live && live.item.slides[live.index];
  const t = s.config.theme || {};
  const cd = live && live.item.kind === 'countdown' ? countdownParts(live.item.countdown, Date.now() + (s.now - (s.receivedAt || s.now))) : null;
  return JSON.stringify([cd && [cd.time, cd.message], slide && slide.image, effectiveBg(slide, live && live.item, t), slide && slide.text, slide && slide.ref, live && live.item.kind, live && live.item.subtitle,
    s.black, s.clear, s.logo, t.logo, t.logoName, t.logoSize, s.config.churchName, t.textScale || 1, t.minText, themeClasses(t), slide && slide.part, s.config.quality]);
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + w : w;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

// Stream sizes (lib/stream.js QUALITY) and the JPEG quality of the picture sent to FFmpeg:
// high enough that lettering has no visible blocking before the stream is encoded.
const STREAM_SIZE = { low: [854, 480], good: [1280, 720], high: [1920, 1080] };
const PROGRAM_JPEG = 0.94;
async function renderProgram(s) {
  // Drawn at the stream's own size, so slide text stays sharp at 1080p (no upscaling).
  // The stream's size, or the recording's when that is larger (a 1080p recording of a 720p stream).
  const rec = s.config.record && { hd: 720, fullhd: 1080, best: 1080 }[s.config.recordQuality];
  const [W0, H0] = STREAM_SIZE[s.config.quality] || STREAM_SIZE.good;
  const [W, H] = rec && rec > H0 ? (rec === 1080 ? [1920, 1080] : [1280, 720]) : [W0, H0];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const live = s.live;
  const slide = live && live.item.slides[live.index];
  const t = s.config.theme || {};
  const FONT = (FONTS[t.font] || FONTS.inter).css;
  const WT = t.font === 'serif' ? 400 : t.font === 'arial' ? 700 : 600; // weight for slide words
  try { await document.fonts.load(`600 40px "Inter ChurchStream"`); } catch { /* fall back to system font */ }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (s.black) return new Promise((r) => c.toBlob(r, 'image/jpeg', PROGRAM_JPEG));

  const bg = bgInfo(effectiveBg(slide, live && live.item, t));
  const img = bg.url && await loadImg(bg.url);
  if (img) {
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) || 1;
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    if (bg.photo) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H); }
  } else {
    const g = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 1.15);
    g.addColorStop(0, '#1b2440'); g.addColorStop(0.55, '#0b0f1a'); g.addColorStop(1, '#05070c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const ink = bg.light ? '#1a1d23' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!bg.light) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = H * 0.012; ctx.shadowOffsetY = H * 0.0025; }

  if (s.logo) {
    // Same layout as the projector (shared.css .screen-logo): image, name, or image with the name under it.
    const lp = logoParts(t, s.config.churchName);
    // A video logo plays on the stream's own video layer (see App.syncLogoVideo); draw nothing here.
    const logo = lp.img && !lp.video && await loadImg(lp.img);
    if (logo && lp.size === 'full') {
      // Full screen: fill the picture (cover), like the projector.
      const k = Math.max(W / logo.naturalWidth, H / logo.naturalHeight);
      const sh = ctx.shadowColor; ctx.shadowColor = 'transparent';
      ctx.drawImage(logo, (W - logo.naturalWidth * k) / 2, (H - logo.naturalHeight * k) / 2, logo.naturalWidth * k, logo.naturalHeight * k);
      ctx.shadowColor = sh;
    } else {
    const box = { small: [0.34, 0.34, 0.30], medium: [0.5, 0.5, 0.42], large: [0.8, 0.7, 0.56] }[lp.size];
    const nameSize = H * (logo ? 0.055 : 0.07);
    let ih = 0;
    let iw = 0;
    if (logo) {
      const k = Math.min((W * box[0]) / logo.naturalWidth, (H * (lp.name ? box[2] : box[1])) / logo.naturalHeight);
      iw = logo.naturalWidth * k; ih = logo.naturalHeight * k;
    }
    const gap = logo && lp.name ? H * 0.03 : 0;
    const total = ih + gap + (lp.name ? nameSize * 1.2 : 0);
    let y = (H - total) / 2;
    if (logo) {
      const sh = ctx.shadowColor; ctx.shadowColor = 'transparent';
      ctx.drawImage(logo, (W - iw) / 2, y, iw, ih);
      ctx.shadowColor = sh;
      y += ih + gap;
    }
    if (lp.name) {
      ctx.fillStyle = ink;
      let size = nameSize;
      for (; size > H * 0.03; size -= H * 0.003) { ctx.font = `600 ${size}px ${FONT}`; if (ctx.measureText(lp.name).width <= W * 0.84) break; }
      ctx.fillText(lp.name, W / 2, y + nameSize * 0.6);
    }
    }
  } else if (slide && slide.image && !s.clear) {
    const pic = await loadImg(bgInfo(slide.image).url);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (pic) {
      const k = Math.min(W / pic.naturalWidth, H / pic.naturalHeight);
      ctx.drawImage(pic, (W - pic.naturalWidth * k) / 2, (H - pic.naturalHeight * k) / 2, pic.naturalWidth * k, pic.naturalHeight * k);
    }
  } else if (live && live.item.kind === 'media' && live.item.media && live.item.media.type === 'youtube' && !s.clear) {
    // YouTube plays in the room only; the stream shows what is playing.
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.8; ctx.font = `600 ${H * 0.04}px ${FONT}`;
    ctx.fillText('♪  Now playing', W / 2, H * 0.42);
    ctx.globalAlpha = 1;
    let size = H * 0.075;
    const title = live.item.title || '';
    for (; size > H * 0.035; size -= H * 0.004) { ctx.font = `600 ${size}px ${FONT}`; if (ctx.measureText(title).width <= W * 0.86) break; }
    ctx.fillText(title, W / 2, H * 0.53);
  } else if (live && live.item.kind === 'countdown') {
    const p = countdownParts(live.item.countdown, Date.now() + (s.now - (s.receivedAt || s.now)));
    ctx.fillStyle = ink;
    const ann = !s.clear && slide && slide.text ? slide.text : '';
    const cy = ann ? H * 0.36 : H * 0.48;
    if (p.done) {
      ctx.font = `600 ${H * 0.09}px ${FONT}`;
      ctx.fillText(p.message, W / 2, cy);
    } else {
      ctx.globalAlpha = 0.88; ctx.font = `600 ${H * 0.046}px ${FONT}`;
      ctx.fillText(p.message, W / 2, cy - H * 0.14);
      ctx.globalAlpha = 1; ctx.font = `600 ${H * 0.19}px ${FONT}`;
      ctx.fillText(p.time, W / 2, cy + H * 0.02);
    }
    if (ann) {
      let size = H * 0.05;
      let lines;
      for (; size > H * 0.03; size -= H * 0.003) {
        ctx.font = `600 ${size}px ${FONT}`;
        lines = wrapLines(ctx, ann, W * 0.84);
        if (lines.length * size * 1.28 <= H * 0.3) break;
      }
      const top = H * 0.62 + (H * 0.3 - lines.length * size * 1.28) / 2 + size * 0.64;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * size * 1.28));
    }
  } else if (slide && !s.clear) {
    // Same fitting rules and text options as the projector: keep song lines whole if still
    // readable, else wrap; optional left alignment, outline, and "words at the bottom".
    const bottom = t.position === 'bottom';
    const left = t.align === 'left';
    const box = bottom ? { x: W * 0.05, y: H * 0.58, w: W * 0.9, h: H * 0.34 } : { x: W * 0.06, y: H * 0.06, w: W * 0.88, h: H * 0.83 };
    if (bottom) {
      const g = ctx.createLinearGradient(0, H, 0, H * 0.54);
      g.addColorStop(0, bg.light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.72)'); g.addColorStop(1, bg.light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
      const sh = ctx.shadowColor; ctx.shadowColor = 'transparent'; ctx.fillStyle = g; ctx.fillRect(0, H * 0.54, W, H * 0.46); ctx.shadowColor = sh;
    }
    const part = slide.part && PARTS[slide.part] ? slide.part : '';
    const labelH = part ? 0.62 : 0; // the Leader / Congregation label, in lines of text
    const sz = textSizes(t); // same sizes as the screens (percent of height)
    const max = H * sz.max / 100;
    const min = H * sz.min / 100;
    const layout = (size, wrap) => {
      ctx.font = `${WT} ${size}px ${FONT}`;
      const lines = wrap ? wrapLines(ctx, slide.text, box.w) : String(slide.text).split('\n');
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      return { lines, fits: widest <= box.w && (lines.length + labelH) * size * 1.28 <= box.h };
    };
    const search = (wrap) => {
      let lo = min; let hi = max;
      if (layout(hi, wrap).fits) return hi;
      for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (layout(mid, wrap).fits) lo = mid; else hi = mid; }
      return lo;
    };
    // Same rule as the screens (shared.js fitText): wrap long lines when that keeps the words
    // noticeably bigger; otherwise keep each line whole.
    let wrap = true;
    let size = search(true);
    if (live.item.kind !== 'bible') {
      const whole = search(false);
      if (layout(whole, false).fits && whole * WRAP_GAIN >= size) { wrap = false; size = whole; }
    }
    const { lines } = layout(size, wrap);
    const lh = size * 1.28;
    const blockH = (lines.length + labelH) * lh;
    let top = (bottom ? box.y + box.h - blockH : box.y + (box.h - blockH) / 2) + lh / 2;
    const x = left ? box.x : W / 2;
    ctx.textAlign = left ? 'left' : 'center';
    if (part) {
      ctx.fillStyle = ink; ctx.globalAlpha = 0.75; ctx.font = `600 ${size * 0.5}px "Inter ChurchStream", "Segoe UI", sans-serif`;
      ctx.fillText(PARTS[part].toUpperCase().split('').join(String.fromCharCode(8202)), x, top - lh * 0.12);
      ctx.globalAlpha = 1; top += lh * labelH;
    }
    ctx.font = `${part === 'all' ? 800 : WT} ${size}px ${FONT}`;
    const color = part === 'people' || part === 'all' ? (bg.light ? '#8a4b00' : '#ffd98a') : ink;
    if (t.outline) {
      ctx.lineJoin = 'round'; ctx.lineWidth = H * 0.0028 * 2;
      ctx.strokeStyle = bg.light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
      lines.forEach((l, i) => ctx.strokeText(l, x, top + i * lh));
    }
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
    ctx.textAlign = 'center';
    ctx.shadowColor = 'transparent';
    if (slide.ref) {
      ctx.globalAlpha = 0.78; ctx.font = `600 ${H * 0.034}px ${FONT}`;
      ctx.fillText(slide.ref, W / 2, H - H * 0.036 - H * 0.017);
      ctx.globalAlpha = 1;
    } else if (live.item.kind === 'song' && live.item.subtitle) {
      ctx.globalAlpha = 0.5; ctx.textAlign = 'right'; ctx.font = `600 ${H * 0.026}px ${FONT}`;
      ctx.fillText(live.item.subtitle, W - W * 0.03, H - H * 0.036 - H * 0.013);
      ctx.globalAlpha = 1;
    }
  }
  return new Promise((r) => c.toBlob(r, 'image/jpeg', PROGRAM_JPEG));
}

let lastProgramKey = null;
let programTimer = null;
let programSeq = 0;
function updateProgram(s) {
  const key = programKey(s);
  if (key === lastProgramKey) return;
  clearTimeout(programTimer);
  programTimer = setTimeout(async () => {
    lastProgramKey = key;
    const seq = ++programSeq;
    try {
      const blob = await renderProgram(s);
      // A newer picture was started while this one was drawing (e.g. a slow photo background,
      // then Next): don't send the older one after it.
      if (seq !== programSeq) return;
      // `at` (the server's time of this state) lets the server ignore a late, older picture,
      // also one from another tablet or laptop.
      const q = new URLSearchParams({ key: key.length > 1500 ? String(key.length) + key.slice(0, 1500) : key, at: String(s.now || 0) });
      await fetch('/api/program-image?' + q, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    } catch { lastProgramKey = null; }
  }, 60);
}

// ---------------------------------------------------------------------------------------
// The stream page (/stream): for a second person, on another laptop, who runs the live stream
// while the main control panel runs the slides. Same settings and state as the control panel.
const STREAM_SECTIONS = [['camera', 'Camera & sound', SectionCamera], ['streaming', 'YouTube & Facebook', SectionStreaming], ['lowerthirds', 'Names (lower thirds)', SectionLowerThirds]];

// The finished stream picture, as viewers see it (MJPEG; reconnects after a restart).
function LiveFeed({ s }) {
  const st = s.stream;
  const [n, setN] = useState(0);
  const [ok, setOk] = useState(false);
  const run = st.mode !== 'off' ? `${st.mode}-${st.since || ''}` : '';
  useEffect(() => { setOk(false); }, [run]);
  if (!run) {
    return html`<div class="live-feed off"><div><b>The camera is off</b><span>Start the preview to see the stream picture, or go live.</span>
      <button class="btn" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Preview camera</button></div></div>`;
  }
  return html`<div class="live-feed">
    ${!ok && html`<span class="wait">Starting…</span>`}
    <img key=${run + n} src=${'/stream.mjpeg?r=' + encodeURIComponent(run) + '&n=' + n} alt="The live stream" onLoad=${() => setOk(true)}
      onError=${() => { setOk(false); setTimeout(() => setN((x) => x + 1), 1500); }} />
    ${st.mode === 'live' ? html`<span class="tag live">● LIVE</span>` : html`<span class="tag">Preview — not live</span>`}
  </div>`;
}

function StreamView({ s }) {
  const [tab, setTab] = useState(STREAM_SECTIONS.some(([id]) => '#' + id === location.hash) ? 'settings' : 'live');
  const [dialog, setDialog] = useState(null);
  const st = s.stream;
  const cfg = s.config;
  const configured = Object.values(cfg.outputs).some((o) => o.enabled && o.hasKey) || cfg.record;
  const dests = Object.entries(st.destinations || {});
  const slide = s.live && s.live.item.slides[s.live.index];
  useEffect(() => { document.title = 'Stream · ChurchStream'; }, []);
  // 1 / 2 switch cameras, as on the control panel.
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.key === '1' || e.key === '2') && hasCam2(s.config)) api('/api/camera', { camera: +e.key }).catch(fail);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [s.config]);
  if (tab === 'settings') {
    return html`<${SettingsView} s=${s} sections=${STREAM_SECTIONS} backLabel="Back to the stream" onBack=${() => { history.replaceState({}, '', '/stream'); setTab('live'); }} />`;
  }
  return html`<div class="shell stream-page">
    <div class="topbar">
      <div class="brand"><img src="/logo.svg" alt="" /><span>Stream${cfg.churchName ? ' · ' + cfg.churchName : ''}</span></div>
      <span class="spacer"></span>
      <${StreamStatus} s=${s} />
      <a class="btn icon round" href="/manual#the-stream-page-a-second-laptop" target="_blank" rel="noopener" title="User manual" aria-label="User manual">?</a>
      <button class="btn icon round" title="Stream settings" aria-label="Stream settings" onClick=${() => { history.replaceState({}, '', '/stream#camera'); setTab('settings'); }}>${icons.gear()}</button>
    </div>
    ${st.problem && html`<div class=${'banner' + (st.state === 'retrying' || st.state === 'error' ? ' red' : '')}>${icons.alert()}<span class="grow">${st.problem}${st.message && st.state === 'retrying' ? ' ' + st.message : ''}</span>
      ${st.mode !== 'off' && html`<button class="btn small" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop</button>`}</div>`}
    ${st.silent && html`<div class="banner red">${icons.alert()}<span class="grow"><b>No sound for 10 seconds.</b> Check that the microphone or sound desk is on and connected.</span></div>`}
    <div class="stream-grid">
      <div class="card stack stream-main">
        <${LiveFeed} s=${s} />
        <${Meter} />
        <div class="stream-dests">
          ${st.mode === 'live'
            ? html`${dests.map(([id, d]) => html`<span class="dest" key=${id}><span class=${'dot ' + d.state}></span>${d.label}</span>`)}${st.recording && html`<span class="dest"><span class="dot ok"></span>Recording</span>`}`
            : html`<span class="muted">${configured ? 'Not live. ' + [cfg.outputs.youtube.enabled && cfg.outputs.youtube.hasKey && 'YouTube', cfg.outputs.facebook.enabled && cfg.outputs.facebook.hasKey && 'Facebook', cfg.outputs.custom.enabled && cfg.outputs.custom.hasKey && 'Other', cfg.record && 'Recording'].filter(Boolean).join(' · ') : 'No stream keys yet — add them in the stream settings.'}</span>`}
          <span class="spacer"></span>
          ${st.mode === 'preview' && html`<button class="btn small ghost" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop preview</button>`}
        </div>
        <${StreamPhase} s=${s} />
        ${!configured
          ? html`<button class="btn big" onClick=${() => { history.replaceState({}, '', '/stream#streaming'); setTab('settings'); }}>Set up YouTube & Facebook</button>`
          : st.mode === 'live'
            ? html`<button class="btn big" onClick=${() => setDialog('stop')}>End live stream</button>`
            : html`<button class="btn big danger" onClick=${() => setDialog('golive')}>${icons.radio()} Go live</button>`}
      </div>
      <div class="stream-side">
        <div class="card stack">
          <${CameraSwitch} s=${s} />
          <${StreamScene} s=${s} />
          <${RecordingOptions} s=${s} compact=${true} />
        </div>
        <${NameOnStream} s=${s} />
        <${TickerCard} s=${s} />
        <div class="card mini">
          <div class="card-head"><b>On the screens now</b></div>
          <${Screen} slide=${slide} kind=${s.live && s.live.item.kind} subtitle=${s.live && s.live.item.subtitle} theme=${cfg.theme} bg=${effectiveBg(slide, s.live && s.live.item, cfg.theme)} churchName=${cfg.churchName} black=${s.black} clear=${s.clear} logo=${s.logo}
            countdown=${s.live && s.live.item.kind === 'countdown' ? s.live.item.countdown : null} skew=${s.now - (s.receivedAt || s.now)} />
          <${StreamOnScreens} s=${s} />
          <div class="hint">The slides are run from the main control panel.</div>
        </div>
      </div>
    </div>
    ${dialog === 'golive' && html`<${GoLiveDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog === 'stop' && html`<${StopDialog} s=${s} onClose=${() => setDialog(null)} />`}
  </div>`;
}

// ---------------------------------------------------------------------------------------
// The studio on the stream page (/stream): scenes, Preview → Program and transitions, like a
// vision mixer. The pictures come from the stream itself (lib/compositor.js): Program
// (/stream.mjpeg), Preview (the off-air scene) and the multiview (every source small).

// Studio info from the server (scenes incl. the built-in ones, sources, multiview layout).
function useStudioInfo(s) {
  const [info, setInfo] = useState(null);
  const key = JSON.stringify([s.config.scenes, CAMERA_KEYS.map((k) => s.config[k]), s.studioOn, !!s.stream.studioReady]);
  useEffect(() => { get('/api/studio').then(setInfo).catch(() => {}); }, [key]);
  return info;
}

// The multiview picture, shared by every small source picture on the page (one connection:
// browsers only allow a few at a time).
let mvImg = null;
function multiviewImage() {
  if (mvImg) return mvImg;
  mvImg = new Image();
  mvImg.alt = '';
  mvImg.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  const load = () => { mvImg.src = '/studio/multiview.mjpeg?t=' + Date.now(); };
  mvImg.onerror = () => setTimeout(load, 2000);
  document.body.appendChild(mvImg);
  load();
  return mvImg;
}

// One source's live picture, cut from the multiview.
function SourcePicture({ info, source }) {
  const ref = useRef();
  useEffect(() => {
    const img = multiviewImage();
    const i = info ? info.tiles.indexOf(source) : -1;
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      const cols = Math.min(4, info ? info.tiles.length : 1) || 1;
      const rows = Math.ceil((info ? info.tiles.length : 1) / 4) || 1;
      if (i < 0 || !img.naturalWidth) { ctx.fillStyle = source === 'black' ? '#000' : '#1e293b'; ctx.fillRect(0, 0, c.width, c.height); return; }
      const tw = img.naturalWidth / cols;
      const th = img.naturalHeight / rows;
      try { ctx.drawImage(img, (i % cols) * tw, Math.floor(i / cols) * th, tw, th, 0, 0, c.width, c.height); } catch { /* not loaded yet */ }
    };
    draw();
    const t = setInterval(draw, 200);
    return () => clearInterval(t);
  }, [info, source]);
  return html`<canvas ref=${ref} width="320" height="180" class="src-pic" aria-hidden="true"></canvas>`;
}

// A live MJPEG picture that reconnects after a restart.
function Monitor({ src, run, kind, label, name }) {
  const [n, setN] = useState(0);
  return html`<div class="monitor-col">
    <div class="monitor-head"><span class=${'tally-tag ' + kind}>${label}</span><span class="monitor-name">${name || ''}</span></div>
    <div class=${'monitor ' + kind}>
      ${run ? html`<img key=${run + n} src=${src + '?r=' + encodeURIComponent(run) + '&n=' + n} alt=${label} onError=${() => setTimeout(() => setN((x) => x + 1), 1500)} />`
        : html`<span class="monitor-off">Camera off</span>`}
    </div>
  </div>`;
}

const SOURCE_COLORS = { cam1: '#475569', cam2: '#64748b', cam3: '#56657a', cam4: '#334155', slides: '#1d3a8a', media: '#7c2d12', black: '#000' };
// The layers of a scene id, also for the control panel's own scenes (pip2 = slides + camera 2).
function sceneLayers(info, id) {
  const sc = info && info.scenes.find((x) => x.id === id);
  if (sc) return sc.layers;
  if (/^(cam\d|slides|media)$/.test(id || '')) return [{ source: id, x: 0, y: 0, w: 1, h: 1 }];
  const m = /^pip(\d)$/.exec(id || '');
  if (m) return [{ source: 'slides', x: 0, y: 0, w: 1, h: 1 }, { source: 'cam' + m[1], x: 0.671, y: 0.652, w: 0.3, h: 0.3 }];
  return [];
}
function sceneName(info, id) {
  const sc = info && info.scenes.find((x) => x.id === id);
  if (sc) return sc.name;
  const src = info && info.sources.find((x) => x.id === id);
  if (src) return src.name;
  if (/^pip\d$/.test(id || '')) return 'Slides + camera';
  return id || '';
}

function SceneThumb({ layers }) {
  return html`<span class="scene-thumb">${layers.map((l) => html`<span style=${`left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;height:${l.h * 100}%;background:${SOURCE_COLORS[l.source] || '#475569'}${l.border ? ';outline:1px solid #fff' : ''}`}></span>`)}</span>`;
}

const TRANSITIONS = [['cut', 'Cut'], ['fade', 'Fade'], ['dip', 'Dip'], ['slide', 'Slide'], ['wipe', 'Wipe']];

function TransitionControls({ s }) {
  const tr = (s.config.studio && s.config.studio.transition) || { type: 'fade', ms: 600 };
  const busy = !!(s.stream.studio && s.stream.studio.transition);
  const [bar, setBar] = useState(0);
  const pending = useRef(null);
  const timer = useRef(null);
  // The T-bar: sent at most every 40 ms, always ending with the last position.
  const sendBar = (v) => {
    pending.current = v;
    if (timer.current) return;
    const flush = () => {
      timer.current = null;
      if (pending.current === null) return;
      const pos = pending.current;
      pending.current = null;
      api('/api/studio/tbar', { pos }).catch(fail);
      timer.current = setTimeout(flush, 40);
    };
    flush();
  };
  useEffect(() => { if (!busy && bar >= 1) setBar(0); }, [busy]);
  const setTr = (patch) => api('/api/config', { studio: { transition: patch } }).catch(fail);
  return html`<div class="tr-controls">
    <button class="btn tr-cut" onClick=${() => api('/api/studio/take', { type: 'cut' }).catch(fail)} disabled=${busy} title="Cut (Space)">Cut</button>
    <button class="btn primary tr-auto" onClick=${() => api('/api/studio/take', {}).catch(fail)} disabled=${busy} title="Auto transition (Enter)">Auto</button>
    <label class="tr-label">T-bar
      <input type="range" min="0" max="100" value=${Math.round(bar * 100)} aria-label="T-bar"
        onInput=${(e) => { const v = +e.target.value / 100; setBar(v); sendBar(v); }} /></label>
    <div class="tr-types" role="radiogroup" aria-label="Transition">
      ${TRANSITIONS.map(([id, label]) => html`<button role="radio" aria-checked=${tr.type === id} class=${tr.type === id ? 'on' : ''} onClick=${() => setTr({ type: id })}>${label}</button>`)}
    </div>
    <label class="tr-label">Length
      <select class="select" value=${tr.ms} onChange=${(e) => setTr({ ms: +e.target.value })}>
        ${[300, 600, 1000, 1500, 2000].map((ms) => html`<option value=${ms}>${ms / 1000} s</option>`)}
      </select></label>
  </div>`;
}

function StudioView({ s }) {
  const [tab, setTab] = useState(STREAM_SECTIONS.some(([id]) => '#' + id === location.hash) ? 'settings' : 'live');
  const [dialog, setDialog] = useState(null);
  const [group, setGroup] = useState('All');
  const info = useStudioInfo(s);
  const st = s.stream;
  const cfg = s.config;
  const studio = st.studio || {};
  const quick = !cfg.studio || cfg.studio.mode !== 'studio';
  const configured = Object.values(cfg.outputs).some((o) => o.enabled && o.hasKey) || cfg.record;
  const dests = Object.entries(st.destinations || {});
  const slide = s.live && s.live.item.slides[s.live.index];
  const run = st.mode !== 'off' ? `${st.mode}-${st.since || ''}` : '';
  useEffect(() => { document.title = 'Stream · ChurchStream'; }, []);
  // Keyboard shortcuts (also for a Stream Deck: give each button a Hotkey action with these keys).
  const keys = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      if (!k || k.dialog || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      const st2 = k.s;
      const act = () => { e.preventDefault(); };
      if (/^[1-9]$/.test(e.key)) { const sc = k.scenes[+e.key - 1]; if (sc) { act(); k.pick(sc.id); } return; }
      if (/^F[1-4]$/.test(e.key)) { const id = 'cam' + e.key.slice(1); if (k.info && k.info.tiles.includes(id)) { act(); k.pick(id); } return; }
      switch (e.key) {
        case ' ': act(); api('/api/studio/take', { type: 'cut' }).catch(fail); break;
        case 'Enter': act(); api('/api/studio/take', {}).catch(fail); break;
        case 'd': case 'D': act(); api('/api/studio/take', { type: 'dip' }).catch(fail); break;
        case 'n': case 'N': act(); api('/api/lower-third', { visible: !st2.lowerThird.visible }).catch(fail); break;
        case 't': case 'T': act(); api('/api/ticker', { text: st2.ticker.text, visible: !st2.ticker.visible }).catch(fail); break;
        case 'g': case 'G': {
          act();
          const g1 = (st2.gfx && st2.gfx[1]) || {};
          if (g1.on) { api('/api/studio/gfx/show', { n: 1, on: false }).catch(fail); break; }
          const list = st2.config.graphics || [];
          const g = list.find((x) => x.id === g1.label) || list[0];
          if (g && k.info) loadImage('/media/' + encodeURIComponent(g.file)).then((img) => sendGraphic(k.info, 1, g.id, (ctx, W, H) => drawPicture(ctx, W, H, img, g.position || 'tr'))).catch(fail);
          else toast('Add a picture first (Pictures, on the right)');
          break;
        }
        case 'r': case 'R': act(); api('/api/config', { record: !st2.config.record }).then(() => toast(st2.config.record ? 'Recording off' : st2.stream.mode === 'live' ? 'Recording on — it starts the next time you go live' : 'Recording on')).catch(fail); break;
        case '?': act(); setDialog({ type: 'keys' }); break;
        default:
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  if (tab === 'settings') {
    keys.current = null;
    return html`<${SettingsView} s=${s} sections=${STREAM_SECTIONS} backLabel="Back to the stream" onBack=${() => { history.replaceState({}, '', '/stream'); setTab('live'); }} />`;
  }
  const scenes = info ? info.scenes : [];
  const groups = ['All', ...new Set(scenes.map((x) => x.group).filter(Boolean))];
  const shown = scenes.filter((x) => group === 'All' || x.group === group);
  const onAirSources = new Set(sceneLayers(info, studio.onAir).map((l) => l.source));
  const previewSources = new Set(sceneLayers(info, studio.preview).map((l) => l.source));
  // Click a scene: on air at once (Quick) or into Preview (Studio).
  const pick = (id) => api(quick ? '/api/studio/show' : '/api/studio/preview', { id }).catch(fail);
  const openSettings = (sec) => { history.replaceState({}, '', '/stream#' + sec); setTab('settings'); };
  keys.current = { s, info, quick, scenes, pick, dialog };
  return html`<div class="shell studio-page">
    <div class="topbar">
      <div class="brand"><img src="/logo.svg" alt="" /><span>Stream${cfg.churchName ? ' · ' + cfg.churchName : ''}</span></div>
      <div class="seg mode-seg" role="radiogroup" aria-label="How scenes go on air">
        ${[['quick', 'Quick'], ['studio', 'Studio']].map(([id, label]) => html`<button role="radio" aria-checked=${(quick ? 'quick' : 'studio') === id} class=${(quick ? 'quick' : 'studio') === id ? 'on' : ''}
          title=${id === 'quick' ? 'A scene goes on air as soon as you click it' : 'A scene goes to Preview first; then Cut or Auto'} onClick=${() => api('/api/config', { studio: { mode: id } }).catch(fail)}>${label}</button>`)}
      </div>
      <span class="spacer"></span>
      <${StreamStatus} s=${s} />
      <button class="btn small ghost" title="Keyboard shortcuts (?)" onClick=${() => setDialog({ type: 'keys' })}>Keys</button>
      <a class="btn icon round" href="/manual#the-studio-scenes-and-transitions" target="_blank" rel="noopener" title="User manual" aria-label="User manual">?</a>
      <button class="btn icon round" title="Stream settings" aria-label="Stream settings" onClick=${() => openSettings('camera')}>${icons.gear()}</button>
    </div>
    ${st.problem && html`<div class=${'banner' + (st.state === 'retrying' || st.state === 'error' ? ' red' : '')}>${icons.alert()}<span class="grow">${st.problem}${st.message && st.state === 'retrying' ? ' ' + st.message : ''}</span>
      ${st.mode !== 'off' && html`<button class="btn small" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop</button>`}</div>`}
    ${st.silent && html`<div class="banner red">${icons.alert()}<span class="grow"><b>No sound for 10 seconds.</b> Check that the microphone or sound desk is on and connected.</span></div>`}
    <div class="studio-grid">
      <main class="studio-main">
        <section class="card studio-monitors" aria-label="Preview and Program">
          <${Monitor} src="/studio/preview.mjpeg" run=${run} kind="preview" label="PREVIEW" name=${sceneName(info, studio.preview)} />
          <${TransitionControls} s=${s} />
          <${Monitor} src="/stream.mjpeg" run=${run} kind="program" label=${st.mode === 'live' ? 'PROGRAM · LIVE' : 'PROGRAM'} name=${sceneName(info, studio.onAir)} />
          ${st.mode === 'off' && html`<div class="studio-off"><span>The camera is off.</span><button class="btn" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Preview camera</button></div>`}
        </section>

        <section class="card" aria-label="Sources">
          <div class="studio-head"><b>Sources</b><span class="muted">Click one to put it ${quick ? 'on air' : 'in Preview'}</span></div>
          <div class="src-grid">
            ${info && info.tiles.concat('black').map((id) => {
              const tally = onAirSources.has(id) ? 'live' : previewSources.has(id) ? 'preview' : '';
              return html`<button class=${'src-tile ' + tally} onClick=${() => pick(id)} title=${sceneName(info, id)}>
                <${SourcePicture} info=${info} source=${id} />
                <span class="src-name">${sceneName(info, id)}</span>
                ${tally && html`<span class=${'src-tally ' + tally}>${tally === 'live' ? 'LIVE' : 'PREVIEW'}</span>`}
              </button>`;
            })}
          </div>
        </section>

        <section class="card" aria-label="Scenes">
          <div class="studio-head">
            <b>Scenes</b>
            <div class="chips">${groups.map((g) => html`<button class=${'chip' + (g === group ? ' on' : '')} onClick=${() => setGroup(g)}>${g}</button>`)}</div>
            <span class="spacer"></span>
            <button class="btn small ghost" onClick=${() => setDialog({ type: 'scene', scene: { id: 's' + Date.now().toString(36), name: 'New scene', group: group === 'All' ? '' : group, layers: [{ source: 'cam1', x: 0, y: 0, w: 1, h: 1 }] }, isNew: true })}>+ New scene</button>
          </div>
          <div class="scene-grid">
            ${shown.map((sc) => {
              const tally = sc.id === studio.onAir ? 'live' : sc.id === studio.preview ? 'preview' : '';
              const n = scenes.indexOf(sc) + 1;
              return html`<div class=${'scene-card ' + tally}>
                <button class="scene-pick" onClick=${() => pick(sc.id)} title=${n <= 9 ? `Key ${n}` : ''}>
                  <${SceneThumb} layers=${sc.layers} />
                  <span class="scene-label">${n <= 9 && html`<kbd>${n}</kbd>`}<span>${sc.name}</span></span>
                </button>
                <button class="scene-edit" aria-label=${'Edit ' + sc.name} title="Edit" onClick=${() => setDialog({ type: 'scene', scene: JSON.parse(JSON.stringify(sc)) })}>✎</button>
              </div>`;
            })}
          </div>
        </section>
      </main>

      <aside class="studio-side">
        <div class="card stack">
          <div class="stream-dests">
            ${st.mode === 'live'
              ? html`${dests.map(([id, d]) => html`<span class="dest" key=${id}><span class=${'dot ' + d.state}></span>${d.label}</span>`)}${st.recording && html`<span class="dest"><span class="dot ok"></span>Recording</span>`}`
              : html`<span class="muted">${configured ? 'Not live yet.' : 'No stream keys yet.'}</span>`}
          </div>
          <${StreamPhase} s=${s} />
          ${!configured
            ? html`<button class="btn big" onClick=${() => openSettings('streaming')}>Set up YouTube & Facebook</button>`
            : st.mode === 'live'
              ? html`<button class="btn big" onClick=${() => setDialog({ type: 'stop' })}>End live stream</button>`
              : html`<button class="btn big danger" onClick=${() => setDialog({ type: 'golive' })}>${icons.radio()} Go live</button>`}
          <${RecordingOptions} s=${s} compact=${true} />
        </div>
        <${AudioMixer} s=${s} />
        <${NameOnStream} s=${s} />
        <${TitlesCard} s=${s} info=${info} />
        <${GraphicsCard} s=${s} info=${info} />
        <${TickerCard} s=${s} />
        <div class="card mini">
          <div class="card-head"><b>On the screens now</b></div>
          <${Screen} slide=${slide} kind=${s.live && s.live.item.kind} subtitle=${s.live && s.live.item.subtitle} theme=${cfg.theme} bg=${effectiveBg(slide, s.live && s.live.item, cfg.theme)} churchName=${cfg.churchName} black=${s.black} clear=${s.clear} logo=${s.logo}
            countdown=${s.live && s.live.item.kind === 'countdown' ? s.live.item.countdown : null} skew=${s.now - (s.receivedAt || s.now)} />
          <${StreamOnScreens} s=${s} />
          <div class="hint">The slides are run from the main control panel.</div>
        </div>
      </aside>
    </div>
    ${dialog && dialog.type === 'golive' && html`<${GoLiveDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'stop' && html`<${StopDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'scene' && html`<${SceneEditor} info=${info} scene=${dialog.scene} isNew=${!!dialog.isNew} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'keys' && html`<${ShortcutsDialog} onClose=${() => setDialog(null)} />`}
  </div>`;
}


// --- the sound mixer (stream page) ------------------------------------------------------
const toDb = (g) => (g <= 0.001 ? '−∞' : (20 * Math.log10(g) >= 0 ? '+' : '') + (20 * Math.log10(g)).toFixed(0) + ' dB');
function MixerChannel({ id, name, mix, levelKey, master }) {
  const cur = mix[id] || { gain: 1, mute: false };
  const [gain, setGain] = useState(cur.gain);
  const bar = useRef();
  const timer = useRef(null);
  const pending = useRef(null);
  useEffect(() => { setGain(cur.gain); }, [cur.gain]);
  useEffect(() => {
    // Sources: RMS level of the source; the whole mix: its loudness (LUFS).
    const show = (db) => { if (bar.current) { const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)); bar.current.style.height = pct + '%'; bar.current.className = 'mix-level' + (db > -6 ? ' hot' : db > -18 ? ' warm' : ''); } };
    const onL = (e) => { if (!master && levelKey) show(e.detail[levelKey] ?? -120); };
    const onM = (e) => { if (master) show(e.detail); };
    levelsBus.addEventListener('l', onL);
    meterBus.addEventListener('m', onM);
    return () => { levelsBus.removeEventListener('l', onL); meterBus.removeEventListener('m', onM); };
  }, [levelKey, master]);
  const send = (g) => {
    pending.current = g;
    if (timer.current) return;
    const flush = () => {
      timer.current = null;
      if (pending.current === null) return;
      const v = pending.current;
      pending.current = null;
      api('/api/studio/audio', { id, gain: v }).catch(fail);
      timer.current = setTimeout(flush, 80);
    };
    flush();
  };
  return html`<div class=${'mix-ch' + (cur.mute ? ' muted' : '') + (master ? ' master' : '')}>
    <div class="mix-strip">
      <div class="mix-meter"><i ref=${bar} class="mix-level"></i></div>
      <input class="vfader" type="range" min="0" max="200" step="1" value=${Math.round(gain * 100)} aria-label=${name + ' volume'}
        onInput=${(e) => { const g = +e.target.value / 100; setGain(g); send(g); }} onDblClick=${() => { setGain(1); send(1); }} title="Double-click: back to normal" />
    </div>
    <span class="mix-db">${toDb(gain)}</span>
    <button class=${'mix-mute' + (cur.mute ? ' on' : '')} aria-pressed=${!!cur.mute} onClick=${() => api('/api/studio/audio', { id, mute: !cur.mute }).catch(fail)} title=${cur.mute ? 'Turn back on' : 'Mute'}>M</button>
    <span class="mix-name">${name}</span>
  </div>`;
}

function AudioMixer({ s }) {
  const cfg = s.config;
  const mix = cfg.audioMix || {};
  const a = cfg.audio || {};
  const micName = a.source === 'camera' ? 'Camera sound' : a.source === 'none' ? 'No microphone' : 'Microphone / desk';
  const chans = [['mic', micName], ['media', 'Videos & music'], ...(cfg.audio2 && cfg.audio2.device ? [['mic2', 'Second mic']] : [])];
  return html`<div class="card mixer" aria-label="Sound mixer">
    <div class="card-head"><b>Sound</b><span class="note-r muted" style="font-size:12px">Double-click a fader for normal</span></div>
    <div class="mix-row">
      ${chans.map(([id, name]) => html`<${MixerChannel} key=${id} id=${id} name=${name} mix=${mix} levelKey=${id} />`)}
      <${MixerChannel} id="master" name="Stream" mix=${mix} master=${true} />
    </div>
    ${s.stream.mode === 'off' && html`<div class="hint">The meters move when the camera preview or the stream is running.</div>`}
  </div>`;
}

// --- graphics and titles (stream page) -----------------------------------------------------
// The stream has two graphics channels on top of every scene: 1 for a picture (a logo in the
// corner, a QR code, a flyer), 2 for a title. Both are drawn here, at the stream's size, as a
// transparent PNG, and sent to ChurchStream; FFmpeg lays them over the picture.
const GFX_POSITIONS = [['tr', 'Top right'], ['tl', 'Top left'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['lower', 'Lower middle'], ['full', 'Full screen']];
const TITLE_TEMPLATES = [
  ['scripture', 'Scripture', 'Reading, e.g. Psalm 46:1', 'Words (optional)'],
  ['sermon', 'Sermon title', 'Title', 'Speaker (optional)'],
  ['speaker', 'Speaker', 'Name', 'Role, e.g. Guest speaker'],
  ['welcome', 'Welcome', 'Headline, e.g. Welcome!', 'Second line (optional)'],
];
const TITLE_STYLES = [['classic', 'Classic'], ['bar', 'Modern bar'], ['minimal', 'Minimal']];

const loadImage = (src) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Could not load the picture')); im.src = src; });

function drawPicture(ctx, W, H, img, position) {
  const ar = img.naturalWidth / img.naturalHeight;
  let w;
  let h;
  if (position === 'full') { const s = Math.min(W / img.naturalWidth, H / img.naturalHeight); w = img.naturalWidth * s; h = img.naturalHeight * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); return; }
  if (position === 'lower') { w = Math.min(W * 0.6, H * 0.25 * ar); h = w / ar; ctx.drawImage(img, (W - w) / 2, H * 0.94 - h, w, h); return; }
  // A corner: about a fifth of the width, never taller than a quarter of the height.
  w = Math.min(W * 0.18, H * 0.25 * ar); h = w / ar;
  const m = H * 0.045;
  const x = position.endsWith('l') ? m : W - m - w;
  const y = position.startsWith('t') ? m : H - m - h;
  ctx.drawImage(img, x, y, w, h);
}

// One line of text, shortened with … when too wide.
function fitLine(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function drawTitle(ctx, W, H, style, a, b) {
  const font = (wt, px) => `${wt} ${Math.round(px)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  if (style === 'bar') {
    const bh = b ? H * 0.15 : H * 0.1;
    const y = H * 0.955 - bh;
    ctx.fillStyle = 'rgba(14,122,109,0.94)';
    ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = '#fff';
    ctx.font = font(800, H * 0.048);
    ctx.fillText(fitLine(ctx, a, W * 0.9), W * 0.05, y + (b ? bh * 0.33 : bh / 2));
    if (b) { ctx.font = font(500, H * 0.032); ctx.fillText(fitLine(ctx, b, W * 0.9), W * 0.05, y + bh * 0.72); }
    return;
  }
  if (style === 'minimal') {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = H * 0.012;
    ctx.fillStyle = '#fff';
    const x = W * 0.06;
    const y = H * (b ? 0.78 : 0.84);
    ctx.font = font(700, H * 0.055);
    ctx.fillText(fitLine(ctx, a, W * 0.86), x, y);
    ctx.fillRect(x, y + H * 0.045, W * 0.06, Math.max(2, H * 0.005));
    if (b) { ctx.font = font(400, H * 0.034); ctx.fillText(fitLine(ctx, b, W * 0.86), x, y + H * 0.095); }
    ctx.shadowBlur = 0;
    return;
  }
  // Classic: like the names on the stream — white box, blue box underneath.
  const x = W * 0.055;
  const pad = H * 0.02;
  ctx.font = font(800, H * 0.05);
  const t1 = fitLine(ctx, a, W * 0.8);
  const w1 = ctx.measureText(t1).width + pad * 2;
  const h1 = H * 0.05 * 1.25 + pad;
  const y1 = H * (b ? 0.71 : 0.78);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillRect(x, y1, w1, h1);
  ctx.fillStyle = '#111827';
  ctx.fillText(t1, x + pad, y1 + h1 / 2);
  if (b) {
    ctx.font = font(500, H * 0.034);
    const t2 = fitLine(ctx, b, W * 0.8);
    const w2 = ctx.measureText(t2).width + pad * 1.6;
    const h2 = H * 0.034 * 1.3 + pad * 0.8;
    ctx.fillStyle = 'rgba(37,99,235,0.95)';
    ctx.fillRect(x, y1 + h1, w2, h2);
    ctx.fillStyle = '#fff';
    ctx.fillText(t2, x + pad * 0.8, y1 + h1 + h2 / 2);
  }
}

// Draw at the stream's size and send to channel n, then switch it on.
async function sendGraphic(info, n, label, draw) {
  const { width: W, height: H } = info.size;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  try { await document.fonts.load(`700 ${Math.round(H * 0.05)}px Inter`); } catch { /* system font */ }
  await draw(ctx, W, H);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const res = await fetch(`/api/studio/gfx?n=${n}&label=${encodeURIComponent(label)}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/png' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not send the graphic');
  await api('/api/studio/gfx/show', { n, on: true });
}

function GraphicsCard({ s, info }) {
  const list = s.config.graphics || [];
  const g1 = (s.gfx && s.gfx[1]) || {};
  const fileRef = useRef();
  const [busy, setBusy] = useState('');
  const upload = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy('upload');
    try {
      const res = await fetch(`/api/media?kind=graphic&name=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      toast('Picture added');
    } catch (err) { fail(err); }
    setBusy('');
  };
  const show = async (g) => {
    if (!info) return;
    setBusy(g.id);
    try {
      const img = await loadImage('/media/' + encodeURIComponent(g.file));
      await sendGraphic(info, 1, g.id, (ctx, W, H) => drawPicture(ctx, W, H, img, g.position || 'tr'));
    } catch (err) { fail(err); }
    setBusy('');
  };
  const isOn = (g) => g1.on && g1.label === g.id;
  return html`<div class="card gfx-card">
    <div class="card-head"><b>Pictures</b><span class="note-r"><button class="btn small" disabled=${busy === 'upload'} onClick=${() => fileRef.current.click()}>${busy === 'upload' ? 'Adding…' : 'Add picture…'}</button></span></div>
    <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${upload} />
    ${!list.length && html`<div class="hint" style="margin:0">A logo in the corner, a QR code for giving, or a flyer. PNG pictures can have a see-through background.</div>`}
    ${list.map((g) => html`<div class=${'gfx-row' + (isOn(g) ? ' on' : '')} key=${g.id}>
      <img class="gfx-thumb" src=${'/media/' + encodeURIComponent(g.file)} alt="" />
      <div class="gfx-info">
        <span class="gfx-name">${g.name}</span>
        <select class="select small" aria-label="Where" value=${g.position || 'tr'} onChange=${async (e) => { await api('/api/studio/graphic', { id: g.id, position: e.target.value }).catch(fail); if (isOn(g)) show({ ...g, position: e.target.value }); }}>
          ${GFX_POSITIONS.map(([id, label]) => html`<option value=${id}>${label}</option>`)}
        </select>
      </div>
      ${isOn(g)
        ? html`<button class="btn small on-air" onClick=${() => api('/api/studio/gfx/show', { n: 1, on: false }).catch(fail)}>On</button>`
        : html`<button class="btn small" disabled=${busy === g.id} onClick=${() => show(g)}>Off</button>`}
      <button class="btn small ghost" aria-label=${'Remove ' + g.name} title="Remove" onClick=${() => { if (confirm(`Remove “${g.name}”?`)) { if (isOn(g)) api('/api/studio/gfx/show', { n: 1, on: false }); api('/api/studio/graphic/delete', { id: g.id }).catch(fail); } }}>×</button>
    </div>`)}
  </div>`;
}

function TitlesCard({ s, info }) {
  const g2 = (s.gfx && s.gfx[2]) || {};
  const style = s.config.titleStyle || 'classic';
  const [tpl, setTpl] = useState('scripture');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const prev = useRef();
  const t = TITLE_TEMPLATES.find((x) => x[0] === tpl) || TITLE_TEMPLATES[0];
  const slide = s.live && s.live.item.slides[s.live.index];
  const reading = s.live && s.live.item.kind === 'bible' && slide;
  // A small preview of the title over a dark picture.
  useEffect(() => {
    const c = prev.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#273449';
    ctx.fillRect(0, 0, c.width, c.height);
    if (a.trim()) drawTitle(ctx, c.width, c.height, style, a.trim(), b.trim());
  }, [a, b, style]);
  const show = async () => {
    if (!info || !a.trim()) return;
    try { await sendGraphic(info, 2, a.trim(), (ctx, W, H) => drawTitle(ctx, W, H, style, a.trim(), b.trim())); } catch (err) { fail(err); }
  };
  return html`<div class="card gfx-card">
    <div class="card-head"><b>Titles</b>${g2.on && html`<span class="note-r"><span class="tally-tag program">ON AIR</span></span>`}</div>
    <div class="chips" style="margin-bottom:8px">${TITLE_TEMPLATES.map(([id, label]) => html`<button class=${'chip' + (tpl === id ? ' on' : '')} onClick=${() => setTpl(id)}>${label}</button>`)}</div>
    <input class="input" placeholder=${t[2]} value=${a} maxlength="80" onInput=${(e) => setA(e.target.value)} />
    <input class="input" style="margin-top:6px" placeholder=${t[3]} value=${b} maxlength="140" onInput=${(e) => setB(e.target.value)} />
    ${tpl === 'scripture' && reading && html`<button class="btn small ghost" style="margin-top:6px" onClick=${() => { setA(slide.ref || s.live.item.title || ''); setB(String(slide.text || '').replace(/\s+/g, ' ').slice(0, 140)); }}>Use the reading on screen</button>`}
    <div class="seg" role="radiogroup" aria-label="Title style" style="margin-top:8px;grid-template-columns:repeat(3,1fr)">
      ${TITLE_STYLES.map(([id, label]) => html`<button role="radio" aria-checked=${style === id} class=${style === id ? 'on' : ''} onClick=${() => api('/api/config', { titleStyle: id }).catch(fail)}>${label}</button>`)}
    </div>
    <canvas ref=${prev} class="title-preview" width="640" height="360" aria-label="How the title looks"></canvas>
    <div class="row" style="gap:8px">
      <button class="btn primary grow" disabled=${!a.trim() || !info} onClick=${show}>${g2.on ? 'Update title' : 'Show title'}</button>
      ${g2.on && html`<button class="btn on red" onClick=${() => api('/api/studio/gfx/show', { n: 2, on: false }).catch(fail)}>Take off</button>`}
    </div>
  </div>`;
}

// --- keyboard shortcuts (stream page) --------------------------------------------------
const STUDIO_KEYS = [
  ['1 – 9', 'Scene 1 to 9 (on air in Quick mode, into Preview in Studio mode)'], ['Space', 'Cut'], ['Enter', 'Auto transition'], ['D', 'Dip to black'],
  ['F1 – F4', 'Camera 1 to 4'], ['G', 'Picture on / off'], ['N', 'Name on / off'], ['T', 'Ticker on / off'], ['R', 'Recording on / off'], ['?', 'This list'],
];
function ShortcutsDialog({ onClose }) {
  return html`<${Modal} title="Keyboard shortcuts" onClose=${onClose} footer=${html`<button class="btn" onClick=${() => print()}>Print</button><button class="btn primary" onClick=${onClose}>Close</button>`}>
    <div class="keys-grid">${STUDIO_KEYS.map(([k, what]) => html`<div class="keys-row"><kbd>${k}</kbd><span>${what}</span></div>`)}</div>
    <div class="note" style="margin-top:14px">Have a Stream Deck? Give each button a <b>Hotkey</b> action with these keys while the stream page is in front.</div>
  </${Modal}>`;
}

// --- the scene editor ------------------------------------------------------------------
const L = (source, x, y, w, h, border) => ({ source, x, y, w, h, border: !!border });
const LAYOUTS = [
  ['Full', (src) => [L(src[0], 0, 0, 1, 1)]],
  ['Corner', (src) => [L(src[0], 0, 0, 1, 1), L(src[1], 0.671, 0.652, 0.3, 0.3, true)]],
  ['Top corner', (src) => [L(src[0], 0, 0, 1, 1), L(src[1], 0.66, 0.04, 0.3, 0.3, true)]],
  ['Side by side', (src) => [L(src[0], 0, 0.25, 0.5, 0.5), L(src[1], 0.5, 0.25, 0.5, 0.5)]],
  ['Three', (src) => [L(src[0], 0, 0.25, 0.5, 0.5), L(src[1], 0.5, 0, 0.5, 0.5), L(src[2], 0.5, 0.5, 0.5, 0.5)]],
  ['Four', (src) => [L(src[0], 0, 0, 0.5, 0.5), L(src[1], 0.5, 0, 0.5, 0.5), L(src[2], 0, 0.5, 0.5, 0.5), L(src[3], 0.5, 0.5, 0.5, 0.5)]],
];
const round3 = (v) => Math.round(v * 1000) / 1000;
// Snap to the edges and the middle when close.
const snap = (v) => { for (const t of [0, 0.25, 0.5, 0.75, 1]) if (Math.abs(v - t) < 0.015) return t; return v; };

function SceneEditor({ info, scene: start, isNew, onClose }) {
  const [sc, setSc] = useState(() => ({ ...start, layers: start.layers.map((l) => ({ crop: { l: 0, t: 0, r: 0, b: 0 }, ...l })) }));
  const [sel, setSel] = useState(sc.layers.length - 1);
  const [busy, setBusy] = useState(false);
  const area = useRef();
  const sources = info ? info.sources.filter((x) => x.id !== 'black') : [{ id: 'cam1', name: 'Camera 1' }];
  const setLayer = (i, patch) => setSc((cur) => ({ ...cur, layers: cur.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const applyLayout = (make) => {
    const used = sc.layers.map((l) => l.source);
    const pool = [...used, ...sources.map((x) => x.id).filter((id) => !used.includes(id))];
    setSc((cur) => ({ ...cur, layers: make(pool).map((l) => ({ ...l, crop: { l: 0, t: 0, r: 0, b: 0 } })) }));
    setSel(0);
  };
  // Drag to move; drag the corner to resize (keeping the 16:9 shape unless Shift is held).
  const drag = (e, i, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const box = area.current.getBoundingClientRect();
    const l0 = sc.layers[i];
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / box.width;
      const dy = (ev.clientY - y0) / box.height;
      if (mode === 'move') setLayer(i, { x: round3(snap(l0.x + dx)), y: round3(snap(l0.y + dy)) });
      else {
        const w = Math.max(0.05, Math.min(1, snap(l0.x + l0.w + dx) - l0.x));
        const h = ev.shiftKey ? Math.max(0.05, Math.min(1, snap(l0.y + l0.h + dy) - l0.y)) : w * (l0.h / l0.w);
        setLayer(i, { w: round3(w), h: round3(h) });
      }
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const save = async (thenPreview) => {
    setBusy(true);
    try {
      const r = await api('/api/studio/scene', { scene: sc });
      if (thenPreview) await api('/api/studio/preview', { id: r.scene.id });
      toast('Scene saved');
      onClose();
    } catch (err) { fail(err); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(start.builtin ? `Put “${sc.name}” back the way it was?` : `Delete the scene “${sc.name}”?`)) return;
    try { await api('/api/studio/scene/delete', { id: sc.id }); onClose(); } catch (err) { fail(err); }
  };
  const num = (v) => Math.round(v * 1000) / 10;
  const l = sc.layers[sel];
  return html`<${Modal} title=${isNew ? 'New scene' : 'Edit scene'} onClose=${onClose} wide=${true} footer=${html`
      ${!isNew && html`<button class="btn danger ghost" onClick=${remove}>${start.builtin ? 'Reset' : 'Delete scene'}</button>`}
      <span class="spacer"></span>
      <button class="btn" disabled=${busy} onClick=${() => save(true)}>Save and put in Preview</button>
      <button class="btn primary" disabled=${busy} onClick=${() => save(false)}>Save scene</button>`}>
    <div class="row wrap" style="gap:12px;margin-bottom:12px">
      <label class="tr-label">Name<input class="input" value=${sc.name} maxlength="60" onInput=${(e) => setSc({ ...sc, name: e.target.value })} /></label>
      <label class="tr-label">Group<input class="input" list="scene-groups" value=${sc.group || ''} placeholder="e.g. Sermon" maxlength="40" onInput=${(e) => setSc({ ...sc, group: e.target.value })} /></label>
      <datalist id="scene-groups">${[...new Set((info ? info.scenes : []).map((x) => x.group).filter(Boolean))].map((g) => html`<option value=${g} />`)}</datalist>
    </div>
    <div class="editor">
      <div>
        <div class="layouts">${LAYOUTS.map(([name, make]) => html`<button class="layout-btn" onClick=${() => applyLayout(make)}><${SceneThumb} layers=${make(['cam1', 'cam2', 'cam3', 'cam4'])} /><span>${name}</span></button>`)}</div>
        <div class="editor-area" ref=${area} onPointerDown=${() => setSel(-1)}>
          ${sc.layers.map((ly, i) => html`<div class=${'editor-layer' + (i === sel ? ' sel' : '') + (ly.border ? ' border' : '')} style=${`left:${ly.x * 100}%;top:${ly.y * 100}%;width:${ly.w * 100}%;height:${ly.h * 100}%;z-index:${i + 1}`}
              onPointerDown=${(e) => drag(e, i, 'move')}>
            <${SourcePicture} info=${info} source=${ly.source} />
            <span class="layer-tag">${i + 1} · ${sceneName(info, ly.source)}</span>
            ${i === sel && html`<span class="layer-handle" onPointerDown=${(e) => drag(e, i, 'size')} title="Drag to resize (Shift: any shape)"></span>`}
          </div>`)}
        </div>
        <div class="hint">Drag a layer to move it and its corner to resize it. It snaps to the edges and the middle.</div>
      </div>
      <div class="layer-list">
        <div class="seg-label">Layers (back to front)</div>
        ${sc.layers.map((ly, i) => html`<div class=${'layer-row' + (i === sel ? ' sel' : '')} onClick=${() => setSel(i)}>
          <span class="layer-n">${i + 1}</span>
          <select class="select" aria-label="Source" value=${ly.source} onChange=${(e) => setLayer(i, { source: e.target.value })}>
            ${sources.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
          </select>
          <button class="btn small ghost" aria-label="Remove layer" onClick=${(e) => { e.stopPropagation(); setSc({ ...sc, layers: sc.layers.filter((_, k) => k !== i) }); setSel(Math.max(0, i - 1)); }}>×</button>
        </div>`)}
        ${sc.layers.length < 4 && html`<button class="btn small" onClick=${() => { setSc({ ...sc, layers: [...sc.layers, { source: sources[Math.min(sc.layers.length, sources.length - 1)].id, x: 0.6, y: 0.06, w: 0.34, h: 0.34, border: true, crop: { l: 0, t: 0, r: 0, b: 0 } }] }); setSel(sc.layers.length); }}>+ Add layer</button>`}
        ${l && html`<div class="layer-props">
          <div class="seg-label">Layer ${sel + 1}</div>
          <div class="prop-grid">
            ${[['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']].map(([k, lab]) => html`<label class="tr-label">${lab} %<input class="input" type="number" step="1" value=${num(l[k])} onChange=${(e) => setLayer(sel, { [k]: round3((+e.target.value || 0) / 100) })} /></label>`)}
          </div>
          <label class="switch" style="min-height:34px"><input type="checkbox" checked=${!!l.border} onChange=${(e) => setLayer(sel, { border: e.target.checked })} /><span>White border</span></label>
          <div class="seg-label" style="margin-top:6px">Crop the picture</div>
          <div class="prop-grid">
            ${[['l', 'Left'], ['r', 'Right'], ['t', 'Top'], ['b', 'Bottom']].map(([k, lab]) => html`<label class="tr-label">${lab} %<input type="range" min="0" max="40" value=${Math.round((l.crop?.[k] || 0) * 100)} onInput=${(e) => setLayer(sel, { crop: { ...l.crop, [k]: +e.target.value / 100 } })} /></label>`)}
          </div>
        </div>`}
      </div>
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------------------
// Updates: ChurchStream looks for a newer version by itself (lib/updater.js) and this shows it
// on every page. Nothing is downloaded until someone clicks Update; it waits while live.
const fmtMB = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function NotesText({ text }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const plain = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\[(.+?)\]\([^)]*\)/g, '$1');
  return html`<div class="update-notes">${lines.map((l) => (/^#+\s/.test(l) ? html`<b>${plain(l.replace(/^#+\s*/, ''))}</b>` : html`<div>${/^[-*]\s/.test(l) ? '• ' : ''}${plain(l.replace(/^[-*]\s+/, ''))}</div>`))}</div>`;
}
function UpdateBanner({ s }) {
  const u = s.update;
  const a = u && u.available;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The first time a new version is seen, its "What's new" opens by itself.
  useEffect(() => {
    if (!a) return;
    let seen = '';
    try { seen = localStorage.getItem('cs-update-seen') || ''; } catch { /* private window */ }
    if (seen !== a.version) { setOpen(true); try { localStorage.setItem('cs-update-seen', a.version); } catch { /* fine */ } }
  }, [a && a.version]);
  if (!u || u.hidden) return null;
  const live = s.stream && s.stream.mode === 'live';
  const later = () => api('/api/update/later', {}).catch(fail);
  if (u.failed && !a) {
    return html`<div class="banner update">${icons.alert()}<span class="grow">The update to ChurchStream ${u.failed} could not start, so this computer stays on ${s.version}. Your settings are fine.</span><button class="btn small ghost" onClick=${later}>OK</button></div>`;
  }
  if (!a || (live && !u.progress)) return null; // during the service it waits until the stream ends
  const install = () => { setBusy(true); api('/api/update/install', {}).catch(fail).finally(() => setBusy(false)); };
  const restart = () => api('/api/update/restart', {}).then(() => toast('ChurchStream is restarting with the new version…')).catch(fail);
  let body;
  let buttons;
  if (u.ready === a.version) {
    body = html`<b>ChurchStream ${a.version} is ready.</b> Restart to use it (about 10 seconds), or it starts next time.`;
    buttons = html`<button class="btn small primary" disabled=${live} onClick=${restart}>Restart now</button><button class="btn small ghost" onClick=${later}>Later</button>`;
  } else if (u.progress) {
    const pct = u.progress.total ? Math.min(100, Math.round((u.progress.done / u.progress.total) * 100)) : 0;
    body = html`<b>Downloading ChurchStream ${a.version}…</b> ${pct}%<div class="update-bar"><i style=${{ width: pct + '%' }}></i></div>`;
    buttons = null;
  } else if (a.needs === 'full') {
    body = html`<b>ChurchStream ${a.version} is available.</b> This one needs the full download (the program itself changed).`;
    buttons = html`<a class="btn small primary" href=${a.fullUrl || a.notesUrl} target="_blank" rel="noopener">Download</a><button class="btn small ghost" onClick=${later}>Later</button>`;
  } else {
    body = html`<b>ChurchStream ${a.version} is available</b>${a.size ? ` (${fmtMB(a.size)})` : ''}. You have ${s.version}.`;
    buttons = html`<button class="btn small primary" disabled=${busy || !u.canInstall} onClick=${install}>Update</button><button class="btn small ghost" onClick=${later}>Later</button>`;
  }
  return html`<div class="banner update" role="status">
    <div class="grow">
      <div>${body}</div>
      ${a.notes && html`<button class="linkish" onClick=${() => setOpen(!open)}>${open ? 'Hide what’s new' : 'What’s new'}</button>`}
      ${open && a.notes && html`<${NotesText} text=${a.notes} />`}
      ${u.error && html`<div class="update-error">${u.error}</div>`}
    </div>
    <div class="update-buttons">${buttons}</div>
  </div>`;
}

function UpdateSettings({ s, save }) {
  const u = s.update || {};
  const [checking, setChecking] = useState(false);
  const check = () => { setChecking(true); api('/api/update/check', {}).then((r) => { if (!r.available && !r.error) toast(`ChurchStream ${s.version} is the newest version`); }).catch(fail).finally(() => setChecking(false)); };
  return html`<div class="field"><label class="label">Updates</label>
    <div class="note">This is ChurchStream ${s.version}.${u.available ? ` Version ${u.available.version} is available.` : ''}</div>
    <label class="switch" style="margin-top:8px"><input type="checkbox" checked=${s.config.checkUpdates !== false} onChange=${(e) => save({ checkUpdates: e.target.checked })} /><span>Check for updates by itself</span></label>
    <div class="hint">ChurchStream asks GitHub (github.com) every few hours whether there is a newer version and shows it on this page. Nothing is downloaded until you click Update, and never during a live stream. Most updates are only a few MB.</div>
    <button class="btn small" style="margin-top:8px" disabled=${checking || u.checking} onClick=${check}>${checking || u.checking ? 'Checking…' : 'Check now'}</button>
    ${u.error && html`<div class="hint">${u.error}</div>`}
  </div>`;
}

// ---------------------------------------------------------------------------------------
function Root() {
  const [s, setS] = useState(null);
  const [online, setOnline] = useState(true);
  const [route, setRoute] = useState(location.pathname);
  useEffect(() => {
    get('/api/state').then((st) => setS((cur) => cur ? { ...cur, lan: st.lan } : st)).catch(() => {});
    const stop = connect((st) => {
      setOnline(!!st);
      if (st) { SAB = st.sabbath; st.receivedAt = Date.now(); setS((cur) => ({ ...st, lan: cur ? cur.lan : st.lan })); updateProgram(st); }
    }, (m) => meterBus.dispatchEvent(new CustomEvent('m', { detail: m })), {
      page: location.pathname === '/stream' ? 'stream' : '',
      events: { levels: (v) => levelsBus.dispatchEvent(new CustomEvent('l', { detail: v })) },
    });
    const pop = () => setRoute(location.pathname);
    addEventListener('popstate', pop);
    return () => { stop(); removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = (s && s.config.uiTheme) || 'light'; }, [s && s.config.uiTheme]);
  // While a countdown is on screen, redraw the stream's projector picture every second.
  useEffect(() => {
    if (!s || !s.live || s.live.item.kind !== 'countdown') return undefined;
    const id = setInterval(() => updateProgram(s), 1000);
    return () => clearInterval(id);
  }, [s]);
  // ChurchStream came back as a newer version (after Update → Restart): load the new pages.
  const firstVersion = useRef(null);
  useEffect(() => {
    if (!s || !s.version) return;
    if (!firstVersion.current) firstVersion.current = s.version;
    else if (firstVersion.current !== s.version) location.reload();
  }, [s && s.version]);
  if (!s) return html`<div class="boot">ChurchStream</div>`;
  let view;
  if (route === '/setup') view = html`<${SetupView} s=${s} />`;
  else if (route === '/settings') view = html`<${SettingsView} s=${s} />`;
  else if (route === '/stream') view = s.studioOn ? html`<${StudioView} s=${s} />` : html`<${StreamView} s=${s} />`;
  else view = html`<${ControlView} s=${s} />`;
  return html`${!online && html`<div class="banner red fixed">Connection to ChurchStream lost — reconnecting…</div>`}${view}${route !== '/setup' && html`<${UpdateBanner} s=${s} />`}<${Toasts} />`;
}

render(html`<${Root} />`, document.getElementById('app'));

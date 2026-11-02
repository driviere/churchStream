import { h, html, render, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from '/vendor/preact-htm.js';
import { connect, fitText, slideHtml, bgInfo, effectiveBg, countdownParts, fillSabbath, logoParts } from '/shared.js';

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
const toast = (msg, kind = 'info') => toastBus.dispatchEvent(new CustomEvent('t', { detail: { msg, kind, id: Math.random() } }));
const fail = (err) => toast(err.message || String(err), 'error');
const meterBus = new EventTarget();

const navigate = (path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); };
const fmtTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60; return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`; };
const hymnLabel = (s) => (s.number ? `${s.hymnal === 'CH1941' ? 'Church Hymnal' : s.hymnal === 'SDAH' ? 'SDA Hymnal' : 'Hymn'} ${s.number}` : (s.author || ''));
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
  film: () => I(html`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>`),
};

// ---------------------------------------------------------------------------------------
// the projected screen, used for thumbnails and the mini projector view
function Screen({ slide, kind, subtitle, theme = {}, churchName = '', black, clear, logo, bg, lt, countdown, skew = 0 }) {
  const ref = useRef();
  const scale = theme.textScale || 1;
  const isCount = !!(countdown && !black && !logo);
  if (slide && slide.text && slide.text.includes('{')) slide = { ...slide, text: fillSabbath(slide.text, SAB) };
  if (countdown && /\{/.test((countdown.message || '') + (countdown.endText || ''))) countdown = { ...countdown, message: fillSabbath(countdown.message, SAB), endText: fillSabbath(countdown.endText, SAB) };
  const text = !black && !clear && !logo && slide && !isCount && !slide.image && kind !== 'media' ? slide : null;
  const ltOn = !!(lt && !black && !logo);
  useLayoutEffect(() => { if (ref.current) fitText(ref.current, { max: 8.5 * scale }); }, [text && text.text, scale, ltOn]);
  // Re-fit when the screen changes size (e.g. a hidden tab becomes visible).
  useEffect(() => {
    const el = ref.current && ref.current.closest('.screen');
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let w = 0;
    const ro = new ResizeObserver(([e]) => {
      const nw = Math.round(e.contentRect.width);
      if (nw && nw !== w) { w = nw; if (ref.current) fitText(ref.current, { max: 8.5 * scale }); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!text, scale]);
  const info = bgInfo(bg !== undefined ? bg : theme.background);
  return html`<div class=${'screen' + (info.light ? ' light-bg' : '') + (ltOn ? ' has-lt' : '')}>
    <div class=${'screen-bg' + (info.photo ? ' has-image' : '')} style=${info.url ? `background-image:url("${info.url}")` : ''}></div>
    ${text && html`<div class="screen-layer"><div ref=${ref} class=${'screen-text' + (kind === 'bible' ? ' bible' : '')} dangerouslySetInnerHTML=${{ __html: slideHtml(text) }}></div></div>`}
    ${text && text.ref && html`<div class="screen-ref">${text.ref}</div>`}
    ${text && kind === 'song' && subtitle && html`<div class="screen-tag">${subtitle}</div>`}
    ${!black && !logo && !clear && slide && slide.image && html`<div class="screen-img"><img src=${bgInfo(slide.image).url} alt="" loading="lazy" /></div>`}
    ${!black && !logo && kind === 'media' && html`<div class="screen-logo"><div class="name" style="font-size:6cqh">${slide ? '▶ ' + slide.label : ''}</div></div>`}
    ${isCount && html`<${CountdownFace} cd=${countdown} skew=${skew} ann=${!clear && slide ? slide.text : ''} />`}
    ${ltOn && html`<div class="screen-lt"><div class="n">${lt.name}</div><div class="t">${lt.title}</div></div>`}
    ${logo && (() => { const lp = logoParts(theme, churchName); return html`<div class=${lp.cls}>${lp.img && html`<img src=${lp.img} alt="" />`}${lp.name && html`<div class=${'name' + (lp.img ? ' under' : '')}>${lp.name}</div>`}</div>`; })()}
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
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3000);
    };
    toastBus.addEventListener('t', on);
    return () => toastBus.removeEventListener('t', on);
  }, []);
  return html`<div class="toasts">${list.map((t) => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}</div>`)}</div>`;
}

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
      <header><h2>${title}</h2><span class="spacer"></span><button class="btn ghost icon" onClick=${onClose} aria-label="Close">${icons.x()}</button></header>
      <div class="body">${children}</div>
      ${footer && html`<footer>${footer}</footer>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// status pill in the top bar
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
    <span class="dot"></span>Live · <span style="font-variant-numeric:tabular-nums">${fmtTime(Date.now() - (st.liveSince || Date.now()))}</span>
    <span class="sep extra">·</span><span class="extra">${health}</span>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// omnibox: songs, hymn numbers and Bible references in one search
function Omnibox({ onOpen, onShow, onAdd, onNewSong }) {
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

  useEffect(() => {
    if (!q.trim()) { setRes(null); return undefined; }
    const t = setTimeout(() => get('/api/search', { q }).then((r) => { setRes(r); setSel(0); }).catch(() => {}), 110);
    return () => clearTimeout(t);
  }, [q]);

  const rows = useMemo(() => {
    if (!res) return [];
    const r = [];
    if (res.bible) r.push({ type: 'bible', data: res.bible });
    for (const b of res.books) r.push({ type: 'book', data: b });
    for (const s of res.songs) r.push({ type: 'song', data: s });
    return r;
  }, [res]);

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
    else if (e.key === 'Enter') { e.preventDefault(); act(rows[sel], e.shiftKey ? 'add' : 'show'); }
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
          <div class="grow"><div class="t">${row.data.title}</div><div class="s">${[row.data.hymnal === 'CH1941' ? 'Church Hymnal' : row.data.hymnal === 'SDAH' ? 'SDA Hymnal' : '', row.data.firstLine].filter(Boolean).join(' · ')}</div></div>
          <div class="acts"><button class="btn small" onClick=${(e) => { e.stopPropagation(); act(row, 'add'); }}>Add</button><button class="btn small primary" onClick=${(e) => { e.stopPropagation(); act(row, 'show'); }}>Show</button></div>
        </div>`)}
      ${!rows.length && html`<div class="empty">Nothing found for “${q}”.<br/><button class="btn small" style="margin-top:10px" onClick=${() => { onNewSong(q); setOpen(false); }}>Create a song called “${q}”</button></div>`}
      <div class="foot"><kbd>Enter</kbd> show now · <kbd>Shift</kbd>+<kbd>Enter</kbd> add to service · click to preview</div>
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

function Plan({ s, selectedKey, onOpen, onNewText, onNewCountdown, onNewSlides, onNewMedia, onNewSunset, onTemplates }) {
  const items = s.plan.items;
  const live = s.live;
  const liveAt = live ? items.findIndex((x) => x.uid === live.item.key) : -1;
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const list = useRef();

  const save = (next) => api('/api/plan', { items: next }).catch(fail);
  const remove = (uid) => save(items.filter((x) => x.uid !== uid));

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
    if (e.button > 0 || e.target.closest('.x')) return;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let mode = 'press'; // press → drag | scroll
    let hold = null;
    const begin = () => { mode = 'drag'; dragging.current = true; setDrag(i); setOver(i); if (navigator.vibrate) navigator.vibrate(15); };
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
    <div class="plan-head"><b>Order of service</b><button class="btn small ghost" onClick=${onTemplates}>Templates</button><span>${items.length ? 'Next moves on by itself at the end of each item · drag (or press and hold) to reorder' : ''}</span></div>
    ${items.length === 0 && html`<div class="plan-empty">Search above, then press <kbd>Shift</kbd>+<kbd>Enter</kbd> (or “Add”) to build the order of service.</div>`}
    <ul class="plan" ref=${list}>
      ${items.map((it, i) => {
        const isLive = i === liveAt;
        const n = isLive ? live.item.slides.length : it.count || 0;
        return html`<li key=${it.uid} data-i=${i} onPointerDown=${(e) => start(e, i)}
          class=${[it.uid === selectedKey && 'sel', isLive && 'live', liveAt >= 0 && i < liveAt && 'done', drag === i && 'dragging', over === i && drag !== null && drag !== i && 'over'].filter(Boolean).join(' ')}>
          <span class=${'k ' + it.kind}>${kindLabel(it)}</span>
          <span class="t">${it.title}</span>
          ${n > 0 && html`<span class="dots">${Array.from({ length: Math.min(n, 12) }, (_, d) => html`<i class=${isLive ? (d === live.index ? 'now' : d < live.index ? 'past' : '') : ''}></i>`)}</span>`}
          <button class="x" title="Remove" aria-label=${'Remove ' + it.title} onClick=${(e) => { e.stopPropagation(); remove(it.uid); }}>${icons.x()}</button>
        </li>`;
      })}
      <li style="flex:0 0 auto;padding:0;border:0;background:none;min-height:0">
        <${AddMenu} items=${[
          ['Text or announcements', 'Words you type; can change by themselves', onNewText],
          ['Sermon slides', 'From a PDF or pictures', onNewSlides],
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

function Slides({ s, item, onShowSlide, onAdd, onEdit, inPlan, active, onBackground }) {
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
        ${(item.kind === 'song' || item.kind === 'text' || item.kind === 'countdown') && html`<button class="btn small" onClick=${onEdit}>${icons.edit()} Edit</button>`}
        ${inPlan && item.kind !== 'media' && html`<button class="btn small" onClick=${() => onBackground(null)}>${icons.image()} Background</button>`}
        ${!inPlan && html`<button class="btn small" onClick=${onAdd}>${icons.plus()} Add to service</button>`}
      </div>
      ${live && !isLiveItem && html`<div class="jump">${icons.radio()}<span class="grow">On screen now: <b>${live.item.title}</b></span><button class="btn small" onClick=${() => onShowSlide(null)}>Go to it</button></div>`}
      ${item.kind === 'media' ? html`<${MediaPanel} s=${s} item=${item} isLive=${isLiveItem} onShow=${() => onShowSlide(0)} />` : html`
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
  return html`<div class="card">
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
          : html`<button class="btn small" onClick=${() => api('/api/projector/open', {}).catch(fail)}>Open on projector</button>`}</span></div>
      <${Screen} slide=${slide} kind=${s.live && s.live.item.kind} subtitle=${s.live && s.live.item.subtitle} theme=${cfg.theme} bg=${effectiveBg(slide, s.live && s.live.item, cfg.theme)} churchName=${cfg.churchName} black=${s.black} clear=${s.clear} logo=${s.logo}
        lt=${cfg.lowerThirdOnProjector && s.lowerThird.visible && (s.lowerThird.name || s.lowerThird.title) ? s.lowerThird : null}
        countdown=${s.live && s.live.item.kind === 'countdown' ? s.live.item.countdown : null} skew=${s.now - (s.receivedAt || s.now)} />
    </div>

    <div class="card stack">
      <div class="card-head" style="margin:0"><b>Live stream</b>
        <span class="note-r">${st.mode === 'live'
          ? html`<span class="dests">${dests.map(([id, d]) => html`<span class="dest" key=${id}><span class=${'dot ' + d.state}></span>${d.label}</span>`)}${st.recording && html`<span class="dest"><span class="dot ok"></span>Rec</span>`}</span>`
          : st.mode === 'preview'
            ? html`<button class="btn small ghost" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop preview</button>`
            : html`<button class="btn small ghost" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Preview camera</button>`}</span></div>
      ${st.mode !== 'off' ? html`<${PreviewImage} running=${true} /><${Meter} />` : html`<div class="muted" style="font-size:13px">Camera is off. ${configured ? 'It starts when you go live.' : ''}</div>`}
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
        <label class="switch" style="min-height:36px"><input type="checkbox" checked=${cfg.streamCaptions} onChange=${(e) => api('/api/config', { streamCaptions: e.target.checked }).catch(fail)} /><span>Words along the bottom of the camera view</span></label>`}
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
    try { await api('/api/stream/start', { mode: 'live' }); onClose(); toast('You are live'); } catch (err) { fail(err); setBusy(false); }
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
    <${TitleHelper} s=${s} />
    <p class="hint">On YouTube and Facebook, the broadcast may take 10–30 seconds to appear.</p>
  </${Modal}>`;
}

function StopDialog({ onClose }) {
  const [busy, setBusy] = useState(false);
  return html`<${Modal} title="End the live stream?" onClose=${onClose} footer=${html`
      <button class="btn" onClick=${onClose}>Keep streaming</button>
      <button class="btn danger" disabled=${busy} onClick=${async () => { setBusy(true); await api('/api/stream/stop', {}).catch(fail); onClose(); toast('Stream ended'); }}>End stream</button>`}>
    <p class="muted" style="margin:0">Viewers will see the broadcast end. Any recording is saved to the Recordings folder.</p>
  </${Modal}>`;
}

function SongEditor({ song, onClose, onSaved }) {
  const [title, setTitle] = useState(song.title || '');
  const [author, setAuthor] = useState(song.author || '');
  const [lyrics, setLyrics] = useState(song.sections ? sectionsToText(song.sections) : '');
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => parseSections(lyrics), [lyrics]);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api('/api/song', { id: song.id, title, author, lyrics, hymnal: song.hymnal, number: song.number, copyright: song.copyright, ccli: song.ccli });
      toast('Song saved');
      onSaved && onSaved(saved);
      onClose();
    } catch (err) { fail(err); setBusy(false); }
  };
  const del = async () => {
    if (!confirm(`Delete “${song.title}”?`)) return;
    await api('/api/song/delete', { id: song.id }).catch(fail);
    toast('Song deleted');
    onSaved && onSaved(null);
    onClose();
  };
  return html`<${Modal} wide title=${song.id ? 'Edit song' : 'New song'} onClose=${onClose} footer=${html`
      ${song.id && html`<button class="btn ghost" onClick=${del}>Delete</button>`}<span class="spacer"></span>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy || !title.trim() || !sections.length} onClick=${save}>Save song</button>`}>
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
  return html`<${Modal} title=${editing ? 'Edit text slides' : 'Text slides'} onClose=${onClose} footer=${footer}>
    <div class="field"><label class="label">Name (shown in the order of service)</label><input class="input" value=${title} placeholder="e.g. Announcements" onInput=${(e) => setTitle(e.target.value)} /></div>
    <label class="label">Text</label>
    <textarea class="textarea" style="min-height:220px" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Welcome to our service!\n\nA blank line starts a new slide.'} autofocus=${editing}></textarea>
    <div class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'} · a blank line starts a new slide · sunset times: <kbd>{sunset}</kbd> <kbd>{sabbath-begins}</kbd> <kbd>{sabbath-ends}</kbd> <kbd>{next-sabbath-begins}</kbd></div>
    ${/\{(sunset|sabbath-|next-sabbath)/.test(text) && html`<div class="note" style="margin-top:8px;white-space:pre-line">${!SAB ? 'Set your church’s location in Settings → General so ChurchStream can work out sunset times.' : fillSabbath(slides.map((x) => x.text).join('\n\n'), SAB)}</div>`}
    <div class="field" style="margin-top:14px"><label class="label">Change slides automatically (loops — good for announcements)</label>
      <select class="select" value=${auto} onChange=${(e) => setAuto(+e.target.value)}>${AUTO_CHOICES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>
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
  return html`<${Modal} wide title=${editing ? 'Edit countdown' : 'Countdown'} onClose=${onClose} footer=${footer}>
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

// Video / music item: big transport controls instead of a slide grid.
function MediaPanel(props) {
  return props.item.media && props.item.media.type === 'youtube' ? html`<${YouTubePanel} ...${props} />` : html`<${FilePanel} ...${props} />`;
}

const ytThumb = (y) => (y && y.id ? `https://i.ytimg.com/vi/${y.id}/hqdefault.jpg` : '');

// A YouTube item: plays in YouTube's player on the projector (needs internet).
function YouTubePanel({ s, item, isLive, onShow }) {
  const m = item.media || {};
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
               <button class="btn big ghost" onClick=${() => ctl({ action: 'restart' })}>From the start</button>`
        : html`<button class="btn big primary" onClick=${() => (isLive ? ctl({ action: 'play' }) : onShow())}>${icons.play()} Play</button>`}
      <div class="media-progress grow"><div class="track"><i style=${`width:${dur ? Math.min(100, (shown / dur) * 100) : 0}%`}></i></div>
        <span class="muted">${fmtDur(shown)} / ${dur ? fmtDur(dur) : '–:––'}${m.loop ? ' · loops' : ''}</span></div>
      <label class="media-vol" title="Volume in the room">${icons.music()}<input type="range" min="0" max="1" step="0.05" value=${playing ? playing.volume : (m.volume ?? 1)}
        onChange=${(e) => (playing ? ctl({ volume: +e.target.value }) : Promise.resolve())} /></label>
    </div>
    <div class="hint" style="padding:0 18px 16px">Plays from YouTube on the projector, so it needs internet. The live stream shows a “now playing” card (or the camera), and online viewers hear it only through your microphones. To put the video itself into the stream, download it instead (+ Add → Video, music or YouTube).</div>
  </div>`;
}

// A video / music file from the media library.
function FilePanel({ s, item, isLive, onShow }) {
  const m = item.media || {};
  const playing = s.media && s.media.now && s.media.now.id === item.key ? s.media.now : null;
  const [, tick] = useState(0);
  useEffect(() => { if (!playing) return undefined; const id = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(id); }, [playing && playing.startedAt]);
  const skew = s.now - (s.receivedAt || s.now);
  const elapsed = playing ? (Date.now() + skew - playing.startedAt) / 1000 : 0;
  const dur = m.duration || 0;
  const shown = m.loop && dur ? elapsed % dur : Math.min(elapsed, dur || elapsed);
  const vol = playing ? playing.volume : (m.volume ?? 1);
  const src = '/media/' + encodeURIComponent((m.file || '').replace(/^media:/, ''));
  return html`<div class="media-panel">
    <div class="media-view">
      ${m.type === 'video'
        ? html`<video src=${src} muted preload="metadata" ref=${(el) => { if (el && playing && Math.abs(el.currentTime - shown) > 1) { el.currentTime = shown; el.play().catch(() => {}); } else if (el && !playing && !el.paused) el.pause(); }}></video>`
        : html`<div class="media-audio">${icons.music()}<span>${item.title}</span></div>`}
      ${playing && html`<span class="tag live" style="position:absolute;top:12px;left:12px">${m.type === 'video' ? 'PLAYING ON SCREEN & STREAM' : 'PLAYING'}</span>`}
    </div>
    <div class="media-bar">
      ${playing
        ? html`<button class="btn big" onClick=${() => api('/api/media/control', { action: 'stop' }).catch(fail)}>${icons.stop()} Stop</button>
               <button class="btn big ghost" onClick=${() => api('/api/media/control', { action: 'restart' }).catch(fail)}>From the start</button>`
        : html`<button class="btn big primary" onClick=${() => (isLive ? api('/api/media/control', { action: 'play' }).catch(fail) : onShow())}>${icons.play()} Play</button>`}
      <div class="media-progress grow"><div class="track"><i style=${`width:${dur ? Math.min(100, (shown / dur) * 100) : 0}%`}></i></div>
        <span class="muted">${fmtDur(shown)} / ${dur ? fmtDur(dur) : '–:––'}${m.loop ? ' · loops' : ''}</span></div>
      <label class="media-vol" title="Volume on the stream">${icons.music()}<input type="range" min="0" max="1.5" step="0.05" value=${vol}
        onChange=${(e) => (playing ? api('/api/media/control', { volume: +e.target.value }) : Promise.resolve()).catch(fail)} /></label>
    </div>
    <div class="hint" style="padding:0 18px 16px">${m.type === 'video'
      ? 'The video fills the projector and the stream while it plays (names and the ticker stay on top). Background music pauses during the video.'
      : 'The music plays on the stream' + (m.room ? ' and through this computer’s speakers.' : '.')}</div>
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
  const doneRef = useRef(null);
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
  const del = async (c) => { if (confirm(`Delete “${c.name}” from this computer?`)) setClips(await api('/api/clips/delete', { id: c.id }).catch(fail)); };
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
  return html`<div class="card">
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

// Sermon slides: a PDF (PowerPoint → File → Save As → PDF) or picture files become slides.
async function uploadSlideImage(blob) {
  const res = await fetch('/api/media?kind=slide', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');
  return d.name;
}

function SlidesImport({ onClose, onAdd, onShow }) {
  const [title, setTitle] = useState('');
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState('');
  const [auto, setAuto] = useState(0);
  const pick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'application/pdf,.pdf,image/png,image/jpeg,image/webp';
    inp.onchange = async () => {
      const files = [...inp.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!files.length) return;
      if (!title) setTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      const out = [...slides];
      try {
        for (const f of files) {
          if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
            setBusy('Opening ' + f.name + '…');
            const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
            const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
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
          } else if (/^image\//.test(f.type)) {
            setBusy('Adding ' + f.name + '…');
            out.push({ label: `Slide ${out.length + 1}`, text: '', image: await uploadSlideImage(f) });
            setSlides([...out]);
          }
        }
      } catch (err) { fail(err); }
      setBusy('');
    };
    inp.click();
  };
  const item = () => ({ key: 'images:' + Date.now(), kind: 'images', title: title.trim() || 'Slides', subtitle: '', slides, autoAdvance: auto });
  const ready = slides.length > 0 && !busy;
  return html`<${Modal} wide title="Sermon slides" onClose=${onClose} footer=${html`
      <button class="btn" disabled=${!ready} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!ready} onClick=${() => { onShow(item()); onClose(); }}>Show now</button>`}>
    <div class="note" style="margin-bottom:14px">In PowerPoint, Keynote or Google Slides choose <b>File → Save As / Download → PDF</b>, then pick that PDF here. You can also pick picture files (PNG/JPG), one per slide.</div>
    <div class="row wrap" style="margin-bottom:12px">
      <button class="btn primary" disabled=${!!busy} onClick=${pick}>${icons.plus()} ${slides.length ? 'Add more…' : 'Choose PDF or pictures…'}</button>
      ${busy && html`<span class="muted">${busy}</span>`}
      ${slides.length > 0 && !busy && html`<span class="muted">${slides.length} slide${slides.length === 1 ? '' : 's'} ready</span>`}
    </div>
    <div class="two" style="gap:10px">
      <div class="field"><label class="label">Name in the order of service</label><input class="input" value=${title} placeholder="e.g. Sermon — The Good Shepherd" onInput=${(e) => setTitle(e.target.value)} /></div>
      <div class="field"><label class="label">Change slides automatically</label><select class="select" value=${auto} onChange=${(e) => setAuto(+e.target.value)}>${AUTO_CHOICES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>
    </div>
    ${slides.length > 0 && html`<div class="bg-grid" style="max-height:340px;overflow:auto;padding:4px">${slides.map((sl, i) => html`<div class="bg-tile" key=${i}>
      <div class="bg-thumb" style=${`background:#000 url("${bgInfo(sl.image).url}") center/contain no-repeat;cursor:default`}></div>
      <div class="row" style="justify-content:space-between"><span class="bg-name">${i + 1}</span><button class="btn ghost small" onClick=${() => setSlides(slides.filter((_, j) => j !== i))}>Remove</button></div></div>`)}</div>`}
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
    await api('/api/plan', { items: t.items }).catch(fail);
    toast(`Loaded “${t.name}”`);
    onClose();
  };
  const del = async (t) => { if (confirm(`Delete the template “${t.name}”?`)) setList(await api('/api/templates/delete', { name: t.name }).catch(fail)); };
  return html`<${Modal} title="Service templates" onClose=${onClose}>
    <label class="label">Save this order of service (${s.plan.items.length} items) as</label>
    <div class="key-row"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /><button class="btn primary" disabled=${!name.trim() || !s.plan.items.length} onClick=${saveIt}>Save</button></div>
    <div class="hint">Saving with an existing name replaces it.</div>
    <label class="label" style="margin-top:20px">Start from a template</label>
    ${!list ? html`<div class="muted">Loading…</div>` : !list.length ? html`<div class="note">No templates yet. Build your usual order of service once (opening hymn, scripture reading, prayer, children's story, sermon, closing hymn…), then save it here.</div>` : html`
      <div style="display:grid;gap:8px">${list.map((t) => html`<div class="row" key=${t.name}>
        <div class="grow"><b>${t.name}</b><div class="hint" style="margin:0">${t.items.length} items · ${t.items.slice(0, 4).map((x) => x.title).join(', ')}${t.items.length > 4 ? '…' : ''}</div></div>
        <button class="btn small primary" onClick=${() => load(t)}>Use</button><button class="btn small ghost" onClick=${() => del(t)}>Delete</button></div>`)}</div>`}
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
  const i = slideIndex === null ? 0 : slideIndex;
  const current = scope === 'slide' ? ((plan.slideBackgrounds || {})[i] || '') : (plan.background || '');
  const [pick, setPick] = useState(current);
  useEffect(() => setPick(current), [scope]);
  const slide = item.slides[i];
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
          <button class=${'choice' + (scope === 'slide' ? ' on' : '')} onClick=${() => setScope('slide')}><b>Only this slide</b><span>${slide.label || 'Slide ' + (i + 1)}</span></button>
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
function ControlView({ s }) {
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [tab, setTab] = useState('slides'); // only matters on tablets/phones
  const st = s.stream;

  // Follow the live item when nothing else is selected.
  const item = selected || (s.live ? s.live.item : null);
  const inPlan = item && s.plan.items.some((x) => x.uid === item.key);

  const show = (it, index = 0) => api('/api/live', { item: it, index }).then(() => { setSelected(it); }).catch(fail);
  const addToPlan = (it) => {
    const entry = { kind: it.kind, title: it.title, subtitle: it.subtitle, songId: it.songId, ref: it.ref, translation: it.translation, count: it.slides.length,
      slides: it.kind === 'text' || it.kind === 'countdown' || it.kind === 'images' ? it.slides : undefined, autoAdvance: it.autoAdvance, countdown: it.countdown, media: it.media };
    api('/api/plan', { items: [...s.plan.items, entry] }).then(() => toast(`Added “${it.title}”`)).catch(fail);
  };
  const openPlan = (uid) => api('/api/plan/open', { uid }).then((it) => { setSelected(it); setTab('slides'); }).catch(fail);
  const showSlide = (i) => {
    if (i === null) { setSelected(null); return; }
    if (s.live && item && s.live.item.key === item.key) api('/api/goto', { index: i }).catch(fail);
    else show(item, i);
  };
  const step = (d) => {
    if (!s.live && item) return show(item, 0);
    api('/api/goto', { delta: d }).catch(fail);
  };
  const toggle = (name) => api('/api/toggle', { name }).catch(fail);

  // After the live item moves on (e.g. Next past the end), keep the centre in sync.
  const liveKey = s.live && s.live.item.key;
  const prevLive = useRef(liveKey);
  useEffect(() => {
    if (prevLive.current && selected && selected.key === prevLive.current && liveKey !== prevLive.current) setSelected(null);
    prevLive.current = liveKey;
  }, [liveKey]);

  useEffect(() => {
    const k = (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || dialog) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
      else if (e.key === 'b' || e.key === 'B' || e.key === '.') toggle('black');
      else if (e.key === 'c' || e.key === 'C') toggle('clear');
      else if (e.key === 'l' || e.key === 'L') api('/api/lower-third', { visible: !s.lowerThird.visible }).catch(fail);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const editSong = async () => {
    try { setDialog({ type: 'song', song: await get('/api/song', { id: songIdOf(item) }) }); } catch (err) { fail(err); }
  };
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
  // After a background change, reload the item (and refresh the screens if it is showing).
  const refreshItem = async (uid) => {
    const it = await api('/api/plan/open', { uid });
    if (s.live && s.live.item.key === uid) await api('/api/live', { item: it, index: s.live.index });
    setSelected(it);
  };
  const songIdOf = (it) => it && (it.songId || (it.key.startsWith('song:') ? it.key.slice(5) : null));
  const planSong = item && item.kind === 'song' && s.plan.items.find((x) => x.uid === item.key);

  const live = s.live;
  return html`<div class="shell">
    <div class="topbar">
      <div class="brand"><img src="/favicon.svg" alt="" /><span>${s.config.churchName || 'ChurchStream'}</span></div>
      <${Omnibox} onOpen=${(it) => { setSelected(it); setTab('slides'); }} onShow=${(it) => { show(it); setTab('slides'); }} onAdd=${addToPlan} onNewSong=${(t) => setDialog({ type: 'song', song: { title: t } })} />
      <span class="spacer"></span>
      ${s.sabbath && s.sabbath.label && html`<div class=${'status sun' + (s.sabbath.isSabbath ? ' sabbath' : '')} title="Sunset times for your church's location (Settings → General)">${icons.sun()}<span class="extra-sun">${s.sabbath.label}</span></div>`}
      <${StreamStatus} s=${s} />
      ${/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && html`<button class="btn icon round" title="Connect a phone or tablet" aria-label="Connect a phone or tablet" onClick=${() => navigate('/settings#devices')}>${icons.phone()}</button>`}
      <button class="btn icon round" title="Settings" aria-label="Settings" onClick=${() => navigate('/settings')}>${icons.gear()}</button>
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
      <${Slides} s=${s} item=${item} inPlan=${inPlan} active=${tab === 'slides'} onShowSlide=${showSlide} onAdd=${() => addToPlan({ ...item, songId: songIdOf(item) })} onEdit=${item && item.kind === 'text' ? () => setDialog({ type: 'text', item }) : item && item.kind === 'countdown' ? () => setDialog({ type: 'countdown', item }) : editSong} onBackground=${(i) => setDialog({ type: 'bg', item, slideIndex: i })} />
      <${Aside} s=${s} active=${tab === 'output'} onGoLive=${() => setDialog({ type: 'golive' })} onStop=${() => setDialog({ type: 'stop' })} />
    </div>
    <div class="bottom">
      <${Plan} s=${s} selectedKey=${item && item.key} onOpen=${openPlan} onNewText=${() => setDialog({ type: 'text' })}
        onNewCountdown=${() => setDialog({ type: 'countdown' })} onNewSlides=${() => setDialog({ type: 'slides' })} onNewMedia=${() => setDialog({ type: 'media' })}
        onNewSunset=${() => setDialog({ type: 'text', preset: { title: 'Sunset times', text: 'This Sabbath ends at sunset\n{sabbath-ends}\n\nNext Sabbath begins\n{next-sabbath-begins}' } })} onTemplates=${() => setDialog({ type: 'templates' })} />
      <div class="controls">
        <button class="btn" onClick=${() => step(-1)} title="Previous (←)">‹ Back${live && html`<small>${live.index + 1} of ${live.item.slides.length}</small>`}</button>
        <button class="btn primary next" onClick=${() => step(1)} title="Next (→, Space or a clicker)">Next ${icons.right()}</button>
        <button class=${'btn' + (s.clear ? ' on' : '')} onClick=${() => toggle('clear')} title="Hide the words, keep the background (C)">Clear<small>C</small></button>
        <button class=${'btn' + (s.logo ? ' on' : '')} onClick=${() => { toggle('logo'); if (!s.logo && !(s.config.theme || {}).logo) toast('Tip: upload your church logo in Settings → General'); }} title="Show the church logo">Logo</button>
        <button class=${'btn black' + (s.black ? ' on' : '')} onClick=${() => toggle('black')} title="Black screen (B)">${s.black ? 'Black ✓' : 'Black'}<small>B</small></button>
      </div>
    </div>
    ${dialog && dialog.type === 'golive' && html`<${GoLiveDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'stop' && html`<${StopDialog} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'bg' && html`<${BackgroundDialog} s=${s} item=${dialog.item} slideIndex=${dialog.slideIndex} onClose=${() => setDialog(null)} onSaved=${() => refreshItem(dialog.item.key)} />`}
    ${dialog && dialog.type === 'text' && html`<${TextEditor} preset=${dialog.preset} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (title, slides, auto) => saveText(dialog.item.key, title, slides, auto) : null} />`}
    ${dialog && dialog.type === 'countdown' && html`<${CountdownEditor} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)}
      initial=${dialog.item} onSave=${dialog.item ? (it) => saveCountdown(dialog.item.key, it) : null} />`}
    ${dialog && dialog.type === 'templates' && html`<${TemplatesDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'slides' && html`<${SlidesImport} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)} />`}
    ${dialog && dialog.type === 'media' && html`<${MediaDialog} s=${s} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)} />`}
    ${dialog && dialog.type === 'song' && html`<${SongEditor} song=${dialog.song} onClose=${() => setDialog(null)} onSaved=${(saved) => {
      if (!saved) { setSelected(null); return; }
      const it = { key: planSong ? planSong.uid : 'song:' + saved.id, kind: 'song', title: saved.title, subtitle: hymnLabel(saved), slides: saved.slides, songId: saved.id };
      setSelected(it);
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
  const pick = () => pickFiles('image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg', false, async ([f]) => {
    if (!f) return;
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
  const sizes = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
  return html`<div class="field"><label class="label">Church logo</label>
    <div class="logo-field">
      <div class="logo-preview"><${Screen} slide=${null} theme=${theme} bg=${effectiveBg(null, null, theme)} churchName=${s.config.churchName} logo=${true} /></div>
      <div class="grow">
        <div class="row wrap">
          <button class="btn primary" disabled=${busy} onClick=${pick}>${busy ? 'Uploading…' : theme.logo ? 'Change logo…' : 'Upload logo…'}</button>
          ${theme.logo && html`<button class="btn ghost" onClick=${() => api('/api/media/remove', { kind: 'logo' }).then(() => toast('Logo removed')).catch(fail)}>Remove</button>`}
        </div>
        ${theme.logo && html`<label class="switch" style="margin-top:8px"><input type="checkbox" checked=${!!theme.logoName} onChange=${(e) => save({ theme: { logoName: e.target.checked } })} /><span>Show the church name under the logo</span></label>`}
        ${theme.logo && html`<div class="choices" style="margin-top:8px">${sizes.map(([v, t]) => html`<button class=${'choice' + ((theme.logoSize || 'medium') === v ? ' on' : '')} onClick=${() => save({ theme: { logoSize: v } })}><b>${t}</b></button>`)}</div>`}
        <div class="hint">Shown full screen on the projector and the stream when you press <b>Logo</b>. A PNG with a transparent background looks best. ${theme.logo ? '' : 'Until you upload one, the church name is shown.'}</div>
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
    ['dshow', 'USB camera or capture card', 'Webcams and HDMI-to-USB capture devices'],
    ['rtsp', 'Network (IP) camera', 'PTZ and IP cameras on your network'],
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
      <div class="field"><label class="label">Sound of videos and background music on the stream</label>
        <select class="select" value=${s.config.mediaSound || 'direct'} onChange=${(e) => save({ mediaSound: e.target.value })}>
          <option value="direct">Mix it straight into the stream (recommended)</option>
          <option value="desk">It already reaches the stream through our sound desk</option>
        </select>
        <div class="hint">Choose the second option only if this computer's sound goes into your sound desk and the desk feeds the stream — otherwise viewers would hear it twice.</div></div>
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
      <button class="btn primary" onClick=${() => api('/api/projector/open', {}).catch(fail)}>Open projector window</button>
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
    <label class="switch"><input type="checkbox" checked=${cfg.record} onChange=${(e) => save({ record: e.target.checked })} /><span>Also record a copy on this computer</span></label>
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
        <option value="SDAH">Seventh-day Adventist Hymnal (1985)</option><option value="CH1941">Church Hymnal (1941)</option>
      </select><div class="hint">Type <kbd>sdah 100</kbd> or <kbd>ch 100</kbd> to choose a hymnal directly.</div></div>
    <div class="note">Hymn texts are downloaded from free community projects (github.com/joshpetit/sda-hymnal and github.com/adventhymnals). Many hymns are public domain, but some are still under copyright. <b>Projecting them requires your church's CCLI licence</b>, which most churches already have.</div>
    <p class="muted" style="margin-top:16px">${counts.total} songs in your library in total. To add your own, search for a title in the control panel and choose “Create a song”.</p>
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
    <label class="label">Free (public domain) translations</label>
    <div style="display:grid;gap:8px;margin-bottom:16px">
      ${catalog.map(([id, name]) => html`<div class="row"><span class="grow">${name}</span>${have.some((t) => t.id === id)
        ? html`<span style="color:var(--ok)">Installed</span>`
        : html`<button class="btn small" disabled=${busy} onClick=${() => api('/api/import/bible', { id }).catch(fail)}>Download</button>`}</div>`)}
    </div>
    ${s.task && (s.task.running || s.task.error) && html`<div class="note">${s.task.error || s.task.label}</div>`}
    <div class="note">Modern translations such as NIV, ESV or NKJV are copyrighted and can't be included. If your church holds a licence and has the text as a JSON file, see the README for how to import it.</div>
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
      <div class="field"><label class="label">Projector text size</label>
        <div class="choices">${[[0.85, 'Smaller'], [1, 'Normal'], [1.15, 'Larger']].map(([v, t]) => html`<button class=${'choice' + ((theme.textScale || 1) === v ? ' on' : '')} onClick=${() => save({ theme: { textScale: v } })}><b>${t}</b></button>`)}</div></div>
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
      <div class="note">${s.ffmpeg.ok ? s.ffmpeg.version : html`<b>FFmpeg was not found.</b> Put ffmpeg.exe in the “ffmpeg” folder next to ChurchStream.exe, or enter its location below.`}</div>
      <div class="key-row" style="margin-top:8px"><input class="input" value=${ff} placeholder="Automatic" onInput=${(e) => setFf(e.target.value)} /><button class="btn" onClick=${() => save({ ffmpegPath: ff.trim() }, 'Saved')}>Save</button></div></div>
    <div class="field"><label class="label">Video encoder</label>
      <select class="select" value=${s.config.encoder} onChange=${(e) => save({ encoder: e.target.value })}>
        <option value="auto">Automatic (uses the graphics chip when possible)</option>
        <option value="h264_qsv">Intel Quick Sync</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="h264_amf">AMD AMF</option><option value="libx264">Software (x264)</option>
      </select>${s.stream.encoder && html`<div class="hint">In use: ${s.stream.encoder}</div>`}</div>
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
    ['Control panel', best.url + '/control', 'Run the service from a phone or tablet (same as this screen).'],
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
          <li>Not loading? Windows may be blocking it: the first time ChurchStream started, Windows asked to allow it on networks. Choose <b>Allow</b> (or set the church Wi-Fi to a <b>Private</b> network in Windows settings).</li>
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

function SettingsView({ s }) {
  const [sec, setSec] = useState((location.hash || '#general').slice(1));
  const cur = SECTIONS.find((x) => x[0] === sec) || SECTIONS[0];
  const C = cur[2];
  return html`<div class="settings-shell">
    <div class="settings-top"><button class="btn ghost" onClick=${() => navigate('/control')}>${icons.back()} Back to control panel</button><span class="spacer"></span><${StreamStatus} s=${s} /></div>
    <div class="settings">
      <nav>${SECTIONS.map(([id, label]) => html`<button class=${id === cur[0] ? 'on' : ''} onClick=${() => { setSec(id); history.replaceState({}, '', '#' + id); }}>${label}</button>`)}
        <span class="spacer"></span><button onClick=${() => navigate('/setup')}>Run setup again</button></nav>
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
    <div class="setup-top"><div class="brand"><img src="/favicon.svg" alt="" /><span>ChurchStream</span></div>
      <div class="steps">${STEPS.map((_, j) => html`<i class=${j <= i ? 'done' : ''}></i>`)}</div></div>
    <div class="setup-body" style=${step.wide ? 'width:min(980px,100%)' : ''}>
      <h1>${step.title}</h1>
      ${step.lead && html`<p class="lead">${step.lead}</p>`}
      ${step.C && html`<${step.C} s=${s} autoPreview=${true} key=${step.id} />`}
      ${step.id === 'done' && html`<div>
        <p class="lead">Here's how a typical Sunday works:</p>
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
    s.black, s.clear, s.logo, t.logo, t.logoName, t.logoSize, s.config.churchName, t.textScale || 1]);
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

async function renderProgram(s) {
  const W = 1280;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const live = s.live;
  const slide = live && live.item.slides[live.index];
  const t = s.config.theme || {};
  const FONT = '"Inter ChurchStream", "Segoe UI", sans-serif';
  try { await document.fonts.load(`600 40px ${FONT}`); } catch { /* fall back to system font */ }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (s.black) return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));

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
    const logo = lp.img && await loadImg(lp.img);
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
    // Same fitting rules as the projector: keep song lines whole if still readable, else wrap.
    const box = { x: W * 0.06, y: H * 0.06, w: W * 0.88, h: H * 0.83 };
    const max = H * 0.085 * (t.textScale || 1);
    const min = H * 0.032;
    const layout = (size, wrap) => {
      ctx.font = `600 ${size}px ${FONT}`;
      const lines = wrap ? wrapLines(ctx, slide.text, box.w) : String(slide.text).split('\n');
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      return { lines, fits: widest <= box.w && lines.length * size * 1.28 <= box.h };
    };
    const search = (wrap) => {
      let lo = min; let hi = max;
      if (layout(hi, wrap).fits) return hi;
      for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (layout(mid, wrap).fits) lo = mid; else hi = mid; }
      return lo;
    };
    let wrap = live.item.kind === 'bible';
    let size = search(wrap);
    if (!wrap && size < Math.min(H * 0.054, max * 0.65)) { wrap = true; size = search(true); }
    const { lines } = layout(size, wrap);
    const lh = size * 1.28;
    const top = box.y + (box.h - lines.length * lh) / 2 + lh / 2;
    ctx.fillStyle = ink;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lh));
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
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
}

let lastProgramKey = null;
let programTimer = null;
function updateProgram(s) {
  const key = programKey(s);
  if (key === lastProgramKey) return;
  clearTimeout(programTimer);
  programTimer = setTimeout(async () => {
    lastProgramKey = key;
    try {
      const blob = await renderProgram(s);
      await fetch('/api/program-image?key=' + encodeURIComponent(key.length > 1500 ? String(key.length) + key.slice(0, 1500) : key), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    } catch { lastProgramKey = null; }
  }, 60);
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
    }, (m) => meterBus.dispatchEvent(new CustomEvent('m', { detail: m })));
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
  if (!s) return html`<div class="boot">ChurchStream</div>`;
  let view;
  if (route === '/setup') view = html`<${SetupView} s=${s} />`;
  else if (route === '/settings') view = html`<${SettingsView} s=${s} />`;
  else view = html`<${ControlView} s=${s} />`;
  return html`${!online && html`<div class="banner red fixed">Connection to ChurchStream lost — reconnecting…</div>`}${view}<${Toasts} />`;
}

render(html`<${Root} />`, document.getElementById('app'));

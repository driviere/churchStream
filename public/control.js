import { h, html, render, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from '/vendor/preact-htm.js';
import { connect, fitText, slideHtml } from '/shared.js';

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
  gear: () => I(html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
  edit: () => I(html`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  radio: () => I(html`<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>`),
  monitor: () => I(html`<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`),
  check: () => I(html`<path d="M20 6 9 17l-5-5"/>`),
  alert: () => I(html`<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>`),
  back: () => I(html`<path d="M19 12H5M12 19l-7-7 7-7"/>`),
};

// ---------------------------------------------------------------------------------------
// the projected screen, used for thumbnails and the mini projector view
function Screen({ slide, kind, subtitle, theme = {}, churchName = '', black, clear, logo }) {
  const ref = useRef();
  const scale = theme.textScale || 1;
  const text = !black && !clear && !logo && slide ? slide : null;
  useLayoutEffect(() => { if (ref.current) fitText(ref.current, { max: 8.5 * scale }); }, [text && text.text, scale]);
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
  const bg = theme.background ? `url("/media/${theme.background}")` : '';
  return html`<div class="screen">
    <div class=${'screen-bg' + (bg ? ' has-image' : '')} style=${bg ? `background-image:${bg}` : ''}></div>
    ${text && html`<div class="screen-layer"><div ref=${ref} class=${'screen-text' + (kind === 'bible' ? ' bible' : '')} dangerouslySetInnerHTML=${{ __html: slideHtml(text) }}></div></div>`}
    ${text && text.ref && html`<div class="screen-ref">${text.ref}</div>`}
    ${text && kind === 'song' && subtitle && html`<div class="screen-tag">${subtitle}</div>`}
    ${logo && html`<div class="screen-logo">${theme.logo ? html`<img src=${'/media/' + theme.logo} alt="" />` : html`<div class="name">${churchName}</div>`}</div>`}
    ${black && html`<div class="screen-black"></div>`}
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

// ---------------------------------------------------------------------------------------
// order of service: a horizontal strip along the bottom
const kindLabel = (it) => {
  if (it.kind === 'bible') return 'READING';
  if (it.kind === 'text') return 'TEXT';
  const m = String(it.subtitle || '').match(/^(SDA Hymnal|Church Hymnal|Hymn)\s+(\d+)$/);
  return m ? `${m[1] === 'Church Hymnal' ? 'CH' : 'HYMN'} ${m[2]}` : 'SONG';
};

function Plan({ s, selectedKey, onOpen, onNewText }) {
  const items = s.plan.items;
  const live = s.live;
  const liveAt = live ? items.findIndex((x) => x.uid === live.item.key) : -1;
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const list = useRef();

  const save = (next) => api('/api/plan', { items: next }).catch(fail);
  const remove = (uid) => save(items.filter((x) => x.uid !== uid));

  // Pointer-based reordering works with a mouse and on touch screens.
  const start = (e, i) => {
    if (e.button > 0 || e.target.closest('.x')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      if (!moved) { moved = true; setDrag(i); }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const li = el && el.closest('li[data-i]');
      if (li && list.current.contains(li)) setOver(Number(li.dataset.i));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (!moved) { onOpen(items[i].uid); return; }
      setDrag(null);
      setOver((o) => {
        if (o !== null && o !== i) { const next = items.slice(); const [m] = next.splice(i, 1); next.splice(o, 0, m); save(next); }
        return null;
      });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  return html`<section class="card plan-card" aria-label="Order of service">
    <div class="plan-head"><b>Order of service</b><span>${items.length ? 'Next moves on by itself at the end of each item · drag to reorder' : ''}</span></div>
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
      <li style="flex:0 0 auto;padding:0;border:0;background:none;min-height:0"><button class="plan-add" onClick=${onNewText}>+ Text</button></li>
    </ul>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// slide grid (centre card)
const SlideCard = ({ slide, i, item, s, isLive, isNext, onClick }) => html`
  <button class=${'slide-card' + (isLive ? ' live' : '') + (isNext ? ' next' : '')} onClick=${onClick}>
    <${Screen} slide=${slide} kind=${item.kind} subtitle=${item.subtitle} theme=${s.config.theme} />
    <div class="meta"><span class="lbl">${slide.label || (item.kind === 'bible' ? slide.ref : `Slide ${i + 1}`)}</span>
      ${isLive ? html`<span class="tag live">ON SCREEN</span>` : isNext ? html`<span class="tag next">NEXT</span>` : html`<span class="tag num">${i + 1}</span>`}</div>
  </button>`;

function Slides({ s, item, onShowSlide, onAdd, onEdit, inPlan, active }) {
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
        ${item.kind === 'song' && html`<button class="btn small" onClick=${onEdit}>${icons.edit()} Edit</button>`}
        ${!inPlan && html`<button class="btn small" onClick=${onAdd}>${icons.plus()} Add to service</button>`}
      </div>
      ${live && !isLiveItem && html`<div class="jump">${icons.radio()}<span class="grow">On screen now: <b>${live.item.title}</b></span><button class="btn small" onClick=${() => onShowSlide(null)}>Go to it</button></div>`}
      <div class="slides-scroll"><div class="slides">
        ${item.slides.map((sl, i) => html`<${SlideCard} key=${i} slide=${sl} i=${i} item=${item} s=${s} isLive=${i === liveIdx} isNext=${isLiveItem && i === liveIdx + 1} onClick=${() => onShowSlide(i)} />`)}
      </div></div>`}
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
    <div class="card-head"><b>Name on stream</b>${lt.visible && html`<span class="tag live" style="margin-left:auto">SHOWING</span>`}</div>
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
    <div class="hint">Tap to show on the stream, tap again to hide.</div>
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
      <${Screen} slide=${slide} kind=${s.live && s.live.item.kind} subtitle=${s.live && s.live.item.subtitle} theme=${cfg.theme} churchName=${cfg.churchName} black=${s.black} clear=${s.clear} logo=${s.logo} />
    </div>

    <div class="card stack">
      <div class="card-head" style="margin:0"><b>Live stream</b>
        <span class="note-r">${st.mode === 'live'
          ? html`<span class="dests">${dests.map(([id, d]) => html`<span class="dest" key=${id}><span class=${'dot ' + d.state}></span>${d.label}</span>`)}${st.recording && html`<span class="dest"><span class="dot ok"></span>Rec</span>`}</span>`
          : st.mode === 'preview'
            ? html`<button class="btn small ghost" onClick=${() => api('/api/stream/stop', {}).catch(fail)}>Stop preview</button>`
            : html`<button class="btn small ghost" onClick=${() => api('/api/stream/start', { mode: 'preview' }).catch(fail)}>Preview camera</button>`}</span></div>
      ${st.mode !== 'off' ? html`<${PreviewImage} running=${true} /><${Meter} />` : html`<div class="muted" style="font-size:13px">Camera is off. ${configured ? 'It starts when you go live.' : ''}</div>`}
      <label class="switch" style="min-height:36px"><input type="checkbox" checked=${cfg.streamCaptions} onChange=${(e) => api('/api/config', { streamCaptions: e.target.checked }).catch(fail)} /><span>Lyrics & verses on the stream</span></label>
      ${!configured
        ? html`<button class="btn big" onClick=${() => navigate('/settings#streaming')}>Set up YouTube & Facebook</button>`
        : st.mode === 'live'
          ? html`<button class="btn big" onClick=${onStop}>End live stream</button>`
          : html`<button class="btn big danger" onClick=${onGoLive}>${icons.radio()} Go live</button>`}
    </div>

    <${NameOnStream} s=${s} />
  </aside>`;
}

// ---------------------------------------------------------------------------------------
// dialogs
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

function TextEditor({ onClose, onAdd, onShow }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const slides = useMemo(() => parseSections(text), [text]);
  const item = () => ({ key: 'text:' + Date.now(), kind: 'text', title: title || slides[0]?.text.split('\n')[0] || 'Text', subtitle: '', slides });
  return html`<${Modal} title="Text slides" onClose=${onClose} footer=${html`
      <button class="btn" disabled=${!slides.length} onClick=${() => { onAdd(item()); onClose(); }}>Add to service</button>
      <button class="btn primary" disabled=${!slides.length} onClick=${() => { onShow(item()); onClose(); }}>Show now</button>`}>
    <div class="field"><label class="label">Name (shown in the service plan)</label><input class="input" value=${title} placeholder="e.g. Announcements" onInput=${(e) => setTitle(e.target.value)} /></div>
    <label class="label">Text</label>
    <textarea class="textarea" style="min-height:200px" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Welcome to our service!\n\nA blank line starts a new slide.'}></textarea>
    <div class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'}</div>
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
    const entry = { kind: it.kind, title: it.title, subtitle: it.subtitle, songId: it.songId, ref: it.ref, translation: it.translation, count: it.slides.length, slides: it.kind === 'text' ? it.slides : undefined };
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
  const songIdOf = (it) => it && (it.songId || (it.key.startsWith('song:') ? it.key.slice(5) : null));
  const planSong = item && item.kind === 'song' && s.plan.items.find((x) => x.uid === item.key);

  const live = s.live;
  return html`<div class="shell">
    <div class="topbar">
      <div class="brand"><img src="/favicon.svg" alt="" /><span>${s.config.churchName || 'ChurchStream'}</span></div>
      <${Omnibox} onOpen=${(it) => { setSelected(it); setTab('slides'); }} onShow=${(it) => { show(it); setTab('slides'); }} onAdd=${addToPlan} onNewSong=${(t) => setDialog({ type: 'song', song: { title: t } })} />
      <span class="spacer"></span>
      <${StreamStatus} s=${s} />
      <button class="btn icon round" title="Settings" aria-label="Settings" onClick=${() => navigate('/settings')}>${icons.gear()}</button>
    </div>
    ${st.problem && html`<div class=${'banner' + (st.state === 'retrying' || st.state === 'error' ? ' red' : '')}>${icons.alert()}<span class="grow">${st.problem}${st.message && st.state === 'retrying' ? ' ' + st.message : ''}</span></div>`}
    ${st.silent && html`<div class="banner red">${icons.alert()}<span class="grow"><b>No sound for 10 seconds.</b> Check that the microphone or sound desk is on and connected.</span></div>`}
    ${s.task && (s.task.running || s.task.error) && html`<div class=${'banner' + (s.task.error ? ' red' : '')}><span class="grow">${s.task.error || s.task.label}</span></div>`}
    <nav class="tabs">
      <button class=${tab === 'slides' ? 'on' : ''} onClick=${() => setTab('slides')}>Slides</button>
      <button class=${tab === 'output' ? 'on' : ''} onClick=${() => setTab('output')}>Screens & stream${st.mode === 'live' ? ' ●' : ''}</button>
    </nav>
    <div class="main">
      <${Slides} s=${s} item=${item} inPlan=${inPlan} active=${tab === 'slides'} onShowSlide=${showSlide} onAdd=${() => addToPlan({ ...item, songId: songIdOf(item) })} onEdit=${editSong} />
      <${Aside} s=${s} active=${tab === 'output'} onGoLive=${() => setDialog({ type: 'golive' })} onStop=${() => setDialog({ type: 'stop' })} />
    </div>
    <div class="bottom">
      <${Plan} s=${s} selectedKey=${item && item.key} onOpen=${openPlan} onNewText=${() => setDialog({ type: 'text' })} />
      <div class="controls">
        <button class="btn" onClick=${() => step(-1)} title="Previous (←)">‹ Back${live && html`<small>${live.index + 1} of ${live.item.slides.length}</small>`}</button>
        <button class="btn primary next" onClick=${() => step(1)} title="Next (→, Space or a clicker)">Next ${icons.right()}</button>
        <button class=${'btn' + (s.clear ? ' on' : '')} onClick=${() => toggle('clear')} title="Hide the words, keep the background (C)">Clear<small>C</small></button>
        <button class=${'btn' + (s.logo ? ' on' : '')} onClick=${() => toggle('logo')} title="Show the church logo">Logo</button>
        <button class=${'btn black' + (s.black ? ' on' : '')} onClick=${() => toggle('black')} title="Black screen (B)">${s.black ? 'Black ✓' : 'Black'}<small>B</small></button>
      </div>
    </div>
    ${dialog && dialog.type === 'golive' && html`<${GoLiveDialog} s=${s} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'stop' && html`<${StopDialog} onClose=${() => setDialog(null)} />`}
    ${dialog && dialog.type === 'text' && html`<${TextEditor} onClose=${() => setDialog(null)} onAdd=${addToPlan} onShow=${(it) => show(it)} />`}
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
      <div class="hint">Shown on the projector when you press “Logo” (if no logo image is set).</div></div>
    <div class="field"><label class="label">Control panel password (optional)</label><input class="input" type="password" value=${pw} placeholder="No password" onInput=${(e) => setPw(e.target.value)} onBlur=${() => save({ controlPassword: pw })} />
      <div class="hint">Set one if your Wi-Fi is open to visitors. The projector and stage screens never need it.</div></div>
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
    ${lan.length > 0 && html`<div class="note" style="margin-top:16px"><b>Stage screen for musicians:</b> open <b>${lan[0]}/stage</b> on any phone or tablet on the church Wi-Fi to see the current and next slide.</div>`}
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
    <label class="label" style="margin-top:20px">Quality</label>
    <div class="choices">${qualities.map(([id, t, d]) => html`<button class=${'choice' + (cfg.quality === id ? ' on' : '')} onClick=${() => save({ quality: id })}><b>${t}</b><span>${d}</span></button>`)}</div>
    <div class="note" style="margin-bottom:16px">The video is encoded <b>once</b> and sent to every platform, so the computer works no harder for two platforms. Your internet upload needs to cover each platform. Check it at <a href="https://fast.com" target="_blank" rel="noopener">fast.com</a> (“Show more info”). If unsure, start with <b>Good</b>.</div>
    <label class="switch"><input type="checkbox" checked=${cfg.record} onChange=${(e) => save({ record: e.target.checked })} /><span>Also record a copy on this computer</span></label>
  </div>`;
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
  const upload = (kind) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const res = await fetch('/api/media?kind=' + kind, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const d = await res.json();
      if (d.error) fail(new Error(d.error)); else toast('Image saved');
    };
    inp.click();
  };
  const sample = { text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.' };
  return html`<div class="two">
    <div>
      <div class="field"><label class="label">Background image</label>
        <div class="row">${theme.background ? html`<img class="thumb-img" src=${'/media/' + theme.background} alt="" />` : html`<span class="muted">Default dark blue</span>`}</div>
        <div class="row" style="margin-top:8px"><button class="btn small" onClick=${() => upload('background')}>Choose image…</button>${theme.background && html`<button class="btn small ghost" onClick=${() => api('/api/media/remove', { kind: 'background' })}>Remove</button>`}</div>
        <div class="hint">A calm, darker photo works best. It's dimmed automatically so text stays readable.</div></div>
      <div class="field"><label class="label">Logo (shown when you press “Logo”)</label>
        <div class="row">${theme.logo ? html`<img class="thumb-img" style="object-fit:contain" src=${'/media/' + theme.logo} alt="" />` : html`<span class="muted">Church name is shown instead</span>`}</div>
        <div class="row" style="margin-top:8px"><button class="btn small" onClick=${() => upload('logo')}>Choose image…</button>${theme.logo && html`<button class="btn small ghost" onClick=${() => api('/api/media/remove', { kind: 'logo' })}>Remove</button>`}</div></div>
      <div class="field"><label class="label">Control panel colours</label>
        <div class="choices">${[['light', 'Light', 'Bright and easy to read'], ['dark', 'Dark', 'Less glare in a dim room']].map(([v, t, d]) => html`<button class=${'choice' + ((s.config.uiTheme || 'light') === v ? ' on' : '')} onClick=${() => save({ uiTheme: v })}><b>${t}</b><span>${d}</span></button>`)}</div></div>
      <div class="field"><label class="label">Projector text size</label>
        <div class="choices">${[[0.85, 'Smaller'], [1, 'Normal'], [1.15, 'Larger']].map(([v, t]) => html`<button class=${'choice' + ((theme.textScale || 1) === v ? ' on' : '')} onClick=${() => save({ theme: { textScale: v } })}><b>${t}</b></button>`)}</div></div>
    </div>
    <div><label class="label">Preview</label><${Screen} slide=${sample} kind="song" subtitle="SDA Hymnal 108" theme=${theme} /></div>
  </div>`;
}

function SectionLowerThirds({ s }) {
  const presets = s.config.lowerThirdPresets || [];
  const update = (list) => save({ lowerThirdPresets: list });
  return html`<div>
    <p class="muted" style="margin-top:0">One-tap names for the live stream. Add them from the control panel with “Save”, or edit them here.</p>
    ${presets.map((p, i) => html`<div class="row" style="margin-bottom:8px" key=${i}>
      <input class="input" value=${p.name} placeholder="Name" onChange=${(e) => update(presets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
      <input class="input" value=${p.title} placeholder="Title" onChange=${(e) => update(presets.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
      <button class="btn ghost icon" onClick=${() => update(presets.filter((_, j) => j !== i))} title="Remove">${icons.x()}</button>
    </div>`)}
    <button class="btn small" onClick=${() => update([...presets, { name: 'New name', title: '' }])}>${icons.plus()} Add preset</button>
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
    <div class="field"><label class="label">Recent log <button class="btn small ghost" onClick=${load}>Refresh</button></label><div class="logbox">${logs.length ? logs.join('\n') : 'Nothing yet.'}</div></div>
  </div>`;
}

const SECTIONS = [
  ['general', 'General', SectionGeneral],
  ['camera', 'Camera & sound', SectionCamera],
  ['projector', 'Projector', SectionProjector],
  ['streaming', 'YouTube & Facebook', SectionStreaming],
  ['songs', 'Hymnals & songs', SectionSongs],
  ['bible', 'Bible', SectionBible],
  ['appearance', 'Appearance', SectionAppearance],
  ['lowerthirds', 'Lower thirds', SectionLowerThirds],
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
        ${s.lan && s.lan.length > 0 && html`<div class="note">To run it from a tablet, open <b>${s.lan[0]}/control</b> on the church Wi-Fi.</div>`}
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
function Root() {
  const [s, setS] = useState(null);
  const [online, setOnline] = useState(true);
  const [route, setRoute] = useState(location.pathname);
  useEffect(() => {
    get('/api/state').then((st) => setS((cur) => cur ? { ...cur, lan: st.lan } : st)).catch(() => {});
    const stop = connect((st) => {
      setOnline(!!st);
      if (st) setS((cur) => ({ ...st, lan: cur ? cur.lan : st.lan }));
    }, (m) => meterBus.dispatchEvent(new CustomEvent('m', { detail: m })));
    const pop = () => setRoute(location.pathname);
    addEventListener('popstate', pop);
    return () => { stop(); removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = (s && s.config.uiTheme) || 'light'; }, [s && s.config.uiTheme]);
  if (!s) return html`<div class="boot">ChurchStream</div>`;
  let view;
  if (route === '/setup') view = html`<${SetupView} s=${s} />`;
  else if (route === '/settings') view = html`<${SettingsView} s=${s} />`;
  else view = html`<${ControlView} s=${s} />`;
  return html`${!online && html`<div class="banner red fixed">Connection to ChurchStream lost — reconnecting…</div>`}${view}<${Toasts} />`;
}

render(html`<${Root} />`, document.getElementById('app'));

'use strict';
// YouTube links: played with YouTube's own embedded player on the projector (nothing is
// downloaded). This module only understands links and looks up a video's title.
const ID = /^[\w-]{11}$/;
const LIST = /^[\w-]{10,64}$/;

// Seconds from "90", "1m30s", "1h2m3s".
function parseStart(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// Accepts watch / youtu.be / shorts / embed / live / music.youtube.com links, playlists, or a bare video id.
function parseYouTube(input) {
  const s = String(input || '').trim();
  if (ID.test(s)) return { id: s, list: '', start: 0 };
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
    else if (parts[0] !== 'playlist') return null;
  } else return null;
  const list = u.searchParams.get('list') || '';
  const out = { id: ID.test(id) ? id : '', list: LIST.test(list) ? list : '', start: parseStart(u.searchParams.get('t') || u.searchParams.get('start')) };
  return out.id || out.list ? out : null;
}

function clean(y) {
  y = y && typeof y === 'object' ? y : {};
  return {
    id: ID.test(String(y.id || '')) ? y.id : '',
    list: LIST.test(String(y.list || '')) ? y.list : '',
    start: Math.max(0, Math.min(86400, Math.round(Number(y.start) || 0))),
  };
}

function watchUrl(y) {
  return y.id ? `https://www.youtube.com/watch?v=${y.id}${y.list ? '&list=' + y.list : ''}` : `https://www.youtube.com/playlist?list=${y.list}`;
}

// Title and channel via YouTube's public oEmbed endpoint (works without an API key).
async function info(input) {
  const y = parseYouTube(input);
  if (!y) throw new Error('That doesn’t look like a YouTube link. Copy it from the Share button on YouTube.');
  let title = '';
  let author = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watchUrl(y)), { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) throw new Error('This video doesn’t allow playing on other sites (the owner turned off embedding). Choose another video.');
    if (res.status === 404 || res.status === 400) throw new Error('That video wasn’t found. It may be private or removed.');
    if (res.ok) { const d = await res.json(); title = d.title || ''; author = d.author_name || ''; }
  } catch (err) {
    if (/embedding|wasn’t found/.test(err.message)) throw err;
    // Offline or blocked: still usable, just without a title.
  }
  return { ...y, title: title || (y.list && !y.id ? 'YouTube playlist' : 'YouTube video'), author };
}

module.exports = { parseYouTube, clean, info, watchUrl };

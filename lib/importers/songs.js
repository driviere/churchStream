'use strict';
// Import songs from files (Settings → Hymnals & songs → Import songs…). Everything is read on
// this computer; nothing is uploaded anywhere.
//
// Accepted:
//   .churchsongs          ChurchStream songbook file (a zip of song .txt files + songbook.json)
//   .txt                  ChurchStream song format ("Title:" header), a CCLI SongSelect export,
//                         or a numbered songbook listing ("25. Title" then the words)
//   .docx                 a Word document laid out like the numbered listing (or one song)
//   .xml                  OpenLyrics (OpenLP, and other church software)
//   .cho .chordpro .pro   ChordPro (chords are removed)
//   .csv                  columns: number, title, lyrics (or title, lyrics)
const path = require('path');
const { readZip } = require('../unzip');
const { writeZip } = require('../zip');
const { parseSong, parseSections, serializeSong } = require('../songs');

const clean = (s) => String(s).replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ').trim();
const decodeXml = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// A section label on its own line: "Chorus", "Verse 2", "Refrain:", "2", "2."
const LABEL = /^\s*\[?\s*(verse\s*\d+|chorus\s*\d*|refrain|bridge|pre-?chorus|tag|ending|coda|interlude|intro|outro)\s*\]?\s*:?\s*$/i;
const VERSE_NUM = /^\s*(\d{1,2})[.)]?\s*$/;
const niceLabel = (l) => {
  const s = clean(l).replace(/^\[|\]$/g, '').replace(/:$/, '').trim().toLowerCase();
  const m = /^verse\s*(\d+)$/.exec(s);
  if (m) return 'Verse ' + m[1];
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\s+(\d+)$/, ' $1');
};

// Words → sections. Blank lines separate slides; label lines name the next section; a verse
// number at the start of a line ("2. Text" or "2" alone) starts that verse.
function wordsToSections(lines) {
  const sections = [];
  let cur = null;
  const start = (label) => { cur = { label, lines: [] }; sections.push(cur); };
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) { cur = null; continue; }
    if (LABEL.test(line)) { start(niceLabel(line)); continue; }
    let m = VERSE_NUM.exec(line);
    if (m) { start('Verse ' + Number(m[1])); continue; }
    m = /^(\d{1,2})[.)]\s+(\S.*)$/.exec(line);
    if (m) { start('Verse ' + Number(m[1])); cur.lines.push(m[2]); continue; }
    m = /^(chorus|refrain)\s*:\s*(\S.*)$/i.exec(line);
    if (m) { start(niceLabel(m[1])); cur.lines.push(m[2]); continue; }
    if (!cur) start('');
    cur.lines.push(line);
  }
  return sections.filter((s) => s.lines.length).map((s) => ({ label: s.label, text: s.lines.join('\n') }));
}

// ---------- ChurchStream's own song format ----------
const isChurchStreamSong = (text) => /^\s*Title\s*:/i.test(text);
function fromChurchStream(text, fallbackTitle) {
  const s = parseSong(text, '');
  if (!s.title && fallbackTitle) s.title = fallbackTitle;
  return { title: s.title, number: s.number, hymnal: s.hymnal, author: s.author, copyright: s.copyright, ccli: s.ccli, sections: s.sections };
}

// ---------- CCLI SongSelect .txt ----------
const isSongSelect = (text) => /CCLI Song\s*#\s*\d+/i.test(text);
function fromSongSelect(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const title = clean(lines.find((l) => clean(l)) || 'Untitled');
  const body = [];
  let ccli = ''; let copyright = ''; let author = '';
  let i = lines.findIndex((l) => clean(l)) + 1;
  for (; i < lines.length; i++) {
    const l = clean(lines[i]);
    let m;
    if ((m = /^CCLI Song\s*#\s*(\d+)/i.exec(l))) { ccli = m[1]; author = clean(lines[i + 1] || ''); continue; }
    if (/^(©|\(c\)|copyright)/i.test(l)) { copyright = l.replace(/^(\(c\)|copyright)\s*/i, '© '); continue; }
    if (/^For use solely with the SongSelect|^CCLI Licen[cs]e\s*#|^Note: Reproduction/i.test(l)) continue;
    if (ccli && l && l === author) continue;
    body.push(lines[i]);
  }
  return { title, author, copyright, ccli, sections: wordsToSections(body) };
}

// ---------- ChordPro ----------
const isChordPro = (text) => /\{\s*(title|t|soc|start_of_chorus|sov|start_of_verse)\s*[:}]/i.test(text);
function fromChordPro(text) {
  const song = { title: '', author: '', copyright: '', ccli: '', number: null, sections: [] };
  const out = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const d = /^\s*\{\s*([\w_-]+)\s*(?::\s*(.*?))?\s*\}\s*$/.exec(raw);
    if (d) {
      const [, k, v = ''] = d;
      const key = k.toLowerCase();
      if (key === 'title' || key === 't') song.title = clean(v);
      else if (['artist', 'composer', 'lyricist', 'author'].includes(key)) song.author = song.author || clean(v);
      else if (key === 'copyright') song.copyright = clean(v);
      else if (key === 'ccli') song.ccli = clean(v);
      else if (/^(soc|start_of_chorus)$/.test(key)) out.push('', 'Chorus');
      else if (/^(sov|start_of_verse)$/.test(key)) out.push('', v ? clean(v) : '');
      else if (/^(sob|start_of_bridge)$/.test(key)) out.push('', 'Bridge');
      else if (/^(eoc|end_of_chorus|eov|end_of_verse|eob|end_of_bridge)$/.test(key)) out.push('');
      else if (/^(c|comment|ci|comment_italic)$/.test(key) && LABEL.test(v)) out.push('', clean(v));
      continue;
    }
    if (/^\s*#/.test(raw)) continue;
    out.push(raw.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' '));
  }
  song.sections = wordsToSections(out);
  return song;
}

// ---------- OpenLyrics ----------
const isOpenLyrics = (text) => /<song\b[^>]*openlyrics/i.test(text) || (/<song\b/i.test(text) && /<lyrics\b/i.test(text));
function fromOpenLyrics(text) {
  const tag = (name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(text); return m ? clean(decodeXml(m[1].replace(/<[^>]+>/g, ''))) : ''; };
  const names = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Pre-chorus', e: 'Ending', i: 'Intro', o: 'Ending' };
  const sections = [];
  for (const m of text.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)) {
    const nm = (/\bname="([^"]*)"/i.exec(m[1]) || [])[1] || '';
    const k = /^([a-z])(\d*)/i.exec(nm);
    const label = k ? (names[k[1].toLowerCase()] || '') + (k[1].toLowerCase() === 'v' ? ' ' + (k[2] || '1') : k[2] && k[2] !== '1' ? ' ' + k[2] : '') : '';
    const lines = m[2].replace(/<comment\b[\s\S]*?<\/comment>/gi, '').replace(/<chord\b[^>]*\/>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/lines>\s*<lines\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
    const t = decodeXml(lines).split('\n').map(clean).filter(Boolean).join('\n');
    if (t) sections.push({ label: label.trim(), text: t });
  }
  const authors = [...text.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)].map((m) => clean(decodeXml(m[1])));
  const songbook = /<songbook\b[^>]*\bentry="(\d+)"/i.exec(text);
  return { title: tag('title'), author: authors.join(', '), copyright: tag('copyright'), ccli: tag('ccliNo'), number: songbook ? Number(songbook[1]) : null, sections };
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  let iNum = col(/^(no\.?|number|num|#|hymn)$/); let iTitle = col(/title|name/); let iWords = col(/lyric|words|text/);
  let data = rows.slice(1);
  if (iTitle < 0 || iWords < 0) { // no header row: number?, title, lyrics
    data = rows;
    const w = rows[0].length;
    if (w >= 3) { iNum = 0; iTitle = 1; iWords = 2; } else { iNum = -1; iTitle = 0; iWords = 1; }
  }
  const iAuthor = col(/author|writer/);
  return data.map((r) => ({
    title: clean(r[iTitle] || ''), number: iNum >= 0 ? parseInt(r[iNum], 10) || null : null,
    author: iAuthor >= 0 ? clean(r[iAuthor] || '') : '',
    sections: wordsToSections(String(r[iWords] || '').replace(/\r/g, '').replace(/\\n/g, '\n').split('\n')),
  })).filter((s) => s.title && s.sections.length);
}

// ---------- Word (.docx) → lines ----------
function docxLines(buf) {
  let entries;
  try { entries = readZip(buf); } catch { throw new Error('This Word file could not be read.'); }
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('This Word file could not be read.');
  const xml = doc.read().toString('utf8');
  const lines = [];
  for (const p of xml.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const body = p[1] || '';
    let text = '';
    for (const t of body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g)) {
      if (t[1] !== undefined) text += decodeXml(t[1]);
      else if (t[2]) text += '\n';
      else text += ' ';
    }
    lines.push(...text.split('\n'));
  }
  return lines;
}

// ---------- A numbered songbook listing ----------
// "25 Title", "25. Title", "#25 Title", "No. 25 – Title", or "25" alone (title on the next line),
// then the words. Verse numbers ("1.", "2") look like song numbers, so we keep the run of song
// numbers that counts up best (1, 2, 3…) and treat the rest as verses.
const HEAD = /^\s*(?:#|no\.?\s*|hymn\s+|song\s+)?(\d{1,4})\s*(?:[.):–—-]\s*|\s+|$)(.*)$/i;
function fromNumberedListing(lines) {
  const L = lines.map((l) => String(l).replace(/\r/g, ''));
  const cands = [];
  for (let i = 0; i < L.length; i++) {
    const m = HEAD.exec(L[i]);
    if (!m) continue;
    const prevBlank = i === 0 || !clean(L[i - 1]);
    const rest = clean(m[2]);
    const hash = /^\s*(#|no\.?\s*\d|hymn\s|song\s)/i.test(L[i]);
    // How much it looks like a song heading (not a verse number).
    let w = 1;
    if (hash) w += 1;
    if (prevBlank) w += 0.3;
    if (rest && rest.length <= 50 && !/[,;]$/.test(rest)) w += 0.3;
    if (rest && rest === rest.toUpperCase() && /[A-Z]/.test(rest)) w += 0.5;
    if (!rest) w -= 0.2;
    cands.push({ i, n: Number(m[1]), rest, w });
  }
  if (!cands.length) return [];
  // Best chain: numbers going up by 1 (small gaps allowed, at a cost).
  const best = cands.map((c) => ({ score: c.w, prev: -1 }));
  for (let a = 0; a < cands.length; a++) {
    for (let b = Math.max(0, a - 400); b < a; b++) {
      const gap = cands[a].n - cands[b].n;
      if (gap < 1 || gap > 4 || cands[a].i - cands[b].i < 2) continue;
      const s = best[b].score + cands[a].w - (gap - 1) * 0.6;
      if (s > best[a].score) best[a] = { score: s, prev: b };
    }
  }
  let end = 0;
  for (let a = 1; a < cands.length; a++) if (best[a].score > best[end].score) end = a;
  const chain = [];
  for (let a = end; a >= 0; a = best[a].prev) chain.unshift(cands[a]);
  if (chain.length < 2) return [];
  const songs = [];
  chain.forEach((c, k) => {
    const stop = k + 1 < chain.length ? chain[k + 1].i : L.length;
    let body = L.slice(c.i + 1, stop);
    let title = c.rest;
    if (!title) { // "25" alone: the title is the next line
      const j = body.findIndex((l) => clean(l));
      if (j >= 0) { title = clean(body[j]); if (body[j + 1] !== undefined && !clean(body[j + 1])) body = body.slice(j + 1); }
    }
    const sections = wordsToSections(body);
    if (!title && sections[0]) title = sections[0].text.split('\n')[0];
    if (sections.length) songs.push({ title: titleCase(title), number: c.n, sections });
  });
  return songs;
}
// "AMAZING GRACE" → "Amazing Grace"; titles already in mixed case are kept.
function titleCase(t) {
  t = clean(t).replace(/[.:]+$/, '');
  if (t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return t.toLowerCase().replace(/[a-z][a-z']*/g, (w, i) => (i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .replace(/\b(i|god|lord|jesus|christ)\b/g, (w) => (w === 'i' ? 'I' : w[0].toUpperCase() + w.slice(1)));
}

// ---------- .churchsongs ----------
function fromChurchSongs(buf) {
  let entries;
  try { entries = readZip(buf); } catch { throw new Error('This isn’t a ChurchStream songs file (.churchsongs).'); }
  let book = null;
  const mf = entries.find((e) => e.name === 'songbook.json');
  if (mf) { try { book = JSON.parse(mf.read().toString('utf8')); } catch { book = null; } }
  const songs = entries.filter((e) => /\.txt$/i.test(e.name) && !e.name.endsWith('/'))
    .map((e) => fromChurchStream(e.read().toString('utf8'), path.basename(e.name, '.txt')));
  if (!songs.length) throw new Error('This songs file is empty.');
  return { songs, book: book && book.code ? { code: String(book.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), name: String(book.name || book.code).slice(0, 80) } : null };
}

// Any accepted file → { songs: [...], book: {code, name} | null, format }.
function parseSongFile(name, buf) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.pdf' || (buf.length > 4 && buf.slice(0, 4).toString('latin1') === '%PDF')) {
    throw new Error('PDF files can’t be read directly. Copy the words into a Word or text file and import that instead.');
  }
  if (ext === '.churchsongs' || (ext === '.zip')) return { ...fromChurchSongs(buf), format: 'ChurchStream songs file' };
  if (ext === '.docx') {
    const lines = docxLines(buf);
    const many = fromNumberedListing(lines);
    if (many.length) return { songs: many, book: null, format: 'Word document' };
    const one = wordsToSections(lines);
    if (!one.length) throw new Error('No song words were found in this Word file.');
    return { songs: [{ title: path.basename(name, ext), sections: one }], book: null, format: 'Word document' };
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  if (ext === '.csv') { const s = fromCsv(text); if (!s.length) throw new Error('No songs were found in this CSV file. It needs title and lyrics columns.'); return { songs: s, book: null, format: 'CSV' }; }
  if (ext === '.xml' || /^\s*<\?xml|^\s*<song\b/i.test(text)) {
    if (!isOpenLyrics(text)) throw new Error('This XML file isn’t an OpenLyrics song.');
    return { songs: [fromOpenLyrics(text)], book: null, format: 'OpenLyrics' };
  }
  if (['.cho', '.chordpro', '.chopro', '.pro', '.crd'].includes(ext) || isChordPro(text)) return { songs: [fromChordPro(text)], book: null, format: 'ChordPro' };
  if (isChurchStreamSong(text)) return { songs: [fromChurchStream(text, path.basename(name, ext))], book: null, format: 'ChurchStream song' };
  if (isSongSelect(text)) return { songs: [fromSongSelect(text)], book: null, format: 'CCLI SongSelect' };
  const lines = text.split('\n');
  const many = fromNumberedListing(lines);
  if (many.length) return { songs: many, book: null, format: 'numbered song list' };
  const one = wordsToSections(lines);
  if (!one.length) throw new Error('No song words were found in this file.');
  return { songs: [{ title: path.basename(name, ext) || one[0].text.split('\n')[0], sections: one }], book: null, format: 'text' };
}

// Songs → a .churchsongs file.
function writeChurchSongs(songs, book) {
  const used = new Set();
  const entries = [];
  if (book) entries.push({ name: 'songbook.json', data: Buffer.from(JSON.stringify({ format: 'churchstream-songs', version: 1, code: book.code, name: book.name, count: songs.length }, null, 1)) });
  for (const s of songs) {
    let base = (s.number ? String(s.number).padStart(3, '0') + ' ' : '') + String(s.title || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    let n = base; let k = 2;
    while (used.has(n.toLowerCase())) n = `${base} (${k++})`;
    used.add(n.toLowerCase());
    entries.push({ name: n + '.txt', data: Buffer.from(serializeSong({ ...s, edited: false }).replace(/\n/g, '\r\n')) });
  }
  return writeZip(entries);
}

module.exports = { parseSongFile, writeChurchSongs, wordsToSections, fromNumberedListing, titleCase, parseSections };

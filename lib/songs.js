'use strict';
// Song library: one plain-text file per song, easy to read and back up.
//
//   Title: Great Is Thy Faithfulness
//   Hymnal: SDAH
//   Number: 100
//   Author: Thomas O. Chisholm
//
//   [Verse 1]
//   Great is Thy faithfulness, O God my Father;
//   ...
//
//   [Refrain]
//   ...
const fs = require('fs');
const path = require('path');

const HEADER_KEYS = ['title', 'hymnal', 'number', 'author', 'copyright', 'ccli', 'edited'];
const MAX_LINES_PER_SLIDE = 8;

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(s) {
  return normalize(s).replace(/\s+/g, '-').slice(0, 60) || 'song';
}

function parseSong(text, id = '') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const song = { id, title: '', hymnal: '', number: null, author: '', copyright: '', ccli: '', edited: false, sections: [] };
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
    if (!m || !HEADER_KEYS.includes(m[1].toLowerCase())) break;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'number') song.number = parseInt(val, 10) || null;
    else if (key === 'edited') song.edited = /^(yes|true|1)$/i.test(val);
    else song[key] = val;
  }
  const body = lines.slice(i).join('\n');
  song.sections = parseSections(body);
  if (!song.title) {
    const first = song.sections[0] && song.sections[0].text.split('\n')[0];
    song.title = first || id || 'Untitled';
  }
  return song;
}

// Blank lines separate slides. An optional "[Label]" line names the section.
function parseSections(body) {
  const sections = [];
  for (const block of String(body).split(/\n\s*\n/)) {
    let lines = block.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let label = '';
    const m = lines[0].trim().match(/^\[(.+)\]$/);
    if (m) { label = m[1].trim(); lines = lines.slice(1); }
    if (!lines.length) continue;
    sections.push({ label, text: lines.join('\n') });
  }
  return sections;
}

// Sections → projector slides (very long sections are split in half so text stays large).
function toSlides(song) {
  const slides = [];
  for (const s of song.sections) {
    const lines = s.text.split('\n');
    if (lines.length <= MAX_LINES_PER_SLIDE) { slides.push({ label: s.label, text: s.text }); continue; }
    const parts = Math.ceil(lines.length / MAX_LINES_PER_SLIDE);
    const per = Math.ceil(lines.length / parts);
    for (let p = 0; p < parts; p++) {
      slides.push({ label: s.label ? `${s.label} (${p + 1}/${parts})` : '', text: lines.slice(p * per, (p + 1) * per).join('\n') });
    }
  }
  return slides;
}

function serializeSong(song) {
  const head = [];
  head.push(`Title: ${song.title || 'Untitled'}`);
  if (song.hymnal) head.push(`Hymnal: ${song.hymnal}`);
  if (song.number) head.push(`Number: ${song.number}`);
  if (song.author) head.push(`Author: ${song.author}`);
  if (song.copyright) head.push(`Copyright: ${song.copyright}`);
  if (song.ccli) head.push(`CCLI: ${song.ccli}`);
  if (song.edited) head.push('Edited: yes');
  const body = song.sections.map((s) => (s.label ? `[${s.label}]\n` : '') + s.text.trim()).join('\n\n');
  return head.join('\n') + '\n\n' + body + '\n';
}

function songId(song) {
  if (song.hymnal && song.number) return `${song.hymnal.toLowerCase()}-${String(song.number).padStart(3, '0')}-${slugify(song.title)}`.slice(0, 80);
  return slugify(song.title);
}

const HYMNALS = {
  SDAH: 'Seventh-day Adventist Hymnal (1985)',
  CH1941: 'Church Hymnal (1941)',
};

class SongLibrary {
  constructor(dir) {
    this.dir = dir;
    this.songs = new Map();
    fs.mkdirSync(dir, { recursive: true });
    this.reload();
  }

  reload() {
    this.songs.clear();
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.txt')) continue;
      const id = f.slice(0, -4);
      try { this.index(parseSong(fs.readFileSync(path.join(this.dir, f), 'utf8'), id)); } catch { /* skip unreadable */ }
    }
  }

  index(song) {
    const first = song.sections[0] ? song.sections[0].text.split('\n')[0] : '';
    song.firstLine = first;
    song._title = normalize(song.title);
    song._first = normalize(first);
    song._all = normalize(song.sections.map((s) => s.text).join(' '));
    this.songs.set(song.id, song);
  }

  summary(song) {
    return { id: song.id, title: song.title, hymnal: song.hymnal, number: song.number, author: song.author, firstLine: song.firstLine };
  }

  get(id) {
    const s = this.songs.get(id);
    if (!s) return null;
    return { ...this.summary(s), copyright: s.copyright, ccli: s.ccli, edited: s.edited, sections: s.sections, slides: toSlides(s) };
  }

  byNumber(hymnal, number) {
    for (const s of this.songs.values()) if (s.number === number && (!hymnal || s.hymnal === hymnal)) return s;
    return null;
  }

  counts() {
    const c = { total: this.songs.size };
    for (const s of this.songs.values()) if (s.hymnal) c[s.hymnal] = (c[s.hymnal] || 0) + 1;
    return c;
  }

  // Ranked search. Supports hymn numbers: "100", "#100", "hymn 100", "sdah 100", "ch 100".
  search(query, { limit = 20, defaultHymnal = 'SDAH' } = {}) {
    const q = String(query || '').trim();
    if (!q) return [...this.songs.values()].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit).map((s) => this.summary(s));
    const num = q.match(/^(?:(sdah|sda|ch|ch1941|church hymnal|hymn|h|#)\s*#?\s*)?(\d{1,4})$/i);
    if (num) {
      const n = parseInt(num[2], 10);
      const tag = (num[1] || '').toLowerCase();
      let order = [defaultHymnal, ...Object.keys(HYMNALS).filter((h) => h !== defaultHymnal)];
      if (tag.startsWith('sda')) order = ['SDAH'];
      else if (tag.startsWith('ch')) order = ['CH1941'];
      const hits = order.map((h) => this.byNumber(h, n)).filter(Boolean);
      const extra = [...this.songs.values()].filter((s) => s.number === n && !s.hymnal);
      return [...hits, ...extra].slice(0, limit).map((s) => this.summary(s));
    }
    const nq = normalize(q);
    if (!nq) return [];
    const words = nq.split(' ');
    const scored = [];
    for (const s of this.songs.values()) {
      let score = 0;
      if (s._title === nq) score = 100;
      else if (s._title.startsWith(nq)) score = 80;
      else if (s._title.includes(nq)) score = 60;
      else if (s._first.includes(nq)) score = 50;
      else if (s._all.includes(nq)) score = 30;
      else if (words.length > 1 && words.every((w) => s._all.includes(w))) score = 10;
      if (score) scored.push([score + (s.hymnal === defaultHymnal ? 1 : 0), s]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
    return scored.slice(0, limit).map(([, s]) => this.summary(s));
  }

  save(input) {
    const song = {
      title: String(input.title || '').trim() || 'Untitled',
      hymnal: input.hymnal || '', number: input.number ? parseInt(input.number, 10) : null,
      author: input.author || '', copyright: input.copyright || '', ccli: input.ccli || '',
      edited: input.edited || false,
      sections: Array.isArray(input.sections) ? input.sections : parseSections(input.lyrics || ''),
    };
    let id = input.id && this.songs.has(input.id) ? input.id : songId(song);
    if (!input.id || !this.songs.has(input.id)) {
      let n = 2;
      const base = id;
      while (this.songs.has(id)) id = `${base}-${n++}`;
    }
    song.id = id;
    const file = path.join(this.dir, id + '.txt');
    fs.writeFileSync(file + '.tmp', serializeSong(song));
    fs.renameSync(file + '.tmp', file);
    this.index(parseSong(serializeSong(song), id));
    return this.get(id);
  }

  remove(id) {
    if (!this.songs.has(id)) return false;
    try { fs.unlinkSync(path.join(this.dir, id + '.txt')); } catch { /* already gone */ }
    this.songs.delete(id);
    return true;
  }
}

module.exports = { SongLibrary, parseSong, parseSections, serializeSong, toSlides, songId, slugify, normalize, HYMNALS };

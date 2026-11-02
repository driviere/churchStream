'use strict';
// One-click hymnal downloads. The hymn texts are NOT shipped with ChurchStream. They are
// fetched from public community projects onto the church's own computer when you ask.
// Projecting hymns that are still under copyright requires the church's CCLI licence.
const fs = require('fs');
const path = require('path');
const { download, pool } = require('./net');
const { readZip } = require('../unzip');

// ---------------------------------------------------------------------------------------
// Seventh-day Adventist Hymnal (1985), 695 hymns — github.com/joshpetit/sda-hymnal (SQLite)
const SDAH_DB_URL = 'https://raw.githubusercontent.com/joshpetit/sda-hymnal/master/data/hymns.db';

function sdahRowToSong(row) {
  const verses = [];
  for (let i = 1; i <= 7; i++) if (row['verse' + i]) verses.push(String(row['verse' + i]).trim());
  const refrain = row.refrain ? String(row.refrain).trim() : '';
  const refrain2 = row.refrain2 ? String(row.refrain2).trim() : '';
  const sections = [];
  // Hymn 121 (Go, Tell It on the Mountain) starts with its refrain.
  if (row.number === 121 && refrain) sections.push({ label: 'Refrain', text: refrain });
  verses.forEach((v, i) => {
    sections.push({ label: `Verse ${i + 1}`, text: v });
    if (refrain) {
      // Hymn 140 has a different final refrain.
      const last = i === verses.length - 1;
      sections.push({ label: 'Refrain', text: last && refrain2 ? refrain2 : refrain });
    }
  });
  return { hymnal: 'SDAH', number: row.number, title: String(row.title).trim(), sections };
}

async function fetchSdah({ tmpDir, onProgress }) {
  onProgress && onProgress('Downloading the SDA Hymnal…');
  const buf = await download(SDAH_DB_URL);
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, 'sdah.db');
  fs.writeFileSync(file, buf);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT * FROM hymns ORDER BY number').all();
    return rows.map(sdahRowToSong);
  } finally {
    db.close();
    try { fs.unlinkSync(file); } catch { /* temp */ }
  }
}

// ---------------------------------------------------------------------------------------
// Church Hymnal (1941), 703 hymns — github.com/adventhymnals/church-hymnal-csycms (Markdown)
const CH_REPO = 'adventhymnals/church-hymnal-csycms';
const CH_ZIP_URL = `https://codeload.github.com/${CH_REPO}/zip/refs/heads/master`;
const CH_RAW_BASE = `https://raw.githubusercontent.com/${CH_REPO}/master/`;

const LABEL_RE = /^(refrain|chorus)\s*:?\s*$/i;

function parseChMarkdown(md) {
  const head = md.match(/title:\s*\|?\s*\n?\s*(\d+)\.\s*(.+?)\s*-\s*Church Hymnal 1941/);
  if (!head) return null;
  const number = parseInt(head[1], 10);
  const title = head[2].trim();
  const authorM = md.match(/^Author\s*\|\s*(.+?)\s*\|?\s*$/m);
  const author = authorM && !/^(undefined|-|anonymous)?$/i.test(authorM[1].trim()) ? authorM[1].trim() : '';
  const body = md.match(/```txt\r?\n([\s\S]*?)```/);
  if (!body) return null;

  const verses = [];
  let refrain = '';
  for (const block of body[1].split(/\r?\n\s*\r?\n/)) {
    let lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines = lines.filter((l) => !/^Major Key:/i.test(l) && !/^Minor Key:/i.test(l));
    if (!lines.length) continue;
    let isRefrain = false;
    if (/^\d+\.?$/.test(lines[0])) lines = lines.slice(1);
    else if (LABEL_RE.test(lines[0])) { isRefrain = true; lines = lines.slice(1); }
    // A refrain is often written inside the first verse after a "Refrain:" line.
    const at = lines.findIndex((l) => LABEL_RE.test(l));
    if (at >= 0) {
      const r = lines.slice(at + 1).join('\n');
      if (r && !refrain) refrain = r;
      lines = lines.slice(0, at);
    }
    if (!lines.length) continue;
    if (isRefrain) { if (!refrain) refrain = lines.join('\n'); } else verses.push(lines.join('\n'));
  }
  const sections = [];
  verses.forEach((v, i) => {
    sections.push({ label: `Verse ${i + 1}`, text: v });
    if (refrain) sections.push({ label: 'Refrain', text: refrain });
  });
  if (!sections.length && refrain) sections.push({ label: 'Refrain', text: refrain });
  return sections.length ? { hymnal: 'CH1941', number, title, author, sections } : null;
}

async function fetchCh1941({ onProgress }) {
  onProgress && onProgress('Downloading the Church Hymnal (1941)…');
  let docs = [];
  try {
    const zip = readZip(await download(CH_ZIP_URL, { timeoutMs: 120000 }));
    docs = zip.filter((e) => e.name.endsWith('/docs.md')).map((e) => e.read().toString('utf8'));
  } catch {
    // Some networks block GitHub archive downloads; fall back to individual files.
    const list = require('./ch1941-paths.json');
    let done = 0;
    docs = await pool(list, 8, async (p) => {
      const buf = await download(CH_RAW_BASE + p.split('/').map(encodeURIComponent).join('/'));
      if (++done % 50 === 0 && onProgress) onProgress(`Downloading the Church Hymnal (1941)… ${done}/${list.length}`);
      return buf.toString('utf8');
    });
  }
  return docs.map(parseChMarkdown).filter(Boolean).sort((a, b) => a.number - b.number);
}

// ---------------------------------------------------------------------------------------
const SOURCES = {
  SDAH: { name: 'Seventh-day Adventist Hymnal (1985)', count: 695, fetch: fetchSdah, source: 'github.com/joshpetit/sda-hymnal' },
  CH1941: { name: 'Church Hymnal (1941)', count: 703, fetch: fetchCh1941, source: 'github.com/adventhymnals/church-hymnal-csycms' },
};

// Add or update the hymns in the library. Hymns you've edited (Edited: yes) are left alone.
async function importHymnal(id, library, { tmpDir, onProgress } = {}) {
  const src = SOURCES[id];
  if (!src) throw new Error('Unknown hymnal ' + id);
  const hymns = await src.fetch({ tmpDir, onProgress });
  if (!hymns.length) throw new Error('The download did not contain any hymns.');
  onProgress && onProgress(`Adding ${hymns.length} hymns…`);
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const h of hymns) {
    const existing = library.byNumber(id, h.number);
    if (existing && existing.edited) { kept++; continue; }
    library.save({ ...h, id: existing ? existing.id : undefined, copyright: '' });
    if (existing) updated++; else added++;
  }
  return { hymnal: src.name, added, updated, kept, total: hymns.length };
}

module.exports = { importHymnal, parseChMarkdown, sdahRowToSong, SOURCES };

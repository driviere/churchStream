'use strict';
// Convert Bible JSON files into ChurchStream's compact format (gzipped):
//   { name, abbrev, books: [66 × [chapters × [verse text]]] }
// Supported inputs:
//   - scrollmapper/bible_databases JSON  { translation, books:[{name, chapters:[{chapter, verses:[{verse,text}]}]}] }
//   - thiagobodruk/bible JSON            [ {abbrev, chapters:[[ "v1", "v2" ]]} ]
//   - ChurchStream's own format
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { download } = require('./net');

// Public-domain translations that can be downloaded from inside the app.
const CATALOG = {
  kjv: { abbrev: 'KJV', name: 'King James Version', file: 'KJV' },
  bsb: { abbrev: 'BSB', name: 'Berean Standard Bible', file: 'BSB' },
  asv: { abbrev: 'ASV', name: 'American Standard Version (1901)', file: 'ASV' },
  ylt: { abbrev: 'YLT', name: "Young's Literal Translation", file: 'YLT' },
  darby: { abbrev: 'DARBY', name: 'Darby Bible (1889)', file: 'Darby' },
  webster: { abbrev: 'WBT', name: 'Webster Bible', file: 'Webster' },
};
const SCROLLMAPPER = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();

function convert(json, { name, abbrev } = {}) {
  let books;
  if (Array.isArray(json)) {
    books = json.map((b) => b.chapters.map((ch) => ch.map(clean)));
  } else if (json.books && json.books[0] && Array.isArray(json.books[0])) {
    books = json.books;
  } else if (json.books) {
    books = json.books.map((b) => {
      const chapters = [];
      for (const ch of b.chapters) {
        const verses = [];
        for (const v of ch.verses) verses[v.verse - 1] = clean(v.text);
        chapters[ch.chapter - 1] = Array.from(verses, (v) => v || '');
      }
      return Array.from(chapters, (c) => c || []);
    });
  } else {
    throw new Error('Unrecognised Bible file format.');
  }
  if (books.length !== 66) throw new Error(`Expected 66 books, found ${books.length}. Only Protestant-canon Bibles are supported.`);
  return { name: name || json.name || json.translation || 'Bible', abbrev: abbrev || json.abbrev || 'BIBLE', books };
}

function writeTranslation(dir, id, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
  return file;
}

async function downloadTranslation(id, dir, { onProgress } = {}) {
  const c = CATALOG[id];
  if (!c) throw new Error('Unknown translation ' + id);
  onProgress && onProgress(`Downloading ${c.name}…`);
  const buf = await download(SCROLLMAPPER + c.file + '.json', { timeoutMs: 180000 });
  const data = convert(JSON.parse(buf.toString('utf8').replace(/^﻿/, '')), c);
  writeTranslation(dir, id, data);
  return { id, name: c.name, abbrev: c.abbrev };
}

module.exports = { convert, writeTranslation, downloadTranslation, CATALOG };

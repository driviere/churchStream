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

// ---------------------------------------------------------------------------------------
// Importing a Bible file the church is licensed to use (Settings → Bible → Import a Bible file).
// Accepts the JSON formats above plus three common XML formats: Zefania, OSIS and USFX.
// The result stays on this computer; ChurchStream never redistributes it.

// Book order (Protestant canon): OSIS and USFX/USFM book codes.
const OSIS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];
const USFM = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];

const decodeXml = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// Verse text: footnotes, cross-references and headings removed, other markup dropped.
const verseText = (s) => clean(decodeXml(String(s)
  .replace(/<(note|NOTE|f|x|title|TITLE|rf|RF|fn)\b[^>]*\/>/g, '')
  .replace(/<(note|NOTE|f|x|rf|RF|fn)\b[^>]*>[\s\S]*?<\/\1>/g, '')
  .replace(/<[^>]+>/g, ' ')));
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag); return m ? m[1] : null; };
const emptyBooks = () => Array.from({ length: 66 }, () => []);
const put = (books, b, c, v, text) => {
  if (b < 0 || b > 65 || !(c > 0) || !(v > 0) || !text) return;
  const ch = (books[b][c - 1] = books[b][c - 1] || []);
  ch[v - 1] = ch[v - 1] ? ch[v - 1] + ' ' + text : text;
};
const tidy = (books) => books.map((ch) => Array.from(ch, (c) => Array.from(c || [], (v) => v || '')));

function parseZefania(xml) {
  const books = emptyBooks();
  for (const bm of xml.matchAll(/<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi)) {
    const b = Number(attr(bm[1], 'bnumber')) - 1;
    for (const cm of bm[2].matchAll(/<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi)) {
      const c = Number(attr(cm[1], 'cnumber'));
      for (const vm of cm[2].matchAll(/<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi)) put(books, b, c, Number(attr(vm[1], 'vnumber')), verseText(vm[2]));
    }
  }
  const title = /<INFORMATION\b[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(xml);
  const id = /<INFORMATION\b[\s\S]*?<identifier>([\s\S]*?)<\/identifier>/i.exec(xml);
  return { books, name: title ? clean(decodeXml(title[1])) : '', abbrev: id ? clean(decodeXml(id[1])) : '' };
}

function parseOsis(xml) {
  const books = emptyBooks();
  const at = (osisID) => {
    const [bk, c, v] = String(osisID || '').split(/\s+/)[0].split('.');
    return [OSIS.indexOf(bk), Number(c), Number(v)];
  };
  // Container verses: <verse osisID="John.3.16">…</verse>
  for (const m of xml.matchAll(/<verse\b([^>]*[^/])>([\s\S]*?)<\/verse>/g)) {
    const [b, c, v] = at(attr(m[1], 'osisID'));
    put(books, b, c, v, verseText(m[2]));
  }
  // Milestone verses: <verse sID="x" osisID="John.3.16"/> … <verse eID="x"/>
  for (const m of xml.matchAll(/<verse\b([^>]*\bsID="([^"]+)"[^>]*)\/>([\s\S]*?)<verse\b[^>]*\beID="\2"[^>]*\/>/g)) {
    const [b, c, v] = at(attr(m[1], 'osisID') || m[2]);
    put(books, b, c, v, verseText(m[3]));
  }
  const title = /<work\b[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml);
  const work = /<osisText\b[^>]*\bosisIDWork="([^"]+)"/.exec(xml);
  return { books, name: title ? clean(decodeXml(title[1])) : '', abbrev: work ? work[1] : '' };
}

function parseUsfx(xml) {
  const books = emptyBooks();
  for (const bm of xml.matchAll(/<book\b([^>]*)>([\s\S]*?)<\/book>/g)) {
    const b = USFM.indexOf(String(attr(bm[1], 'id') || '').toUpperCase());
    if (b < 0) continue;
    let c = 0;
    // Tokens: chapter marks, verse marks, verse ends.
    const parts = bm[2].split(/(<c\b[^>]*\/>|<v\b[^>]*\/>|<ve\s*\/>)/);
    let v = 0;
    for (const part of parts) {
      if (/^<c\b/.test(part)) { c = Number(attr(part, 'id')); v = 0; continue; }
      if (/^<v\b/.test(part)) { v = Number(String(attr(part, 'id') || '').split('-')[0]); continue; }
      if (/^<ve\b/.test(part)) { v = 0; continue; }
      if (v) put(books, b, c, v, verseText(part));
    }
  }
  return { books, name: '', abbrev: '' };
}

// Any supported file → { name, abbrev, books[66] } plus how many books have text.
function parseBibleFile(buf) {
  let text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  text = text.replace(/^﻿/, '');
  let r;
  if (/^\s*[[{]/.test(text)) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('This JSON file could not be read. It may be damaged.'); }
    try { r = convert(json); } catch (err) {
      throw new Error(/66 books/.test(err.message) ? err.message : 'This file isn’t a Bible in a format ChurchStream understands.');
    }
    r = { name: json.name || json.translation || '', abbrev: json.abbrev || '', books: r.books };
  } else if (/<XMLBIBLE\b/i.test(text)) r = parseZefania(text);
  else if (/<osis\b|<osisText\b/.test(text)) r = parseOsis(text);
  else if (/<usfx\b/i.test(text)) r = parseUsfx(text);
  else throw new Error('This file isn’t a Bible in a format ChurchStream understands (JSON, Zefania, OSIS or USFX XML).');
  r.books = tidy(r.books);
  const withText = r.books.filter((b) => b.some((c) => c.some((v) => v))).length;
  const nt = r.books.slice(39).filter((b) => b.some((c) => c.some((v) => v))).length;
  if (withText === 0) throw new Error('No Bible verses were found in this file.');
  if (withText < 66 && nt < 27) throw new Error(`Only ${withText} books of the Bible were found in this file. ChurchStream needs the whole Bible, or at least the whole New Testament.`);
  return { ...r, booksWithText: withText };
}

module.exports = { convert, writeTranslation, downloadTranslation, parseBibleFile, CATALOG };

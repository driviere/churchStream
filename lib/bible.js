'use strict';
// Bible lookup. Translations are stored as gzipped JSON:
//   { id, name, abbrev, books: [ /* 66 books */ [ /* chapters */ [ "verse 1", "verse 2", … ] ] ] }
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Canonical book names + common abbreviations (lower-case, no spaces/dots).
const BOOKS = [
  ['Genesis', 'gen ge gn'], ['Exodus', 'ex exo exod'], ['Leviticus', 'lev le lv'], ['Numbers', 'num nu nm nb'],
  ['Deuteronomy', 'deut deu dt de'], ['Joshua', 'josh jos jsh'], ['Judges', 'judg jdg jg jdgs'], ['Ruth', 'rth ru'],
  ['1 Samuel', '1sam 1sa 1s 1sm'], ['2 Samuel', '2sam 2sa 2s 2sm'], ['1 Kings', '1kgs 1ki 1k 1kin'], ['2 Kings', '2kgs 2ki 2k 2kin'],
  ['1 Chronicles', '1chr 1ch 1chron'], ['2 Chronicles', '2chr 2ch 2chron'], ['Ezra', 'ezr'], ['Nehemiah', 'neh ne'],
  ['Esther', 'esth est es'], ['Job', 'jb'], ['Psalms', 'ps psa psalm pss psm pslm'], ['Proverbs', 'prov pro prv pr'],
  ['Ecclesiastes', 'eccl ecc ec qoh eccles'], ['Song of Solomon', 'song sos so canticles songofsongs ss'], ['Isaiah', 'isa is'],
  ['Jeremiah', 'jer je jr'], ['Lamentations', 'lam la'], ['Ezekiel', 'ezek eze ezk'], ['Daniel', 'dan da dn'],
  ['Hosea', 'hos ho'], ['Joel', 'jl joe'], ['Amos', 'am amo'], ['Obadiah', 'obad ob oba'], ['Jonah', 'jnh jon'],
  ['Micah', 'mic mc'], ['Nahum', 'nah na'], ['Habakkuk', 'hab hb'], ['Zephaniah', 'zeph zep zp'], ['Haggai', 'hag hg'],
  ['Zechariah', 'zech zec zc'], ['Malachi', 'mal ml'], ['Matthew', 'matt mt mat'], ['Mark', 'mrk mk mr mar'],
  ['Luke', 'luk lk lu'], ['John', 'jn jhn joh'], ['Acts', 'act ac'], ['Romans', 'rom ro rm'],
  ['1 Corinthians', '1cor 1co'], ['2 Corinthians', '2cor 2co'], ['Galatians', 'gal ga'], ['Ephesians', 'eph ephes'],
  ['Philippians', 'phil php pp'], ['Colossians', 'col co'], ['1 Thessalonians', '1thess 1th 1thes'], ['2 Thessalonians', '2thess 2th 2thes'],
  ['1 Timothy', '1tim 1ti 1tm'], ['2 Timothy', '2tim 2ti 2tm'], ['Titus', 'tit ti'], ['Philemon', 'philem phm pm'],
  ['Hebrews', 'heb'], ['James', 'jas jm jam'], ['1 Peter', '1pet 1pe 1pt 1p'], ['2 Peter', '2pet 2pe 2pt 2p'],
  ['1 John', '1jn 1jo 1joh 1jhn'], ['2 John', '2jn 2jo 2joh 2jhn'], ['3 John', '3jn 3jo 3joh 3jhn'], ['Jude', 'jud jd'],
  ['Revelation', 'rev re rv revelations apocalypse'],
].map(([name, ab], index) => ({ index, name, keys: [name.toLowerCase().replace(/\s+/g, ''), ...ab.split(' ')] }));

function normBook(s) {
  return String(s).toLowerCase()
    .replace(/^(iii|3rd|third)\s*/, '3').replace(/^(ii|2nd|second)\s*/, '2').replace(/^(i|1st|first)\s+/, '1')
    .replace(/[\s.]+/g, '');
}

function findBooks(input) {
  const n = normBook(input);
  if (!n) return [];
  const exact = BOOKS.filter((b) => b.keys.includes(n));
  if (exact.length) return exact;
  return BOOKS.filter((b) => b.keys[0].startsWith(n));
}

// "John 3:16", "jn 3:16-18", "Ps 23", "1 Cor 13:4-7", "Rom 8:28-9:2", "Genesis 1.1"
const REF_RE = /^\s*((?:[123]|i{1,3})?\s*[a-z][a-z.\s]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?)?\s*$/i;

function parseReference(input) {
  const m = String(input || '').match(REF_RE);
  if (!m) return null;
  const books = findBooks(m[1]);
  if (!books.length) return null;
  const book = books[0];
  const chapter = parseInt(m[2], 10);
  let verseStart = m[3] ? parseInt(m[3], 10) : null;
  let endChapter = chapter;
  let verseEnd = verseStart;
  if (m[4] && m[5]) { endChapter = parseInt(m[4], 10); verseEnd = parseInt(m[5], 10); }
  else if (m[4]) verseEnd = parseInt(m[4], 10);
  if (verseStart && verseEnd < verseStart && endChapter === chapter) [verseStart, verseEnd] = [verseEnd, verseStart];
  return { book: book.index, bookName: book.name, chapter, verseStart, endChapter, verseEnd };
}

function formatRef(bookName, c1, v1, c2, v2) {
  if (bookName === 'Psalms' && c1 === c2) bookName = 'Psalm';
  if (!v1) return `${bookName} ${c1}`;
  if (c1 !== c2) return `${bookName} ${c1}:${v1}–${c2}:${v2}`;
  return v1 === v2 ? `${bookName} ${c1}:${v1}` : `${bookName} ${c1}:${v1}–${v2}`;
}

const MAX_SLIDE_CHARS = 320;

class Bible {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
  }

  list() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => /\.json(\.gz)?$/.test(f)); } catch { /* none */ }
    return files.map((f) => {
      const t = this.load(f.replace(/\.json(\.gz)?$/, ''));
      return t ? { id: t.id, name: t.name, abbrev: t.abbrev, complete: t.books.filter((b) => b && b.length).length === 66, imported: t.source === 'import' } : null;
    }).filter(Boolean).sort((a, b) => a.abbrev.localeCompare(b.abbrev));
  }

  load(id) {
    id = String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (this.cache.has(id)) return this.cache.get(id);
    for (const f of [id + '.json.gz', id + '.json']) {
      const p = path.join(this.dir, f);
      if (!fs.existsSync(p)) continue;
      let buf = fs.readFileSync(p);
      if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
      const t = JSON.parse(buf.toString('utf8'));
      t.id = id;
      this.cache.set(id, t);
      return t;
    }
    return null;
  }

  // Returns { ref, translation, slides: [{ text, ref, verses:[{n,text}] }] } or { error }.
  lookup(reference, translationId) {
    const r = parseReference(reference);
    if (!r) return { error: 'Type a reference like “John 3:16” or “Ps 23”.' };
    const t = this.load(translationId) || this.load(this.list()[0] && this.list()[0].id);
    if (!t) return { error: 'No Bible installed. Add one in Settings → Bible.' };
    const book = t.books[r.book];
    if (!book || !book.length) return { error: `${r.bookName} is not in ${t.abbrev}.` };
    if (!book[r.chapter - 1]) return { error: `${r.bookName} has ${book.length} chapters.` };
    const verses = [];
    const endC = Math.min(r.endChapter, book.length);
    for (let c = r.chapter; c <= endC; c++) {
      const ch = book[c - 1] || [];
      const from = c === r.chapter && r.verseStart ? r.verseStart : 1;
      const to = c === endC && r.verseEnd ? Math.min(r.verseEnd, ch.length) : ch.length;
      for (let v = from; v <= to; v++) if (ch[v - 1]) verses.push({ c, n: v, text: ch[v - 1] });
    }
    if (!verses.length) return { error: `${formatRef(r.bookName, r.chapter, r.verseStart, r.endChapter, r.verseEnd)} was not found.` };
    const first = verses[0];
    const last = verses[verses.length - 1];
    const fullRef = formatRef(r.bookName, first.c, r.verseStart ? first.n : null, last.c, last.n);
    // Group short verses together so the screen isn't flipping every few seconds.
    const slides = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const a = cur[0];
      const b = cur[cur.length - 1];
      slides.push({
        text: cur.map((v) => v.text).join(' '),
        ref: `${formatRef(r.bookName, a.c, a.n, b.c, b.n)} ${t.abbrev}`,
        verses: cur.map((v) => ({ n: v.n, text: v.text })),
      });
      cur = [];
    };
    for (const v of verses) {
      const len = cur.reduce((s, x) => s + x.text.length + 1, 0);
      if (cur.length && (len + v.text.length > MAX_SLIDE_CHARS || cur[0].c !== v.c)) flush();
      cur.push(v);
    }
    flush();
    return { ref: `${fullRef} (${t.abbrev})`, title: fullRef, translation: t.abbrev, slides };
  }

  // Omnibox suggestions while typing a book name.
  suggest(input) {
    const m = String(input).match(/^\s*((?:[123]\s*)?[a-z][a-z.\s]*)$/i);
    if (!m || normBook(m[1]).length < 2) return [];
    return findBooks(m[1]).slice(0, 4).map((b) => b.name);
  }
}

module.exports = { Bible, BOOKS, parseReference, findBooks, formatRef };

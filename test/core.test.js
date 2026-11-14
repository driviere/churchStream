'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseReference, Bible } = require('../lib/bible');
const { parseSong, serializeSong, toSlides, SongLibrary } = require('../lib/songs');
const { wrap, captionText, Overlay } = require('../lib/overlay');
const { parseChMarkdown, sdahRowToSong } = require('../lib/importers/hymnals');
const { convert, parseBibleFile } = require('../lib/importers/bible');
const { parseDshowDevices } = require('../lib/ffmpeg');
const { readZip } = require('../lib/unzip');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));

test('Bible references', () => {
  const r = parseReference('John 3:16');
  assert.equal(r.bookName, 'John'); assert.equal(r.chapter, 3); assert.equal(r.verseStart, 16); assert.equal(r.verseEnd, 16);
  assert.equal(parseReference('jn 3:16-18').verseEnd, 18);
  assert.equal(parseReference('Ps 23').bookName, 'Psalms');
  assert.equal(parseReference('Ps 23').verseStart, null);
  assert.equal(parseReference('1 Cor 13:4-7').bookName, '1 Corinthians');
  assert.equal(parseReference('i john 1:9').bookName, '1 John');
  assert.equal(parseReference('Song of Solomon 2:4').bookName, 'Song of Solomon');
  assert.equal(parseReference('Gen 1.1').verseStart, 1);
  const x = parseReference('Rom 8:28-9:2');
  assert.deepEqual([x.chapter, x.verseStart, x.endChapter, x.verseEnd], [8, 28, 9, 2]);
  assert.equal(parseReference('amazing grace'), null);
  assert.equal(parseReference('100'), null);
  assert.equal(parseReference('hymn 100'), null);
});

test('Bible lookup on the bundled KJV', () => {
  const b = new Bible(path.join(__dirname, '..', 'defaults', 'bible'));
  const r = b.lookup('John 3:16', 'kjv');
  assert.match(r.slides[0].text, /^For God so loved the world/);
  assert.equal(r.slides[0].ref, 'John 3:16 KJV');
  assert.equal(b.lookup('Psalm 23', 'kjv').title, 'Psalm 23');
  assert.ok(b.lookup('Jude 99:1', 'kjv').error);
  assert.ok(b.lookup('John 3:16', 'bsb').slides[0].text.includes('one and only Son'));
  // grouping keeps slides short
  for (const s of b.lookup('Romans 8', 'kjv').slides) assert.ok(s.text.length < 700);
});

test('Bible conversion from scrollmapper and array formats', () => {
  const books = Array.from({ length: 66 }, (_, i) => ({ name: 'B' + i, chapters: [{ chapter: 1, verses: [{ verse: 1, text: ' In  the beginning ' }, { verse: 2, text: 'x' }] }] }));
  const out = convert({ translation: 'Test', books }, { abbrev: 'T' });
  assert.equal(out.books.length, 66);
  assert.equal(out.books[0][0][0], 'In the beginning');
  const arr = convert(Array.from({ length: 66 }, () => ({ chapters: [['a', 'b']] })), { name: 'A', abbrev: 'A' });
  assert.equal(arr.books[65][0][1], 'b');
  assert.throws(() => convert({ books: [] }));
});

test('song text format round-trips', () => {
  const text = 'Title: Test Song\nHymnal: SDAH\nNumber: 12\n\n[Verse 1]\nLine one\nLine two\n\n[Chorus]\nSing it\n';
  const s = parseSong(text, 'x');
  assert.equal(s.title, 'Test Song'); assert.equal(s.number, 12); assert.equal(s.hymnal, 'SDAH');
  assert.deepEqual(s.sections.map((x) => x.label), ['Verse 1', 'Chorus']);
  assert.equal(parseSong(serializeSong(s)).sections[1].text, 'Sing it');
  // pasted lyrics without labels
  const p = parseSong('First slide\nmore\n\n\nSecond slide');
  assert.equal(p.sections.length, 2);
  assert.equal(p.title, 'First slide');
  // very long sections are split
  const long = parseSong('[V]\n' + Array.from({ length: 12 }, (_, i) => 'line ' + i).join('\n'));
  assert.equal(toSlides(long).length, 2);
});

test('song library search: titles, lyrics and hymn numbers', () => {
  const dir = tmp();
  const lib = new SongLibrary(dir);
  lib.save({ title: 'Great Is Thy Faithfulness', hymnal: 'SDAH', number: 100, lyrics: 'Great is Thy faithfulness, O God my Father' });
  lib.save({ title: 'To Us a Child of Hope Is Born', hymnal: 'CH1941', number: 100, lyrics: 'To us a Child of hope is born' });
  lib.save({ title: 'Amazing Grace', lyrics: 'Amazing grace! How sweet the sound' });
  assert.equal(lib.search('100')[0].hymnal, 'SDAH');
  assert.equal(lib.search('100', { defaultHymnal: 'CH1941' })[0].hymnal, 'CH1941');
  assert.equal(lib.search('ch 100').length, 1);
  assert.equal(lib.search('sdah 100')[0].title, 'Great Is Thy Faithfulness');
  assert.equal(lib.search('#100').length, 2);
  assert.equal(lib.search('amazing')[0].title, 'Amazing Grace');
  assert.equal(lib.search('sweet sound')[0].title, 'Amazing Grace');
  const reloaded = new SongLibrary(dir);
  assert.equal(reloaded.counts().total, 3);
  assert.equal(reloaded.byNumber('CH1941', 100).title, 'To Us a Child of Hope Is Born');
});

test('SDA Hymnal rows become songs with refrains after each verse', () => {
  const s = sdahRowToSong({ number: 100, title: 'Great Is Thy Faithfulness', refrain: 'R', refrain2: null, verse1: 'A', verse2: 'B', verse3: null });
  assert.deepEqual(s.sections.map((x) => x.text), ['A', 'R', 'B', 'R']);
  const h140 = sdahRowToSong({ number: 140, title: 'T', refrain: 'R1', refrain2: 'R2', verse1: 'A', verse2: 'B' });
  assert.deepEqual(h140.sections.map((x) => x.text), ['A', 'R1', 'B', 'R2']);
  const h121 = sdahRowToSong({ number: 121, title: 'Go Tell', refrain: 'R', verse1: 'A' });
  assert.deepEqual(h121.sections.map((x) => x.text), ['R', 'A', 'R']);
});

test('Church Hymnal (1941) markdown parsing', () => {
  const s = parseChMarkdown(fs.readFileSync(path.join(__dirname, 'fixtures', 'ch1941-266.md'), 'utf8'));
  assert.equal(s.number, 266);
  assert.equal(s.title, 'I Will Follow Thee');
  assert.equal(s.author, 'James Lawson');
  assert.equal(s.sections[0].label, 'Verse 1');
  assert.equal(s.sections[1].label, 'Refrain');
  assert.ok(!s.sections.some((x) => /Major Key|CHORUS/i.test(x.text)));
  const c = parseChMarkdown(fs.readFileSync(path.join(__dirname, 'fixtures', 'ch1941-003.md'), 'utf8'));
  assert.equal(c.number, 3);
  assert.equal(c.sections.length, 3);
  assert.ok(c.sections[0].text.startsWith('Come, Thou almighty King'));
});

test('caption wrapping for the stream', () => {
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
  const t = captionText({ text: 'For God so loved the world, that he gave his only begotten Son', ref: 'John 3:16 KJV' }, { maxChars: 30 });
  assert.ok(t.split('\n').every((l) => l.length <= 30));
  assert.ok(t.endsWith('— John 3:16 KJV'));
  const long = captionText({ text: 'word '.repeat(200) }, { maxChars: 20, maxLines: 3 });
  assert.equal(long.split('\n').length, 3);
  assert.ok(long.endsWith('…'));
  assert.equal(captionText(null), '');
});

test('overlay files are written atomically and start empty', () => {
  const dir = tmp();
  const o = new Overlay(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8'), '');
  o.setLowerThird('Jane Doe', 'Elder');
  assert.equal(fs.readFileSync(path.join(dir, 'lt_name.txt'), 'utf8').trim(), 'Jane Doe');
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')));
});

test('DirectShow device list parsing (old and new FFmpeg output)', () => {
  const old = `[dshow @ 0000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0000]  "HD Pro Webcam C920"
[dshow @ 0000]     Alternative name "@device_pnp_\\\\?\\usb"
[dshow @ 0000] DirectShow audio devices
[dshow @ 0000]  "Microphone (HD Pro Webcam C920)"
[dshow @ 0000]  "Line In (Realtek Audio)"`;
  assert.deepEqual(parseDshowDevices(old), { video: ['HD Pro Webcam C920'], audio: ['Microphone (HD Pro Webcam C920)', 'Line In (Realtek Audio)'] });
  const neu = `[in#0 @ 0000] "USB Video" (video)
[in#0 @ 0000]   Alternative name "@device_pnp_x"
[in#0 @ 0000] "Digital Audio Interface (USB Capture)" (audio)`;
  assert.deepEqual(parseDshowDevices(neu), { video: ['USB Video'], audio: ['Digital Audio Interface (USB Capture)'] });
});

test('zip reader handles stored and deflated entries', () => {
  // Build a tiny zip by hand with one deflated file.
  const zlib = require('zlib');
  const name = Buffer.from('repo-master/a/docs.md');
  const data = Buffer.from('hello hymn'.repeat(5));
  const comp = zlib.deflateRawSync(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, name, comp]);
  const centralPart = Buffer.concat([central, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  const entries = readZip(Buffer.concat([localPart, centralPart, end]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].read().toString(), data.toString());
});

test('sunset and Sabbath times', () => {
  const { sunset, sabbathInfo, fillTokens } = require('../lib/sun');
  // Washington, DC: compare with the UTC sunset times (8:37 pm EDT = 00:37 UTC next day, 4:49 pm EST = 21:49 UTC).
  const june = new Date(sunset(new Date(Date.UTC(2026, 5, 21, 16)), 38.9072, -77.0369));
  const dec = new Date(sunset(new Date(Date.UTC(2026, 11, 21, 17)), 38.9072, -77.0369));
  const minutesUtc = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
  assert.ok(Math.abs(minutesUtc(june) - (24 * 60 + 37) % 1440) <= 3, 'June sunset ' + june.toISOString());
  assert.ok(Math.abs(minutesUtc(dec) - (21 * 60 + 49)) <= 3, 'December sunset ' + dec.toISOString());
  assert.equal(sunset(new Date(Date.UTC(2026, 5, 21, 12)), 80, 0), null); // midnight sun
  assert.equal(sabbathInfo(NaN, NaN), null);
  const info = sabbathInfo(-1.2921, 36.8219, new Date(2026, 10, 4, 10)); // a Wednesday
  assert.ok(info.tokens['sabbath-begins'].length > 4 && !info.isSabbath);
  assert.match(fillTokens('Ends at {sabbath-ends}', info), /^Ends at .+\d/);
  assert.match(fillTokens('{sunset}', null), /Settings/);
  // Always a 12-hour clock, even on PCs set to 24-hour time.
  assert.match(info.tokens.sunset, /^(1[0-2]|[1-9]):[0-5]\d (am|pm)$/);
  assert.match(info.label, /\d:\d\d (am|pm)$/);
});

test('YouTube links', () => {
  const { parseYouTube, clean } = require('../lib/youtube');
  assert.deepEqual(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', list: '', start: 0 });
  assert.deepEqual(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=90'), { id: 'dQw4w9WgXcQ', list: '', start: 90 });
  assert.deepEqual(parseYouTube('youtube.com/shorts/dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', list: '', start: 0 });
  assert.equal(parseYouTube('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s').start, 65);
  assert.deepEqual(parseYouTube('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), { id: '', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', start: 0 });
  assert.equal(parseYouTube('dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://vimeo.com/123'), null);
  assert.equal(parseYouTube('https://www.youtube.com/@church'), null);
  assert.deepEqual(clean({ id: 'bad id!', list: '<x>', start: -4 }), { id: '', list: '', start: 0 });
});

test('service files: zip round trip', () => {
  const { writeZip } = require('../lib/zip');
  const { readZip } = require('../lib/unzip');
  const big = Buffer.from('Holy, holy, holy! '.repeat(200));
  const pic = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  const zip = writeZip([{ name: 'service.json', data: big }, { name: 'media/slide-1.jpg', data: pic }]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['service.json', 'media/slide-1.jpg']);
  assert.ok(entries[0].read().equals(big));
  assert.ok(entries[1].read().equals(pic));
  assert.ok(zip.length < big.length); // text is compressed
});

// Importing a Bible file (Settings → Bible). Small generated fixtures, one verse per book.
const OSIS_BOOKS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];
const USFM_BOOKS = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];
const verseFor = (i) => (i === 42 ? 'For God so loved the world' : `Verse of book ${i + 1}`);

test('Import a Bible file: Zefania XML', () => {
  const xml = `<?xml version="1.0"?><XMLBIBLE biblename="Test"><INFORMATION><title>Test Revised Version</title><identifier>TRV</identifier></INFORMATION>` +
    OSIS_BOOKS.map((b, i) => `<BIBLEBOOK bnumber="${i + 1}"><CHAPTER cnumber="3"><VERS vnumber="16">${verseFor(i)}<NOTE>a footnote</NOTE> &amp; more</VERS></CHAPTER></BIBLEBOOK>`).join('') + '</XMLBIBLE>';
  const r = parseBibleFile(Buffer.from(xml));
  assert.equal(r.name, 'Test Revised Version'); assert.equal(r.abbrev, 'TRV'); assert.equal(r.booksWithText, 66);
  assert.equal(r.books[42][2][15], 'For God so loved the world & more');
  assert.equal(r.books[42][2][0], ''); // verses before are empty, not holes
});

test('Import a Bible file: OSIS XML (container and milestone verses)', () => {
  const container = `<osis><osisText osisIDWork="NTV"><header><work osisWork="NTV"><title>New Test Version</title></work></header>` +
    OSIS_BOOKS.map((b, i) => `<div type="book" osisID="${b}"><chapter osisID="${b}.3"><verse osisID="${b}.3.16">${verseFor(i)}<note type="x">see 1:1</note></verse></chapter></div>`).join('') + '</osisText></osis>';
  const a = parseBibleFile(container);
  assert.equal(a.name, 'New Test Version'); assert.equal(a.abbrev, 'NTV'); assert.equal(a.booksWithText, 66);
  assert.equal(a.books[42][2][15], 'For God so loved the world');
  const milestone = '<osis><osisText osisIDWork="MS">' +
    OSIS_BOOKS.map((b, i) => `<chapter sID="${b}.3" osisID="${b}.3"/><verse sID="${b}.3.16" osisID="${b}.3.16"/>${verseFor(i)}, <w lemma="x">that</w> he gave<verse eID="${b}.3.16"/><chapter eID="${b}.3"/>`).join('') + '</osisText></osis>';
  const m = parseBibleFile(milestone);
  assert.equal(m.booksWithText, 66);
  assert.equal(m.books[42][2][15], 'For God so loved the world, that he gave');
});

test('Import a Bible file: USFX XML, JSON, New Testament only, refusals', () => {
  const usfx = '<usfx>' + USFM_BOOKS.map((b, i) => `<book id="${b}"><c id="3"/><p><v id="16"/>${verseFor(i)}<f>note</f><ve/></p><v id="17"/>Next verse<ve/></book>`).join('') + '</usfx>';
  const u = parseBibleFile(usfx);
  assert.equal(u.booksWithText, 66);
  assert.equal(u.books[42][2][15], 'For God so loved the world');
  assert.equal(u.books[42][2][16], 'Next verse');

  // scrollmapper-style JSON
  const json = { translation: 'JSON Test', abbrev: 'JT', books: OSIS_BOOKS.map((b, i) => ({ name: b, chapters: [{ chapter: 1, verses: [{ verse: 1, text: verseFor(i) }] }] })) };
  const j = parseBibleFile(JSON.stringify(json));
  assert.equal(j.booksWithText, 66); assert.equal(j.abbrev, 'JT'); assert.equal(j.name, 'JSON Test');

  // The New Testament alone is accepted.
  const nt = '<usfx>' + USFM_BOOKS.slice(39).map((b, i) => `<book id="${b}"><c id="1"/><v id="1"/>${verseFor(i + 39)}<ve/></book>`).join('') + '</usfx>';
  assert.equal(parseBibleFile(nt).booksWithText, 27);
  // A few books are not enough.
  const few = '<usfx>' + USFM_BOOKS.slice(0, 5).map((b) => `<book id="${b}"><c id="1"/><v id="1"/>x<ve/></book>`).join('') + '</usfx>';
  assert.throws(() => parseBibleFile(few), /Only 5 books/);
  assert.throws(() => parseBibleFile('<html><body>hello</body></html>'), /isn’t a Bible/);
  assert.throws(() => parseBibleFile('{"songs": []}'), /isn’t a Bible/);
  assert.throws(() => parseBibleFile('{ broken'), /could not be read/);
  assert.throws(() => parseBibleFile('<XMLBIBLE></XMLBIBLE>'), /No Bible verses/);
});

// Importing songs (Settings → Hymnals & songs → Import songs…) and AY Sing numbers.
test('Import songs: numbered songbook listing, verse numbers are not song numbers', () => {
  const { parseSongFile } = require('../lib/importers/songs');
  const txt = [
    '1. HE IS LORD', '', '1. He is Lord, He is Lord,', 'He is risen from the dead', '', '2. Every knee shall bow,', 'every tongue confess', '', 'Chorus', 'That Jesus Christ is Lord.', '',
    '2 Give Me Oil in My Lamp', '', 'Give me oil in my lamp,', 'keep me burning', '',
    '3', 'Into My Heart', '', '1', 'Into my heart, into my heart,', '', '2', 'Out of my heart', '',
  ].join('\n');
  const r = parseSongFile('ay.txt', Buffer.from(txt));
  assert.deepEqual(r.songs.map((x) => [x.number, x.title]), [[1, 'He Is Lord'], [2, 'Give Me Oil in My Lamp'], [3, 'Into My Heart']]);
  assert.equal(require('../lib/importers/songs').titleCase('HE’S COMING SOON'), 'He’s Coming Soon');
  assert.deepEqual(r.songs[0].sections.map((x) => x.label), ['Verse 1', 'Verse 2', 'Chorus']);
  assert.equal(r.songs[0].sections[0].text, 'He is Lord, He is Lord,\nHe is risen from the dead');
  assert.deepEqual(r.songs[2].sections.map((x) => x.label), ['Verse 1', 'Verse 2']);
  const { wordsToSections } = require('../lib/importers/songs');
  assert.deepEqual(wordsToSections(['3.', '', 'By the crystal flowing river,', '', 'Chorus:', '', 'All that thrills']),
    [{ label: 'Verse 3', text: 'By the crystal flowing river,' }, { label: 'Chorus', text: 'All that thrills' }]);
});

test('Import songs: SongSelect, ChordPro, OpenLyrics, CSV, Word, refusals', () => {
  const { parseSongFile } = require('../lib/importers/songs');
  const { writeZip } = require('../lib/zip');
  const ss = parseSongFile('w.txt', Buffer.from('Way Maker\n\nVerse 1\nYou are here\n\nChorus\nWay maker\n\nCCLI Song # 7115744\nOsinachi Kalu\n© 2016 Integrity\nFor use solely with the SongSelect® Terms of Use.\nCCLI License # 123')).songs[0];
  assert.deepEqual([ss.title, ss.ccli, ss.author, ss.copyright, ss.sections.length], ['Way Maker', '7115744', 'Osinachi Kalu', '© 2016 Integrity', 2]);
  const cp = parseSongFile('a.cho', Buffer.from('{title: Amazing}\n{artist: Newton}\n[G]Amazing [C]grace\nhow sweet\n\n{soc}\n[D]Chorus line\n{eoc}')).songs[0];
  assert.equal(cp.title, 'Amazing'); assert.equal(cp.sections[0].text, 'Amazing grace\nhow sweet'); assert.equal(cp.sections[1].label, 'Chorus');
  const ol = parseSongFile('o.xml', Buffer.from('<?xml version="1.0"?><song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>Test OL</title></titles></properties><lyrics><verse name="v1"><lines>Line one<br/>Line two</lines></verse><verse name="c"><lines>Chorus here</lines></verse></lyrics></song>')).songs[0];
  assert.deepEqual(ol.sections, [{ label: 'Verse 1', text: 'Line one\nLine two' }, { label: 'Chorus', text: 'Chorus here' }]);
  const csv = parseSongFile('c.csv', Buffer.from('Number,Title,Lyrics\n5,Jesus Loves Me,"Jesus loves me\nthis I know"\n')).songs;
  assert.deepEqual([csv[0].number, csv[0].title, csv[0].sections[0].text], [5, 'Jesus Loves Me', 'Jesus loves me\nthis I know']);
  const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const docXml = '<w:document><w:body>' + ['1. Song One', '', 'Words of one', '', '2. Song Two', '', 'Words of two'].map(para).join('') + '</w:body></w:document>';
  const docx = writeZip([{ name: 'word/document.xml', data: Buffer.from(docXml) }]);
  assert.deepEqual(parseSongFile('ay.docx', docx).songs.map((x) => [x.number, x.title, x.sections[0].text]), [[1, 'Song One', 'Words of one'], [2, 'Song Two', 'Words of two']]);
  assert.throws(() => parseSongFile('ay.pdf', Buffer.from('%PDF-1.4 ...')), /PDF/);
  assert.throws(() => parseSongFile('x.xml', Buffer.from('<?xml version="1.0"?><note>hi</note>')), /OpenLyrics/);
  assert.throws(() => parseSongFile('x.txt', Buffer.from('\n\n')), /No song words/);
});

test('Import songs: .churchsongs round trip and AY numbers', () => {
  const { parseSongFile, writeChurchSongs } = require('../lib/importers/songs');
  const lib = new SongLibrary(tmp());
  lib.save({ title: 'He Is Lord', hymnal: 'AY', number: 25, lyrics: '[Chorus]\nHe is Lord' });
  lib.save({ title: 'Give Me Oil', hymnal: 'AY', number: 2, lyrics: 'Give me oil in my lamp' });
  assert.equal(lib.search('ay 25')[0].title, 'He Is Lord');
  assert.equal(lib.search('AY Sing 2')[0].title, 'Give Me Oil');
  assert.equal(lib.search('25', { defaultHymnal: 'AY' })[0].title, 'He Is Lord');
  assert.deepEqual(lib.list('AY').map((x) => x.number), [2, 25]);
  const file = writeChurchSongs(lib.list('AY'), { code: 'AY', name: 'Advent Youth Sing' });
  const r = parseSongFile('Advent Youth Sing.churchsongs', file);
  assert.deepEqual(r.book, { code: 'AY', name: 'Advent Youth Sing' });
  assert.deepEqual(r.songs.map((x) => [x.hymnal, x.number, x.title]), [['AY', 2, 'Give Me Oil'], ['AY', 25, 'He Is Lord']]);
  assert.equal(r.songs[1].sections[0].label, 'Chorus');
});

// PowerPoint → PDF with the office software on the computer.
test('PowerPoint files: converters and scripts', () => {
  const office = require('../lib/office');
  assert.equal(office.converters('win32')[0].id, 'powerpoint');
  assert.deepEqual(office.converters('darwin').slice(0, 2).map((c) => c.id), ['powerpoint', 'keynote']);
  // Paths are passed as environment variables (Windows) or arguments (Mac), never inside the script.
  const win = office.converters('win32')[0];
  assert.ok(!win.args('C:\\x\\in.pptx', 'C:\\x\\out.pdf').join(' ').includes('in.pptx'));
  assert.deepEqual(win.env('a', 'b'), { CS_IN: 'a', CS_OUT: 'b' });
  assert.deepEqual(office.converters('darwin')[0].args('/i.pptx', '/o.pdf').slice(-2), ['/i.pptx', '/o.pdf']);
  assert.match(office.PS_POWERPOINT, /SaveAs\(\$env:CS_OUT, 32\)/);
});

test('PowerPoint files: refusals and a LibreOffice conversion', { timeout: 200000 }, async (t) => {
  const office = require('../lib/office');
  await assert.rejects(office.presentationToPdf(Buffer.from('x'), 'notes.docx', { list: [] }), /PowerPoint file/);
  await assert.rejects(office.presentationToPdf(Buffer.from('x'), 'a.pptx', { list: [] }), /Save As → PDF/);
  const failing = [{ id: 'x', name: 'PowerPoint', cmd: process.execPath, args: () => ['-e', 'process.exit(3)'] }];
  await assert.rejects(office.presentationToPdf(Buffer.from('x'), 'a.pptx', { list: failing, tmpDir: tmp() }), /tried PowerPoint/);
  const lo = office.converters(process.platform).find((c) => c.id === 'libreoffice');
  if (!lo) { t.skip('LibreOffice is not installed'); return; }
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'three-slides.pptx'));
  const r = await office.presentationToPdf(buf, 'Sermon.pptx', { list: [lo], tmpDir: tmp() });
  assert.equal(r.via, 'LibreOffice');
  assert.equal(r.pdf.slice(0, 5).toString(), '%PDF-');
  assert.equal((r.pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 3);
});

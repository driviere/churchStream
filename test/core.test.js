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
const { convert } = require('../lib/importers/bible');
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

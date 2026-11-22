'use strict';
// ChurchStream's icon files (made by scripts/make-icons.js from the church's design).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { writeIco, SIZES, ICO_SIZES } = require('../scripts/make-icons');

const DIR = path.join(__dirname, '..', 'assets', 'icon');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('icons: a PNG for every size, and an .ico holding the Windows sizes', () => {
  for (const s of SIZES) {
    const png = fs.readFileSync(path.join(DIR, 'png', `icon_${s}.png`));
    assert.ok(png.subarray(0, 8).equals(PNG), `icon_${s}.png is a PNG`);
    assert.equal(png.readUInt32BE(16), s, `icon_${s}.png is ${s} px wide`);
  }
  const ico = fs.readFileSync(path.join(DIR, 'churchstream.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'an icon');
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  ICO_SIZES.forEach((s, i) => {
    const e = 6 + 16 * i;
    assert.equal(ico.readUInt8(e) || 256, s);
    const size = ico.readUInt32LE(e + 8);
    const at = ico.readUInt32LE(e + 12);
    assert.ok(ico.subarray(at, at + 8).equals(PNG), `${s} px entry holds a PNG`);
    assert.ok(at + size <= ico.length);
  });
});

test('icons: the .ico writer', () => {
  const ico = writeIco([{ size: 16, data: Buffer.concat([PNG, Buffer.alloc(4)]) }, { size: 256, data: Buffer.concat([PNG, Buffer.alloc(8)]) }]);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(6 + 16), 0, '256 is written as 0');
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 32);
  assert.equal(ico.length, 6 + 32 + 12 + 16);
});

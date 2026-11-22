#!/usr/bin/env node
'use strict';
// Makes ChurchStream's program icons from the SVGs in assets/icon/ (the church's design):
//   assets/icon/png/icon_<size>.png   16 … 1024 (the Mac app's icon is made from these)
//   assets/icon/churchstream.ico      for ChurchStream.exe, the installer and its shortcuts
// Each size uses the drawing made for it: churchstream-16.svg (simplified), -32.svg (bolder
// lines, up to 48 px), -rounded.svg (64 px and up).
//
// Needs Playwright's Chromium (a development tool, not part of ChurchStream):
//   node scripts/make-icons.js
// The results are committed, so building ChurchStream doesn't need it.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'icon');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function svgFor(size) {
  if (size <= 16) return fs.readFileSync(path.join(DIR, 'churchstream-16.svg'), 'utf8');
  if (size <= 48) return fs.readFileSync(path.join(DIR, 'churchstream-32.svg'), 'utf8');
  const svg = fs.readFileSync(path.join(DIR, 'churchstream-rounded.svg'), 'utf8');
  return size <= 64 ? svg.replace('stroke-width="9"', 'stroke-width="11"').replace(/H161\.5/g, 'H162.5') : svg;
}

// A Windows .ico holding PNG images (Windows Vista and later read these).
function writeIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); // no palette
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  fs.mkdirSync(path.join(DIR, 'png'), { recursive: true });
  const out = {};
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svgFor(size)).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.waitForFunction(() => document.images[0].complete);
    out[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(DIR, 'png', `icon_${size}.png`), out[size]);
  }
  await browser.close();
  fs.writeFileSync(path.join(DIR, 'churchstream.ico'), writeIco(ICO_SIZES.map((size) => ({ size, data: out[size] }))));
  console.log(`✓ ${SIZES.length} PNGs and churchstream.ico in ${path.relative(process.cwd(), DIR)}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { writeIco, SIZES, ICO_SIZES };

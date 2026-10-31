#!/usr/bin/env node
'use strict';
// Build the Bibles bundled with ChurchStream (public domain) into defaults/bible/,
// or convert your own file:
//   node scripts/fetch-bible.js                 → downloads KJV + BSB into defaults/bible
//   node scripts/fetch-bible.js asv ylt         → other catalogue translations
//   node scripts/fetch-bible.js --file my.json --id niv --name "My Bible" --abbrev MB
const path = require('path');
const fs = require('fs');
const { convert, writeTranslation, downloadTranslation, CATALOG } = require('../lib/importers/bible');

const out = path.join(__dirname, '..', 'defaults', 'bible');

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  if (fi >= 0) {
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    const json = JSON.parse(fs.readFileSync(args[fi + 1], 'utf8').replace(/^﻿/, ''));
    const id = (opt('--id') || 'custom').toLowerCase();
    const file = writeTranslation(opt('--out') || out, id, convert(json, { name: opt('--name'), abbrev: opt('--abbrev') }));
    console.log('Wrote', file);
    return;
  }
  const ids = args.length ? args : ['kjv', 'bsb'];
  for (const id of ids) {
    if (!CATALOG[id]) { console.error(`Unknown: ${id}. Available: ${Object.keys(CATALOG).join(', ')}`); process.exitCode = 1; continue; }
    const r = await downloadTranslation(id, out, { onProgress: console.log });
    console.log(`✓ ${r.name}`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });

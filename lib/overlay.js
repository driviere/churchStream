'use strict';
// Stream overlays. FFmpeg's drawtext filter re-reads these small text files every frame
// (reload=1), so changing a lower third or caption never restarts the stream and costs
// almost nothing. Files are replaced atomically so FFmpeg never sees a half-written file.
const fs = require('fs');
const path = require('path');

const FILES = { ltName: 'lt_name.txt', ltTitle: 'lt_title.txt', caption: 'caption.txt', ticker: 'ticker.txt' };

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, typeof text === 'string' ? 'utf8' : undefined);
  // On Windows the rename can fail for a moment while FFmpeg has the file open.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (err) {
      if (i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      sleepSync(5);
    }
  }
}

// Greedy word wrap. drawtext cannot wrap by itself.
function wrap(text, maxChars) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

// Turn a slide into on-stream caption text that fits the frame.
function captionText(slide, { maxChars = 60, maxLines = 5 } = {}) {
  if (!slide || !slide.text) return '';
  let lines = wrap(slide.text, maxChars);
  // Song lines are usually short; if a verse has many, join pairs to save height.
  if (lines.length > maxLines) lines = wrap(slide.text.replace(/\r?\n/g, ' '), maxChars);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:]*$/, '') + '…';
  }
  if (slide.ref) lines.push('— ' + slide.ref);
  return lines.join('\n');
}

class Overlay {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.files = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, path.join(dir, f)]));
    this.clearAll();
  }
  write(key, text) { atomicWrite(this.files[key], text || ''); }
  setLowerThird(name, title) { this.write('ltName', name ? ' ' + name + ' ' : ''); this.write('ltTitle', title ? ' ' + title + ' ' : ''); }
  setCaption(text) { this.write('caption', text); }
  setTicker(text) { this.write('ticker', text ? String(text).replace(/\s+/g, ' ').trim() + '     ' : ''); }
  clearAll() { for (const k of Object.keys(FILES)) this.write(k, ''); }
}

module.exports = { Overlay, FILES, wrap, captionText, atomicWrite };

'use strict';
// Words that won't fit on one screen at the smallest text size continue on the next slide.
//
// The screens shrink text to fit (public/shared.js fitText), down to the "Smallest text size"
// chosen in Settings → Appearance. Here, on the server, we estimate whether a slide still fits
// at that size, and if not split it, so the projector, stage screen, phone remote, stream and
// Next all see the same slides. The estimate follows the projector's layout (public/shared.css):
// a 16:9 screen, the text box inside its padding, line height 1.28, and an average letter
// width a little wider than real text, so a slide that "fits" here really fits.

const DEFAULT_MIN = 3.2; // cqh (percent of screen height), the screens' long-standing minimum
const LETTER = 0.56;      // average letter width as a fraction of the font size (Inter, semibold)
const LINE = 1.28;

function capacity(theme = {}) {
  const min = Math.max(2.5, Math.min(9, Number(theme.minText) || DEFAULT_MIN));
  const W = 177.78; // 16:9, in cqh
  const bottom = theme.position === 'bottom';
  const boxW = bottom ? W * 0.9 : W * 0.88;
  const boxH = bottom ? 34 : 83;
  return { lines: Math.max(1, Math.floor(boxH / (min * LINE))), chars: Math.max(8, Math.floor(boxW / (min * LETTER))) };
}

// How many screen lines a piece of text takes when wrapped at `chars` letters per line.
function wrappedLines(text, chars) {
  let n = 0;
  for (const line of String(text).split('\n')) {
    let len = 0;
    let rows = 1;
    for (const w of line.split(/\s+/).filter(Boolean)) {
      const add = (len ? 1 : 0) + w.length;
      if (len + add > chars && len) { rows++; len = w.length; } else len += add;
      while (len > chars) { rows++; len -= chars; } // one very long word
    }
    n += rows;
  }
  return n;
}

function slideLines(slide, cap, joinVerses) {
  const text = joinVerses && slide.verses && slide.verses.length > 1
    ? slide.verses.map((v) => `${v.n}  ${v.text}`).join(' ') // verse numbers take a little room
    : slide.text;
  return wrappedLines(joinVerses ? String(text).replace(/\n/g, ' ') : text, cap.chars) + (slide.part ? 1 : 0);
}

// A single long line or verse → pieces that each fit, split at sentence ends, then commas,
// then words.
function splitText(text, cap, room) {
  const fitsIn = (t) => wrappedLines(t, cap.chars) <= room;
  const pieces = [];
  let rest = String(text).trim();
  while (rest && !fitsIn(rest)) {
    const words = rest.split(/\s+/);
    // The most words that fit…
    let lo = 1;
    let hi = words.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fitsIn(words.slice(0, mid).join(' '))) lo = mid; else hi = mid - 1; }
    // …then step back to a sentence end or a comma when one is near.
    let cut = lo;
    for (const re of [/[.!?;:]["”’)]*$/, /[,—–]$/]) {
      const at = words.slice(0, lo).findLastIndex((w, i) => i >= Math.floor(lo * 0.5) && re.test(w));
      if (at >= 0) { cut = at + 1; break; }
    }
    pieces.push(words.slice(0, cut).join(' '));
    rest = words.slice(cut).join(' ');
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// "John 3:16-18 KJV" for the verses of one part (simple single-chapter references only).
function partRef(ref, verses) {
  const m = /^(.*\d+:)(\d+)(?:([-–])(\d+))?(\s.*)?$/.exec(String(ref || ''));
  if (!m || !verses.length) return ref;
  const a = verses[0].n;
  const b = verses[verses.length - 1].n;
  return `${m[1]}${a === b ? a : `${a}${m[3] || '–'}${b}`}${m[5] || ''}`;
}

const numbered = (label, i, k) => (k > 1 ? `${label ? label + ' ' : ''}(${i + 1}/${k})` : label);

// One slide → the slides it needs. Each part remembers which slide it came from (orig).
function splitSlide(slide, cap, isBible) {
  if (!slide || slide.image || !slide.text || slideLines(slide, cap, isBible) <= cap.lines) return [slide];
  const room = cap.lines - (slide.part ? 1 : 0);
  let parts = [];
  if (isBible && slide.verses && slide.verses.length > 1) {
    // Whole verses together where they fit; a verse that is too long on its own is split.
    let cur = [];
    const flush = () => { if (cur.length) parts.push({ verses: cur }); cur = []; };
    for (const v of slide.verses) {
      const one = wrappedLines(`${v.n}  ${v.text}`, cap.chars);
      if (one > room) {
        flush();
        splitText(v.text, cap, room).forEach((t) => parts.push({ verses: [{ n: v.n, text: t }] }));
        continue;
      }
      const next = [...cur, v];
      if (wrappedLines(next.map((x) => `${x.n}  ${x.text}`).join(' '), cap.chars) > room) { flush(); cur = [v]; } else cur = next;
    }
    flush();
    return parts.map((p, i) => ({
      ...slide, verses: p.verses, text: p.verses.map((v) => v.text).join(' '),
      ref: partRef(slide.ref, p.verses), label: numbered(slide.label, i, parts.length),
    }));
  }
  // Lines (songs, typed text): whole lines together; a line too long on its own is split.
  const lines = String(slide.text).split('\n').flatMap((l) => (wrappedLines(l, cap.chars) > room ? splitText(l, cap, room) : [l]));
  const total = lines.reduce((n, l) => n + wrappedLines(l, cap.chars), 0);
  const fill = (limit) => {
    const out = [];
    let cur = [];
    let used = 0;
    for (const l of lines) {
      const n = wrappedLines(l, cap.chars);
      if (cur.length && used + n > limit) { out.push(cur); cur = []; used = 0; }
      cur.push(l); used += n;
    }
    if (cur.length) out.push(cur);
    return out;
  };
  parts = fill(room);
  // Even the parts out (3 + 3 lines rather than 5 + 1) when that needs no extra slide.
  const even = fill(Math.ceil(total / parts.length));
  if (even.length === parts.length) parts = even;
  return parts.map((p, i) => ({ ...slide, text: p.join('\n'), label: numbered(slide.label, i, parts.length) }));
}

// Slides → slides that fit. Returns the new slides and, for each, the index it came from.
function fitSlides(slides, { kind, theme } = {}) {
  if (!Array.isArray(slides) || (theme && theme.overflow === false) || ['images', 'media', 'countdown'].includes(kind)) return { slides, orig: (slides || []).map((_, i) => i) };
  const cap = capacity(theme);
  const out = [];
  const orig = [];
  slides.forEach((sl, i) => { for (const p of splitSlide(sl, cap, kind === 'bible')) { out.push(p); orig.push(i); } });
  return { slides: out, orig };
}

module.exports = { fitSlides, capacity, wrappedLines, splitText, partRef, DEFAULT_MIN };

#!/usr/bin/env node
'use strict';
// Generates ChurchStream's built-in projector backgrounds as small SVG files in
// public/backgrounds/. They are drawn in code (no photos), so they are ours to ship,
// tiny, sharp at any resolution, and dark enough for white lyrics to stay readable.
//   node scripts/make-backgrounds.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'backgrounds');
const W = 1920;
const H = 1080;

// Small deterministic random generator so the files never change between runs.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const f = (n) => Math.round(n * 10) / 10;

const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>${defs}</defs>
${body}
</svg>
`;
const linear = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const radial = (id, stops, cx = 0.5, cy = 0.5, r = 0.7) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const vignette = `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
const vigDef = radial('vig', [[0.55, '#000', 0], [1, '#000', 0.55]], 0.5, 0.5, 0.75);

// A soft hill / mountain ridge as a path along the bottom.
function ridge(r, baseY, amp, steps, color, opacity = 1) {
  let d = `M0 ${H} L0 ${f(baseY)}`;
  for (let i = 1; i <= steps; i++) {
    const x = (W / steps) * i;
    const y = baseY - amp * (0.3 + r() * 0.7) * (i % 2 ? 1 : 0.45);
    d += ` L${f(x)} ${f(y)}`;
  }
  return `<path d="${d} L${W} ${H} Z" fill="${color}" opacity="${opacity}"/>`;
}
function wave(baseY, amp, len, phase, color, opacity) {
  let d = `M0 ${H} L0 ${baseY}`;
  for (let x = 0; x <= W + len; x += len) {
    d += ` Q${f(x + len / 4)} ${f(baseY - amp * Math.sin(phase))} ${f(x + len / 2)} ${baseY} T${f(x + len)} ${baseY}`;
  }
  return `<path d="${d} L${W + len} ${H} Z" fill="${color}" opacity="${opacity}"/>`;
}

const BACKGROUNDS = [
  ['midnight', 'Midnight', () => svg(radial('g', [[0, '#1b2440'], [0.55, '#0b0f1a'], [1, '#05070c']], 0.5, 0, 1.1), `<rect width="${W}" height="${H}" fill="url(#g)"/>`)],

  ['black', 'Plain black', () => svg('', `<rect width="${W}" height="${H}" fill="#000"/>`)],

  ['slate', 'Slate', () => svg(radial('g', [[0, '#2b2f36'], [1, '#0d0f12']], 0.5, 0.45, 0.9) + vigDef, `<rect width="${W}" height="${H}" fill="url(#g)"/>${vignette}`)],

  ['ocean', 'Deep ocean', () => svg(linear('g', [[0, '#04152b'], [0.6, '#0a2a4a'], [1, '#0e3d5e']]) + vigDef,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>${wave(820, 40, 480, 1, '#0f4c6e', 0.55)}${wave(900, 34, 360, 2, '#12597c', 0.5)}${wave(980, 26, 300, 3, '#0b3550', 0.9)}${vignette}`)],

  ['sunrise', 'Sunrise', () => svg(linear('g', [[0, '#1d1033'], [0.55, '#5a2a4f'], [0.85, '#a64b3c'], [1, '#d9823b']]) + radial('sun', [[0, '#ffd08a', 0.85], [0.35, '#ff9f5a', 0.35], [1, '#ff9f5a', 0]], 0.5, 1, 0.55) + vigDef,
    `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#sun)"/>${ridge(rng(3), 1000, 70, 14, '#1a0d1f', 0.9)}<rect width="${W}" height="${H}" fill="#000" opacity="0.22"/>${vignette}`)],

  ['mountains', 'Mountains at dusk', () => {
    const r = rng(7);
    return svg(linear('g', [[0, '#0b1426'], [0.6, '#1f3352'], [1, '#3c5677']]) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/>${ridge(r, 760, 260, 9, '#2b4060', 0.8)}${ridge(r, 860, 220, 12, '#1d2d46', 0.95)}${ridge(r, 960, 160, 16, '#111b2c', 1)}${vignette}`);
  }],

  ['forest', 'Forest evening', () => {
    const r = rng(11);
    return svg(linear('g', [[0, '#0a1712'], [0.7, '#183528'], [1, '#24493a']]) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/>${ridge(r, 860, 120, 30, '#14301f', 0.9)}${ridge(r, 950, 100, 40, '#0c2016', 1)}${vignette}`);
  }],

  ['stars', 'Starry night', () => {
    const r = rng(42);
    let dots = '';
    for (let i = 0; i < 260; i++) {
      const rad = r() < 0.92 ? 0.8 + r() * 1.4 : 2 + r() * 1.6;
      dots += `<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.85)}" r="${f(rad)}" fill="#fff" opacity="${f(0.25 + r() * 0.6)}"/>`;
    }
    return svg(linear('g', [[0, '#03050d'], [0.7, '#0b1430'], [1, '#18234a']]) + radial('glow', [[0, '#3b4f9a', 0.35], [1, '#3b4f9a', 0]], 0.7, 0.3, 0.6) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>${dots}${vignette}`);
  }],

  ['bokeh', 'Golden lights', () => {
    const r = rng(5);
    let c = '';
    for (let i = 0; i < 38; i++) {
      const rad = 40 + r() * 120;
      c += `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(rad)}" fill="${r() < 0.7 ? '#e0a64a' : '#f3d39a'}" opacity="${f(0.06 + r() * 0.16)}" filter="url(#b)"/>`;
    }
    return svg(radial('g', [[0, '#2a1d10'], [1, '#0c0805']], 0.5, 0.5, 0.9) + blur('b', 18) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/>${c}${vignette}`);
  }],

  ['rays', 'Light from above', () => {
    let rays = '';
    const angles = [-28, -17, -8, 0, 9, 19, 30];
    angles.forEach((a, i) => {
      rays += `<polygon points="960,-80 ${960 - 120 - i * 10},1200 ${960 + 120 + i * 10},1200" fill="#fff" opacity="${0.035 + (i % 2) * 0.02}" transform="rotate(${a} 960 -80)" filter="url(#b)"/>`;
    });
    return svg(linear('g', [[0, '#1c2a44'], [1, '#070a12']]) + radial('top', [[0, '#9fb9ff', 0.35], [1, '#9fb9ff', 0]], 0.5, 0, 0.6) + blur('b', 22) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#top)"/>${rays}${vignette}`);
  }],

  ['purple', 'Worship purple', () => svg(linear('g', [[0, '#1a0b2e'], [0.6, '#2d1250'], [1, '#12061f']], 1, 1) + blur('b', 90) + vigDef,
    `<rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="420" cy="300" r="320" fill="#7a2fd0" opacity="0.35" filter="url(#b)"/><circle cx="1500" cy="780" r="380" fill="#c2367a" opacity="0.28" filter="url(#b)"/><circle cx="1150" cy="220" r="220" fill="#3d5bd6" opacity="0.25" filter="url(#b)"/>${vignette}`)],

  ['teal', 'Calm teal', () => svg(linear('g', [[0, '#04201f'], [1, '#0b3b3a']], 1, 1) + vigDef,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>${wave(700, 60, 900, 1, '#0f4d4a', 0.35)}${wave(820, 50, 700, 2, '#126058', 0.3)}${wave(940, 40, 560, 3, '#083330', 0.8)}${vignette}`)],

  ['cross', 'Cross at dawn', () => svg(linear('g', [[0, '#14182e'], [0.6, '#3a3352'], [0.85, '#8a5a5a'], [1, '#c48a5c']]) + radial('glow', [[0, '#ffd9a0', 0.55], [1, '#ffd9a0', 0]], 0.5, 0.88, 0.45) + vigDef,
    `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#glow)"/><path d="M0 ${H} L0 1000 Q 960 880 ${W} 1000 L${W} ${H} Z" fill="#120d16"/><rect x="947" y="720" width="26" height="230" fill="#120d16"/><rect x="895" y="776" width="130" height="22" fill="#120d16"/><rect width="${W}" height="${H}" fill="#000" opacity="0.18"/>${vignette}`)],

  ['wood', 'Warm wood', () => {
    const r = rng(19);
    let grain = '';
    for (let i = 0; i < 70; i++) {
      const y = r() * H;
      grain += `<path d="M0 ${f(y)} C ${f(W * 0.3)} ${f(y + (r() - 0.5) * 40)}, ${f(W * 0.7)} ${f(y + (r() - 0.5) * 40)}, ${W} ${f(y + (r() - 0.5) * 30)}" stroke="#000" stroke-width="${f(1 + r() * 3)}" fill="none" opacity="${f(0.06 + r() * 0.1)}"/>`;
    }
    return svg(linear('g', [[0, '#3b2414'], [1, '#22140a']], 1, 0) + vigDef,
      `<rect width="${W}" height="${H}" fill="url(#g)"/>${grain}<rect width="${W}" height="${H}" fill="#000" opacity="0.35"/>${vignette}`);
  }],

  ['paper', 'Soft cream (dark text)', () => svg(radial('g', [[0, '#f6f0e3'], [1, '#e3d8c3']], 0.5, 0.4, 0.9), `<rect width="${W}" height="${H}" fill="url(#g)"/>`)],
];

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const [id, name, make] of BACKGROUNDS) {
  fs.writeFileSync(path.join(OUT, id + '.svg'), make());
  index.push({ id, name, light: id === 'paper' });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`Wrote ${index.length} backgrounds to ${path.relative(process.cwd(), OUT)}`);

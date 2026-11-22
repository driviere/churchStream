'use strict';
// The studio picture, built inside the one FFmpeg process:
//
//   sources (cameras 1–4, slides, media, black) ─┬─ bus A: 4 layer slots ─┐
//                                                ├─ bus B: 4 layer slots ─┼─ transitions ─ dip ─▶ program
//                                                └─ multiview             └─ preview feed (the off-air bus)
//
// A slot is streamselect (which source) → crop → scale → overlay (+ an optional border), and
// every one of those takes live commands, so a scene is loaded onto a bus without restarting.
// The off-air bus is the Preview: a scene is loaded there (invisible to viewers), then a cut or
// a transition puts it on air. Transitions are switched on only while they run (blend/overlay
// `enable`), so at rest they cost almost nothing. Commands go through FFmpeg's zmq filter
// (lib/zmq.js), which applies them on the next frame. Pure functions: easy to test.
const { zmqFilter } = require('./zmq');

const SLOTS = 4;
const CAMERA_KEYS = ['video', 'video2', 'video3', 'video4'];
const MAX_CAMERAS = 4;
const even = (n) => 2 * Math.round(n / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// --- cameras and sources -------------------------------------------------------------------
function cameraUsable(v) {
  return !!v && ((v.type === 'dshow' && !!v.device) || (v.type === 'rtsp' && !!v.rtspUrl) || v.type === 'testsrc' || v.type === 'phone');
}
// Camera 1 is always there (a test pattern when nothing is chosen); cameras 2–4 when set up.
function cameraNumbers(cfg) {
  const out = [1];
  for (let n = 2; n <= MAX_CAMERAS; n++) if (cameraUsable(cfg[CAMERA_KEYS[n - 1]])) out.push(n);
  return out;
}
function cameraName(cfg, n) {
  const v = cfg[CAMERA_KEYS[n - 1]] || {};
  return String(v.name || '').trim() || `Camera ${n}`;
}
// The sources a scene can use, in graph order (black is always last and not listed here).
function sourceIds(cfg, { media = true } = {}) {
  return [...cameraNumbers(cfg).map((n) => `cam${n}`), 'slides', ...(media ? ['media'] : [])];
}
function sourceName(cfg, id) {
  if (/^cam\d$/.test(id)) return cameraName(cfg, Number(id.slice(3)));
  return { slides: 'Slides', media: 'Video', black: 'Black' }[id] || id;
}

// --- scenes -----------------------------------------------------------------------------------
// A scene is layers (back to front), each a source at a position given as fractions of the
// frame: { source, x, y, w, h, crop: { l, t, r, b }, border }.
const full = (source) => ({ source, x: 0, y: 0, w: 1, h: 1 });
// The corner inset of "Slides + camera" (same place as before the studio).
const inset = (source) => ({ source, x: 0.671, y: 0.652, w: 0.3, h: 0.3, border: true });

function builtinScenes(cfg) {
  const cams = cameraNumbers(cfg);
  const list = cams.map((n) => ({ id: `cam${n}`, name: cameraName(cfg, n), group: 'Cameras', builtin: true, layers: [full(`cam${n}`)] }));
  list.push({ id: 'slides', name: 'Slides', group: 'Slides', builtin: true, layers: [full('slides')] });
  list.push({ id: 'pip', name: 'Slides + camera', group: 'Slides', builtin: true, layers: [full('slides'), inset('cam1')] });
  if (cams.length >= 2) {
    list.push({ id: 'side', name: 'Side by side', group: 'Cameras', builtin: true,
      layers: [{ source: 'cam1', x: 0, y: 0.25, w: 0.5, h: 0.5 }, { source: `cam${cams[1]}`, x: 0.5, y: 0.25, w: 0.5, h: 0.5 }] });
  }
  return list;
}

function cleanLayer(l) {
  if (!l || typeof l !== 'object' || !l.source) return null;
  const w = clamp(num(l.w, 1), 0.02, 1);
  const h = clamp(num(l.h, 1), 0.02, 1);
  const c = l.crop || {};
  const crop = { l: clamp(num(c.l, 0), 0, 0.45), t: clamp(num(c.t, 0), 0, 0.45), r: clamp(num(c.r, 0), 0, 0.45), b: clamp(num(c.b, 0), 0, 0.45) };
  return { source: String(l.source), x: clamp(num(l.x, 0), -1, 1), y: clamp(num(l.y, 0), -1, 1), w, h, crop, border: !!l.border };
}

// A saved scene from the stream page (keeps only what the studio understands).
function cleanScene(s, i = 0) {
  if (!s || typeof s !== 'object') return null;
  const id = String(s.id || `scene${Date.now().toString(36)}${i}`).replace(/[^\w-]/g, '').slice(0, 40) || `scene${i}`;
  return {
    id, name: String(s.name || 'Scene').slice(0, 60), group: String(s.group || '').slice(0, 40),
    layers: (Array.isArray(s.layers) ? s.layers : []).map(cleanLayer).filter(Boolean).slice(0, SLOTS),
    audio: s.audio && typeof s.audio === 'object' ? s.audio : undefined,
  };
}

function allScenes(cfg) {
  const mine = (Array.isArray(cfg.scenes) ? cfg.scenes : []).map(cleanScene).filter(Boolean);
  const builtins = builtinScenes(cfg).filter((b) => !mine.some((m) => m.id === b.id));
  return [...builtins, ...mine];
}
function findScene(cfg, id) { return allScenes(cfg).find((s) => s.id === id) || null; }

// The control panel's simple choices as a scene: Camera 1/2 and "Stream shows".
function simpleScene(cfg, view, camera = 1) {
  const cam = cameraNumbers(cfg).includes(camera) ? camera : 1;
  if (view === 'slides') return { id: 'slides', name: 'Slides', layers: [full('slides')] };
  if (view === 'pip') return { id: cam === 1 ? 'pip' : `pip${cam}`, name: 'Slides + camera', layers: [full('slides'), inset(`cam${cam}`)] };
  return { id: `cam${cam}`, name: cameraName(cfg, cam), layers: [full(`cam${cam}`)] };
}

// --- slots ------------------------------------------------------------------------------------
const borderWidth = (q) => Math.max(2, even(q.height * 0.004));

// The filter settings for one slot showing `layer` (or hidden when there is none).
function slotParams(layer, q, index) {
  const W = q.width;
  const H = q.height;
  const blackIdx = index.black;
  const hidden = { on: 0, map: blackIdx, crop: { w: 2, h: 2, x: 0, y: 0 }, scale: { w: 2, h: 2 }, pos: { x: W + 8, y: 0 }, box: { on: 0, x: W + 8, y: 0, w: 2, h: 2, t: 1 } };
  const src = layer ? index[layer.source] : undefined;
  if (!layer || src === undefined) return hidden;
  const c = layer.crop || {};
  const cl = num(c.l, 0);
  const ct = num(c.t, 0);
  const cw = Math.max(2, even(W * (1 - cl - num(c.r, 0))));
  const ch = Math.max(2, even(H * (1 - ct - num(c.b, 0))));
  const w = Math.max(2, even(layer.w * W));
  const h = Math.max(2, even(layer.h * H));
  const x = even(layer.x * W);
  const y = even(layer.y * H);
  const bt = layer.border ? borderWidth(q) : 0;
  return {
    on: 1,
    map: src,
    crop: { w: cw, h: ch, x: Math.min(even(W * cl), W - cw), y: Math.min(even(H * ct), H - ch) },
    scale: { w, h },
    pos: { x, y },
    box: bt ? { on: 1, x: x - bt, y: y - bt, w: w + 2 * bt, h: h + 2 * bt, t: bt } : hidden.box,
  };
}

// A scene as the bus builds it: a full-screen first layer is the background itself (no black
// underneath, nothing to copy); the other layers go into the overlay slots. Cheapest for the
// usual scenes (a camera, the slides, slides + camera).
const isFull = (l) => l && Math.abs(l.x) < 0.001 && Math.abs(l.y) < 0.001 && Math.abs(l.w - 1) < 0.001 && Math.abs(l.h - 1) < 0.001
  && !(l.crop && (l.crop.l || l.crop.t || l.crop.r || l.crop.b)) && !l.border;
function sceneParts(scene, index) {
  const layers = ((scene && scene.layers) || []).filter((l) => index[l.source] !== undefined);
  if (layers.length && isFull(layers[0])) return { bg: index[layers[0].source], over: layers.slice(1) };
  return { bg: index.black, over: layers };
}
// How many overlay slots the scenes need (each bus gets this many; 1 to 4).
function slotsNeeded(scenes, index) {
  let n = 1;
  for (const sc of scenes) if (sc) n = Math.max(n, sceneParts(sc, index).over.length);
  return Math.min(SLOTS, n);
}

// Index of each source in a slot's streamselect (black last).
function sourceIndex(ids) {
  const index = { black: ids.length };
  ids.forEach((id, i) => { index[id] = i; });
  return index;
}

const slotName = (bus, k) => ({
  select: `streamselect@${bus}${k}`, crop: `crop@${bus}c${k}`, scale: `scale@${bus}s${k}`, over: `overlay@${bus}o${k}`, box: `drawbox@${bus}b${k}`,
});

// Live commands that load `scene` onto bus 'a' or 'b' (which has `slots` overlay slots).
// An unused slot is switched off (enable 0): FFmpeg then passes the picture straight through.
function sceneCommands(scene, bus, q, index, slots = SLOTS) {
  const { bg, over } = sceneParts(scene, index);
  const out = [`streamselect@${bus}bg map ${bg}`];
  for (let k = 0; k < slots; k++) {
    const p = slotParams(over[k], q, index);
    const n = slotName(bus, k);
    if (!p.on) { out.push(`${n.over} enable 0`, `${n.box} enable 0`, `${n.select} map ${p.map}`, `${n.crop} w 2`, `${n.crop} h 2`, `${n.scale} w 2`, `${n.scale} h 2`); continue; }
    out.push(`${n.select} map ${p.map}`,
      `${n.crop} w ${p.crop.w}`, `${n.crop} h ${p.crop.h}`, `${n.crop} x ${p.crop.x}`, `${n.crop} y ${p.crop.y}`,
      `${n.scale} w ${p.scale.w}`, `${n.scale} h ${p.scale.h}`,
      `${n.over} x ${p.pos.x}`, `${n.over} y ${p.pos.y}`, `${n.over} enable 1`,
      `${n.box} x ${p.box.x}`, `${n.box} y ${p.box.y}`, `${n.box} w ${p.box.w}`, `${n.box} h ${p.box.h}`, `${n.box} t ${p.box.t}`, `${n.box} enable ${p.box.on}`);
  }
  return out;
}

// Inputs of the switches: out = what goes to air; base/next = which bus (2 = black, for `next`).
const OUT = { base: 0, mix: 1, tr: 2 };
const BUS = { a: 0, b: 1, black: 2 };

/**
 * The studio part of the filter graph.
 * sources: [{ id, label }] — each label an input pad like '[0:v]' (cameras, slides, media)
 * black:   the label of a black input at the stream size and frame rate
 * Returns { graph, program, preview, multiview, iso: { n: label }, tiles }.
 */
function studioGraph({ q, sources, black, sceneA, sceneB, live = 'a', zmqPort = null, preview = true, multiview = true, iso = [], slots = SLOTS }) {
  const W = q.width;
  const H = q.height;
  const F = q.fps;
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
  const ids = sources.map((s) => s.id);
  const index = sourceIndex(ids);
  const parts = [];
  const take = {}; // id → list of split labels still unused
  const use = (id) => take[id].shift();

  // Black: carries the command port, then feeds the bus backgrounds, hidden slots and the dip.
  const blackUses = 2 + 2 * slots + 1;
  const perSource = 2 + 2 * slots; // two backgrounds + the slots of both buses
  take.black = Array.from({ length: blackUses }, (_, j) => `[k${j}]`);
  // (`black` is an input label like '[5:v]', or null: then black is made inside the graph.)
  const blackSrc = black || `color=c=black:s=${W}x${H}:r=${F},`;
  parts.push(`${blackSrc}${zmqPort ? zmqFilter(zmqPort) + ',' : ''}format=yuv420p,split=${blackUses}${take.black.join('')}`);

  // Each source: fitted once, then shared by every slot (and the multiview / clean recording).
  const tiles = sources.filter((s) => s.id !== 'black').map((s) => s.id);
  sources.forEach((s, i) => {
    const isoN = /^cam\d$/.test(s.id) && iso.includes(Number(s.id.slice(3))) ? Number(s.id.slice(3)) : 0;
    const n = perSource + (multiview ? 1 : 0) + (isoN ? 1 : 0);
    take[s.id] = Array.from({ length: n }, (_, j) => `[s${i}_${j}]`);
    parts.push(`${s.label}${s.pre ? s.pre + ',' : ''}fps=${F},${fit},split=${n}${take[s.id].join('')}`);
  });

  // The two buses.
  const scenes = { a: sceneA, b: sceneB };
  for (const bus of ['a', 'b']) {
    const { bg, over } = sceneParts(scenes[bus], index);
    const all = () => [...ids.map((id) => use(id)), use('black')].join('');
    parts.push(`${all()}streamselect@${bus}bg=inputs=${ids.length + 1}:map=${bg}[${bus}bg]`);
    let prev = `[${bus}bg]`;
    for (let k = 0; k < slots; k++) {
      const p = slotParams(over[k], q, index);
      const n = slotName(bus, k);
      parts.push(`${all()}${n.select}=inputs=${ids.length + 1}:map=${p.map},${n.crop}=w=${p.crop.w}:h=${p.crop.h}:x=${p.crop.x}:y=${p.crop.y}:keep_aspect=0:exact=1,${n.scale}=w=${p.scale.w}:h=${p.scale.h}[${bus}l${k}]`);
      const next = k === slots - 1 ? `[bus${bus}]` : `[${bus}x${k}]`;
      parts.push(`${prev}[${bus}l${k}]${n.over}=x=${p.pos.x}:y=${p.pos.y}:eof_action=repeat:enable=${p.on},${n.box}=x=${p.box.x}:y=${p.box.y}:w=${p.box.w}:h=${p.box.h}:t=${p.box.t}:color=white:enable=${p.box.on}${next}`);
      prev = next;
    }
  }

  // Transitions. Two switches pick the pictures: `base` is what's on air, `next` what comes
  // (normally the other bus, so it is also the Preview; black for a dip). One fade (blend) and
  // one slide/wipe (overlay) work between them and are switched on only while they run. The
  // studio (lib/studio.js) changes a switch only while its picture isn't showing, so nothing
  // ever flashes on air.
  const pv = preview ? 1 : 0;
  const L = live === 'a' ? 0 : 1;
  parts.push(`[busa]split=2[ba][ia];[busb]split=2[bb][ib]`);
  parts.push(`[ba][bb]streamselect@base=inputs=2:map=${L},split=3[b1][b2][b3]`);
  parts.push(`[ia][ib]${use('black')}streamselect@next=inputs=3:map=${1 - L},split=${2 + pv}[n1][n2]${pv ? '[n3]' : ''}`);
  parts.push('[n1][b2]blend@mix=all_mode=normal:all_opacity=0:enable=0[mix]');
  parts.push(`[n2]crop@wipe=w=${W}:h=${H}:x=0:y=0:keep_aspect=0:exact=1[nc];[b3][nc]overlay@tr=x=${W + 8}:y=0:enable=0[tr]`);
  parts.push('[b1][mix][tr]streamselect@out=inputs=3:map=0[sprog]');
  if (pv) parts.push(`[n3]fps=10,scale=640:${even(640 * H / W)}[spv]`);

  // Multiview: every source small, 4 across, 5 times a second.
  let mvLabel = null;
  if (multiview && tiles.length) {
    const tw = 320;
    const th = even(tw * H / W);
    const cols = Math.min(4, tiles.length);
    const small = tiles.map((id, i) => { parts.push(`${use(id)}fps=5,scale=${tw}:${th},setsar=1[mv${i}]`); return `[mv${i}]`; });
    if (small.length === 1) {
      mvLabel = small[0];
    } else {
      const layout = small.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
      parts.push(`${small.join('')}xstack=inputs=${small.length}:layout=${layout}:fill=black[smv]`);
      mvLabel = '[smv]';
    }
  }

  // A clean copy of each camera for "record each camera on its own".
  const isoOut = {};
  for (const n of iso) {
    if (take[`cam${n}`]) { const l = use(`cam${n}`); parts.push(`${l}null[isoc${n}]`); isoOut[n] = `[isoc${n}]`; }
  }

  return {
    graph: parts.join(';'),
    program: '[sprog]',
    preview: pv ? '[spv]' : null,
    multiview: mvLabel,
    iso: isoOut,
    tiles,
    grid: { cols: Math.min(4, tiles.length || 1), rows: Math.ceil((tiles.length || 1) / 4) },
    index,
    slots,
  };
}

module.exports = {
  SLOTS, CAMERA_KEYS, MAX_CAMERAS, OUT, BUS,
  cameraUsable, cameraNumbers, cameraName, sourceIds, sourceName,
  builtinScenes, cleanScene, allScenes, findScene, simpleScene,
  slotParams, sourceIndex, sceneCommands, studioGraph, borderWidth, sceneParts, slotsNeeded,
};

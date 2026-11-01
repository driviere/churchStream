'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

// Everything the setup wizard can change. The user never has to edit this file by hand.
const DEFAULTS = {
  setupComplete: false,
  churchName: '',
  port: 8080,
  ffmpegPath: '',               // empty = auto (bundled ffmpeg\ffmpeg.exe, then PATH)
  video: {
    type: 'testsrc',            // 'dshow' (USB webcam / HDMI capture) | 'rtsp' (IP camera) | 'testsrc'
    device: '',                 // dshow video device name
    rtspUrl: '',
  },
  audio: {
    source: 'device',           // 'device' (dshow mic / capture audio) | 'camera' (RTSP audio) | 'none'
    device: '',                 // dshow audio device name
  },
  quality: 'good',              // 'good' 720p | 'low' 480p | 'high' 1080p
  encoder: 'auto',
  outputs: {
    youtube: { enabled: false, key: '' },
    facebook: { enabled: false, key: '' },
    custom: { enabled: false, url: '' },
  },
  record: false,
  streamCaptions: true,         // show lyrics/verses on the stream as well as the projector
  lowerThirdOnProjector: false, // also show names (lower thirds) on the projector screens
  streamScene: 'camera',        // what the stream shows: 'camera' | 'slides' | 'pip' | 'auto'
  tickerOnProjector: false,     // also scroll the ticker on the projector screens
  tickerSpeed: 'normal',        // 'slow' | 'normal' | 'fast'
  broadcastTitle: '{church} · Sabbath Service · {date}',
  mediaSound: 'direct',         // videos & music on the stream: 'direct' (mixed in) | 'desk' (comes back through the sound desk)
  musicVolume: 0.4,
  musicFiles: [],
  musicRoom: true,              // also play background music through this computer's speakers
  projector: { autoLaunch: false, x: null, y: null, monitor: '' },
  theme: { background: '', logo: '', textScale: 1 },
  uiTheme: 'light',             // control panel: 'light' | 'dark'
  bible: { translation: 'kjv' },
  hymnal: { default: 'SDAH' },
  lowerThirdPresets: [
    { name: 'Welcome', title: 'We are glad you are here' },
  ],
  controlPassword: '',
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

let current = null;

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(paths.configFile, 'utf8')); } catch { /* first run */ }
  current = merge(DEFAULTS, saved);
  return current;
}

function get() { return current || load(); }

function update(patch) {
  current = merge(get(), patch);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  const tmp = paths.configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
  fs.renameSync(tmp, paths.configFile);
  return current;
}

// Config safe to send to browsers: stream keys are masked.
function publicView(cfg = get()) {
  const mask = (s) => (s ? '••••' + String(s).slice(-4) : '');
  return {
    ...cfg,
    controlPassword: cfg.controlPassword ? '••••' : '',
    outputs: {
      youtube: { enabled: cfg.outputs.youtube.enabled, key: mask(cfg.outputs.youtube.key), hasKey: !!cfg.outputs.youtube.key },
      facebook: { enabled: cfg.outputs.facebook.enabled, key: mask(cfg.outputs.facebook.key), hasKey: !!cfg.outputs.facebook.key },
      custom: { enabled: cfg.outputs.custom.enabled, url: cfg.outputs.custom.url ? mask(cfg.outputs.custom.url) : '', hasKey: !!cfg.outputs.custom.url },
    },
  };
}

module.exports = { DEFAULTS, load, get, update, merge, publicView };

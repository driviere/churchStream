'use strict';
// Locate FFmpeg, read its version, pick the fastest working H.264 encoder and list
// capture devices. All slow probes are cached.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('./paths');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exe = isWin ? 'ffmpeg.exe' : 'ffmpeg';

function candidates(configured) {
  const list = [];
  if (configured) list.push(configured);
  list.push(path.join(paths.appRoot, 'ffmpeg', exe), path.join(paths.appRoot, 'ffmpeg', 'bin', exe), path.join(paths.appRoot, exe));
  if (isMac) list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'); // Homebrew
  list.push('ffmpeg');
  return list;
}

let found = null;

function locate(configured) {
  if (found && (!configured || found.path === configured)) return found;
  for (const p of candidates(configured)) {
    if (p !== 'ffmpeg' && !fs.existsSync(p)) continue;
    const r = spawnSync(p, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (r.status === 0 && /ffmpeg version/.test(r.stdout)) {
      const m = r.stdout.match(/ffmpeg version (?:n|N-)?(\d+)\.?(\d+)?/);
      found = { path: p, version: r.stdout.split('\n')[0], major: m ? Number(m[1]) : 0 };
      return found;
    }
  }
  return null;
}

function run(ffmpegPath, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

// Hardware encoders are tried first (Apple VideoToolbox on a Mac; Intel Quick Sync, NVIDIA,
// AMD on Windows), then x264.
const ENCODER_ORDER = isMac ? ['h264_videotoolbox', 'libx264'] : ['h264_qsv', 'h264_nvenc', 'h264_amf', 'libx264'];
const encoderCache = new Map();

async function detectEncoder(ffmpegPath) {
  if (encoderCache.has(ffmpegPath)) return encoderCache.get(ffmpegPath);
  const { encoderArgs } = require('./encoders');
  const test = { fps: 30, vbit: 1500 };
  let chosen = 'libx264';
  // Each encoder is tried with the exact settings the stream will use: the quality set first,
  // then the plainer one (some graphics drivers reject B-frames or look-ahead).
  outer: for (const enc of ENCODER_ORDER) {
    for (const variant of enc === 'libx264' ? [''] : ['', ':compat']) {
      const extra = enc === 'h264_qsv' ? ['-vf', 'format=nv12'] : [];
      const r = await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=1',
        ...extra, '-frames:v', '30', ...encoderArgs(enc + variant, test), '-f', 'null', '-'], 20000);
      if (r.code === 0) { chosen = enc + variant; break outer; }
    }
  }
  encoderCache.set(ffmpegPath, chosen);
  return chosen;
}

// Windows DirectShow devices: `ffmpeg -list_devices true -f dshow -i dummy`.
function parseDshowDevices(text) {
  const video = [];
  const audio = [];
  let section = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) { section = 'video'; continue; }
    if (/DirectShow audio devices/i.test(line)) { section = 'audio'; continue; }
    if (/Alternative name/i.test(line)) continue;
    const m = line.match(/\]\s+"(.+)"(?:\s+\((video|audio|none)\))?\s*$/);
    if (!m) continue;
    const kind = m[2] || section;
    if (kind === 'video' && !video.includes(m[1])) video.push(m[1]);
    else if (kind === 'audio' && !audio.includes(m[1])) audio.push(m[1]);
  }
  return { video, audio };
}

// macOS AVFoundation devices: `ffmpeg -f avfoundation -list_devices true -i ""`.
// Screen-capture entries are left out (a camera or capture card is what's wanted).
function parseAvfDevices(text) {
  const video = [];
  const audio = [];
  let section = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/AVFoundation video devices/i.test(line)) { section = 'video'; continue; }
    if (/AVFoundation audio devices/i.test(line)) { section = 'audio'; continue; }
    const m = line.match(/\]\s+\[(\d+)\]\s+(.+?)\s*$/);
    if (!m || !section) continue;
    if (section === 'video' && /^Capture screen/i.test(m[2])) continue;
    (section === 'video' ? video : audio).push(m[2]);
  }
  return { video, audio };
}

async function listDevices(ffmpegPath) {
  if (isMac) {
    const r = await run(ffmpegPath, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], 15000);
    const d = parseAvfDevices(r.out);
    if (!d.video.length && !d.audio.length) d.note = 'No camera or microphone was found. If macOS asked, allow Terminal to use the camera and microphone (System Settings → Privacy & Security), then press Refresh.';
    return d;
  }
  if (!isWin) return { video: [], audio: [], note: 'Device listing is available on Windows and macOS. Use an IP camera (RTSP) or the test pattern here.' };
  const r = await run(ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], 15000);
  return parseDshowDevices(r.out);
}

// macOS displays via JavaScript for Automation (no extra tools). Cocoa measures from the
// bottom-left of the main screen; browsers place windows from its top-left.
const JXA_SCREENS = `ObjC.import('AppKit'); var s = $.NSScreen.screens; var out = [];
for (var i = 0; i < s.count; i++) { var sc = s.objectAtIndex(i); var f = sc.frame; var n = '';
  try { n = sc.localizedName.js; } catch (e) {}
  out.push([n, f.origin.x, f.origin.y, f.size.width, f.size.height].join('|')); }
out.join('\\n');`;
function parseMacScreens(text) {
  const rows = String(text).split(/\r?\n/).filter(Boolean).map((l) => { const [name, x, y, w, h] = l.split('|'); return { name, x: +x, y: +y, w: +w, h: +h }; });
  if (!rows.length) return [];
  const mainH = rows[0].h;
  return rows.map((r, i) => ({ id: 'display-' + i, label: `${r.name || 'Display ' + (i + 1)}${i === 0 ? ' (main)' : ''} — ${r.w}×${r.h}`, primary: i === 0,
    x: Math.round(r.x), y: Math.round(mainH - (r.y + r.h)), width: Math.round(r.w), height: Math.round(r.h) }));
}

// Monitors (for placing the projector window): PowerShell on Windows, JXA on macOS.
async function listMonitors() {
  if (isMac) {
    return new Promise((resolve) => {
      const p = spawn('osascript', ['-l', 'JavaScript', '-e', JXA_SCREENS]);
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => resolve([]));
      p.on('close', () => resolve(parseMacScreens(out)));
    });
  }
  if (!isWin) return [];
  const ps = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "{0}|{1}|{2}|{3}|{4}|{5}" -f $_.DeviceName,$_.Primary,$_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height }';
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve([]));
    p.on('close', () => {
      resolve(out.split(/\r?\n/).filter(Boolean).map((l, i) => {
        const [name, primary, x, y, w, h] = l.trim().split('|');
        return { id: name, label: `Display ${i + 1}${primary === 'True' ? ' (main)' : ''} — ${w}×${h}`, primary: primary === 'True', x: +x, y: +y, width: +w, height: +h };
      }));
    });
  });
}

module.exports = { locate, detectEncoder, listDevices, listMonitors, parseDshowDevices, parseAvfDevices, parseMacScreens, run, ENCODER_ORDER };

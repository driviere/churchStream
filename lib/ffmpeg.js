'use strict';
// Locate FFmpeg, read its version, pick the fastest working H.264 encoder and list
// capture devices. All slow probes are cached.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('./paths');

const isWin = process.platform === 'win32';
const exe = isWin ? 'ffmpeg.exe' : 'ffmpeg';

function candidates(configured) {
  const list = [];
  if (configured) list.push(configured);
  list.push(path.join(paths.appRoot, 'ffmpeg', exe), path.join(paths.appRoot, 'ffmpeg', 'bin', exe), path.join(paths.appRoot, exe));
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

// Hardware encoders are tried first (Intel Quick Sync, NVIDIA, AMD), then x264.
const ENCODER_ORDER = ['h264_qsv', 'h264_nvenc', 'h264_amf', 'libx264'];
const encoderCache = new Map();

async function detectEncoder(ffmpegPath) {
  if (encoderCache.has(ffmpegPath)) return encoderCache.get(ffmpegPath);
  let chosen = 'libx264';
  for (const enc of ENCODER_ORDER) {
    const extra = enc === 'h264_qsv' ? ['-vf', 'format=nv12'] : [];
    const r = await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=0.5',
      ...extra, '-frames:v', '10', '-c:v', enc, '-f', 'null', '-'], 15000);
    if (r.code === 0) { chosen = enc; break; }
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

async function listDevices(ffmpegPath) {
  if (!isWin) return { video: [], audio: [], note: 'Device listing is available on Windows. Use an IP camera (RTSP) or the test pattern here.' };
  const r = await run(ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], 15000);
  return parseDshowDevices(r.out);
}

// Monitors (for placing the projector window). Windows only, via PowerShell.
async function listMonitors() {
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

module.exports = { locate, detectEncoder, listDevices, listMonitors, parseDshowDevices, run, ENCODER_ORDER };

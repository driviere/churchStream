'use strict';
// Opens the projector page full-screen (kiosk) on the chosen monitor using Microsoft Edge,
// which is already installed on every Windows PC. Falls back to Chrome / Chromium.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findBrowser() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const win = [];
  for (const base of pf) {
    win.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    win.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  const unix = ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return (process.platform === 'win32' ? win : unix).find((p) => fs.existsSync(p)) || null;
}

class Projector {
  constructor({ profileDir }) {
    this.profileDir = profileDir;
    this.proc = null;
  }

  get open() { return !!this.proc; }

  launch(url, monitor) {
    this.close();
    const browser = findBrowser();
    if (!browser) throw new Error('Microsoft Edge or Google Chrome was not found. Open the projector link manually.');
    const args = [
      `--user-data-dir=${this.profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
      '--autoplay-policy=no-user-gesture-required', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
    ];
    if (monitor && Number.isFinite(monitor.x)) args.push(`--window-position=${monitor.x},${monitor.y}`);
    if (/msedge/i.test(browser)) args.push('--edge-kiosk-type=fullscreen');
    args.push('--kiosk', url);
    this.proc = spawn(browser, args, { detached: false, stdio: 'ignore' });
    this.proc.on('exit', () => { this.proc = null; });
    this.proc.on('error', () => { this.proc = null; });
    return browser;
  }

  close() {
    if (this.proc) { try { this.proc.kill(); } catch { /* gone */ } this.proc = null; }
  }
}

module.exports = { Projector, findBrowser };

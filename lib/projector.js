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
  const home = process.env.HOME || '';
  const mac = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Chromium.app/Contents/MacOS/Chromium', 'Brave Browser.app/Contents/MacOS/Brave Browser']
    .flatMap((a) => ['/Applications/' + a, path.join(home, 'Applications', a)]);
  const unix = ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const list = process.platform === 'win32' ? win : process.platform === 'darwin' ? mac : unix;
  return list.find((p) => fs.existsSync(p)) || null;
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
    if (!browser && process.platform === 'darwin') {
      // No Chrome/Edge on this Mac: open the projector page in the default browser (Safari).
      spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
      return 'safari';
    }
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

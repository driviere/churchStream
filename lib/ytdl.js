'use strict';
// Optional: save a YouTube video (or just its sound) into the media library with the free
// tool yt-dlp, so it plays offline and goes into the live stream with sound.
// yt-dlp is fetched on first use (like the hymnals); nothing is bundled.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { download } = require('./importers/net');

const ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform] || 'yt-dlp';
const URL_LATEST = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;

class YtDownloader {
  constructor({ toolsDir }) {
    this.toolsDir = toolsDir;
    this.bin = path.join(toolsDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    this.proc = null;
    this.updated = false;
  }

  async ensure(onStatus) {
    if (fs.existsSync(this.bin) && fs.statSync(this.bin).size > 100000) return this.bin;
    onStatus && onStatus('Getting the YouTube downloader (yt-dlp, about 18 MB, first time only)…');
    fs.mkdirSync(this.toolsDir, { recursive: true });
    const buf = await download(URL_LATEST, { timeoutMs: 180000 });
    const tmp = this.bin + '.part';
    fs.writeFileSync(tmp, buf, { mode: 0o755 });
    fs.renameSync(tmp, this.bin);
    return this.bin;
  }

  run(args, onLine) {
    return new Promise((resolve) => {
      const p = spawn(this.bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc = p;
      let err = '';
      let buf = '';
      const feed = (d) => {
        buf += d;
        let i;
        while ((i = buf.search(/[\r\n]/)) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
      };
      p.stdout.on('data', feed);
      p.stderr.on('data', (d) => { err = (err + d).slice(-4000); feed(d); });
      p.on('error', (e) => { err += '\n' + e.message; });
      p.on('close', (code) => { if (this.proc === p) this.proc = null; resolve({ code, err }); });
    });
  }

  cancel() { if (this.proc) { try { this.proc.kill(); } catch { /* gone */ } } }

  // kind: 'video' (MP4 up to 1080p) or 'audio' (M4A). Returns { file, title, duration }.
  async fetch({ url, kind, ffmpegPath, outDir, base, onStatus, onProgress }) {
    await this.ensure(onStatus);
    const args = ['--no-playlist', '--newline', '--no-mtime', '--no-part', '--no-simulate',
      '--progress-template', 'download:PROG %(progress._percent_str)s',
      '--print', 'after_move:FILE %(filepath)s', '--print', 'after_move:TITLE %(title)s', '--print', 'after_move:DUR %(duration)s',
      '-o', path.join(outDir, base + '.%(ext)s')];
    if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
    if (kind === 'audio') args.push('-f', 'ba[ext=m4a]/ba', '-x', '--audio-format', 'm4a');
    else args.push('-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4');
    args.push('--', url);
    const attempt = async () => {
      const out = {};
      const r = await this.run(args, (line) => {
        let m;
        if ((m = line.match(/^PROG\s+([\d.]+)%/))) onProgress && onProgress(Number(m[1]) / 100);
        else if ((m = line.match(/^(FILE|TITLE|DUR) (.*)$/))) out[m[1]] = m[2];
      });
      return { ...r, out };
    };
    onStatus && onStatus('Downloading…');
    let r = await attempt();
    // YouTube changes often; an out-of-date yt-dlp is the usual cause of failures.
    if (r.code !== 0 && !this.updated && !/Private video|unavailable|copyright|Sign in|proxy|getaddrinfo|resolve|timed out|Connection|Network/i.test(r.err)) {
      this.updated = true;
      onStatus && onStatus('Updating the YouTube downloader…');
      await this.run(['-U'], () => {});
      onStatus && onStatus('Downloading…');
      r = await attempt();
    }
    if (r.code !== 0 || !r.out.FILE || !fs.existsSync(r.out.FILE)) {
      const line = (r.err.split('\n').reverse().find((l) => /ERROR/.test(l)) || r.err.trim().split('\n').pop() || '').replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, '');
      throw new Error(friendly(line) || 'The download failed.');
    }
    return { file: path.basename(r.out.FILE), title: r.out.TITLE || '', duration: Math.round(Number(r.out.DUR) || 0) };
  }
}

function friendly(msg) {
  if (/Private video/i.test(msg)) return 'This video is private.';
  if (/Sign in to confirm your age/i.test(msg)) return 'This video is age-restricted and can’t be downloaded.';
  if (/Sign in to confirm you.?re not a bot/i.test(msg)) return 'YouTube is asking this computer to sign in (bot check). Try again later, or play it from YouTube instead.';
  if (/unavailable/i.test(msg)) return 'This video is unavailable.';
  if (/getaddrinfo|resolve|Network|timed out|proxy|Unable to download|Connection (refused|reset|aborted)/i.test(msg)) return 'Could not reach YouTube. Check the internet connection.';
  return msg.slice(0, 300);
}

module.exports = { YtDownloader };

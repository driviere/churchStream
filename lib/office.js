'use strict';
// PowerPoint files → PDF, using the office software already on this computer, so slides look
// exactly as in PowerPoint. The control panel then turns the PDF into slide pictures, the same
// way as a PDF the user picks. Tried in order: PowerPoint (Windows/Mac), Keynote (Mac),
// LibreOffice. Paths go to the scripts as arguments/environment variables, never into the code.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTS = ['.pptx', '.ppt', '.ppsx', '.pps', '.pptm', '.odp', '.key'];
const TIMEOUT = 180000;

// Windows: PowerPoint through COM. 32 = ppSaveAsPDF. Opened read-only, without a window.
const PS_POWERPOINT = [
  '$ErrorActionPreference = "Stop"',
  '$pp = New-Object -ComObject PowerPoint.Application',
  '$p = $pp.Presentations.Open($env:CS_IN, -1, 0, 0)',
  'try { $p.SaveAs($env:CS_OUT, 32) } finally { $p.Close() }',
  'if ($pp.Presentations.Count -eq 0) { $pp.Quit() }',
].join('; ');

// Mac: PowerPoint, then Keynote (which also opens .pptx). Paths arrive as argv.
const AS_POWERPOINT = `on run argv
  set inF to POSIX file (item 1 of argv)
  set outF to POSIX file (item 2 of argv)
  tell application "Microsoft PowerPoint"
    open inF
    set p to active presentation
    save p in outF as save as PDF
    close p saving no
  end tell
end run`;
const AS_KEYNOTE = `on run argv
  set inF to POSIX file (item 1 of argv)
  set outF to POSIX file (item 2 of argv)
  tell application "Keynote"
    set d to open inF
    export d to outF as PDF
    close d saving no
  end tell
end run`;

function libreOfficePaths(platform = process.platform) {
  if (platform === 'win32') {
    return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
      .filter(Boolean).map((d) => path.join(d, 'LibreOffice', 'program', 'soffice.exe'));
  }
  if (platform === 'darwin') return ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
}

// The converters to try on this platform, in order.
function converters(platform = process.platform) {
  const list = [];
  if (platform === 'win32') list.push({ id: 'powerpoint', name: 'PowerPoint', cmd: 'powershell.exe', args: () => ['-NoProfile', '-NonInteractive', '-Command', PS_POWERPOINT], env: (i, o) => ({ CS_IN: i, CS_OUT: o }) });
  if (platform === 'darwin') {
    list.push({ id: 'powerpoint', name: 'PowerPoint', cmd: 'osascript', args: (i, o) => ['-e', AS_POWERPOINT, i, o], sandbox: true });
    list.push({ id: 'keynote', name: 'Keynote', cmd: 'osascript', args: (i, o) => ['-e', AS_KEYNOTE, i, o] });
  }
  const lo = libreOfficePaths(platform).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (lo) list.push({ id: 'libreoffice', name: 'LibreOffice', cmd: lo, args: (i, o) => ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', path.dirname(o), i], loOut: true });
  return list;
}

const run = (cmd, args, env) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: TIMEOUT, windowsHide: true, env: { ...process.env, ...env }, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.detail = String(stderr || stdout || '').trim().slice(0, 400); reject(err); } else resolve();
  });
});

// Mac PowerPoint is sandboxed: it can only read and write inside its own container.
function workDir(conv, base) {
  if (conv.sandbox) {
    const d = path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Powerpoint', 'Data', 'tmp', 'churchstream-' + crypto.randomBytes(4).toString('hex'));
    try { fs.mkdirSync(d, { recursive: true }); return d; } catch { /* fall through */ }
  }
  const d = path.join(base, 'office-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

let busy = false;
// buf + original file name → { pdf: Buffer, via: 'PowerPoint' | 'Keynote' | 'LibreOffice' }
async function presentationToPdf(buf, name, { tmpDir, list = converters() } = {}) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!EXTS.includes(ext)) throw new Error('Choose a PowerPoint file (.pptx or .ppt).');
  if (busy) throw new Error('Another presentation is being opened. Please wait a moment.');
  if (!list.length) throw new Error('PowerPoint couldn’t be found on this computer. In PowerPoint choose File → Save As → PDF, then pick the PDF here.');
  busy = true;
  const tried = [];
  try {
    for (const conv of list) {
      const dir = workDir(conv, tmpDir || os.tmpdir());
      const inFile = path.join(dir, 'slides' + ext);
      const outFile = path.join(dir, 'slides.pdf');
      try {
        fs.writeFileSync(inFile, buf);
        await run(conv.cmd, conv.args(inFile, outFile), conv.env ? conv.env(inFile, outFile) : {});
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return { pdf: fs.readFileSync(outFile), via: conv.name };
        tried.push(conv.name);
      } catch (err) {
        tried.push(conv.name + (err.killed ? ' (took too long)' : ''));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally { busy = false; }
  throw new Error(`The presentation couldn’t be opened (tried ${tried.join(', ')}). In PowerPoint choose File → Save As → PDF, then pick the PDF here.`);
}

module.exports = { presentationToPdf, converters, libreOfficePaths, EXTS, PS_POWERPOINT, AS_POWERPOINT, AS_KEYNOTE };

'use strict';
// The phone camera page: the phone's camera → 1280×720 JPEG pictures → ChurchStream, about
// 20 per second. Each picture is sent when the last one has arrived, so a slow Wi-Fi sends fewer
// pictures instead of falling behind. (ChurchStream repeats the latest picture in between.)
(function () {
  const W = 1280;
  const H = 720;
  const FPS = 20;
  const params = new URLSearchParams(location.search);
  const cam = Math.max(1, Math.min(4, parseInt(params.get('cam'), 10) || 1));
  const key = params.get('k') || '';
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  let stream = null;
  let facing = 'environment';
  let running = false;
  let torchOn = false;
  let wake = null;
  let sent = 0;
  let lastOk = 0;
  let onAir = null;
  let failures = 0;

  $('title').textContent = `ChurchStream camera ${cam}`;
  const msg = (t) => { $('msg').textContent = t; };
  function badge(cls, text) {
    $('badge').hidden = false;
    $('badge').className = cls;
    $('badgeText').textContent = text;
  }

  if (!key) { $('intro').textContent = 'This address is incomplete. Scan the QR code in ChurchStream (Settings → Camera & sound) again.'; $('go').hidden = true; }
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('intro').textContent = 'This browser can’t use the camera on this page. Open the address from the QR code in Safari (iPhone) or Chrome (Android).';
    $('go').hidden = true;
  }

  async function openCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    $('torch').hidden = !caps.torch;
    torchOn = false;
    $('torch').classList.remove('on');
    track.addEventListener('ended', () => { if (running) { msg('The camera stopped. Tap Start camera.'); stop(); } });
  }

  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ }
  }

  // Draw the camera into the 16:9 picture (black bars if the phone is held upright).
  function draw() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const s = Math.min(W / vw, H / vh);
    const dw = Math.round(vw * s);
    const dh = Math.round(vh * s);
    ctx.fillStyle = '#000';
    if (dw < W || dh < H) ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return true;
  }

  const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));

  let loopGen = 0;
  async function loop() {
    // Stop → Start while a frame was still on its way must not leave two loops sending.
    const gen = ++loopGen;
    while (running && gen === loopGen) {
      const t0 = performance.now();
      if (document.visibilityState === 'visible' && draw()) {
        const blob = await toBlob();
        if (!running) break;
        try {
          // A frame that takes over 3 s means the Wi-Fi has gone quiet: count it as a failure
          // (so the badge stops saying "connected") instead of waiting for ever.
          const ac = new AbortController();
          const limit = setTimeout(() => ac.abort(), 3000);
          let r;
          try { r = await fetch(`/api/phone-camera/frame?cam=${cam}&k=${encodeURIComponent(key)}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' }, cache: 'no-store', signal: ac.signal }); } finally { clearTimeout(limit); }
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (r.status === 403) { msg(d.error || 'This camera address is out of date. Scan the QR code again.'); badge('bad', 'Not connected'); stop(); break; }
            throw new Error(d.error || 'Not accepted');
          }
          sent++;
          failures = 0;
          lastOk = Date.now();
          if (onAir !== d.onAir) {
            onAir = d.onAir;
            msg(onAir ? `Connected. ChurchStream is using this phone as camera ${cam}.` : `Connected. In ChurchStream, choose “Phone” for camera ${cam} in Settings → Camera & sound.`);
          }
          badge(onAir ? 'live' : 'ok', onAir ? `Camera ${cam} · connected` : 'Connected');
        } catch {
          failures++;
          if (failures === 3) { badge('bad', 'Reconnecting…'); msg('Can’t reach ChurchStream. Check this phone is on the church Wi-Fi.'); onAir = null; }
          await new Promise((r) => setTimeout(r, Math.min(2000, 200 * failures)));
        }
      } else if (document.visibilityState !== 'visible') {
        await new Promise((r) => setTimeout(r, 300));
      }
      const wait = 1000 / FPS - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  async function start() {
    $('go').disabled = true;
    try {
      await openCamera();
    } catch (err) {
      $('go').disabled = false;
      $('intro').textContent = err && err.name === 'NotAllowedError'
        ? 'The camera was blocked. Allow the camera for this page (in Safari: aA → Website Settings → Camera; in Chrome: the icon left of the address), then tap Start camera.'
        : 'The camera couldn’t start: ' + ((err && err.message) || err);
      return;
    }
    $('start').hidden = true;
    $('flip').hidden = false;
    $('stop').hidden = false;
    badge('', 'Connecting…');
    msg('Connecting to ChurchStream…');
    running = true;
    onAir = null;
    keepAwake();
    loop();
  }

  function stop() {
    running = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    $('start').hidden = false;
    $('go').disabled = false;
    $('go').textContent = 'Start camera';
    $('flip').hidden = true;
    $('torch').hidden = true;
    $('stop').hidden = true;
    if (wake) { wake.release().catch(() => {}); wake = null; }
  }

  $('go').addEventListener('click', start);
  $('stop').addEventListener('click', () => { stop(); badge('', 'Stopped'); msg('Stopped. ChurchStream shows “Waiting for the phone camera”.'); });
  $('flip').addEventListener('click', async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    try { await openCamera(); } catch (err) { msg('Couldn’t switch: ' + err.message); }
  });
  $('torch').addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); torchOn = !torchOn; $('torch').classList.toggle('on', torchOn); } catch { $('torch').hidden = true; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) {
      keepAwake();
      onAir = null; // replace "Keep this page open…" with the connection message again
      // Some phones stop the camera while the page is hidden.
      const track = stream && stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') openCamera().catch(() => msg('Tap Stop, then Start camera.'));
    } else if (running) msg('Keep this page open: the camera stops while another app is in front.');
  });
  window.__phonecam = { stats: () => ({ sent, lastOk, running, onAir }) };
})();

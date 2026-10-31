# ChurchStream

Live streaming, projection, hymns, Bible verses and lower thirds for small churches, all in one calm screen.

- **Streams to YouTube and Facebook at the same time.** The video is encoded **once** and sent to both.
- **Projects** hymn lyrics, songs and Bible verses to your screens (one HDMI output; a splitter feeds both screens).
- **Lower thirds** (name/title) and **lyrics on the stream**, drawn straight into the video with no extra software.
- **One search box:** type `100`, `ch 266`, `Amazing grace` or `John 3:16`.
- **SDA Hymnal (1985)** and **Church Hymnal (1941)** in one click. **KJV** and **BSB** Bibles are built in.
- **Runs light:** one small program and one FFmpeg process. No OBS, no Electron. It uses the graphics chip (Intel/NVIDIA/AMD) for encoding when it can.
- **Portable Windows app:** unzip and double-click. Nothing to install.

---

## Install (Windows)

1. Download **`ChurchStream-win-x64.zip`** from the [Releases page](../../releases) (or from the latest *Windows build* workflow run).
2. Unzip it anywhere, for example `Documents\ChurchStream`.
3. Double-click **`ChurchStream.exe`**.
   - The first time, Windows SmartScreen may say *“Windows protected your PC”*. Click **More info → Run anyway**. The app isn't code-signed.
   - If Windows Firewall asks, allow **Private networks** so a tablet can connect.
4. Your browser opens the **setup wizard**:
   1. Church name
   2. Camera and microphone, with a live preview and sound meter
   3. Projector screen
   4. YouTube and Facebook stream keys
   5. Hymnal downloads

Settings, songs, Bibles and recordings live in `ChurchStream-data\` next to the exe. Copy the folder to move everything to another laptop.

## A Sunday with ChurchStream

| When | What to do |
|---|---|
| Before the service | Type a hymn number, song title or verse in the search box and press **Shift+Enter** to add it to the **Service** list. Drag to reorder. |
| Start | Click **Open on screen** to show the projector. Click **Go live**: ChurchStream checks the camera and sound, then starts YouTube and Facebook. |
| During | Press **Next** (or `→`, `Space`, `Page Down`, or a presentation clicker). At the end of a song it moves on to the next item in the service. |
| Sermon | Click a lower-third preset (e.g. *Pastor*) to show the name on the stream. |
| Between items | **Clear** (`C`) hides the words. **Black** (`B`) blanks the screens. **Logo** shows your logo. |
| End | **End live stream**. If recording is on, the file is in `ChurchStream-data\recordings`. |

**Keyboard:** `→`/`Space`/`PageDown` next · `←`/`PageUp` back · `B` black · `C` clear · `L` lower third on/off · `/` search.

**From a tablet or phone:** open `http://<computer-ip>:8080/control` on the church Wi-Fi. The address is shown in the console window and in Settings → Projector.
**Stage screen for musicians:** `http://<computer-ip>:8080/stage` shows the current and next slide and a clock.

## Hardware & internet

- **Computer:** any Windows 10/11 PC or laptop from the last 6–7 years. A recent Intel CPU with Quick Sync encodes in hardware and keeps the computer cool.
- **Camera:** a USB webcam, an **HDMI-to-USB capture card** (for camcorders/PTZ cameras with HDMI out), or an **IP/PTZ camera** (RTSP).
- **Sound:** connect the sound desk's output to the computer's line-in, a USB audio interface, or the capture card, and choose it in setup. Avoid the laptop's built-in mic.
- **Screens:** one HDMI output from the computer into your HDMI splitter.

| Quality | Video | Upload needed (YouTube + Facebook) |
|---|---|---|
| Low bandwidth | 480p, 1.2 Mbps | ~3 Mbps |
| **Good** (default) | 720p, 2.5 Mbps | ~6 Mbps |
| High | 1080p, 4.5 Mbps | ~10 Mbps |

Test your upload at [fast.com](https://fast.com) (“Show more info”). If you stream to only one platform, halve the number.

## Stream keys

- **YouTube:** [YouTube Studio](https://studio.youtube.com) → **Create → Go live → Stream** → copy the **Stream key**. It stays the same each week.
- **Facebook:** [Live Producer](https://www.facebook.com/live/producer) → **Streaming software** → tick **Use a persistent stream key** → copy the key.
- **Anything else** (Vimeo, Restream, a church website): paste the full `rtmp://…` address.

Keys are stored only on this computer and are never shown in full again.

## Hymnals, songs & Bibles

- **Hymnals:** Settings → *Hymnals & songs* → **Download**.
  - SDA Hymnal (1985), 695 hymns, from [joshpetit/sda-hymnal](https://github.com/joshpetit/sda-hymnal).
  - Church Hymnal (1941), from [adventhymnals/church-hymnal-csycms](https://github.com/adventhymnals/church-hymnal-csycms). This adds 694 hymns; the source has 9 hymns without lyrics.
- **Choosing a hymnal:** typing just a number opens it from your default hymnal. `sdah 100` or `ch 100` picks the hymnal.
- **Edited hymns are kept** when you update a hymnal.
- **Copyright:** many hymns are public domain, but some are not. Projecting or streaming copyrighted hymns needs your church's **CCLI** licence (Church Copyright License, plus the Streaming License for online use). Hymn texts are therefore **downloaded on your computer** and are not shipped with the app.
- **Your own songs:** search for the title and choose **Create a song**, or click **Edit** on any song. Paste the lyrics; a blank line starts a new slide, and `[Chorus]`-style labels are optional. Songs are plain `.txt` files in `ChurchStream-data\songs`.
- **Bibles:** KJV and the modern-English **BSB** (Berean Standard Bible) are included. Both are public domain. ASV, YLT and Darby can be downloaded in Settings → Bible.
  - Copyrighted translations (NIV, ESV…) can't be included. If you hold a licence and have the text as JSON, convert it with:
    ```
    node scripts/fetch-bible.js --file mybible.json --id niv --name "New International Version" --abbrev NIV --out ChurchStream-data/bible
    ```

## Troubleshooting

| Problem | Fix |
|---|---|
| “Camera or microphone not found” | Re-plug the USB cable, then pick the device again in Settings → Camera & sound (**Refresh**). Close other apps using the camera (Zoom, Teams, the Camera app). |
| “No sound for 10 seconds” | Check the sound desk output and the cable, then pick the right input in Settings. The meter should move when someone speaks. |
| “Facebook connection problem — retrying” | ChurchStream reconnects automatically while YouTube keeps going. If it persists, check that the Facebook key hasn't changed. |
| “The computer is struggling to keep up” | Choose **Low bandwidth** quality, close other programs, and plug the laptop into power. |
| “Upload is too slow” | Use **Low bandwidth**, use a wired network cable, or stream to one platform. |
| Projector window on the wrong screen | Settings → Projector → choose the display, then **Open projector window** again. |
| Tablet can't connect | Make sure the tablet is on the same Wi-Fi, and allow ChurchStream through Windows Firewall (Private networks). |

Settings → Advanced shows the FFmpeg log and lets you choose the video encoder manually.

---

## For developers

```bash
npm install          # dev tools only (esbuild, postject) — the app itself has no dependencies
npm start            # http://localhost:8080 (needs FFmpeg on PATH or in ./ffmpeg/)
npm test             # node:test unit tests (+ a real FFmpeg run if ffmpeg is installed)
npm run build:exe    # → dist/ChurchStream-win-x64.zip (works from Windows, Linux or macOS)
```

Requires Node.js ≥ 22.13. Data goes to `./userdata` when running from source; set `CHURCHSTREAM_DATA` to change it.

### How it works

```
camera ─┐                                            ┌─► YouTube   (rtmp,  own FIFO + auto-reconnect)
mic ────┼─► FFmpeg: scale → drawtext overlays ─► 1× H.264 + AAC ─┼─► Facebook  (rtmps, own FIFO + auto-reconnect)
        │      (lower third / lyrics text files,                  └─► recording (.mkv, optional)
        │       re-read every frame)          └─► preview.jpg (1 fps) + loudness meter
        │
Node server (no deps) ── SSE ──► control panel (Preact+htm, 13 KB) · projector page · stage page
```

- `server.js`: HTTP API, Server-Sent Events, static files.
- `lib/app.js`: state and actions (live slide, plan, toggles, lower third, downloads).
- `lib/stream.js`: the FFmpeg command builder (pure and tested) and the supervisor. The supervisor restarts with back-off, parses progress and loudness, maps errors to plain language, and masks stream keys in logs.
- `lib/overlay.js`: atomic text-file overlays for FFmpeg `drawtext` (`reload=1`), so changing a lower third never restarts the stream.
- `lib/songs.js`, `lib/bible.js`, `lib/importers/*`: song library, reference parser, and hymnal/Bible importers.
- `public/`: control panel, projector (`display.html`) and stage pages.
  - `shared.css` defines the projected slide once, in container units, so thumbnails look exactly like the projector.
- `scripts/build-exe.js`:
  1. bundles with esbuild
  2. embeds `public/` and `defaults/` as Node SEA assets
  3. injects the result into the official `node.exe` with postject
  4. adds the BtbN FFmpeg GPL build and zips the release
- `.github/workflows/windows-build.yml`: tests on Linux and Windows. It builds the exe, smoke-tests it on Windows (including a real recording through the bundled FFmpeg), uploads the zip, and publishes a GitHub Release for `v*` tags.

### Licences

- ChurchStream code: MIT.
- Inter font: SIL OFL 1.1.
- Preact: MIT. htm: Apache-2.0.
- Bundled `ffmpeg.exe`: GPL. The licence and source links are in `ffmpeg/LICENSE.txt`.
- KJV and BSB texts: public domain.
- Hymn texts are not distributed with ChurchStream.

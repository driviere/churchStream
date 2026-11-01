# ChurchStream

**Live streaming and worship projection, created for Seventh-day Adventist churches.**

ChurchStream runs a whole Sabbath service from one calm screen. It projects hymns and Bible readings, streams to YouTube and Facebook, and puts names on screen. It's built for the small congregation with one laptop, one camera and a couple of screens, run by volunteers.

> ChurchStream is an independent, free and open-source community project. It was created for Seventh-day Adventist congregations but is not an official product of, or endorsed by, the General Conference of Seventh-day Adventists. Any church is welcome to use it.

## What's included

### 📖 The Bible
- **King James Version (KJV)** and the modern-English **Berean Standard Bible (BSB)** are built in. All 66 books work offline, and both are public domain.
- **More free translations** can be downloaded in one click: American Standard Version (ASV), Young's Literal Translation and Darby.
- **Type a reference the way you'd say it:** `John 3:16`, `jn 3:16-18`, `Ps 23`, `1 Cor 13:4-7` or `Rom 8:28-9:2`.
- **Readable slides:** verses are grouped into slides of comfortable length, with small verse numbers and the reference along the bottom.

### 🎵 Both Adventist hymnals
- **Seventh-day Adventist Hymnal (1985):** all 695 hymns.
- **Church Hymnal (1941):** the 703-hymn hymnal that came before it. 694 hymns have lyrics in the source data.
- **One click to install each**, from Settings or the setup wizard.
- **Type the hymn number:** `100` opens your default hymnal, and `sdah 100` or `ch 100` picks the book. You can also search by title or by any line of the words.
- **Sung order:** refrains are placed after every verse, so the operator just presses **Next**. Edits you make to a hymn are kept when the hymnal is updated.
- **Your own songs**, choruses and announcements can be added too. Paste the words, and a blank line starts a new slide.

### 📺 Projection
- **Exact preview:** a projector window on your HDMI output, which can feed a splitter for two screens. The slide thumbnails look exactly like the projector.
- **15 built-in backgrounds** made for projection, plus your own photos. Choose one for everything, for one hymn or reading, or for a single slide.
- **Quick screen controls:** **Black**, **Clear** (hide the words) and **Logo**, each a single tap.
- **Stage screen** for musicians on any phone or tablet, showing the current and next slide and a clock.

### 🔴 Live streaming
- **YouTube and Facebook at the same time**, plus an optional recording. The video is encoded **once**, so two platforms cost no extra computer power.
- **Choose what viewers see:** the **Camera**, the **Slides**, **Slides + camera** (picture-in-picture) or **Auto**. Switching is instant and never interrupts the stream.
- **Names (lower thirds)** with one tap, on the stream and, if you like, the projector screens.
- **Safety checks:** before going live, ChurchStream checks the camera and sound. It warns you if there's no sound, and reconnects a platform automatically if it drops.

### 🎬 Before, during and after the service
- **Countdown** to the start of the service, with announcements changing underneath on their own. It runs on the screens and the stream.
- **Announcement loops:** any text slides can change automatically every few seconds.
- **Sermon slides:** the pastor's PowerPoint, Keynote or Google Slides, saved as a PDF, becomes slides you step through with **Next**.
- **Videos (Mission Spotlight, special music) and background music** play on the screens and *into the live stream* without interrupting it. Background music steps aside automatically while a video plays.
- **Scrolling ticker** along the bottom of the stream, and optionally the screens too.
- **Service templates:** save your usual order of service once, then start each Sabbath from it.
- **Sunset and Sabbath times** for your church's location, worked out on the computer with no internet needed.
  - A reminder in the top bar, e.g. *Sabbath begins 6:12 pm*.
  - A ready-made **Sunset times** slide.
  - Placeholders you can use in any slide or the ticker: `{sunset}`, `{sabbath-begins}`, `{sabbath-ends}` and `{next-sabbath-begins}`.
- **Broadcast title** filled in from a pattern (`{church} · Sabbath Service · {date} · {sermon}`), ready to copy into YouTube and Facebook.

### 🙌 Made for volunteers
- **No settings files:** a setup wizard in the browser handles everything.
- **One search box** for hymn numbers, songs and verses.
- **A big Next button** that a $15 presentation clicker also works with.
- **Order of service** that you build before the service and simply step through.
- **Runs from a tablet** on the church Wi-Fi, as well as from the computer.
- **Light and dark themes.**
- **Light on resources:** one small program plus FFmpeg. There's no OBS, and nothing to install.

---

## Install (Windows)

1. Download **`ChurchStream-win-x64.zip`** from the [Releases page](../../releases) (or from the latest *Windows build* workflow run).
2. Unzip it anywhere, for example `Documents\ChurchStream`.
3. Double-click **`ChurchStream.exe`**.
   - The first time, Windows SmartScreen may say *“Windows protected your PC”*. Click **More info → Run anyway**. The app isn't code-signed.
   - If Windows Firewall asks, allow **Private networks** so a tablet can connect.
4. Your browser opens the **setup wizard**:
   1. Church name (and its location, for sunset times)
   2. Camera and microphone, with a live preview and sound meter
   3. Projector screen
   4. YouTube and Facebook stream keys
   5. Hymnal downloads

Settings, songs, Bibles and recordings live in `ChurchStream-data\` next to the exe. Copy the folder to move everything to another laptop.

## A Sabbath with ChurchStream

| When | What to do |
|---|---|
| Before the service | Type a hymn number, song title or verse in the search box and press **Shift+Enter** to add it to the **Order of service**. Drag to reorder. |
| Start | Click **Open on projector**, choose what the stream shows (**Camera**, **Slides**, **Slides + camera** or **Auto**), then click **Go live**. ChurchStream checks the camera and sound first. |
| During | Press **Next** (or `→`, `Space`, `Page Down`, or a presentation clicker). At the end of a song it moves on to the next item in the service. |
| Sermon | Tap a name in **Names (lower third)** (e.g. *Pastor*) to show it on the stream; tap again to hide it. |
| Between items | **Clear** (`C`) hides the words. **Black** (`B`) blanks the screens. **Logo** shows your logo. |
| End | **End live stream**. If recording is on, the file is in `ChurchStream-data\recordings`. |

**Keyboard:** `→`/`Space`/`PageDown` next · `←`/`PageUp` back · `B` black · `C` clear · `L` lower third on/off · `/` search.

**From a tablet or phone:** open `http://<computer-ip>:8080/control` on the church Wi-Fi. The address is shown in the console window and in Settings → Projector.
**Stage screen for musicians:** `http://<computer-ip>:8080/stage` shows the current and next slide and a clock.

## Videos, music and slides

- **Add to the order of service:** use **+ Add**, then choose *Text or announcements*, *Sermon slides*, *Countdown* or *Video or music*.
- **Videos:** upload MP4, MOV or WebM files (they stay on this computer).
  - A video starts as soon as it goes on screen, or when you press **Play**.
  - It fills the projector and the stream; names and the ticker stay on top. **Stop** returns to the normal view.
- **Background music:** in the *Background music* card, add a few MP3/M4A tracks and press **Play**.
  - The tracks loop under everything at the volume you set.
  - The music also plays through the computer's speakers for the room, unless you turn that off.
- **Sound routing:** if this computer's sound already goes into your sound desk, and the desk feeds the stream, choose *It already reaches the stream through our sound desk* in Settings → Camera & sound. Otherwise viewers would hear it twice.
- **Sermon slides:** in PowerPoint choose **File → Save As → PDF**, then add that PDF. Each page becomes a slide. Picture files work too.

## What the stream shows

In the **Live stream** card, choose **Stream shows**:

| Choice | Viewers see |
|---|---|
| **Camera** | The camera full screen. Lyrics/verses can run along the bottom (switch below the buttons). |
| **Slides** | Exactly what is on the projector. |
| **Slides + camera** | The projector picture with the camera in a small window, bottom-right. |
| **Auto** | Slides + camera while words are on screen; just the camera when you press Clear, Black or Logo. |

Switching is instant and never interrupts the stream. Names (lower thirds) show in every view.
The projector picture is drawn by the control panel, so keep the control panel open (on this computer or a tablet) while streaming slides.

## Backgrounds

- **Built-in library:** 15 projection-friendly backgrounds, including Midnight, Deep ocean, Sunrise, Mountains at dusk, Starry night, Golden lights, Light from above, Cross at dawn and Soft cream (which uses dark text). All are dark enough for white lyrics to stay readable on any projector. They're drawn in code (`scripts/make-backgrounds.js`), so they're tiny and sharp at any resolution.
- **Your own:** click **Add your own** to upload photos or images (PNG, JPG, WebP or SVG; several at once is fine). They're kept in a library in `ChurchStream-data\media` and dimmed slightly on screen so words stay readable.
- **Where a background applies**, from most to least specific:
  1. **One slide:** hover a slide and click its picture icon. Slides with their own background show a small dot.
  2. **A whole item in the order of service:** open the item and click **Background**.
  3. **Everything else:** Settings → Appearance → Default background.

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
  - *Seventh-day Adventist Hymnal* (1985), 695 hymns, from [joshpetit/sda-hymnal](https://github.com/joshpetit/sda-hymnal).
  - *Church Hymnal* (1941), from [adventhymnals/church-hymnal-csycms](https://github.com/adventhymnals/church-hymnal-csycms). This adds 694 hymns; the source has 9 hymns without lyrics.
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
| “Facebook did not accept the connection” or “… connection problem — retrying” | ChurchStream reconnects automatically while other platforms keep going. If it persists, copy a fresh key and make sure **Use a persistent stream key** is ticked in Facebook Live Producer. |
| “The computer is struggling to keep up” | Choose **Low bandwidth** quality, close other programs, and plug the laptop into power. |
| “Upload is too slow” | Use **Low bandwidth**, use a wired network cable, or stream to one platform. |
| Projector window on the wrong screen | Settings → Projector → choose the display, then **Open projector window** again. |
| Tablet can't connect | Make sure the tablet is on the same Wi-Fi, and allow ChurchStream through Windows Firewall (Private networks). |

Click **Details** on any red banner, or open Settings → Advanced, to see the log. **Copy** puts it on the clipboard so you can share it when asking for help. You can also choose the video encoder manually there.

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
camera ─┐
mic ────┤                                                  ┌─► YouTube   (rtmp,  own FIFO + auto-reconnect)
        ├─► FFmpeg: camera ─┬─ projector picture ─┬─ names / ─► 1× H.264 + AAC ─┼─► Facebook  (rtmps, own FIFO + auto-reconnect)
program.jpg ────────────────┘   + camera inset    │   lyrics                    └─► recording (.mkv, optional)
(drawn by the control panel)    (moved in/out by  │   (text files re-read every frame)
                                live commands)    └─► preview.jpg (1 fps) + loudness meter

Node server (no deps) ── SSE ──► control panel (Preact + htm, 13 KB) · projector page · stage page
```

- `server.js`: HTTP API, Server-Sent Events, static files.
- `lib/app.js`: state and actions (live slide, plan, toggles, lower third, downloads).
- `lib/stream.js`: the FFmpeg command builder (pure and tested) and the supervisor. The supervisor restarts with back-off, parses progress and loudness, maps errors to plain language, and masks stream keys in logs.
- `lib/overlay.js`: atomic text-file overlays for FFmpeg `drawtext` (`reload=1`), so changing a lower third never restarts the stream.
- `lib/media.js`: the media relay. Videos and music are decoded by a player FFmpeg and sent to ChurchStream as raw frames and PCM. ChurchStream feeds the stream's FFmpeg a steady 30 fps / 20 ms bus over local TCP: black and silence when idle, mixed music and volume ramps otherwise. That means the stream FFmpeg never waits on that input, and playing a video never restarts the stream.
- Stream views: the control panel renders the projector picture to `run/program.jpg`, which FFmpeg re-reads 4×/s. The slide and camera-inset layers are switched with live filter commands (`overlay@slides` / `overlay@pip`), so the stream never restarts.
- `lib/songs.js`, `lib/bible.js`, `lib/importers/*`: song library, reference parser, and hymnal/Bible importers.
- `public/`: control panel, projector (`display.html`) and stage pages.
  - `shared.css` defines the projected slide once, in container units, so thumbnails look exactly like the projector.
- `scripts/build-exe.js`:
  1. bundles with esbuild
  2. embeds `public/` and `defaults/` as Node SEA assets
  3. injects the result into the official `node.exe` with postject
  4. adds the BtbN FFmpeg GPL build and zips the release
- `.github/workflows/windows-build.yml`: tests on Linux and Windows. It builds the exe, smoke-tests it on Windows (including a real recording through the bundled FFmpeg), uploads the zip, and publishes a GitHub Release for `v*` tags.

### Contributing

Issues and pull requests are welcome, especially from churches using ChurchStream on Sabbath. Please run `npm test` before sending changes. If you change the control panel, include before/after screenshots.

### Credits

- Hymn data: [joshpetit/sda-hymnal](https://github.com/joshpetit/sda-hymnal) (*Seventh-day Adventist Hymnal*) and the [Advent Hymnals](https://github.com/adventhymnals) project (*Church Hymnal*, 1941).
- Bible texts: [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
- [FFmpeg](https://ffmpeg.org) (Windows builds by [BtbN](https://github.com/BtbN/FFmpeg-Builds)), [Preact](https://preactjs.com), [htm](https://github.com/developit/htm) and the [Inter](https://rsms.me/inter/) typeface.

### Licences

- ChurchStream code: MIT.
- Inter font: SIL OFL 1.1.
- Preact: MIT. htm: Apache-2.0. PDF.js: Apache-2.0.
- Bundled `ffmpeg.exe`: GPL. The licence and source links are in `ffmpeg/LICENSE.txt`.
- KJV and BSB texts: public domain.
- Hymn texts are not distributed with ChurchStream. They are downloaded from the projects above onto your computer when you choose to. *Seventh-day Adventist Hymnal* © 1985 Review and Herald Publishing Association; *Church Hymnal* © 1941 General Conference Corporation of Seventh-day Adventists. Many individual hymns are public domain, but projecting or streaming those still under copyright requires your church's CCLI licence.

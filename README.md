# ChurchStream

**Live streaming and worship projection, created for Seventh-day Adventist churches.**

ChurchStream runs a whole Sabbath service from one calm screen. It projects hymns and Bible readings, streams to YouTube and Facebook, and puts names on screen. It's built for the small congregation with one laptop, one camera and a couple of screens, run by volunteers.

> ChurchStream is an independent, free and open-source community project. It was created for Seventh-day Adventist congregations but is not an official product of, or endorsed by, the General Conference of Seventh-day Adventists. Any church is welcome to use it.


📖 **[User manual](public/manual.md)**: a step-by-step guide for volunteers. It's also built into the app: click **?** in the top bar, or open `/manual`.

## Features

ChurchStream runs your church's projector and live stream from one simple control panel. It is free, and works on a Windows PC or a Mac.

**At a glance**
- **One computer** does everything: shows hymns, Bible readings and announcements on the screens, and streams the service to YouTube and Facebook at the same time.
- **Made for volunteers:** a setup guide, one search box, a big Next button, and a simple mode that hides everything else.
- **Runs from phones and tablets** on the church Wi-Fi: as a remote clicker, a stage screen for musicians, or the full control panel.
- **Works offline** during the service: the hymnals and Bibles are stored on the computer. Internet is only needed to stream.
- **Light on resources:** one small program plus FFmpeg. There's no OBS, and nothing else to install.

### 🔴 Live streaming

| Feature | What it does |
| --- | --- |
| YouTube and Facebook at once | Streams to both at the same time, from one encode, so the second platform costs no extra computer power. If one drops, the other keeps going and the dropped one reconnects. |
| Recording | Optionally keeps a copy of each service on the computer. |
| What viewers see | **Camera**, **Slides** (exactly what the projector shows), **Slides + camera** in a corner, or **Auto**. Switching never interrupts the stream. |
| Words on the camera view | Lyrics and verses can appear as captions along the bottom of the camera picture. |
| Names (lower thirds) | One tap shows a name and title, e.g. *Pastor John Smith · Sermon*, on the stream and optionally the screens. |
| Scrolling ticker | A message line along the bottom, e.g. *Potluck lunch after the service*. |
| Sound clean-up | Off, Light or Strong: removes hum and fan noise, evens out loud and quiet voices, and prevents distortion. |
| Mic level and lip-sync | Adjust the microphone, and line the sound up with the picture. |
| Safety checks | Before going live it checks the camera, sound and stream keys. It warns when there's no sound or the connection is struggling. |
| Hardware encoding | Uses the computer's built-in video encoder where available (Intel, NVIDIA, AMD or Apple), so the laptop stays cool. |
| Broadcast title | Filled in from a pattern, e.g. `{church} · Sabbath Service · {date} · {sermon}`, ready to copy into YouTube and Facebook. |

### 📺 Projection

| Feature | What it does |
| --- | --- |
| Projector window | Opens full screen on the projector output. It also works with an HDMI splitter feeding two screens. |
| Exact preview | The slide thumbnails and the small screen in the control panel look exactly like the projector. |
| Backgrounds | 15 built-in backgrounds made for projection, plus your own photos. Set one for everything, one item, or a single slide. |
| Church logo | Your logo full screen with one tap, optionally with the church name under it, in three sizes. |
| Black, Clear, Logo | Blank the screens, hide just the words, or show the logo. Each is one tap or one key. |
| Text options | Choose the font; put the words in the middle or along the bottom; centred or left; with an outline for busy photos. |
| Stage screen | Current slide, next slide and a clock for musicians and the speaker, on any phone or tablet. |
| Readable sizing | Text fits itself to the screen. Song lines are kept whole where possible, and Bible verses show small verse numbers. |

### 🎵 Hymns, Bible and worship

| Feature | What it does |
| --- | --- |
| Both Adventist hymnals | *Seventh-day Adventist Hymnal* (1985, 695 hymns) and *Church Hymnal* (1941, 703 hymns; 694 have lyrics in the source data). One click to download each onto your computer. |
| Hymn numbers | Type `100` for your default hymnal, `ch 100` or `sda 100` to pick the book, or search by title or any line of the words. |
| Sung in order | Refrains are placed after every verse, so the operator just presses Next. Your edits to a hymn are kept when the hymnal is updated. |
| Choose the verses | Sing only some verses, e.g. 1, 2 and 4. Refrains come and go with their verse. |
| Your own songs | Paste the words of any song or chorus; a blank line starts a new slide. |
| Bible | KJV and BSB built in, all 66 books offline; ASV, YLT and Darby downloadable. **Import a Bible file** your church is licensed to use (NRSV, NIV…: JSON, Zefania, OSIS or USFX), kept on that computer only. Type references naturally: `John 3:16`, `jn 3:16-18`, `Ps 23`, `1 Cor 13:4-7`, `Rom 8:28-9:2`. |
| Responsive readings | Built from any Bible passage: Leader and Congregation take turns, and All read the last verse. The congregation's words show in gold. |
| Sermon slides | The pastor's PowerPoint, Keynote or Google Slides, saved as a PDF, becomes slides to step through. |
| Announcements | Text slides that can change by themselves every few seconds, on a loop. |
| Countdown | Counts down to the start of the service, with announcements changing underneath, on the screens and the stream. |
| Sunset and Sabbath times | Worked out for your church's location, with no internet needed. A reminder in the top bar, a ready-made *Sunset times* slide, and placeholders for any slide or the ticker: `{sunset}`, `{sabbath-begins}`, `{sabbath-ends}`, `{next-sabbath-begins}`. |

### 📋 Order of service and sharing

| Feature | What it does |
| --- | --- |
| Order of service | Build the service during the week, then step through it with Next. At the end of each item it moves on to the next. |
| New service | Start blank, or from *Our usual order*, a template you mark with ★. |
| Templates | Save your usual service once (welcome, opening hymn, scripture, prayer, children's story, sermon, closing hymn) and reuse it every week. |
| Save and share | Save a service as one `.churchservice` file, with its songs' words and optionally its pictures and videos. Email it, send it on WhatsApp, or copy it with a USB stick; another computer opens it and adds anything missing. |
| Recent services | Earlier orders of service are kept automatically, so nothing is lost when you start a new one. |
| Printable bulletin | The order of service as a page to print or save as a PDF, with your logo, hymn numbers, verses and readings. |
| Undo | Brings back a removed item or a replaced service, with one tap or **Ctrl+Z**. |
| Reorder | Drag items into a new order. On a phone or tablet, press and hold, then drag. |

### 🙌 Volunteers, phones and tablets

| Feature | What it does |
| --- | --- |
| Setup guide | First-run steps: church name and location, camera and sound, projector, stream keys, and hymnals. No settings files. |
| One search box | Hymn numbers, song titles, words and Bible references, all in one place. |
| Big Next button | Also works with the arrow keys, Space or a presentation clicker. |
| Volunteer mode | A simple screen with settings, stream setup and editing hidden, so nothing changes by accident. Press and hold for 2 seconds to leave. |
| Phone remote | Any phone on the church Wi-Fi becomes the clicker: huge Next and Back buttons, what's next, and the order of service to tap. |
| Control from a tablet | The full control panel works on a tablet, with swipe-friendly controls. |
| QR codes | **Settings → Phones & tablets** shows the computer's address and codes to scan. Nothing to install on the phones. |
| Optional password | Keeps visitors on the Wi-Fi out of the control panel. |
| Light and dark themes | A dark control panel for a dim room. |
| Built-in user manual | Click **?** in the top bar for step-by-step help. It works offline and prints well. |

### 🎬 Videos, music and YouTube

| Feature | What it does |
| --- | --- |
| Videos | Mission Spotlight, special music and other MP4, MOV or WebM videos play full screen on the projector **and** into the live stream with sound, without interrupting it. |
| Video controls | Play, Stop, From the start, volume, and repeat until stopped. |
| Background music | Quiet MP3 or M4A tracks loop before and after the service, on the stream and through the room speakers. They step aside while a video plays. |
| Play from YouTube | Paste a link to play a YouTube video on the projector, or use a video or playlist as background music. Needs internet during the service. |
| Download from YouTube | Save a copy of a video, or just its sound, so it plays offline and goes into the stream with sound. Only for videos you have permission to use. |

### 💻 Requirements

| | Windows | Mac |
| --- | --- | --- |
| Computer | A Windows 10 or 11 laptop or PC | macOS 13 or later; Apple chip (M1–M4) or Intel |
| Download | `ChurchStream-win-x64.zip` | `ChurchStream-mac-arm64.zip` (Apple chip) or `ChurchStream-mac-x64.zip` (Intel) |
| Start it | Unzip and double-click **ChurchStream.exe** | Unzip and double-click **Start ChurchStream.command** |
| First time | SmartScreen: **More info → Run anyway** | System Settings → Privacy & Security → **Open Anyway** |
| Projector | Microsoft Edge (already installed) | Google Chrome recommended; Safari works too |

You also need:
- **A camera:** a USB webcam, an HDMI capture card, an IP camera, or on a Mac the built-in camera or an iPhone.
- **A microphone or a feed from the sound desk.**
- **Internet upload of about 6 Mbps** to stream to YouTube and Facebook together at the default quality (720p). That's about 3 Mbps for one platform, or for both on the low-bandwidth setting (480p). See [Hardware & internet](#hardware--internet).

Downloads are on the [Releases page](../../releases).

---

## Install (Windows)

1. Download **`ChurchStream-win-x64.zip`** from the [Releases page](../../releases) (or from the latest *Build* workflow run).
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

## Install (Mac)

ChurchStream also runs on Mac laptops and desktops (macOS 13 Ventura or later).

1. From the [Releases page](../../releases), download:
   - **`ChurchStream-mac-arm64.zip`** for Macs with Apple chips (M1–M4, 2020 and later);
   - **`ChurchStream-mac-x64.zip`** for older Intel Macs.

   Not sure which you have? Apple menu → **About This Mac**: *Chip: Apple M…* means arm64; *Processor: Intel* means x64.
2. Unzip it and move the **ChurchStream** folder somewhere permanent, e.g. **Documents**.
3. Double-click **Start ChurchStream.command**. A Terminal window opens and keeps ChurchStream running; close it to stop.
   - The first time, macOS may say the file *can't be opened* or *Apple could not verify it*, because the app isn't from the App Store. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. Or Control-click the file in Finder, choose **Open**, then **Open** again.
   - When macOS asks whether **Terminal** may use the camera and microphone, click **Allow**. When it asks whether ChurchStream may accept incoming network connections, click **Allow** too, so phones and tablets can connect.
4. Set it up in your browser, the same as on Windows.

On a Mac:
- **Cameras:** the built-in camera, USB webcams, HDMI capture devices and an iPhone (Continuity Camera) all work.
- **Encoding:** the stream is encoded with Apple's hardware encoder (VideoToolbox).
- **Projector:** install the free **Google Chrome** to get an automatic full-screen projector window. Without it, the projector page opens in Safari: drag it to the projector and press **Control-Command-F**.
- **Sleep:** ChurchStream keeps the Mac awake while it's running. Plug the laptop in.

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
**Phones and tablets:** open **Settings → Phones & tablets**, or tap the phone button next to the gear on the main computer. It shows:
- this computer's address;
- QR codes for the control panel, the stage screen and the projector.

Scan one with a phone on the **same Wi-Fi**. The stage screen (`/stage`) shows musicians the current and next slide and a clock. If a phone can't connect, allow ChurchStream through the Windows firewall, or set the Wi-Fi to a *Private* network.

## Videos, music and slides

- **Add to the order of service:** use **+ Add**, then choose *Text or announcements*, *Sermon slides*, *Countdown* or *Video, music or YouTube*.
- **Videos:** upload MP4, MOV or WebM files (they stay on this computer).
  - A video starts as soon as it goes on screen, or when you press **Play**.
  - It fills the projector and the stream; names and the ticker stay on top. **Stop** returns to the normal view.
- **Background music:** in the *Background music* card, add a few MP3/M4A tracks and press **Play**.
  - The tracks loop under everything at the volume you set.
  - The music also plays through the computer's speakers for the room, unless you turn that off.
- **YouTube links:** paste a link under **+ Add → Video, music or YouTube**, then choose:
  - **Play from YouTube:** plays in YouTube's own player on the projector, using YouTube's official embedded player. It needs internet during the service. It plays in the room only: the stream shows a "now playing" card (or the camera), and viewers hear it through your microphones.
  - **Download video** or **Download sound only:** saves a copy into your media library with the free tool [yt-dlp](https://github.com/yt-dlp/yt-dlp), which is fetched on first use. The copy then works like an uploaded file: offline, and in the live stream with sound. Downloading is against YouTube's terms of service, so only download videos you have permission to use.
  - **Background music from YouTube:** press the YouTube button in the *Background music* card and paste a video or playlist link. YouTube requires its player to stay visible, so it shows as a small "now playing" card in the corner of the projector.
- **Copyright and streaming:** playing a recording on your stream, even audio only, can get the stream muted or blocked by YouTube's and Facebook's automatic checks. Safe choices include:
  - public-domain music;
  - Creative Commons or royalty-free tracks whose licence allows live streaming;
  - your own recordings;
  - ministries' videos that allow rebroadcast;
  - songs your congregation sings live under a CCLI Streaming Licence.
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
  - Copyrighted translations (NIV, NKJV, NRSV, ESV…) can't be included or downloaded. A church licensed to use one can bring its own copy: **Settings → Bible → Import a Bible file…** reads JSON (scrollmapper, thiagobodruk or ChurchStream format) and Zefania, OSIS or USFX XML, asks for the name and short name, and needs you to confirm the licence. The text stays on that computer only; saved services carry just the references.

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
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT) for the QR codes.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), downloaded on first use when you save a YouTube video.
- [FFmpeg](https://ffmpeg.org) (Windows builds by [BtbN](https://github.com/BtbN/FFmpeg-Builds)), [Preact](https://preactjs.com), [htm](https://github.com/developit/htm) and the [Inter](https://rsms.me/inter/) typeface.

### Licences

- ChurchStream code: MIT.
- Inter font: SIL OFL 1.1.
- Preact: MIT. htm: Apache-2.0. PDF.js: Apache-2.0.
- Bundled `ffmpeg.exe`: GPL. The licence and source links are in `ffmpeg/LICENSE.txt`.
- KJV and BSB texts: public domain.
- Hymn texts are not distributed with ChurchStream. They are downloaded from the projects above onto your computer when you choose to. *Seventh-day Adventist Hymnal* © 1985 Review and Herald Publishing Association; *Church Hymnal* © 1941 General Conference Corporation of Seventh-day Adventists. Many individual hymns are public domain, but projecting or streaming those still under copyright requires your church's CCLI licence.

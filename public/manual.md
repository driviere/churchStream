# ChurchStream user manual

ChurchStream runs your church's screens and live stream from one simple control panel. It shows hymns, Bible readings, announcements and names on the projector, and streams the service to YouTube and Facebook. It was made for Seventh-day Adventist churches with one computer, one camera and a projector (or several screens on an HDMI splitter).

This manual is written for volunteers. You don't need any technical knowledge.

**Contents**

1. [Getting started](#1-getting-started)
2. [A tour of the control panel](#2-a-tour-of-the-control-panel)
3. [Building the order of service](#3-building-the-order-of-service)
4. [During the service](#4-during-the-service)
5. [Going live on YouTube and Facebook](#5-going-live-on-youtube-and-facebook)
6. [The projector and how it looks](#6-the-projector-and-how-it-looks)
7. [Phones and tablets](#7-phones-and-tablets)
8. [Saving, sharing and printing services](#8-saving-sharing-and-printing-services)
9. [Videos, music and YouTube](#9-videos-music-and-youtube)
10. [Keyboard shortcuts](#10-keyboard-shortcuts)
11. [Troubleshooting](#11-troubleshooting)
12. [Copyright and licences](#12-copyright-and-licences)

---

## 1. Getting started

### Installing on Windows
1. Download **ChurchStream-win-x64.zip** from the project's *Releases* page on GitHub.
2. Unzip it anywhere, for example to your Desktop or Documents. Nothing needs installing, and FFmpeg (the streaming engine) is included.
3. Double-click **ChurchStream.exe**.

The first time you open it, Windows may say *"Windows protected your PC"*, because the app isn't code-signed. Click **More info → Run anyway**.

If Windows asks whether to allow ChurchStream on networks, click **Allow**. Phones and tablets need this to connect.

A small black window opens and keeps ChurchStream running. **Leave it open** during the service; closing it stops everything. Your web browser opens the control panel by itself.

### Installing on a Mac
1. Download **ChurchStream-mac-arm64.zip** (Macs with Apple chips, M1 and later) or **ChurchStream-mac-x64.zip** (older Intel Macs). Not sure? Apple menu → **About This Mac** shows *Chip: Apple M…* or *Processor: Intel*.
2. Unzip it and move the **ChurchStream** folder somewhere permanent, e.g. **Documents**.
3. Double-click **Start ChurchStream.command**.
   - If macOS says it *can't be opened*, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. Or Control-click the file, choose **Open**, then **Open** again.
   - Allow **Terminal** to use the **camera and microphone** when asked, and allow ChurchStream to **accept incoming network connections** (for phones and tablets).
4. The Terminal window keeps ChurchStream running. Leave it open during the service, and close it to stop.

On a Mac:
- **Cameras:** the built-in camera, USB webcams, HDMI capture devices and an iPhone (Continuity Camera) all work.
- **Projector:** install the free **Google Chrome** to get a full-screen projector window on the right screen automatically. Without Chrome, the projector page opens in Safari: drag it to the projector screen and press **Control-Command-F**.
- **Sleep:** ChurchStream keeps the Mac awake while it's running. Plug the laptop in.

### First-time setup
A short setup guide walks you through:
- **Church name and location.** The location is used for sunset and Sabbath times. In Google Maps, right-click your church, click the numbers at the top to copy them, and paste them in.
- **Camera and sound.** Pick your camera and microphone (or the sound desk). You should see the picture and the sound meter move.
- **Projector.** Choose which screen output goes to the projector.
- **YouTube and Facebook.** Paste your stream keys, or skip this if you only use the projector.
- **Hymnals.** Download the *SDA Hymnal* (1985) and/or the *Church Hymnal* (1941). Each takes about a minute.

You can change all of this later in **Settings** (the ⚙ button).

### Moving to another computer
Everything ChurchStream keeps (settings, songs, services, pictures, videos) lives in the **ChurchStream-data** folder next to ChurchStream.exe. Copy the whole ChurchStream folder to the new computer and everything comes with it.

---

## 2. A tour of the control panel

| Area | What it does |
|---|---|
| **Search bar** (top) | Type a hymn number (`100`), a song title, a line of the words, or a Bible reference (`John 3:16`, `Ps 23`). |
| **Slides** (centre) | The slides of the item you've opened. Tap any slide to put it on the screens. The slide on screen has a **red ring** and an **ON SCREEN** tag; the next one has a **teal ring**. |
| **Screens** (right) | A small copy of exactly what the projector shows. **Open on projector** opens the full-screen projector window. |
| **Live stream** (right) | Go live, what the stream shows (camera or slides), the sound meter, and the camera preview. |
| **Names, Ticker, Background music** (right) | Lower-third names on the stream, a scrolling message line, and quiet music before and after the service. |
| **Order of service** (bottom) | Your service, item by item. Tap an item to open it. |
| **Next / Back / Clear / Logo / Black** (bottom right) | The big buttons you use all service long. |

On a phone or tablet the control panel rearranges itself, with tabs for **Slides** and **Screens & stream**.

---

## 3. Building the order of service

You can build the service during the week or on Sabbath morning.

### Starting a new service
Click **New** above the order of service and choose:
- **★ Our usual order:** starts from your usual order (see *Templates* below).
- **Blank:** starts empty.
- **Any template** you've saved.

The previous order of service is never lost: it's kept in **Save / open → Recent**, and an **Undo** button appears right away.

### Adding hymns and readings
1. Type in the search bar, for example `73`, `holy holy` or `Isaiah 40:28-31`.
2. Press **Shift + Enter**, or click **Add**, to add the result to the order of service. Press **Enter** to show it straight away.

Hymn numbers search your default hymnal. Type `ch 100` for the Church Hymnal or `sda 100` for the SDA Hymnal.

### Choosing which verses to sing
Open a hymn in the order of service. Under its title, **Verses to sing** shows a button for each verse.
- Tap a verse to leave it out; tap it again to bring it back. A refrain stays with the verse before it.
- The order of service shows your choice, e.g. *v. 1, 2, 4*.
- **All verses** puts every verse back.

### The + Add menu
Click **+ Add** at the end of the order of service:
- **Text or announcements:** type words; a blank line starts a new slide. Slides can change by themselves (*Change slides automatically*), which is good for announcements before the service.
- **Responsive reading:** see below.
- **Sermon slides:** in PowerPoint choose **File → Save As → PDF**, then add the PDF; each page becomes a slide. Picture files work too.
- **Countdown:** counts down to the start of the service, optionally with announcements changing underneath.
- **Sunset times:** a ready-made slide showing when this Sabbath ends and the next begins.
- **Video, music or YouTube:** see [section 9](#9-videos-music-and-youtube).

### Responsive readings
1. **+ Add → Responsive reading**.
2. Type a passage in **Start from a Bible passage**, e.g. `Psalm 100`, and click **Fill in**. The verses alternate between **Leader** and **Congregation**, and the last one is read by **All**.
3. Change anything you like in the box. Each part starts with `Leader:`, `Congregation:` or `All:`, with a blank line between parts.

On the screens, each slide is labelled, and the congregation's words are shown in **gold** so everyone knows when to read.

*The numbered responsive readings at the back of the SDA Hymnal aren't freely available, so ChurchStream builds readings from the Bible translations you have installed.*

### Editing, reordering and removing
- **Edit:** open the item and click **Edit** (songs, text, responsive readings and countdowns).
- **Reorder:** drag an item along the order of service. On a phone or tablet, **press and hold** it for half a second, then drag.
- **Remove:** point at the item and click the small **×**. An **Undo** button appears for a few seconds. You can also press **Ctrl + Z**.

### Backgrounds
- **The default background** for everything: Settings → Appearance.
- **For one item:** open it and click **Background**.
- **For one slide:** point at the slide and click its picture button.

There are 15 built-in backgrounds, and you can add your own photos (they're dimmed a little so words stay readable).

### Templates (your usual order)
Build your usual service once: welcome, opening hymn, scripture reading, prayer, children's story, sermon, closing hymn and so on.
1. Click **Templates**, name it (e.g. *Sabbath Divine Service*) and click **Save**.
2. Click **☆** next to it to make it your **usual order**. **New → Our usual order** then starts from it each week.

---

## 4. During the service

### Moving through the slides
- **Next** (or the **→** key, **Space**, **Page Down**, or a presentation clicker) shows the next slide. At the end of an item it moves on to the next item in the order of service.
- **Back** (or **←**, **Page Up**) goes back.
- Tap any slide to jump straight to it.

### Clear, Logo and Black
- **Clear** (**C**): hides the words but keeps the background.
- **Logo**: shows your church logo full screen, on the projector and the stream.
- **Black** (**B**): turns the screens black.

These buttons stay lit while they're on. Press again to turn them off.

### Names on the stream (lower thirds)
In the **Names** card, tap a name to show it at the bottom of the stream, e.g. *Pastor John Smith · Sermon*. Tap it again to hide it. **+ New name** adds one: **Show now** shows it once, **Show & save** also keeps it for next time. **Also show on the projector screens** shows names in the room too.

### Ticker
Type a message (*Potluck lunch after the service*) and press **Start ticker**. It scrolls along the bottom of the stream, and of the projector if you turn on *Also on the projector screens*. **Stop ticker** ends it.

### Volunteer mode
Volunteer mode is a simple screen for whoever is running the slides. Settings, stream setup, editing, removing and reordering are hidden, so nothing can be changed by accident.
- **Turn it on:** click the **lock** button in the top bar.
- **Turn it off:** **press and hold** the *Volunteer mode* chip for 2 seconds. A quick tap does nothing.

It's remembered on each device separately, so the deacon's tablet can stay in volunteer mode while the main computer doesn't.

### Phone remote
Any phone on the church Wi-Fi can be the clicker. See [section 7](#7-phones-and-tablets).

### Stage screen
Musicians and the speaker can see the current and next slide, plus a clock, on any phone or tablet. See [section 7](#7-phones-and-tablets).

---

## 5. Going live on YouTube and Facebook

### Stream keys
In **Settings → YouTube & Facebook**, paste your stream keys:
- **YouTube:** YouTube Studio → **Create → Go live → Stream** → copy the **Stream key**.
- **Facebook:** **Live Producer** → **Streaming software** → copy the **Stream key**. Facebook keys usually work for one broadcast, so paste a fresh one each week, unless you use a *persistent* key.

You can stream to both at once. It doesn't use extra computer power, because the video is prepared once.

### Going live
1. Click **Go live** in the Live stream card. ChurchStream checks the camera, the sound and where it's streaming to.
2. Click **Go live now**. The top bar shows **LIVE**, how long you've been live, and a ✓ for each platform.
3. At the end, click **End live stream**, then **End stream**.

Turn on *Also record a copy on this computer* (Settings → YouTube & Facebook) to keep a copy of each service in the **ChurchStream-data\recordings** folder.

### What the stream shows
In the **Live stream** card, choose:
- **Camera:** the camera full screen. Turn on *Words along the bottom of the camera view* to add the lyrics or verse as captions.
- **Slides:** exactly what the projector shows.
- **Slides + camera:** the slides with the camera in a corner.
- **Auto:** the camera, switching to slides + camera whenever words are on the screen.

You can switch at any time without interrupting the stream.

### Sound for online viewers
In **Settings → Camera & sound**:
- **Sound clean-up:**
  - **Off:** the sound exactly as it comes in.
  - **Light:** removes hum and fan noise and evens out loud and quiet voices. Recommended.
  - **Strong:** for noisy rooms or a distant microphone.
- **Mic level:** raise or lower the microphone. Watch the meter while someone speaks; aim for the green, just touching orange.
- **Lip-sync:** if people's mouths move *after* you hear them on the stream, move this right until they match (usually 100–300 ms with an HDMI capture card).

These change the stream's sound, so they apply the next time the stream starts. A running preview restarts straight away.

### Banners
A red or yellow banner appears only when you need to act, for example *"Facebook disconnected, retrying…"* or *"No sound for 10 seconds"*. **Details** shows the technical log, which is useful when asking for help.

---

## 6. The projector and how it looks

### Opening the projector
Click **Open on projector** in the Screens card. ChurchStream opens a full-screen window on the screen you chose in Settings → Projector. **Show test on projector** helps you find the right screen. You can also open the projector automatically when ChurchStream starts.

### Appearance (Settings → Appearance)
- **Default background:** used everywhere unless an item or slide has its own.
- **Church logo:** upload your logo (a PNG with a transparent background looks best). You can show the church name under it, and choose Small, Medium or Large. Also in Settings → General.
- **Projector text size:** Smaller, Normal or Larger.
- **Projector font:** Clean, Windows, Classic serif or Bold & plain.
- **Where the words go:**
  - **Middle of the screen:** the usual layout.
  - **Along the bottom:** the words sit low on the screen over a soft shade, leaving photos and the camera corner visible.
- **Line up the words:** centred or left.
- **Outline the words:** easier to read over busy photos.
- **Control panel colours:** Light or Dark (less glare in a dim room).

The projector, the previews and the stream all use the same settings, so what you see is what everyone sees.

---

## 7. Phones and tablets

Open **Settings → Phones & tablets**, or click the phone button in the top bar of the main computer. It shows this computer's address (e.g. `192.168.1.25:8080`) and QR codes. Scan one with a phone's camera; the phone must be on the **same Wi-Fi** as the computer, not mobile data.

| Page | Address | For |
|---|---|---|
| **Phone remote** | `/remote` | Huge **Next** and **Back** buttons, Clear, Logo and Black, what's on screen and what's next, and the order of service: tap an item to show it. You can also swipe the picture left or right. A Bluetooth clicker paired with the phone works too. |
| **Control panel** | `/control` | Everything, on a tablet. |
| **Stage screen** | `/stage` | Current and next slide and a clock, for musicians and the speaker. |
| **Projector** | `/display` | Only if the projector is connected to a different computer. |

If a control panel password is set (Settings → General), the remote and control panel ask for it. The stage screen and projector never do.

**Not connecting?**
- Check the phone is on the same Wi-Fi as the computer.
- Allow ChurchStream through the Windows firewall, or set the Wi-Fi to a **Private** network in Windows settings.
- If the address changes from week to week, ask whoever manages the router to give the computer a fixed address (a "DHCP reservation").

---

## 8. Saving, sharing and printing services

Click **Save / open** above the order of service.

- **Save this service → Save to a file:** saves one **.churchservice** file to your Downloads folder. It contains the order of service and the words of its songs, and optionally its pictures, backgrounds and videos. Email it, send it on WhatsApp, or copy it with a USB stick.
- **Keep on this computer:** saves it in the **Recent** list.
- **Open a file:** opens a .churchservice file. Click it, or drop the file on it. Songs and pictures the computer doesn't have are added. If a reading uses a Bible translation this computer doesn't have, it shows in your default Bible instead.
- **Recent:** services you saved, plus earlier orders of service kept automatically. Open or delete them here.
- **Print the order of service:** a simple bulletin with your church name and logo, each item (hymn numbers and verses, readings), and when the Sabbath ends. Print it, or save it as a PDF from the print window.

---

## 9. Videos, music and YouTube

### Videos and music files
**+ Add → Video, music or YouTube → Add video or music…** and choose MP4, MOV or WebM videos (e.g. Mission Spotlight) or MP3/M4A music. The files stay on this computer.
- A video fills the projector **and** the stream, with sound, while names and the ticker stay on top.
- Use **Play**, **Stop** and **From the start**, the volume slider, and *Repeat until stopped*.
- Background music steps aside automatically while a video plays.

### Background music
In the **Background music** card, add a few quiet tracks and press **Play**. They loop quietly under everything, on the stream and through the computer's speakers (you can turn that off). Press the YouTube button to play a YouTube video or playlist instead.

### YouTube links
Paste a YouTube link in **+ Add → Video, music or YouTube** and click **Find**. Then choose:
- **Play from YouTube:** plays on the projector using YouTube's own player. It needs internet during the service. On the stream, viewers see a *Now playing* card and hear it only through your microphones.
- **Download video** or **Download sound only:** saves a copy to this computer, so it plays offline and goes into the stream with sound. Only download videos you have permission to use. If YouTube says it needs to "confirm you're not a bot", try again later or use *Play from YouTube*.

**Sound routing:** if this computer's sound already goes into your sound desk, and the desk feeds the stream, choose *It already reaches the stream through our sound desk* in Settings → Camera & sound. Otherwise viewers would hear it twice.

---

## 10. Keyboard shortcuts

| Key | Does |
|---|---|
| **→**, **Space**, **Page Down** | Next slide (a presentation clicker uses these) |
| **←**, **Page Up** | Back |
| **B** (or **.**) | Black on/off |
| **C** | Clear the words on/off |
| **L** | Name (lower third) on/off |
| **/** | Go to the search bar |
| **Enter** in search | Show the result now |
| **Shift + Enter** in search | Add the result to the order of service |
| **Ctrl + Z** | Undo the last change to the order of service |

---

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| **"Windows protected your PC"** | Click **More info → Run anyway**. It appears because the app isn't code-signed. |
| **Mac: "can't be opened" / "Apple could not verify"** | System Settings → Privacy & Security → **Open Anyway** (or Control-click → Open). |
| **Mac: no camera or microphone in the list** | System Settings → Privacy & Security → **Camera** and **Microphone**: turn on **Terminal**, then restart ChurchStream. |
| **Camera not found or busy** | Close other apps that use the camera (Zoom, Teams, the Camera app), check the cable, then pick the camera again in Settings → Camera & sound. |
| **No sound on the stream** | Check the microphone or sound desk is on and selected in Settings → Camera & sound, and that the meter moves when someone speaks. |
| **Sound comes before the picture** | Move **Lip-sync** to the right (Settings → Camera & sound). |
| **Facebook won't connect** | Facebook keys usually work once: paste a fresh key from Live Producer. |
| **YouTube says "no data"** | Wait 20–30 seconds after going live; check that the YouTube key is current in YouTube Studio. |
| **"The computer is struggling to keep up"** | Choose *Low bandwidth* quality in Settings → YouTube & Facebook, close other programs, and plug the laptop in. |
| **Phone can't connect** | Same Wi-Fi as the computer; allow ChurchStream in the Windows firewall, or set the network to Private. |
| **The projector opened on the wrong screen** | Settings → Projector, pick the other display, then **Show test on projector**. |
| **Something else** | Click **Details** on the banner, or open Settings → Advanced, then **Copy** the log and share it when asking for help. |

---

## 12. Copyright and licences

- **Hymns:** many hymns are in the public domain, but some are not. Projecting or streaming copyrighted hymns needs your church's **CCLI** licence (the Church Copyright License, plus the **Streaming Licence** for online use). That's why the hymnals are downloaded onto your own computer rather than included with ChurchStream.
- **Recordings on the live stream:** playing a recording, even audio only, can get your stream muted or blocked by YouTube's and Facebook's automatic checks. Safe choices include:
  - public-domain music;
  - Creative Commons or royalty-free tracks whose licence allows live streaming;
  - your own recordings;
  - ministries' videos that allow rebroadcast;
  - songs your congregation sings live, under a CCLI Streaming Licence.
- **Bibles:** KJV and BSB are built in; ASV, YLT, Darby and Webster can be downloaded. All are public domain. Copyrighted translations (NIV, NKJV, NRSV, ESV…) can't be included.
- **ChurchStream** is an independent project made for Seventh-day Adventist churches. It is not an official product of the Seventh-day Adventist Church.

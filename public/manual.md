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
1. Download **ChurchStream-Setup.exe** from the project's *Releases* page on GitHub.
2. Double-click it. It installs ChurchStream for you (no administrator password needed) with a **ChurchStream** shortcut in the Start menu, and on the desktop if you tick that box. FFmpeg (the streaming engine) is included.
   - Windows may say *"Windows protected your PC"*, because the app isn't code-signed. Click **More info → Run anyway**.
   - Used ChurchStream from a folder before? The installer asks for that folder and brings your settings, songs and services along.
3. Start **ChurchStream** from the Start menu or the desktop.

Your settings, songs, services and recordings are kept in the **ChurchStream-data** folder in your user folder (for example *C:\Users\Church\ChurchStream-data*). Uninstalling or installing again never touches them. ChurchStream can be removed in **Settings → Apps**.

*Prefer no installer?* **ChurchStream-win-x64.zip** is the same program in a folder: unzip it anywhere (even a USB stick) and double-click **ChurchStream.exe**. Its data then sits in ChurchStream-data next to the exe.

If Windows asks whether to allow ChurchStream on networks, click **Allow**. Phones and tablets need this to connect.

A small black window opens and keeps ChurchStream running. **Leave it open** during the service; closing it stops everything. Your web browser opens the control panel by itself.

### Installing on a Mac
1. Download **ChurchStream-mac-arm64.zip** (Macs with Apple chips, M1 and later) or **ChurchStream-mac-x64.zip** (older Intel Macs). Not sure? Apple menu → **About This Mac** shows *Chip: Apple M…* or *Processor: Intel*.
2. Unzip it. Drag **ChurchStream.app** into your **Applications** folder (or keep the folder in **Documents**).
3. Double-click **ChurchStream.app**.
   - If macOS says it *can't be opened* or *Apple could not verify* it, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. Or Control-click the app, choose **Open**, then **Open** again. This is only needed the first time.
   - Allow ChurchStream to use the **camera and microphone** when asked, and to **accept incoming network connections** and find devices on your **local network** (for phones, tablets and network cameras).
4. Your browser opens the setup page. ChurchStream shows in the **Dock** while it runs; there's no Terminal window.
   - Closed the browser tab? Click ChurchStream in the Dock to open the control panel again.
   - To stop everything, choose **ChurchStream → Quit** in the menu bar, or Control-click its Dock icon and choose **Quit**.

On a Mac, your settings, songs, services and recordings are in the **ChurchStream-data** folder in your home folder (in Finder: **Go → Home**). Installing a newer ChurchStream.app keeps them. If you used an older version, whose data sat in the ChurchStream folder, it's copied there the first time you open the app. *Start ChurchStream.command* is still included as another way to start it in a Terminal window.

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
Everything ChurchStream keeps (settings, songs, services, pictures, videos) lives in the **ChurchStream-data** folder: in your user folder when ChurchStream was installed (Windows installer, or a Mac), or next to ChurchStream.exe for the zip. Install ChurchStream on the new computer and copy that **ChurchStream-data** folder to the same place there (with the zip, simply copy the whole ChurchStream folder).

### Updates
ChurchStream checks by itself whether there is a newer version (when it starts and every few hours). When there is, a card appears in the corner of the control panel and the stream page: *ChurchStream 1.0.1 is available*, with **What's new**, **Update** and **Later**.
- **Update** downloads only what changed, usually a few MB, never the whole program again. Then **Restart now** (about 10 seconds), or the new version starts next time you open ChurchStream. Pages on other laptops and tablets reconnect by themselves.
- Nothing is downloaded until someone clicks **Update**, and never during a live stream or recording: the card waits until the stream ends.
- **Later** hides the card until ChurchStream is started again.
- Once in a while an update changes the program itself; then the card says so and links to the full download (on Windows, run the new **ChurchStream-Setup.exe**; your settings are kept).
- If an update ever fails to start, ChurchStream goes back to the version you had and says so. Your settings are not affected.
- To check by hand, or to stop the checks: **Settings → Advanced → Updates**. Checking contacts GitHub (github.com), where ChurchStream is published.

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

Hymn numbers search your default hymnal. Type `ch 100` for the Church Hymnal, `sda 100` for the SDA Hymnal or `ay 25` for Advent Youth Sing.

### Adding songs and choruses
- **One song:** click **+ Add → Song or chorus** at the end of the order of service (or type its title in the search bar and, if it isn't found, click **Create a song**), paste the words and save. A blank line starts a new slide; a line such as `Chorus` or `Verse 2` names the part that follows.
- **Many songs at once:** open **Settings → Hymnals & songs** and click **Import songs…**. You can pick several files. ChurchStream reads:
  - ChurchStream songs files (**.churchsongs**);
  - text files and Word documents, either one song or a numbered list of songs (`25. Title`, then the words);
  - CCLI SongSelect downloads, OpenLyrics (OpenLP and other church software), ChordPro (chords are left out) and CSV spreadsheets with title and lyrics columns.
- Before importing, choose where the songs go: **Advent Youth Sing**, **My own songs**, or a hymnal. Songs in a songbook can be found by number (`ay 25`) as well as by title or words. Importing again updates the songs, but keeps any you've edited.
- PDF files can't be read directly. Copy the words into a Word or text file first.

### Advent Youth Sing (AY Sing)
ChurchStream doesn't include the AY Sing songbook: there's no free copy to download. If your church has it as a file, import it with the **Import…** button on the **Advent Youth Sing** card in **Settings → Hymnals & songs**. After that, type `ay 25` to open song 25. To make `25` alone open AY Sing, choose it under **When you type just a number**.

### Taking songs to another computer
In **Settings → Hymnals & songs → Take songs to another computer**, choose the songbook (for example Advent Youth Sing, or My own songs) and click **Save to a file…**. A **.churchsongs** file is saved to Downloads. Copy it to the other laptop (USB stick, email or WhatsApp) and open it there with **Import songs…**.

### Choosing which verses to sing
Open a hymn in the order of service. Under its title, **Verses to sing** shows a button for each verse.
- Tap a verse to leave it out; tap it again to bring it back. A refrain stays with the verse before it.
- The order of service shows your choice, e.g. *v. 1, 2, 4*.
- **All verses** puts every verse back.

### The + Add menu
Click **+ Add** at the end of the order of service:
- **Song or chorus:** type or paste the words of a song that isn't in your library; a blank line starts a new slide. **Save and add to service** keeps it in your song library and adds it to the end of the order of service.
- **Text or announcements:** type words; a blank line starts a new slide. Slides can change by themselves (*Change slides automatically*), which is good for announcements before the service.
- **Responsive reading:** see below.
- **Slides (PowerPoint, PDF or pictures):** pick the pastor's PowerPoint file (or drop it on the dialog). PowerPoint on this computer opens it in the background, so each slide looks exactly as it does in PowerPoint; this can take up to a minute. A PDF or picture files (one per slide) work too, and from Google Slides choose **File → Download → PDF**. Animations, videos and sounds inside a PowerPoint don't carry over; add a video separately with *Video, music or YouTube*. If PowerPoint isn't installed, ChurchStream uses Keynote (Mac) or LibreOffice when they are, or asks you to save the file as a PDF.
- **Countdown:** counts down to the start of the service, optionally with announcements changing underneath.
- **Sunset times:** a ready-made slide showing when this Sabbath ends and the next begins.
- **Video, music or YouTube:** see [section 9](#9-videos-music-and-youtube).

### Responsive readings
1. **+ Add → Responsive reading**.
2. Type a passage in **Start from a Bible passage**, e.g. `Psalm 100`, and click **Fill in**. The verses alternate between **Leader** and **Congregation**, and the last one is read by **All**.
3. Change anything you like in the box. Each part starts with `Leader:`, `Congregation:` or `All:`, with a blank line between parts.

On the screens, each slide is labelled, and the congregation's words are shown in **gold** so everyone knows when to read.

*The numbered responsive readings at the back of the SDA Hymnal aren't freely available, so ChurchStream builds readings from the Bible translations you have installed.*

### Bible translations
**KJV** and the modern-English **BSB** are built in. In **Settings → Bible** you can choose the default translation and download **ASV**, **YLT** or **Darby** (all public domain). To use another translation for one reading, add its short name: `John 3:16 ASV`. **Verses on each screen** chooses **One verse** (the default: each verse gets its own screen, with its reference underneath) or **As many as fit** (short verses share a screen).

**A translation your church is licensed to use** (NRSV, NIV, NKJV, ESV…) can be imported if you have its text as a file:
1. Open **Settings → Bible** and click **Import a Bible file…**. ChurchStream reads JSON files and Zefania, OSIS and USFX XML files, the formats most Bible software and publishers export.
2. Check the **Name** (e.g. *New Revised Standard Version*) and **Short name** (e.g. *NRSV*). They are filled in from the file when it says.
3. Tick **Our church is licensed to use this translation**, then click **Import**.

The file needs the whole Bible, or at least the whole New Testament. Importing the same short name again replaces the earlier copy, and **Remove** deletes it. An imported translation stays **on this computer only**: saved services carry just the reading references, so another computer shows them in its own Bible.

### Editing, reordering and removing
- **Edit:** every item can be changed: open it and click **Edit**, or hover its card in the order of service and click the pencil. Songs, text, responsive readings and countdowns change their words; **slides** can be renamed, put in a different order, removed or added to; a **reading** can change its passage or translation; a **video, music or YouTube** item can be renamed and set to repeat.
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
- **Logo**: shows your church logo (at the size chosen in Settings → Appearance), on the projector and the stream.
- **Black** (**B**): turns the screens black.

These buttons stay lit while they're on. Press again to turn them off.

### The live stream on the screens
Turn on **Show the live stream on the screens** (under the screen picture on the right) and the projector shows exactly what online viewers see: the camera, the slides, names and the ticker. Useful for an overflow room, or to show the preacher on a big screen. If the stream isn't running, the camera preview starts by itself. Turn it off to go back to the slides. (Black still works on top of it.) The picture is about a second behind the room.

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

**Starting soon and thank-you screens**
- In the Go live window, turn on **Start with a countdown on the stream** and choose how long (2–30 minutes). Viewers, and the screens in the church, see "Our service begins in" counting down. When it reaches zero, the stream switches to what you chose under *Stream shows*. **Start service now** on the Live stream card starts sooner.
- In the End live stream window, turn on **First show "Thank you for worshipping with us"** and choose how long. The stream shows that message with your church's name, then ends by itself. **End now** ends it straight away.

**Recording.** Turn on **Record this service on this computer** in the Live stream card (it's also in Settings → YouTube & Facebook). Recordings go in the **ChurchStream-data\recordings** folder. Choose the quality underneath:
- **Same as the stream:** exactly what viewers see, with no extra work for the computer (about 1.2 GB per hour at 720p).
- **720p high**, **1080p high** or **1080p best:** a better copy for editing or uploading later (about 2.3, 3.6 or 5.5 GB per hour). It's encoded separately from the stream. A 1080p recording works even when the stream is 720p. Without a graphics encoder this needs more processor, so try a short test first on a slower laptop.
- **Also record each camera on its own:** each camera saved as its own file ("Service … - Camera 1.mkv"), without slides or names, ready for editing a sermon video.

Changes apply the next time you go live.

### Two cameras
In **Settings → Camera & sound**, choose a **Second camera**: another USB camera or capture card, a network camera, or a phone (see below). The sound still comes from your microphone or sound desk. The Live stream card then shows **Camera 1 / Camera 2**: click one, or press **1** or **2**, to switch instantly without interrupting the stream. *Slides + camera* uses the camera that is on air.

If camera 2 stops during the service (unplugged, a loose cable, a network camera that drops out), ChurchStream notices within a few seconds and carries on with **camera 1**, with a red note on the Live stream card. It keeps checking, and when camera 2 works again it is added back by itself (with a brief pause in the stream) and shows as ready. Camera 1 stays on air until you switch. If the picture ever freezes completely, ChurchStream restarts the stream on its own.

### A phone as a camera
Any recent iPhone or Android phone can be a camera, with nothing to install. In **Settings → Camera & sound**, choose **Phone (scan a QR code)** as the camera type, or as the **Second camera**. A QR code appears.
1. Connect the phone to the **same Wi-Fi** as the ChurchStream computer, open its camera app and scan the code.
2. The phone warns that the connection is not private. That is expected: the page comes from your own computer, not from the internet. Tap **Advanced → Proceed** (Android) or **Show Details → visit this website** (iPhone). This is only needed the first time.
3. Tap **Start camera** and allow the camera. The settings page shows a green dot when the phone is sending.

Tips:
- Hold the phone **sideways**, on a small tripod or stand, and keep it **plugged in**. Keep the camera page open; the phone's screen stays on by itself.
- **Switch camera** chooses the front or back camera, and **Light** turns on the torch (where the phone has one).
- If the phone leaves the Wi-Fi or the page is closed, the stream shows "Waiting for the phone camera" instead of freezing, and the picture comes back by itself when the phone reconnects.
- The phone sends pictures only; the sound still comes from your microphone or sound desk.
- **New address** makes a new QR code, so phones using the old one stop sending.
- On Windows, allow ChurchStream through the firewall when asked, so phones can connect. The camera page uses port 8443.

### What the stream shows
In the **Live stream** card, choose:
- **Camera:** the camera full screen. Turn on *Words along the bottom of the camera view* to add the lyrics or verse as captions.
- **Slides:** exactly what the projector shows.
- **Slides + camera:** the slides with the camera in a corner.
- **Auto:** the camera, switching to slides + camera whenever words are on the screen.

You can switch at any time without interrupting the stream.

### The stream page (a second laptop)
A second person can run the live stream from another laptop or tablet while the main computer runs the slides. On that laptop, open the **stream page**: the main computer's address followed by **/stream**, for example *http://192.168.1.20:8080/stream* (the address and a QR code are in **Settings → Phones & tablets**, under *Stream page*). It has:
- the **live picture**, exactly as viewers see it, with the sound meter and whether YouTube and Facebook are connected;
- **Go live** and **End live stream** (with the start and end screens);
- **Camera 1 / Camera 2** (or the **1** and **2** keys), **Stream shows**, and words on the camera view;
- **recording**, **names** (lower thirds) and the **ticker**;
- **Show the live stream on the screens**, and a small picture of what the projector shows now;
- the ⚙ button for the stream settings: cameras (including phone cameras) and sound, stream keys and quality, and names.

Both laptops change the same settings, so everything stays in step. If a password is set (Settings → General), the stream page asks for it.

### The studio: scenes and transitions
With the studio (on by default when ChurchStream's FFmpeg supports it), the **stream page** works like a vision mixer:
- **Preview** (green, left) shows what goes on air next; **Program** (red, right) is what viewers see now.
- **Quick** mode: click a scene and it goes on air with the chosen transition. **Studio** mode: a click puts it in Preview; press **Cut** (instant) or **Auto** (the transition), or pull the **T-bar** across by hand.
- **Transitions:** Cut, Fade, Dip (through black), Slide and Wipe, with a length from 0.3 to 2 seconds. They run inside the stream itself, so they are smooth for viewers and the recording.
- **Sources** shows every camera, the slides and videos live. Click one to show it full screen.
- **Scenes** combine up to four pictures: for example two cameras side by side, the slides with the preacher in a corner, or four cameras at once. Built in: each camera, Slides, Slides + camera, and Side by side. **+ New scene** opens the editor: pick a layout (full, corner, side by side, three, four), drag pictures to move them, drag a corner to resize, choose each picture's source, and add a white border or crop the edges. Give scenes a **group** (such as "Sermon" or "Music") to sort them into tabs. Hover a scene and click ✎ to change it; a built-in scene can be changed too and put back with **Reset**.
- **Cameras 3 and 4:** add them in Settings → Camera & sound (USB, network or phone cameras), and give each camera a name, such as "Pulpit", so the scenes are easy to read.
- Names, the ticker and a playing video stay on top through every scene change.
- While a stream page is open, the main control panel hides its camera and "Stream shows" switches and says the stream is run from the stream page. When the stream page closes, the control panel takes over again from its next change (reloading the stream page doesn't make the stream jump).
- The start and end screens still take over the stream, and give it back afterwards.

**Sound mixer.** The stream page has a fader for each sound source: the microphone or sound desk, videos and music, a second microphone (add one in Settings → Camera & sound), and **Stream** for everything together. The bars show the level as it reaches viewers; **M** mutes a source. Double-click a fader to put it back to normal. Changes are instant, don't interrupt the stream, and are remembered.

**Titles and pictures.** On the stream page, **Titles** puts a title on the stream: choose Scripture, Sermon title, Speaker or Welcome, type one or two lines (or use **Use the reading on screen** during a Bible reading), pick a style (Classic, Modern bar or Minimal) and press **Show title**; **Take off** removes it. **Pictures** keeps your own pictures (a logo, a QR code for giving, a flyer): **Add picture…**, choose where it goes (a corner, lower middle or full screen) and press **Off** to switch it on. PNG pictures with a see-through background look best. Titles and pictures stay on through scene changes and transitions, and the names and ticker go on top of them.

**Keyboard shortcuts** on the stream page (press **?** or **Keys** for the list, which can be printed): **1–9** scenes 1 to 9, **Space** Cut, **Enter** Auto transition, **D** dip to black, **F1–F4** cameras 1 to 4, **G** picture on/off, **N** name on/off, **T** ticker on/off, **R** recording on/off. Shortcuts don't work while you type in a box. A **Stream Deck** can press them: give each button a *Hotkey* action with the key, while the stream page is in front.

The studio uses a little more computer power than before (about a tenth of one processor core). On a computer that struggles, turn it off in **Settings → Advanced → Studio** to go back to the simple switching.

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
- **Church logo:** upload a picture (a PNG with a transparent background looks best) or a short **video** (MP4, MOV or WebM). A video logo plays silently and repeats, on the projector and the stream, and background music keeps playing under it. Choose Small, Medium, Large or **Full screen** (fills the whole screen; a new video logo starts at Full screen). You can show the church name under a smaller logo. Also in Settings → General.
- **Largest text size:** Smaller, Normal, Larger or Largest. Every slide uses this size whenever its words fit. A long line continues on the next line when that keeps the words bigger; short lines stay whole.
- **Smallest text size:** Small, Medium, Large or Extra large. A slide with more words shrinks only as much as it needs, and never below this size.
- **When the words don't fit at this size, continue on the next slide** (on by default): a slide that would need smaller text is split into parts, e.g. *Verse 1 (1/2)* and *Verse 1 (2/2)*. Whole lines and whole Bible verses stay together, each part of a reading shows its own verses (*John 3:16–17*), and **Next** steps through the parts. **Edit** still shows the slide as you typed it. With this off, a very full slide may not fit on the screen.
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
- Use **Play**, **Stop** and **From the start**. To go to another place, drag or tap the bar under the player, or use **‹ 10 s** and **10 s ›**. You can also drag the bar before pressing Play, to start part-way through. The projector and the stream jump there together.
- Under the player you can change the item's settings at any time, even after it was added or while it plays: **Repeat until stopped**, **Play the sound in the room too**, **Volume**, and for YouTube links **Start at**. They're saved in the order of service; turning Repeat on while a video plays takes effect straight away.
- Videos without sound (for example a silent announcement loop) play too.
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
| **→**, **↓**, **Space**, **Page Down** | Next slide (a presentation clicker uses these) |
| **←**, **↑**, **Page Up** | Back |
| **B** (or **.**) | Black on/off |
| **C** | Clear the words on/off |
| **L** | Name (lower third) on/off |
| **1**–**4** | Put that camera on the stream (cameras you have set up; while the stream page runs the studio, use its keys instead) |
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
| **Mac: no camera or microphone in the list** | System Settings → Privacy & Security → **Camera** and **Microphone**: turn on **ChurchStream** (or **Terminal**, if you start it with *Start ChurchStream.command*), then restart ChurchStream. |
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
- **Songs and choruses you import** (AY Sing, CCLI SongSelect downloads…) stay on your computers. Projecting and streaming songs still under copyright needs your church's CCLI licence (and the Streaming Licence online).
- **Bibles:** KJV and BSB are built in; ASV, YLT and Darby can be downloaded. All are public domain. Copyrighted translations (NIV, NKJV, NRSV, ESV…) can't be included or downloaded. A church licensed to use one can import its own copy ([Bible translations](#bible-translations)); projecting and streaming it under that licence is the church's responsibility.
- **ChurchStream** is an independent project made for Seventh-day Adventist churches. It is not an official product of the Seventh-day Adventist Church.

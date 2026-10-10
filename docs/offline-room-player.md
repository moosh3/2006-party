# Independent offline room player

The room player is separate from the audience website. It plays **your original local files**, not Mux streams, YouTube videos, or cached copies of the website. It does not read cloud credentials, call Supabase, change the online queue, or deploy anything.

## Start it

On a Mac with Node.js 22 already installed, double-click `tools/room-player/Start Room Player.command` in Finder. Keep its terminal window open during the performance and open the local controls URL it prints. The launcher does not open QuickTime or change macOS display settings.

From the `2006-party` checkout, with Node.js 22 installed:

```sh
npm run room
```

Open `http://127.0.0.1:2007` on the show laptop. Internet is not required after Node and the checkout are installed. This command uses Node's built-in modules only: no dependency installation, Next.js build, or online login is required.

To select the local media folder at startup:

```sh
npm run room -- --media "/absolute/path/to/your/2006-videos"
```

Alternatively paste that folder's full path into **Local files & setup → Load folder**. In Finder, select the folder and press Option–Command–C to copy its path. Loading a folder does not move or upload any media. Keep the files there for the show.

## Prepare the room rundown

The starting rundown is an editable copy of the site's existing show outline, excluding the online-only karaoke handoff. Its entries are deliberately **live holds**, not guessed mappings to recordings. Check the order against your current script.

1. Select a cue in the rundown.
2. Choose **Live scene**, **Play local video**, or **Show local image**.
3. For a video/image, choose its local file, then **Save cue**.
4. Add, delete or reorder cues as needed. Notes stay on the operator screen.
5. Select your wife's holding-screen file when ready. Video holding screens loop silently; images/GIFs remain visible. Without a file, the built-in static 2006 screen is used.
6. Run **Check show files**. This checks selected file availability and browser readability; it cannot certify speakers, display wiring, lip-sync or every frame of a clip. Rehearse every cue on the actual laptop/displays.

MP4/H.264 with AAC audio is a practical starting point. MOV/M4V/WebM can be listed, but decoding depends on the browser and the actual codecs, so test your originals. Convert unsupported files before the performance. The player does not download or transcode media.

For optional captions, place a WebVTT file beside the video with the same basename (`intro.mp4` and `intro.vtt`). Captions are enabled by default when a matching track exists. Burned-in subtitles are already part of the picture. No captions are invented or fetched online.

## Set up the audience output

Use a separate laptop desktop for controls. The two audience displays may mirror **one another**, not the operator desktop. Actual arrangements depend on the laptop, adapters and macOS display settings.

Click **Open audience window**, move that window to the audience display, then click **Enable sound & fullscreen** there. Browser sound/fullscreen permissions require that real click. The show output has no transport bar after setup. Check the operating system's selected sound output and play a test clip at room volume.

Use one operator page and one audience window. Close unused audience windows to avoid duplicate sound. Escape exits fullscreen; re-enter it through the audience window's setup button. Do not close the local server during the performance. The room server listens only on the laptop's loopback address, not the LAN.

Opening a second operator tab in the same browser is blocked. If the audience window closes or disconnects, click **Open audience window** again; this safely returns the room to hold before reconnecting. Reloading the operator page also returns a connected output to hold rather than resuming a guessed cue.

Use **Close audience window** under setup when finished. Browsers can normally close a window opened by the operator button; if you opened the output manually in another tab, close that tab normally.

## During the show

- **GO** starts the selected next cue. Selecting a cue alone never starts playback.
- **Space** is GO when focus is outside form fields/buttons; held-down keys do not repeat GO.
- **Live scenes** show the holding screen and wait indefinitely for the next GO.
- **Video end** returns to the holding screen by default. Only explicitly enabled auto-follow starts the next media cue; it never starts a live scene automatically.
- **Images** stay up until GO, Hold or Blackout.
- **Pause / Resume** controls the current video.
- **Restart current** replays the current cue.
- **Hold** (`H`) stops the current media and shows the hold. **Blackout** (`B`) stops it and shows black. Neither automatically advances the rundown.
- A missing/failed media cue returns to hold and reports the issue on the operator screen. It never silently skips ahead.

Runtime playback is intentionally not resumed after a laptop/browser restart. Reconnect the audience window, select the correct next cue and start deliberately. Saved cue edits survive server restarts; playback is not an unattended schedule.

## Soundboard

The **LIFE IS A HIGHWAY** pad starts unconfigured: no Rascal Flatts audio is included or downloaded. Put your local three-second clip (or the full local source file) in the selected media folder, then open **Set up first sound**. Choose the file, enter the exact start time in seconds, leave the duration at **3 seconds**, choose a volume, and **Save sound**. A standalone three-second clip starts at zero; a full song needs your chosen start timestamp.

Audio-only MP3/WAV/M4A/AAC/OGG/FLAC and the listed video formats can be selected. A video used as a sound plays **only its audio**; its picture never replaces the room screen. Browser codec support varies, so run **Check show files** and preview the sound on the show laptop before using it. A trim that extends beyond the source is rejected. An unconfigured pad stays disabled and does not fail the rest of the show check.

Click the pad or press **1** outside form fields/buttons. It plays once for the chosen duration through the audience window's sound output, independently of the video, hold, and rundown. Pressing it again restarts that sound, rather than layering multiple copies. **Stop sound** stops only the soundboard. GO, Pause and Hold do not interrupt it; **Blackout**, closing the audience window, and operator-page takeover stop it for safety. There is no automatic video-volume ducking, so test the sound level over any video audio.

Sound/file settings cannot be changed during active video or sound playback. Sound files stay in the local folder; the rundown backup stores only the file reference and trim settings. After restarting or moving the player, confirm the file and speaker routing again. The soundboard does not play to online viewers or send any online-show commands.

## Save and move a show

Edits and the selected folder are saved locally in `.room-player/show.json` (ignored by Git and deployment). **Export rundown** makes a portable JSON backup; **Import rundown** replaces the local room rundown. These files contain labels, notes and local paths, **not the videos themselves**. On another laptop, copy the original media folder too and update its location.

For an alternate local settings directory or port:

```sh
npm run room -- --state-dir "/absolute/path/to/local-settings" --port 2008
```

Nothing in this tool starts, pauses or advances the online audience's program. Continue running the online queue independently.

## Verification

```sh
npm run test:room
```

The focused tests cover cue transitions and stale/double events, audience playback recovery/holding behavior, independent sound timing/retrigger/Stop, operator recovery and keyboard safeguards, local manifest persistence, safe media access, byte-range seeking and loopback-only server boundaries. Real speaker routing and two-display fullscreen placement still require a physical rehearsal.

Implementation verification (2026-10-10): 141 automated checks passed (26 state, 23 server, 65 output, 27 operator). In the in-app browser, generated local H.264/AAC clips played unmuted with matching VTT captions; pause/resume, blackout, explicit auto-follow, video-end looping hold, manual live waits, missing-file preflight, saved multiline notes, operator reload/takeover, duplicate-operator blocking, and the operator's output-open/close controls were verified. Soundboard browser checks used a generated quiet tone, not the requested song: it sought to 5 seconds, played a 3-second excerpt alongside the room video, restarted on retrigger, stopped independently, and stopped on Blackout. A local video also supplied audio without replacing the holding picture. Output reload and setup recovery after closing an active sound were verified. Only isolated temporary rundown/media folders were used. No online program controls were invoked, and the actual song clip is still unconfigured.

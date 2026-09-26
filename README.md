# Overdrive — Volume & Speed Booster

A Chrome extension that lets you push any video/audio element past 100% volume
(up to 200%, in 1% steps) and control playback speed up to 10x — on YouTube,
Pornhub, plain `.mp3`/`.mp4` files, anime streaming sites, or anything else
that uses a standard HTML `<video>`/`<audio>` element.

## How it works

- **Volume boost:** native HTML5 media can't go above 100%. This extension
  routes each media element's audio through the Web Audio API (a `GainNode`),
  which can amplify the signal up to 2x. Above ~150–170% you may hear
  clipping/distortion on already-loud sources — that's the audio itself
  hitting its ceiling, not a bug.
- **Speed control:** sets `playbackRate` directly on the media element
  (0.1x–10x). Above ~4x, audio pitch will sound noticeably higher on most
  browsers, and above 6–8x many sites stop decoding video frames fast enough
  to look smooth — that's a browser/codec limit, not something an extension
  can get around.
- Settings are saved **per site** (per hostname) via `chrome.storage.local`,
  so YouTube and Pornhub can each remember their own volume/speed.
- A `MutationObserver` watches the page for players that load in later
  (YouTube's SPA navigation, lazy-loaded embeds, etc.) and wires them up
  automatically.

## Install (unpacked, since this isn't published to the Chrome Web Store)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension from these files).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Pin the extension (puzzle-piece icon in the toolbar → pin "Overdrive").

## Use

1. Open a page with a video or audio playing.
2. Click the Overdrive icon.
3. Drag the **Volume** fader (0–200%) or **Speed** fader (0.1x–10x), use the
   `−`/`+` buttons for single-step nudges, or tap a preset.
4. **Reset to normal** puts both back to 100% / 1x.

If the popup says "unavailable here," the page is a browser-internal page
(`chrome://…`, the Web Store, etc.) where extensions aren't allowed to run —
this is a Chrome restriction, not something the extension can fix.

## Notes / limitations

- Some sites (mainly DRM-protected streaming players) block direct access to
  the underlying audio graph. If that happens, volume falls back to the
  native 0–100% range automatically; speed control is unaffected.
- The first time a tab plays audio, browsers require a user gesture (a click)
  before Web Audio is allowed to run — clicking play (or clicking the
  extension's slider) satisfies that.

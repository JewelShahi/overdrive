# Overdrive — Volume & Speed Booster

A Chrome extension that lets you push any video or audio element past 100% volume (up to 250%, in 1% steps) and control playback speed up to 10x — on YouTube, streaming media sites, plain `.mp3`/`.mp4` files, or anything else that uses a standard HTML `<video>` or `<audio>` element.

## How it works

- **Volume boost:** Native HTML5 media cannot go above 100%. This extension routes each media element's audio through the Web Audio API (a `GainNode`), which can amplify the signal up to 2.5x. Above ~150–170%, you may hear clipping or distortion on already-loud sources — that is the audio itself hitting its ceiling, not a bug.
- **Speed control:** Sets `playbackRate` directly on the media element (0.1x–10x). Above ~4x, audio pitch will sound noticeably higher on most browsers, and above 6–8x many sites stop decoding video frames fast enough to look smooth — that is a browser/codec limit, not something an extension can circumvent.
- **Per-site persistence:** Settings are saved **per site** (per hostname) via `chrome.storage.local`, so different domains automatically retain their own volume and speed preferences.
- **Dynamic tracking:** A `MutationObserver` watches pages for players that load in dynamically (single-page app navigations, lazy-loaded embeds, etc.) and tracks active players automatically (displayed in the header counter).

## Install (unpacked)

1. Unzip this folder somewhere permanent (do not delete it after installing — Chrome loads the extension directly from these files).
2. Open `chrome://extensions` in your browser.
3. Turn on **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the extension folder.
5. Pin the extension to your toolbar (puzzle-piece icon → pin "Overdrive").

## Interface & Usage

1. Open a web page playing audio or video.
2. Click the Overdrive icon in your browser toolbar to open the control panel.
3. **Volume Controls:**
   - Drag the **Volume** slider (0–250%) or use the `−` and `+` buttons for precise adjustments.
   - Quick presets: **50%**, **100%**, **150%**, **200%**, and **250%**.
4. **Speed Controls:**
   - Drag the **Speed** slider (0.1x–10x) or use the `−` and `+` buttons.
   - Quick presets: **0.25x**, **0.5x**, **1x**, **1.5x**, **2x**, **4x**, **8x**, and **10x**.
5. Click **Reset to normal** to quickly restore both controls to 100% volume and 1x speed.

> **Note:** If the popup indicates "unavailable here," the current page is a browser-restricted URL (`chrome://…`, Chrome Web Store, etc.) where Chrome prevents content scripts from executing.

## Technical limitations

- **DRM & Cross-Origin Media:** Some media players (such as DRM-protected streams) block direct cross-origin access to the underlying Web Audio graph. On those elements, volume adjustment falls back to the native 0–100% range automatically; speed control remains unaffected.
- **Autoplay Restrictions:** Browsers require an initial user gesture (such as clicking play or interacting with the extension sliders) before Web Audio contexts are permitted to output audio.
// Overdrive — Volume & Speed Booster
// Per-page volume/speed control for <video>/<audio> elements.
//
// Important behavior:
// - Every fresh page starts at the defaults (100% / 1x).
// - Nothing is saved to chrome.storage, so reopening/reloading a page resets it.
// - The Web Audio graph is created once per media element and never stacked.
// - Pausing/unpausing only resumes the AudioContext; it does NOT re-apply or
//   multiply the gain, which prevents the "volume suddenly gets boosted"
//   bug on YouTube and similar players.

(() => {
  const MIN_VOL = 0;
  const MAX_VOL = 250;
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 10;

  const DEFAULTS = Object.freeze({
    volume: 100,
    speed: 1,
  });

  // State belongs only to this content-script/page instance.
  // A reload or reopening the URL creates a new content script and therefore
  // starts from DEFAULTS again.
  let state = { ...DEFAULTS };

  let audioCtx = null;

  // Prevents the same media element from ever getting another
  // MediaElementSource/GainNode chain.
  const rigged = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;

      if (!AC) {
        return null;
      }

      try {
        audioCtx = new AC();
      } catch (error) {
        audioCtx = null;
        return null;
      }
    }

    // Browsers commonly suspend an AudioContext until a user gesture.
    // Resuming it is safe and does not change the gain value.
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    return audioCtx;
  }

  function setNativeVolumeForWebAudio(el) {
    // The extension's GainNode is the source of truth for volume.
    if (el.volume !== 1) {
      el.volume = 1;
    }
  }

  function rig(el) {
    let entry = rigged.get(el);

    if (entry) {
      return entry;
    }

    const ctx = getAudioContext();

    if (!ctx) {
      entry = {
        source: null,
        gain: null,
        usesWebAudio: false,
      };

      rigged.set(el, entry);
      return entry;
    }

    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);

      entry = {
        source,
        gain,
        usesWebAudio: true,
      };
    } catch (error) {
      // The media element may already belong to another Web Audio graph.
      // Fall back to native volume instead of creating another graph.
      entry = {
        source: null,
        gain: null,
        usesWebAudio: false,
      };
    }

    rigged.set(el, entry);

    // IMPORTANT:
    // Do not call applyTo() from "play". Play/pause is not a volume-setting
    // event. Some players, especially YouTube, change their internal media
    // state around pause/resume. Re-applying the complete audio setup there
    // was the source of the unwanted volume jump.
    el.addEventListener(
      "play",
      () => {
        getAudioContext();
      },
      { passive: true }
    );

    // Keep the requested speed if a player silently changes it.
    // This handler never touches audio gain.
    el.addEventListener(
      "ratechange",
      () => {
        if (
          Number.isFinite(state.speed) &&
          Math.abs(el.playbackRate - state.speed) > 0.01
        ) {
          try {
            el.playbackRate = state.speed;
          } catch (error) {
            // Some protected/player-controlled elements may reject it.
          }
        }
      },
      { passive: true }
    );

    // When a page/player changes native volume, keep native volume at 100%.
    // The extension gain remains the single volume control.
    if (entry.usesWebAudio) {
      el.addEventListener(
        "volumechange",
        () => {
          if (el.volume !== 1) {
            el.volume = 1;
          }
        },
        { passive: true }
      );
    }

    return entry;
  }

  function applyTo(el) {
    if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) {
      return;
    }

    const entry = rig(el);

    if (entry.usesWebAudio && entry.gain) {
      // Absolute gain. It is NEVER multiplied by the previous gain.
      entry.gain.gain.setValueAtTime(
        state.volume / 100,
        entry.gain.context.currentTime
      );

      setNativeVolumeForWebAudio(el);
    } else {
      // Native fallback cannot exceed 100%.
      el.volume = clamp(state.volume / 100, 0, 1);
    }

    try {
      if (Math.abs(el.playbackRate - state.speed) > 0.01) {
        el.playbackRate = state.speed;
      }

      if (Math.abs(el.defaultPlaybackRate - state.speed) > 0.01) {
        el.defaultPlaybackRate = state.speed;
      }
    } catch (error) {
      // Ignore media elements that reject playback-rate changes.
    }
  }

  function allMedia(root = document) {
    return Array.from(root.querySelectorAll("video, audio"));
  }

  function applyAll() {
    allMedia().forEach(applyTo);
  }

  // Watch for players added after load (YouTube SPA navigation, lazy-loaded
  // media, ads, embeds, etc.).
  const observer = new MutationObserver((mutations) => {
    let foundMedia = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }

        if (node.matches?.("video, audio")) {
          foundMedia = true;
          continue;
        }

        if (node.querySelector?.("video, audio")) {
          foundMedia = true;
        }
      }
    }

    if (foundMedia) {
      applyAll();
    }
  });

  function startObserving() {
    const root = document.documentElement || document;

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  // Messages from the popup.
  //
  // State is deliberately NOT written to chrome.storage.
  // Each loaded page/frame gets its own state:
  //
  //   Site A -> can be 200%
  //   Site B -> can independently be 150%
  //   Reload/reopen -> starts at 100%
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === "overdrive:getState") {
      sendResponse({
        hostname: location.hostname || "local-file",
        volume: state.volume,
        speed: state.speed,
        mediaCount: allMedia().length,
      });

      return true;
    }

    if (msg.type === "overdrive:setVolume") {
      state.volume = clamp(
        Math.round(Number(msg.value)),
        MIN_VOL,
        MAX_VOL
      );

      applyAll();

      sendResponse({
        ok: true,
        volume: state.volume,
      });

      return true;
    }

    if (msg.type === "overdrive:setSpeed") {
      state.speed = clamp(
        Math.round(Number(msg.value) * 100) / 100,
        MIN_SPEED,
        MAX_SPEED
      );

      applyAll();

      sendResponse({
        ok: true,
        speed: state.speed,
      });

      return true;
    }

    if (msg.type === "overdrive:reset") {
      state = { ...DEFAULTS };
      applyAll();

      sendResponse({
        ok: true,
        volume: state.volume,
        speed: state.speed,
      });

      return true;
    }
  });

  function primeAudioOnGesture() {
    const prime = () => {
      getAudioContext();
    };

    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
      document.addEventListener(eventName, prime, {
        once: true,
        capture: true,
        passive: true,
      });
    });
  }

  function init() {
    // No storage load here on purpose.
    state = { ...DEFAULTS };

    applyAll();
    startObserving();
    primeAudioOnGesture();

    document.addEventListener("DOMContentLoaded", applyAll, { once: true });
    window.addEventListener("load", applyAll, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
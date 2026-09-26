// Overdrive — Volume & Speed Booster
// Per-page volume/speed control for <video>/<audio> elements.
//
// Volume behavior:
// - The website/player keeps its own native volume.
// - Overdrive adds a Web Audio gain multiplier on top.
// - Example:
//     YouTube 5%   + Overdrive 250% = 12.5%
//     YouTube 50%  + Overdrive 200% = 100%
//     YouTube 100% + Overdrive 250% = 250%
//
// Storage:
// - Volume and speed are saved in localStorage per hostname.
// - Reloading the page keeps the settings.
// - Reset removes the saved settings for that hostname.
//
// Important:
// - The Web Audio graph is created once per media element.
// - Gain is always set absolutely, never multiplied repeatedly.
// - Pausing/unpausing does not multiply the gain again.

(() => {
  const MIN_VOL = 0;
  const MAX_VOL = 250;

  const MIN_SPEED = 0.25;
  const MAX_SPEED = 10;

  const DEFAULTS = Object.freeze({
    volume: 100,
    speed: 1,
  });

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------

  let state = { ...DEFAULTS };

  let audioCtx = null;

  // Prevents the same media element from getting another
  // MediaElementSource/GainNode chain.
  const rigged = new WeakMap();

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Store settings separately for each website.
  //
  // Example:
  //   overdrive:youtube.com
  //   overdrive:netflix.com
  //
  function storageKey() {
    return `overdrive:${location.hostname || "local-file"}`;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(
        storageKey()
      );

      if (!saved) {
        return { ...DEFAULTS };
      }

      const parsed = JSON.parse(saved);

      const volume = Number(parsed.volume);
      const speed = Number(parsed.speed);

      return {
        volume: Number.isFinite(volume)
          ? clamp(
              Math.round(volume),
              MIN_VOL,
              MAX_VOL
            )
          : DEFAULTS.volume,

        speed: Number.isFinite(speed)
          ? clamp(
              Math.round(speed * 100) / 100,
              MIN_SPEED,
              MAX_SPEED
            )
          : DEFAULTS.speed,
      };
    } catch (error) {
      return { ...DEFAULTS };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify(state)
      );
    } catch (error) {
      // Storage may be unavailable on some pages.
      // Continue using in-memory state.
    }
  }

  function removeSavedState() {
    try {
      localStorage.removeItem(
        storageKey()
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  // ------------------------------------------------------------
  // AudioContext
  // ------------------------------------------------------------

  function getAudioContext() {
    if (!audioCtx) {
      const AC =
        window.AudioContext ||
        window.webkitAudioContext;

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

    // Browsers commonly suspend AudioContext until
    // a user gesture.
    //
    // Resuming does NOT change the gain value.
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    return audioCtx;
  }

  // ------------------------------------------------------------
  // Create Web Audio graph
  // ------------------------------------------------------------

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
      const source =
        ctx.createMediaElementSource(el);

      const gain =
        ctx.createGain();

      // Audio path:
      //
      // <video>/<audio>
      //       ↓
      //    GainNode
      //       ↓
      //   speakers
      //
      source.connect(gain);
      gain.connect(ctx.destination);

      entry = {
        source,
        gain,
        usesWebAudio: true,
      };
    } catch (error) {
      // The media element may already belong to
      // another Web Audio graph.
      //
      // Fall back to native volume.
      entry = {
        source: null,
        gain: null,
        usesWebAudio: false,
      };
    }

    rigged.set(el, entry);

    // ----------------------------------------------------------
    // Play
    // ----------------------------------------------------------
    //
    // IMPORTANT:
    // Do not change volume here.
    //
    // Playing/pausing should not multiply the gain again.

    el.addEventListener(
      "play",
      () => {
        getAudioContext();
      },
      { passive: true }
    );

    // ----------------------------------------------------------
    // Playback speed
    // ----------------------------------------------------------

    el.addEventListener(
      "ratechange",
      () => {
        if (
          Number.isFinite(state.speed) &&
          Math.abs(
            el.playbackRate -
              state.speed
          ) > 0.01
        ) {
          try {
            el.playbackRate =
              state.speed;
          } catch (error) {
            // Some players may reject the change.
          }
        }
      },
      { passive: true }
    );

    // ----------------------------------------------------------
    // IMPORTANT:
    //
    // There is intentionally NO volumechange handler here.
    //
    // We do NOT do this:
    //
    //     el.volume = 1;
    //
    // The website is allowed to control its own volume.
    //
    // Example:
    //
    //     YouTube = 5%
    //     Overdrive = 250%
    //
    //     0.05 × 2.5 = 0.125
    //
    //     Effective volume = 12.5%
    //
    // ----------------------------------------------------------

    return entry;
  }

  // ------------------------------------------------------------
  // Apply volume
  // ------------------------------------------------------------

  function applyVolume(el) {
    if (
      !el ||
      (
        el.tagName !== "VIDEO" &&
        el.tagName !== "AUDIO"
      )
    ) {
      return;
    }

    const entry = rig(el);

    if (
      entry.usesWebAudio &&
      entry.gain
    ) {
      // --------------------------------------------------------
      // IMPORTANT:
      //
      // This is an absolute gain value.
      //
      // 100% = 1.0x
      // 150% = 1.5x
      // 200% = 2.0x
      // 250% = 2.5x
      //
      // We DO NOT change el.volume.
      //
      // The website's volume remains independent.
      // --------------------------------------------------------

      const gainValue =
        state.volume / 100;

      entry.gain.gain.setValueAtTime(
        gainValue,
        entry.gain.context.currentTime
      );
    } else {
      // --------------------------------------------------------
      // Fallback if Web Audio isn't available.
      //
      // Native HTML media volume cannot exceed 100%.
      // --------------------------------------------------------

      el.volume = clamp(
        state.volume / 100,
        0,
        1
      );
    }
  }

  // ------------------------------------------------------------
  // Apply playback speed
  // ------------------------------------------------------------

  function applySpeed(el) {
    if (
      !el ||
      (
        el.tagName !== "VIDEO" &&
        el.tagName !== "AUDIO"
      )
    ) {
      return;
    }

    try {
      if (
        Math.abs(
          el.playbackRate -
            state.speed
        ) > 0.01
      ) {
        el.playbackRate =
          state.speed;
      }

      if (
        Math.abs(
          el.defaultPlaybackRate -
            state.speed
        ) > 0.01
      ) {
        el.defaultPlaybackRate =
          state.speed;
      }
    } catch (error) {
      // Ignore media elements that reject
      // playback-rate changes.
    }
  }

  // ------------------------------------------------------------
  // Apply everything to one media element
  // ------------------------------------------------------------

  function applyTo(el) {
    if (
      !el ||
      (
        el.tagName !== "VIDEO" &&
        el.tagName !== "AUDIO"
      )
    ) {
      return;
    }

    applyVolume(el);
    applySpeed(el);
  }

  // ------------------------------------------------------------
  // Find all media
  // ------------------------------------------------------------

  function allMedia(root = document) {
    return Array.from(
      root.querySelectorAll(
        "video, audio"
      )
    );
  }

  function applyAll() {
    allMedia().forEach(
      applyTo
    );
  }

  // ------------------------------------------------------------
  // Watch for dynamically-created media
  // ------------------------------------------------------------
  //
  // Useful for YouTube SPA navigation,
  // lazy-loaded videos, ads, etc.
  //

  const observer =
    new MutationObserver(
      (mutations) => {
        let foundMedia = false;

        for (
          const mutation of mutations
        ) {
          for (
            const node of mutation.addedNodes
          ) {
            if (
              node.nodeType !==
              Node.ELEMENT_NODE
            ) {
              continue;
            }

            if (
              node.matches?.(
                "video, audio"
              )
            ) {
              foundMedia = true;
              continue;
            }

            if (
              node.querySelector?.(
                "video, audio"
              )
            ) {
              foundMedia = true;
            }
          }
        }

        if (foundMedia) {
          applyAll();
        }
      }
    );

  function startObserving() {
    const root =
      document.documentElement ||
      document;

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  // ------------------------------------------------------------
  // Messages from popup
  // ------------------------------------------------------------

  chrome.runtime.onMessage.addListener(
    (
      msg,
      sender,
      sendResponse
    ) => {
      if (
        !msg ||
        !msg.type
      ) {
        return;
      }

      // --------------------------------------------------------
      // Get current state
      // --------------------------------------------------------

      if (
        msg.type ===
        "overdrive:getState"
      ) {
        sendResponse({
          hostname:
            location.hostname ||
            "local-file",

          volume:
            state.volume,

          speed:
            state.speed,

          mediaCount:
            allMedia().length,
        });

        return true;
      }

      // --------------------------------------------------------
      // Set volume
      // --------------------------------------------------------

      if (
        msg.type ===
        "overdrive:setVolume"
      ) {
        state.volume =
          clamp(
            Math.round(
              Number(msg.value)
            ),
            MIN_VOL,
            MAX_VOL
          );

        // Save per website.
        saveState();

        // Apply immediately.
        applyAll();

        sendResponse({
          ok: true,
          volume:
            state.volume,
        });

        return true;
      }

      // --------------------------------------------------------
      // Set speed
      // --------------------------------------------------------

      if (
        msg.type ===
        "overdrive:setSpeed"
      ) {
        state.speed =
          clamp(
            Math.round(
              Number(msg.value) *
                100
            ) / 100,
            MIN_SPEED,
            MAX_SPEED
          );

        // Save per website.
        saveState();

        // Apply immediately.
        applyAll();

        sendResponse({
          ok: true,
          speed:
            state.speed,
        });

        return true;
      }

      // --------------------------------------------------------
      // Reset
      // --------------------------------------------------------

      if (
        msg.type ===
        "overdrive:reset"
      ) {
        state = {
          ...DEFAULTS,
        };

        // Delete saved settings for this website.
        removeSavedState();

        applyAll();

        sendResponse({
          ok: true,
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return true;
      }
    }
  );

  // ------------------------------------------------------------
  // Prime AudioContext after user gesture
  // ------------------------------------------------------------

  function primeAudioOnGesture() {
    const prime = () => {
      getAudioContext();

      // Make sure any media that appeared before
      // the gesture gets the current gain.
      applyAll();
    };

    [
      "pointerdown",
      "keydown",
      "touchstart",
    ].forEach(
      (eventName) => {
        document.addEventListener(
          eventName,
          prime,
          {
            once: true,
            capture: true,
            passive: true,
          }
        );
      }
    );
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------

  function init() {
    // Load saved settings for this website.
    //
    // Example:
    // youtube.com -> 250%, 1.5x
    // another.com -> 150%, 1x
    //
    state = loadState();

    applyAll();

    startObserving();

    primeAudioOnGesture();

    document.addEventListener(
      "DOMContentLoaded",
      applyAll,
      { once: true }
    );

    window.addEventListener(
      "load",
      applyAll,
      { once: true }
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
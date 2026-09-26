// Overdrive — Volume & Speed Booster
// Runs in every frame of every page. Finds <video>/<audio> elements,
// routes their audio through a GainNode (so volume can exceed the
// native 100% ceiling) and drives playbackRate directly for speed.

(() => {
  const MIN_VOL = 0, MAX_VOL = 250;
  const MIN_SPEED = 0.25, MAX_SPEED = 10;
  const DEFAULTS = { volume: 100, speed: 1 };

  const hostname = location.hostname || "local-file";
  const storageKey = "overdrive:" + hostname;

  let state = { ...DEFAULTS };
  let audioCtx = null;
  const rigged = new WeakMap(); // media element -> { gain, source, usesWebAudio }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function rig(el) {
    let entry = rigged.get(el);
    if (entry) return entry;

    try {
      const ctx = getCtx();
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      entry = { gain, source, usesWebAudio: true };
      el.volume = 1; // real gain now lives in the GainNode, 0..2
    } catch (e) {
      // Element already wired to another graph, or blocked — fall back
      // to native volume, which caps boosting at 100%.
      entry = { usesWebAudio: false };
    }

    rigged.set(el, entry);

    const reapply = () => applyTo(el);
    el.addEventListener("play", () => { getCtx(); reapply(); });
    el.addEventListener("loadedmetadata", reapply);
    el.addEventListener("ratechange", () => {
      // Some players (YouTube quality/ad switches) silently reset the
      // rate; snap it back if it drifted from our setting.
      if (Math.abs(el.playbackRate - state.speed) > 0.01) {
        el.playbackRate = state.speed;
      }
    });

    return entry;
  }

  function applyTo(el) {
    const entry = rig(el);
    if (entry.usesWebAudio) {
      entry.gain.gain.value = state.volume / 100;
      el.volume = 1;
    } else {
      el.volume = clamp(state.volume / 100, 0, 1);
    }
    el.playbackRate = state.speed;
    el.defaultPlaybackRate = state.speed;
  }

  function allMedia(root = document) {
    return Array.from(root.querySelectorAll("video, audio"));
  }

  function applyAll() {
    allMedia().forEach(applyTo);
  }

  // Watch for players added after load (SPA navigation, lazy-loaded
  // embeds, ad-swapped elements, etc).
  const observer = new MutationObserver((mutations) => {
    let found = false;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches("video, audio")) found = true;
        if (node.querySelectorAll) {
          if (node.querySelectorAll("video, audio").length) found = true;
        }
      });
    }
    if (found) applyAll();
  });

  function startObserving() {
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  }

  function loadState() {
    chrome.storage.local.get([storageKey], (res) => {
      state = { ...DEFAULTS, ...(res[storageKey] || {}) };
      applyAll();
    });
  }

  function saveState() {
    chrome.storage.local.set({ [storageKey]: state });
  }

  // Messages from the popup.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "overdrive:getState") {
      sendResponse({
        hostname,
        volume: state.volume,
        speed: state.speed,
        mediaCount: allMedia().length,
      });
      return true;
    }

    if (msg.type === "overdrive:setVolume") {
      state.volume = clamp(Math.round(msg.value), MIN_VOL, MAX_VOL);
      applyAll();
      saveState();
      sendResponse({ ok: true, volume: state.volume });
    }

    if (msg.type === "overdrive:setSpeed") {
      state.speed = clamp(Math.round(msg.value * 100) / 100, MIN_SPEED, MAX_SPEED);
      applyAll();
      saveState();
      sendResponse({ ok: true, speed: state.speed });
    }

    if (msg.type === "overdrive:reset") {
      state = { ...DEFAULTS };
      applyAll();
      saveState();
      sendResponse({ ok: true, volume: state.volume, speed: state.speed });
    }
  });

  function primeAudioOnGesture() {
    const prime = () => { getCtx(); };
    ["pointerdown", "keydown", "touchstart"].forEach((evt) =>
      document.addEventListener(evt, prime, { once: true, capture: true })
    );
  }

  function init() {
    loadState();
    startObserving();
    primeAudioOnGesture();
    // Some elements exist before the observer attaches.
    document.addEventListener("DOMContentLoaded", applyAll);
    window.addEventListener("load", applyAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

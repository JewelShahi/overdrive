(() => {
  const MIN_VOL = 0;
  const MAX_VOL = 250;

  const MIN_SPEED = 0.25;
  const MAX_SPEED = 10;

  const DEFAULTS = {
    volume: 100,
    speed: 1,
  };

  /*
   * Current site's settings
   */
  let state = {
    volume:
      DEFAULTS.volume,

    speed:
      DEFAULTS.speed,
  };

  let initialized = false;

  let currentHost = null;

  let audioCtx = null;

  let audioUnlocked = false;

  /*
   * Each media element gets exactly one:
   *
   * MediaElementSource -> GainNode -> Destination
   *
   * WeakMap prevents duplicate audio rigs
   */
  const rigged = new WeakMap();

  /*
   * Track media elements that have already been watched
   */
  const watched = new WeakSet();

  /*
   * --------------------------------------------------
   * Value helpers
   * --------------------------------------------------
   */

  function clampVolume(value) {
    value =
      Number(value);

    if (
      !Number.isFinite(
        value
      )
    ) {
      return DEFAULTS.volume;
    }

    return Math.min(
      MAX_VOL,
      Math.max(
        MIN_VOL,
        Math.round(value)
      )
    );
  }

  function clampSpeed(value) {
    value =
      Number(value);

    if (
      !Number.isFinite(
        value
      )
    ) {
      return DEFAULTS.speed;
    }

    return Math.min(
      MAX_SPEED,
      Math.max(
        MIN_SPEED,
        Math.round(
          value * 100
        ) / 100
      )
    );
  }

  function normalizeState(value) {
    return {
      volume:
        clampVolume(
          value?.volume
        ),

      speed:
        clampSpeed(
          value?.speed
        ),
    };
  }

  /*
   * --------------------------------------------------
   * Storage
   * --------------------------------------------------
   */

  function getHost() {
    try {
      return (
        new URL(
          location.href
        ).hostname ||
        null
      );
    } catch (error) {
      return null;
    }
  }

  function getStorageKey(host) {
    return `overdrive:site:${host}`;
  }

  async function readSiteSettings() {
    if (!currentHost) {
      return {
        ...DEFAULTS,
      };
    }

    try {
      const key =
        getStorageKey(
          currentHost
        );

      const result =
        await chrome.storage.local.get(
          key
        );

      if (
        !result ||
        !result[key]
      ) {
        return {
          ...DEFAULTS,
        };
      }

      return normalizeState(
        result[key]
      );
    } catch (error) {
      return {
        ...DEFAULTS,
      };
    }
  }

  async function writeSiteSettings() {
    if (!currentHost) {
      return;
    }

    try {
      const key =
        getStorageKey(
          currentHost
        );

      await chrome.storage.local.set({
        [key]:
          normalizeState(
            state
          ),
      });
    } catch (error) {
      // Ignore storage errors
    }
  }

  async function restoreState() {
    state =
      await readSiteSettings();
  }

  /*
   * --------------------------------------------------
   * Web Audio
   * --------------------------------------------------
   */

  function getAudioContext() {
    if (audioCtx) {
      return audioCtx;
    }

    /*
     * Do not create AudioContext automatically
     * before a user gesture
     */
    if (!audioUnlocked) {
      return null;
    }

    try {
      audioCtx =
        new AudioContext();
    } catch (error) {
      audioCtx = null;
    }

    return audioCtx;
  }

  async function unlockAudio() {
    audioUnlocked = true;

    const ctx =
      getAudioContext();

    if (!ctx) {
      return false;
    }

    if (
      ctx.state ===
      "suspended"
    ) {
      try {
        await ctx.resume();
      } catch (error) {
        return false;
      }
    }

    return (
      ctx.state ===
      "running"
    );
  }

  function rig(el) {
    if (
      !el ||
      rigged.has(el)
    ) {
      return;
    }

    /*
     * Do not create Web Audio until
     * the page has received a user gesture
     */
    const ctx =
      getAudioContext();

    if (!ctx) {
      return;
    }

    try {
      const source =
        ctx.createMediaElementSource(
          el
        );

      const gain =
        ctx.createGain();

      source.connect(
        gain
      );

      gain.connect(
        ctx.destination
      );

      rigged.set(
        el,
        {
          source,
          gain,
        }
      );

      /*
       * Apply current settings immediately
       */
      gain.gain.value =
        state.volume / 100;
    } catch (error) {
      /*
       * MediaElementSource can fail for certain
       * protected/cross-origin media
       *
       * Leave the element alone in that case
       */
    }
  }

  /*
   * --------------------------------------------------
   * Media helpers
   * --------------------------------------------------
   */

  function applyVolume(el) {
    const connection =
      rigged.get(el);

    if (!connection) {
      /*
       * Do not modify native/player volume
       *
       * Without Web Audio we cannot amplify the
       * media above its native volume safely
       */
      return;
    }

    const nextGain =
      state.volume / 100;

    if (
      Math.abs(
        connection.gain.gain.value -
          nextGain
      ) > 0.001
    ) {
      connection.gain.gain.value =
        nextGain;
    }
  }

  function applySpeed(el) {
    if (!el) {
      return;
    }

    const nextSpeed =
      state.speed;

    try {
      /*
       * Avoid unnecessary writes
       */
      if (
        Math.abs(
          el.playbackRate -
            nextSpeed
        ) > 0.001
      ) {
        el.playbackRate =
          nextSpeed;
      }

      if (
        Math.abs(
          el.defaultPlaybackRate -
            nextSpeed
        ) > 0.001
      ) {
        el.defaultPlaybackRate =
          nextSpeed;
      }
    } catch (error) {
      // Ignore media errors
    }
  }

  function applyToMedia(el) {
    if (!el) {
      return;
    }

    /*
     * Speed works without Web Audio
     */
    applySpeed(el);

    /*
     * Volume amplification requires Web Audio
     */
    rig(el);

    applyVolume(el);
  }

  function findMediaInNode(node) {
    if (
      !node ||
      node.nodeType !==
        Node.ELEMENT_NODE
    ) {
      return [];
    }

    const media = [];

    /*
     * The node itself may be media
     */
    if (
      node.matches?.(
        "video, audio"
      )
    ) {
      media.push(node);
    }

    /*
     * Media may be inside the node
     */
    node
      .querySelectorAll?.(
        "video, audio"
      )
      .forEach(
        (el) => {
          media.push(el);
        }
      );

    return media;
  }

  function watchMedia(el) {
    if (!el) {
      return;
    }

    /*
     * Avoid registering the same element repeatedly
     */
    if (
      watched.has(el)
    ) {
      /*
       * Still apply the current state
       * if the site recreated/changed the player
       */
      applyToMedia(el);
      return;
    }

    watched.add(el);

    applyToMedia(el);

    /*
     * --------------------------------------------------
     * Media events
     * --------------------------------------------------
     */

    el.addEventListener(
      "loadedmetadata",
      () => {
        applySpeed(el);
        applyVolume(el);
      }
    );

    el.addEventListener(
      "loadeddata",
      () => {
        applySpeed(el);
        applyVolume(el);
      }
    );

    el.addEventListener(
      "canplay",
      () => {
        applySpeed(el);
        applyVolume(el);
      }
    );

    el.addEventListener(
      "play",
      () => {
        applySpeed(el);
        applyVolume(el);
      }
    );

    el.addEventListener(
      "ratechange",
      () => {
        /*
         * Restore only when the site changed
         * the playback rate away from our setting
         */
        if (
          Math.abs(
            el.playbackRate -
              state.speed
          ) > 0.001
        ) {
          el.playbackRate =
            state.speed;
        }
      }
    );
  }

  /*
   * --------------------------------------------------
   * Initial media scan
   * --------------------------------------------------
   *
   * Only scan once during initialization
   *
   * New players are handled by the MutationObserver
   */
  function scanExistingMedia() {
    document
      .querySelectorAll(
        "video, audio"
      )
      .forEach(
        watchMedia
      );
  }

  /*
   * --------------------------------------------------
   * Initialization
   * --------------------------------------------------
   */

  async function initialize() {
    if (initialized) {
      return;
    }

    currentHost =
      getHost();

    await restoreState();

    initialized = true;

    /*
     * Scan media once
     */
    scanExistingMedia();
  }

  /*
   * --------------------------------------------------
   * Page user interaction
   * --------------------------------------------------
   *
   * Chrome requires Web Audio to be activated
   * after a user gesture
   */

  async function activateFromPageGesture() {
    const activated =
      await unlockAudio();

    if (activated) {
      /*
       * Only scan existing media when Web Audio
       * becomes available
       */
      document
        .querySelectorAll(
          "video, audio"
        )
        .forEach(
          applyToMedia
        );
    }
  }

  document.addEventListener(
    "pointerdown",
    activateFromPageGesture,
    {
      capture: true,
      passive: true,
    }
  );

  document.addEventListener(
    "keydown",
    activateFromPageGesture,
    {
      capture: true,
      passive: true,
    }
  );

  document.addEventListener(
    "touchstart",
    activateFromPageGesture,
    {
      capture: true,
      passive: true,
    }
  );

  /*
   * --------------------------------------------------
   * Mutation observer
   * --------------------------------------------------
   *
   * Watch only for newly added media
   *
   * No continuous 1-second page scan
   */

  const observer =
    new MutationObserver(
      (mutations) => {
        for (
          const mutation
          of mutations
        ) {
          if (
            mutation.type !==
            "childList"
          ) {
            continue;
          }

          for (
            const node
            of mutation.addedNodes
          ) {
            const media =
              findMediaInNode(
                node
              );

            media.forEach(
              watchMedia
            );
          }
        }
      }
    );

  if (
    document.documentElement
  ) {
    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      }
    );
  }

  /*
   * --------------------------------------------------
   * Messages from popup
   * --------------------------------------------------
   */

  chrome.runtime.onMessage.addListener(
    (
      message,
      sender,
      sendResponse
    ) => {
      if (
        !message ||
        !message.type
      ) {
        return;
      }

      /*
       * Activate Web Audio
       */
      if (
        message.type ===
        "overdrive:activate"
      ) {
        unlockAudio().then(
          (activated) => {
            if (activated) {
              document
                .querySelectorAll(
                  "video, audio"
                )
                .forEach(
                  applyToMedia
                );
            }

            sendResponse({
              activated,
            });
          }
        );

        return true;
      }

      /*
       * Get current state
       */
      if (
        message.type ===
        "overdrive:getState"
      ) {
        initialize().then(
          () => {
            sendResponse({
              volume:
                state.volume,

              speed:
                state.speed,
            });
          }
        );

        return true;
      }

      /*
       * Set volume
       */
      if (
        message.type ===
        "overdrive:setVolume"
      ) {
        initialize().then(
          async () => {
            const nextVolume =
              clampVolume(
                message.value
              );

            state.volume =
              nextVolume;

            await writeSiteSettings();

            /*
             * Only touch existing media
             */
            document
              .querySelectorAll(
                "video, audio"
              )
              .forEach(
                applyToMedia
              );

            sendResponse({
              volume:
                state.volume,

              speed:
                state.speed,
            });
          }
        );

        return true;
      }

      /*
       * Set speed
       */
      if (
        message.type ===
        "overdrive:setSpeed"
      ) {
        initialize().then(
          async () => {
            const nextSpeed =
              clampSpeed(
                message.value
              );

            state.speed =
              nextSpeed;

            await writeSiteSettings();

            /*
             * Only touch existing media
             */
            document
              .querySelectorAll(
                "video, audio"
              )
              .forEach(
                applySpeed
              );

            sendResponse({
              volume:
                state.volume,

              speed:
                state.speed,
            });
          }
        );

        return true;
      }

      /*
       * Reset this site
       */
      if (
        message.type ===
        "overdrive:reset"
      ) {
        initialize().then(
          async () => {
            state = {
              volume:
                DEFAULTS.volume,

              speed:
                DEFAULTS.speed,
            };

            await writeSiteSettings();

            /*
             * Reset existing media immediately
             */
            document
              .querySelectorAll(
                "video, audio"
              )
              .forEach(
                applyToMedia
              );

            sendResponse({
              volume:
                state.volume,

              speed:
                state.speed,
            });
          }
        );

        return true;
      }
    }
  );

  /*
   * --------------------------------------------------
   * Start
   * --------------------------------------------------
   */

  initialize();
})();
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
   * Current tab's settings
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

  function getSiteKey(host) {
    return `overdrive:default:${host}`;
  }

  /*
   * Site defaults live in localStorage
   *
   * These survive browser restarts
   */
  function readSiteDefault() {
    if (!currentHost) {
      return {
        ...DEFAULTS,
      };
    }

    try {
      const saved =
        localStorage.getItem(
          getSiteKey(
            currentHost
          )
        );

      if (!saved) {
        return {
          ...DEFAULTS,
        };
      }

      return normalizeState(
        JSON.parse(saved)
      );
    } catch (error) {
      return {
        ...DEFAULTS,
      };
    }
  }

  function writeSiteDefault() {
    if (!currentHost) {
      return;
    }

    try {
      localStorage.setItem(
        getSiteKey(
          currentHost
        ),
        JSON.stringify(
          normalizeState(
            state
          )
        )
      );
    } catch (error) {
      // Ignore storage errors
    }
  }

  /*
   * Temporary state lives in sessionStorage
   *
   * sessionStorage is isolated per tab and origin
   *
   * This keeps:
   *
   * - different tabs independent
   * - same-tab episode changes persistent
   * - different sites separated
   */
  function readTabState() {
    try {
      const saved =
        sessionStorage.getItem(
          "overdrive:state"
        );

      if (!saved) {
        return null;
      }

      return normalizeState(
        JSON.parse(saved)
      );
    } catch (error) {
      return null;
    }
  }

  function writeTabState() {
    try {
      sessionStorage.setItem(
        "overdrive:state",
        JSON.stringify(
          normalizeState(
            state
          )
        )
      );
    } catch (error) {
      // Ignore storage errors
    }
  }

  /*
   * Restore the current tab's state
   *
   * If this tab already has temporary state,
   * restore it
   *
   * Otherwise use the site's saved default
   */
  function restoreState() {
    const saved =
      readTabState();

    if (saved) {
      state =
        saved;

      return;
    }

    state =
      readSiteDefault();

    writeTabState();
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

    if (
      ctx.state !==
      "running"
    ) {
      return false;
    }

    return true;
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

      applySpeed(el);
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

  function allMedia() {
    return Array.from(
      document.querySelectorAll(
        "video, audio"
      )
    );
  }

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

    /*
     * Overdrive is an independent multiplier
     *
     * 100% = 1.0x
     * 150% = 1.5x
     * 200% = 2.0x
     * 250% = 2.5x
     */
    connection.gain.gain.value =
      state.volume / 100;
  }

  function applySpeed(el) {
    if (!el) {
      return;
    }

    try {
      /*
       * Always restore the requested speed
       *
       * This is important for sites such as ReAnime
       * that replace the player when changing episodes
       */
      el.playbackRate =
        state.speed;

      el.defaultPlaybackRate =
        state.speed;
    } catch (error) {
      // Ignore media errors
    }
  }

  function applyToMedia(el) {
    if (!el) {
      return;
    }

    /*
     * Speed does not require Web Audio
     *
     * Apply it immediately
     */
    applySpeed(el);

    /*
     * Volume amplification requires Web Audio
     *
     * rig() does nothing until audio is unlocked
     */
    rig(el);

    applyVolume(el);
  }

  function applyAll() {
    allMedia().forEach(
      applyToMedia
    );
  }

  /*
   * --------------------------------------------------
   * Media event protection
   * --------------------------------------------------
   *
   * Streaming sites can reset playbackRate when:
   *
   * - metadata loads
   * - playback starts
   * - a new episode loads
   * - a new media element is created
   */

  function watchMedia(el) {
    if (!el) {
      return;
    }

    applyToMedia(el);

    if (
      el.dataset.overdriveWatched ===
      "true"
    ) {
      return;
    }

    el.dataset.overdriveWatched =
      "true";

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
         * Only restore the value when the site
         * changed it away from our setting
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
   * Initialization
   * --------------------------------------------------
   */

  function initialize() {
    if (initialized) {
      return;
    }

    currentHost =
      getHost();

    restoreState();

    initialized = true;

    /*
     * Apply settings immediately
     *
     * This works even when there is currently
     * no player
     *
     * Speed will automatically apply when a
     * player appears later
     */
    applyAll();
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
      applyAll();
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
   * Streaming sites constantly create/remove media
   *
   * We keep the current tab's settings and
   * automatically apply them to new players
   */

  const observer =
    new MutationObserver(
      (mutations) => {
        for (
          const mutation
          of mutations
        ) {
          for (
            const node
            of mutation.addedNodes
          ) {
            if (
              node.nodeType !==
              Node.ELEMENT_NODE
            ) {
              continue;
            }

            /*
             * The node itself may be media
             */
            if (
              node.matches?.(
                "video, audio"
              )
            ) {
              watchMedia(
                node
              );
            }

            /*
             * Or media may be inside it
             */
            node
              .querySelectorAll?.(
                "video, audio"
              )
              .forEach(
                watchMedia
              );
          }
        }
      }
    );

  if (document.documentElement) {
    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      }
    );
  }

  /*
   * Safety scan
   *
   * This catches media elements created in
   * unusual ways by streaming sites
   */
  setInterval(() => {
    allMedia().forEach(
      watchMedia
    );
  }, 1000);

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
       *
       * This does not require a player to exist
       */
      if (
        message.type ===
        "overdrive:activate"
      ) {
        unlockAudio().then(
          (activated) => {
            if (activated) {
              applyAll();
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
       *
       * This works even when there is no player
       */
      if (
        message.type ===
        "overdrive:getState"
      ) {
        initialize();

        sendResponse({
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return;
      }

      /*
       * Set volume
       *
       * This changes the Overdrive multiplier only
       *
       * It does NOT change the site's native volume
       */
      if (
        message.type ===
        "overdrive:setVolume"
      ) {
        initialize();

        state.volume =
          clampVolume(
            message.value
          );

        /*
         * Save for this tab
         */
        writeTabState();

        /*
         * Save as the site's default
         * for future tabs
         */
        writeSiteDefault();

        /*
         * Apply immediately if a player exists
         *
         * If there is no player, the state is still
         * saved and will be applied when one appears
         */
        applyAll();

        sendResponse({
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return;
      }

      /*
       * Set speed
       *
       * Speed works even when there is no player
       */
      if (
        message.type ===
        "overdrive:setSpeed"
      ) {
        initialize();

        state.speed =
          clampSpeed(
            message.value
          );

        /*
         * Save for this tab
         */
        writeTabState();

        /*
         * Save as the site's default
         * for future tabs
         */
        writeSiteDefault();

        /*
         * If there is no player, nothing is wrong
         *
         * The setting remains stored
         */
        applyAll();

        sendResponse({
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return;
      }

      /*
       * Reset this tab only
       *
       * This MUST work even if there is no player
       *
       * 100% volume
       * 1x speed
       *
       * Site default remains unchanged
       */
      if (
        message.type ===
        "overdrive:reset"
      ) {
        initialize();

        /*
         * Reset the state itself first
         *
         * A player is NOT required
         */
        state = {
          volume:
            DEFAULTS.volume,

          speed:
            DEFAULTS.speed,
        };

        /*
         * Save the reset state for this tab
         *
         * This is important when there is no player
         *
         * If a player appears later, it will use
         * 100% / 1x
         */
        writeTabState();

        /*
         * IMPORTANT:
         *
         * Do NOT call writeSiteDefault()
         *
         * Reset only affects this tab
         */
        applyAll();

        sendResponse({
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return;
      }
    }
  );

  /*
   * --------------------------------------------------
   * Start
   * --------------------------------------------------
   *
   * Initialize immediately
   *
   * No player is required
   */
  initialize();
})();
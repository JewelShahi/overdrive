(() => {
  const MIN_VOL = 0;
  const MAX_VOL = 250;

  const MIN_SPEED = 0.25;
  const MAX_SPEED = 10;

  const DEFAULTS = {
    volume: 100,
    speed: 1,
  };

  const host = location.hostname;

  /*
   * Persistent site default
   *
   * Example:
   * overdrive:youtube.com
   *
   * This is only the fallback for a new tab
   */
  const siteStorageKey =
    `overdrive:${host}`;

  /*
   * Current tab's settings
   *
   * This is intentionally kept in memory
   *
   * Refreshing a page does not destroy the
   * extension's session storage, so the tab
   * can restore its own settings
   */
  let state = {
    volume: DEFAULTS.volume,
    speed: DEFAULTS.speed,
  };

  let initialized = false;

  let audioCtx = null;

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
   * Storage helpers
   * --------------------------------------------------
   */

  function readSiteDefaults() {
    try {
      const raw =
        localStorage.getItem(
          siteStorageKey
        );

      if (!raw) {
        return {
          ...DEFAULTS,
        };
      }

      const saved =
        JSON.parse(raw);

      return {
        volume:
          clampVolume(
            saved.volume
          ),

        speed:
          clampSpeed(
            saved.speed
          ),
      };
    } catch (error) {
      return {
        ...DEFAULTS,
      };
    }
  }

  function writeSiteDefaults() {
    try {
      localStorage.setItem(
        siteStorageKey,
        JSON.stringify({
          volume: state.volume,
          speed: state.speed,
        })
      );
    } catch (error) {
      /*
       * Ignore storage errors
       */
    }
  }

  /*
   * --------------------------------------------------
   * Session storage
   * --------------------------------------------------
   *
   * chrome.storage.session survives page navigation
   * and refreshes while the browser is running
   *
   * It is cleared when Chrome is closed/restarted
   *
   * The key includes the current tab ID so each
   * tab gets independent settings
   */

  function getSessionKey(tabId) {
    return `tab:${tabId}`;
  }

  async function readTabState() {
    /*
     * Content scripts normally don't have access to
     * the tab ID directly, so ask the background/service
     * worker for it
     */
    try {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "overdrive:getTabId",
        });

      if (
        !response ||
        typeof response.tabId !==
          "number"
      ) {
        return false;
      }

      const key =
        getSessionKey(
          response.tabId
        );

      const result =
        await chrome.storage.session.get(
          key
        );

      if (
        result &&
        result[key]
      ) {
        const saved =
          result[key];

        state = {
          volume:
            clampVolume(
              saved.volume
            ),

          speed:
            clampSpeed(
              saved.speed
            ),
        };

        return true;
      }

      /*
       * No tab-specific settings yet
       *
       * Start from this site's default
       */
      state =
        readSiteDefaults();

      await writeTabState(
        response.tabId
      );

      return true;
    } catch (error) {
      /*
       * If session storage or the service worker
       * is unavailable, fall back to site defaults
       */
      state =
        readSiteDefaults();

      return false;
    }
  }

  async function writeTabState(tabId) {
    if (
      typeof tabId !==
      "number"
    ) {
      return;
    }

    try {
      const key =
        getSessionKey(tabId);

      await chrome.storage.session.set({
        [key]: {
          volume:
            state.volume,

          speed:
            state.speed,
        },
      });
    } catch (error) {
      /*
       * Ignore session-storage errors
       */
    }
  }

  async function getCurrentTabId() {
    try {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "overdrive:getTabId",
        });

      if (
        response &&
        typeof response.tabId ===
          "number"
      ) {
        return response.tabId;
      }
    } catch (error) {
      // Ignore.
    }

    return null;
  }

  /*
   * --------------------------------------------------
   * Value helpers
   * --------------------------------------------------
   */

  function clampVolume(value) {
    value =
      Number(value);

    if (
      !Number.isFinite(value)
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
      !Number.isFinite(value)
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

  /*
   * --------------------------------------------------
   * Web Audio
   * --------------------------------------------------
   */

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx =
        new AudioContext();
    }

    if (
      audioCtx.state ===
      "suspended"
    ) {
      audioCtx.resume().catch(
        () => {}
      );
    }

    return audioCtx;
  }

  function rig(el) {
    if (
      !el ||
      rigged.has(el)
    ) {
      return;
    }

    /*
     * Some media elements may not be ready
     * to be connected yet
     */
    try {
      const ctx =
        getAudioContext();

      const source =
        ctx.createMediaElementSource(
          el
        );

      const gain =
        ctx.createGain();

      source.connect(gain);

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

      el.playbackRate =
        state.speed;

      el.defaultPlaybackRate =
        state.speed;
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

    if (connection) {
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

      return;
    }

    /*
     * Fallback if Web Audio could not be attached
     *
     * Native volume cannot exceed 100%
     */
    el.volume =
      Math.min(
        1,
        state.volume / 100
      );
  }

  function applySpeed(el) {
    try {
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

    rig(el);

    applyVolume(el);
    applySpeed(el);
  }

  function applyAll() {
    allMedia().forEach(
      applyToMedia
    );
  }

  /*
   * --------------------------------------------------
   * Save current tab state
   * --------------------------------------------------
   */

  async function saveCurrentTabState() {
    const tabId =
      await getCurrentTabId();

    if (
      tabId === null
    ) {
      return;
    }

    await writeTabState(
      tabId
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

    initialized = true;

    /*
     * Restore this tab's previous settings
     *
     * If none exist, use this site's default
     */
    await readTabState();

    /*
     * Find media that already exists
     */
    applyAll();
  }

  /*
   * --------------------------------------------------
   * Mutation observer
   * --------------------------------------------------
   *
   * YouTube constantly creates/removes media elements
   *
   * We do NOT reset settings when that happens
   *
   * Therefore changing:
   *
   * /watch?v=AAAA
   *
   * to:
   *
   * /watch?v=BBBB
   *
   * keeps the same tab state
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
              applyToMedia(
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
                applyToMedia
              );
          }
        }
      }
    );

  observer.observe(
    document.documentElement ||
      document,
    {
      childList: true,
      subtree: true,
    }
  );

  /*
   * Safety scan
   *
   * This catches media elements that YouTube creates
   * in unusual ways that MutationObserver may miss
   */
  setInterval(() => {
    applyAll();
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
       * Get current state
       */
      if (
        message.type ===
        "overdrive:getState"
      ) {
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
       */
      if (
        message.type ===
        "overdrive:setVolume"
      ) {
        state.volume =
          clampVolume(
            message.value
          );

        applyAll();

        /*
         * Save as this tab's state
         */
        saveCurrentTabState();

        /*
         * Also update this site's default
         *
         * This means a newly opened tab can use
         * the most recently selected site setting
         */
        writeSiteDefaults();

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
       */
      if (
        message.type ===
        "overdrive:setSpeed"
      ) {
        state.speed =
          clampSpeed(
            message.value
          );

        applyAll();

        /*
         * Save as this tab's state
         */
        saveCurrentTabState();

        /*
         * Update site default
         */
        writeSiteDefaults();

        sendResponse({
          volume:
            state.volume,

          speed:
            state.speed,
        });

        return;
      }

      /*
       * Reset this tab
       *
       * Reset means return the current tab
       * to the site's normal defaults
       */
      if (
        message.type ===
        "overdrive:reset"
      ) {
        state = {
          ...DEFAULTS,
        };

        applyAll();

        saveCurrentTabState();

        /*
         * Reset the site's default too
         */
        writeSiteDefaults();

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
   * Initialize
   */
  initialize();
})();
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
   * --------------------------------------------------
   * Elements
   * --------------------------------------------------
   */

  const volumeSlider =
    document.getElementById(
      "volumeSlider"
    );

  const volumeReadout =
    document.getElementById(
      "volumeReadout"
    );

  const speedSlider =
    document.getElementById(
      "speedSlider"
    );

  const speedReadout =
    document.getElementById(
      "speedReadout"
    );

  const resetBtn =
    document.getElementById(
      "resetBtn"
    );

  const siteLabel =
    document.getElementById(
      "siteLabel"
    );

  const volumePresets =
    document.querySelectorAll(
      '.presets[data-target="volume"] button'
    );

  const speedPresets =
    document.querySelectorAll(
      '.presets[data-target="speed"] button'
    );

  const stepButtons =
    document.querySelectorAll(
      ".step[data-target]"
    );

  /*
   * --------------------------------------------------
   * Current tab
   * --------------------------------------------------
   */

  let currentTab = null;

  let currentHost = null;

  let state = {
    volume:
      DEFAULTS.volume,

    speed:
      DEFAULTS.speed,
  };

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
          value * 20
        ) / 20
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

  function formatSpeed(value) {
    const number =
      Number(value);

    if (
      !Number.isFinite(
        number
      )
    ) {
      return "1";
    }

    if (
      Number.isInteger(
        number
      )
    ) {
      return String(
        number
      );
    }

    return number
      .toFixed(2)
      .replace(
        /0+$/,
        ""
      )
      .replace(
        /\.$/,
        ""
      );
  }

  /*
   * --------------------------------------------------
   * Slider progress
   * --------------------------------------------------
   */

  function updateSliderProgress(
    slider,
    min,
    max
  ) {
    if (!slider) {
      return;
    }

    const value =
      Number(
        slider.value
      );

    const progress =
      ((value - min) /
        (max - min)) *
      100;

    slider.style.setProperty(
      "--progress",
      `${progress}%`
    );
  }

  /*
   * --------------------------------------------------
   * Hostname
   * --------------------------------------------------
   */

  function getHostFromUrl(url) {
    if (!url) {
      return null;
    }

    try {
      return (
        new URL(
          url
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

  /*
   * --------------------------------------------------
   * Chrome storage
   * --------------------------------------------------
   */

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

  async function saveSiteSettings() {
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

  /*
   * --------------------------------------------------
   * Content script communication
   * --------------------------------------------------
   */

  async function sendToContent(message) {
    if (
      !currentTab ||
      typeof currentTab.id !==
        "number"
    ) {
      return null;
    }

    try {
      return await chrome.tabs.sendMessage(
        currentTab.id,
        message
      );
    } catch (error) {
      /*
       * Some pages do not allow content scripts
       *
       * The setting is still saved in
       * chrome.storage.local
       */
      return null;
    }
  }

  /*
   * --------------------------------------------------
   * UI
   * --------------------------------------------------
   */

  function updateVolumeUI() {
    if (volumeSlider) {
      volumeSlider.value =
        String(
          state.volume
        );

      /*
       * Update the blue portion of the slider
       */
      updateSliderProgress(
        volumeSlider,
        MIN_VOL,
        MAX_VOL
      );
    }

    if (volumeReadout) {
      volumeReadout.innerHTML =
        `${state.volume}<small>%</small>`;
    }

    volumePresets.forEach(
      (button) => {
        const value =
          Number(
            button.dataset.value
          );

        button.classList.toggle(
          "is-active",
          value ===
            state.volume
        );
      }
    );
  }

  function updateSpeedUI() {
    if (speedSlider) {
      speedSlider.value =
        String(
          state.speed
        );

      /*
       * Update the blue portion of the slider
       */
      updateSliderProgress(
        speedSlider,
        MIN_SPEED,
        MAX_SPEED
      );
    }

    if (speedReadout) {
      speedReadout.innerHTML =
        `${formatSpeed(
          state.speed
        )}<small>x</small>`;
    }

    speedPresets.forEach(
      (button) => {
        const value =
          Number(
            button.dataset.value
          );

        button.classList.toggle(
          "is-active",
          Math.abs(
            value -
              state.speed
          ) <
            0.001
        );
      }
    );
  }

  function updateUI() {
    updateVolumeUI();
    updateSpeedUI();
  }

  /*
   * --------------------------------------------------
   * Site label
   * --------------------------------------------------
   */

  function updateSiteLabel() {
    if (!siteLabel) {
      return;
    }

    siteLabel.textContent =
      currentHost ||
      "this page";
  }

  /*
   * --------------------------------------------------
   * Volume
   * --------------------------------------------------
   */

  async function setVolume(value) {
    state.volume =
      clampVolume(
        value
      );

    updateVolumeUI();

    /*
     * Save as this site's default
     */
    await saveSiteSettings();

    /*
     * Apply immediately to the current page
     */
    await sendToContent({
      type:
        "overdrive:setVolume",

      value:
        state.volume,
    });
  }

  /*
   * --------------------------------------------------
   * Speed
   * --------------------------------------------------
   */

  async function setSpeed(value) {
    state.speed =
      clampSpeed(
        value
      );

    updateSpeedUI();

    /*
     * Save as this site's default
     */
    await saveSiteSettings();

    /*
     * Apply immediately to the current page
     */
    await sendToContent({
      type:
        "overdrive:setSpeed",

      value:
        state.speed,
    });
  }

  /*
   * --------------------------------------------------
   * Step buttons
   * --------------------------------------------------
   */

  async function changeByStep(
    target,
    direction
  ) {
    if (
      target ===
      "volume"
    ) {
      const next =
        state.volume +
        direction;

      await setVolume(
        next
      );

      return;
    }

    if (
      target ===
      "speed"
    ) {
      const next =
        state.speed +
        direction * 0.05;

      await setSpeed(
        next
      );
    }
  }

  /*
   * --------------------------------------------------
   * Reset
   * --------------------------------------------------
   */

  async function resetSettings() {
    state = {
      volume:
        DEFAULTS.volume,

      speed:
        DEFAULTS.speed,
    };

    /*
     * Reset the site's saved default
     */
    await saveSiteSettings();

    /*
     * Update popup immediately
     */
    updateUI();

    /*
     * Apply to the current page if possible
     */
    await sendToContent({
      type:
        "overdrive:reset",
    });
  }

  /*
   * --------------------------------------------------
   * Event listeners
   * --------------------------------------------------
   */

  if (volumeSlider) {
    volumeSlider.addEventListener(
      "input",
      () => {
        setVolume(
          volumeSlider.value
        );
      }
    );
  }

  if (speedSlider) {
    speedSlider.addEventListener(
      "input",
      () => {
        setSpeed(
          speedSlider.value
        );
      }
    );
  }

  /*
   * Volume preset buttons
   */

  volumePresets.forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          setVolume(
            button.dataset.value
          );
        }
      );
    }
  );

  /*
   * Speed preset buttons
   */

  speedPresets.forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          setSpeed(
            button.dataset.value
          );
        }
      );
    }
  );

  /*
   * Plus / minus buttons
   */

  stepButtons.forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          const target =
            button.dataset.target;

          const direction =
            button.classList.contains(
              "step--plus"
            )
              ? 1
              : -1;

          changeByStep(
            target,
            direction
          );
        }
      );
    }
  );

  /*
   * Reset button
   */

  if (resetBtn) {
    resetBtn.addEventListener(
      "click",
      () => {
        resetSettings();
      }
    );
  }

  /*
   * --------------------------------------------------
   * Initialization
   * --------------------------------------------------
   */

  async function initialize() {
    try {
      const tabs =
        await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

      currentTab =
        tabs?.[0] ||
        null;

      currentHost =
        getHostFromUrl(
          currentTab?.url
        );

      updateSiteLabel();

      /*
       * Load this site's saved settings
       */
      state =
        await readSiteSettings();

      updateUI();

      /*
       * Synchronize the current page
       *
       * This also works when content.js has
       * already initialized itself
       */
      await sendToContent({
        type:
          "overdrive:setVolume",

        value:
          state.volume,
      });

      await sendToContent({
        type:
          "overdrive:setSpeed",

        value:
          state.speed,
      });
    } catch (error) {
      state = {
        ...DEFAULTS,
      };

      updateUI();
      updateSiteLabel();
    }
  }

  initialize();
})();
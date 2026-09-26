(() => {
  const DEFAULT_VOLUME = 100;
  const DEFAULT_SPEED = 1;

  const volumeSlider =
    document.getElementById("volumeSlider");

  const speedSlider =
    document.getElementById("speedSlider");

  const volumeReadout =
    document.getElementById("volumeReadout");

  const speedReadout =
    document.getElementById("speedReadout");

  const siteLabel =
    document.getElementById("siteLabel");

  const resetBtn =
    document.getElementById("resetBtn");

  let activeTabId = null;

  /*
   * --------------------------------------------------
   * UI helpers
   * --------------------------------------------------
   */

  function fillStop(frac) {
    return `calc(8px + ${frac} * (100% - 16px))`;
  }

  function paintFill(
    slider,
    frac
  ) {
    if (!slider) {
      return;
    }

    const stop =
      fillStop(frac);

    slider.style.background =
      `linear-gradient(to right, var(--accent) 0, var(--accent) ${stop}, var(--line) ${stop}, var(--line) 100%)`;
  }

  function fmtVolume(value) {
    if (
      !volumeReadout ||
      !volumeSlider
    ) {
      return;
    }

    const volume =
      Math.min(
        250,
        Math.max(
          0,
          Math.round(
            Number(value)
          )
        )
      );

    volumeReadout.innerHTML =
      `${volume}<small>%</small>`;

    paintFill(
      volumeSlider,
      volume / 250
    );

    highlightPreset(
      "volume",
      volume
    );
  }

  function fmtSpeed(value) {
    if (
      !speedReadout ||
      !speedSlider
    ) {
      return;
    }

    const speed =
      Math.min(
        10,
        Math.max(
          0.25,
          Math.round(
            Number(value) * 100
          ) / 100
        )
      );

    speedReadout.innerHTML =
      `${speed.toFixed(2)}<small>x</small>`;

    paintFill(
      speedSlider,
      (speed - 0.25) /
        (10 - 0.25)
    );

    highlightPreset(
      "speed",
      speed
    );
  }

  function highlightPreset(
    target,
    value
  ) {
    const group =
      document.querySelector(
        `.presets[data-target="${target}"]`
      );

    if (!group) {
      return;
    }

    group
      .querySelectorAll("button")
      .forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          Math.abs(
            Number(
              btn.dataset.value
            ) - Number(value)
          ) < 0.001
        );
      });
  }

  function setVolumeUI(value) {
    if (!volumeSlider) {
      return;
    }

    const volume =
      Math.min(
        250,
        Math.max(
          0,
          Math.round(
            Number(value)
          )
        )
      );

    volumeSlider.disabled =
      false;

    volumeSlider.value =
      volume;

    fmtVolume(
      volume
    );
  }

  function setSpeedUI(value) {
    if (!speedSlider) {
      return;
    }

    const speed =
      Math.min(
        10,
        Math.max(
          0.25,
          Math.round(
            Number(value) * 100
          ) / 100
        )
      );

    speedSlider.disabled =
      false;

    speedSlider.value =
      speed;

    fmtSpeed(
      speed
    );
  }

  function enableControls() {
    if (volumeSlider) {
      volumeSlider.disabled =
        false;
    }

    if (speedSlider) {
      speedSlider.disabled =
        false;
    }

    if (resetBtn) {
      resetBtn.disabled =
        false;
    }

    document
      .querySelectorAll(
        ".step, .presets button"
      )
      .forEach((element) => {
        element.disabled =
          false;
      });
  }

  /*
   * --------------------------------------------------
   * Messaging
   * --------------------------------------------------
   *
   * The popup never depends on a player existing.
   *
   * If content.js exists, messages are sent to it.
   *
   * If content.js does not exist, the popup still
   * works normally.
   */

  function send(message) {
    return new Promise(
      (resolve) => {
        if (
          activeTabId == null
        ) {
          resolve(null);
          return;
        }

        chrome.tabs.sendMessage(
          activeTabId,
          message,
          (response) => {
            if (
              chrome.runtime.lastError
            ) {
              resolve(null);
              return;
            }

            resolve(
              response ?? null
            );
          }
        );
      }
    );
  }

  async function activateAudio() {
    await send({
      type:
        "overdrive:activate",
    });
  }

  /*
   * --------------------------------------------------
   * Initialization
   * --------------------------------------------------
   */

  async function init() {
    enableControls();

    /*
     * Set safe UI defaults immediately
     *
     * This means the popup never appears disabled
     * just because the page has no player
     */
    setVolumeUI(
      DEFAULT_VOLUME
    );

    setSpeedUI(
      DEFAULT_SPEED
    );

    const [tab] =
      await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

    if (
      !tab ||
      tab.id == null
    ) {
      if (siteLabel) {
        siteLabel.textContent =
          "this page";
      }

      return;
    }

    activeTabId =
      tab.id;

    let host =
      "this page";

    try {
      host =
        new URL(
          tab.url || ""
        ).hostname ||
        "this page";
    } catch (error) {
      // Keep "this page"
    }

    if (siteLabel) {
      siteLabel.textContent =
        host;
    }

    /*
     * Ask content.js for the current tab state
     *
     * This is optional
     *
     * A missing content script must never disable
     * the popup controls
     */
    const state =
      await send({
        type:
          "overdrive:getState",
      });

    enableControls();

    if (!state) {
      /*
       * No content script
       *
       * Keep the normal UI defaults
       */
      setVolumeUI(
        DEFAULT_VOLUME
      );

      setSpeedUI(
        DEFAULT_SPEED
      );

      return;
    }

    /*
     * Restore the actual current tab state
     */
    if (
      typeof state.volume ===
      "number"
    ) {
      setVolumeUI(
        state.volume
      );
    }

    if (
      typeof state.speed ===
      "number"
    ) {
      setSpeedUI(
        state.speed
      );
    }
  }

  /*
   * --------------------------------------------------
   * Volume slider
   * --------------------------------------------------
   */

  if (volumeSlider) {
    volumeSlider.addEventListener(
      "input",
      async () => {
        const value =
          Number(
            volumeSlider.value
          );

        setVolumeUI(
          value
        );

        /*
         * User interaction can unlock Web Audio
         */
        await activateAudio();

        /*
         * Save/apply through content.js
         */
        await send({
          type:
            "overdrive:setVolume",

          value,
        });
      }
    );
  }

  /*
   * --------------------------------------------------
   * Speed slider
   * --------------------------------------------------
   */

  if (speedSlider) {
    speedSlider.addEventListener(
      "input",
      async () => {
        const value =
          Number(
            speedSlider.value
          );

        setSpeedUI(
          value
        );

        /*
         * Speed itself does not require Web Audio
         */
        await send({
          type:
            "overdrive:setSpeed",

          value,
        });
      }
    );
  }

  /*
   * --------------------------------------------------
   * +/- buttons
   * --------------------------------------------------
   */

  document
    .querySelectorAll(".step")
    .forEach((btn) => {
      btn.addEventListener(
        "click",
        async () => {
          const target =
            btn.dataset.target;

          const direction =
            btn.classList.contains(
              "step--plus"
            )
              ? 1
              : -1;

          /*
           * Volume
           */
          if (
            target ===
            "volume"
          ) {
            if (!volumeSlider) {
              return;
            }

            const value =
              Math.min(
                250,
                Math.max(
                  0,
                  Number(
                    volumeSlider.value
                  ) +
                    direction
                )
              );

            setVolumeUI(
              value
            );

            await activateAudio();

            await send({
              type:
                "overdrive:setVolume",

              value,
            });

            return;
          }

          /*
           * Speed
           */
          if (!speedSlider) {
            return;
          }

          const value =
            Math.min(
              10,
              Math.max(
                0.25,
                Math.round(
                  (
                    Number(
                      speedSlider.value
                    ) +
                      direction *
                        0.05
                  ) *
                    100
                ) / 100
              )
            );

          setSpeedUI(
            value
          );

          await send({
            type:
              "overdrive:setSpeed",

            value,
          });
        }
      );
    });

  /*
   * --------------------------------------------------
   * Presets
   * --------------------------------------------------
   */

  document
    .querySelectorAll(
      ".presets button"
    )
    .forEach((btn) => {
      btn.addEventListener(
        "click",
        async () => {
          const presetGroup =
            btn.closest(
              ".presets"
            );

          if (!presetGroup) {
            return;
          }

          const group =
            presetGroup.dataset
              .target;

          const value =
            Number(
              btn.dataset.value
            );

          /*
           * Volume preset
           */
          if (
            group ===
            "volume"
          ) {
            if (!volumeSlider) {
              return;
            }

            setVolumeUI(
              value
            );

            await activateAudio();

            await send({
              type:
                "overdrive:setVolume",

              value,
            });

            return;
          }

          /*
           * Speed preset
           */
          if (!speedSlider) {
            return;
          }

          setSpeedUI(
            value
          );

          await send({
            type:
              "overdrive:setSpeed",

            value,
          });
        }
      );
    });

  /*
   * --------------------------------------------------
   * Reset
   * --------------------------------------------------
   *
   * This always resets the popup UI first
   *
   * It does not matter whether:
   *
   * - a player exists
   * - content.js exists
   * - the page supports media
   * - the current site has a player
   *
   * If content.js is available, it also resets
   * the actual tab state
   */
  if (resetBtn) {
    resetBtn.addEventListener(
      "click",
      async () => {
        /*
         * Reset UI immediately
         */
        setVolumeUI(
          DEFAULT_VOLUME
        );

        setSpeedUI(
          DEFAULT_SPEED
        );

        enableControls();

        /*
         * Reset content.js state if available
         *
         * No response is required for the UI
         * because it has already been reset
         */
        await send({
          type:
            "overdrive:reset",
        });
      }
    );
  }

  /*
   * --------------------------------------------------
   * Start
   * --------------------------------------------------
   */

  init();
})();
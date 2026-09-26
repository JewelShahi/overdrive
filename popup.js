(() => {
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

  /*
   * Shown when the current page does not have
   * a supported Overdrive content script/player
   */
  const volumeUnavailable =
    document.getElementById(
      "volumeUnavailable"
    );

  let activeTabId = null;

  function fillStop(frac) {
    return `calc(8px + ${frac} * (100% - 16px))`;
  }

  function paintFill(slider, frac) {
    const stop =
      fillStop(frac);

    slider.style.background =
      `linear-gradient(to right, var(--accent) 0, var(--accent) ${stop}, var(--line) ${stop}, var(--line) 100%)`;
  }

  function fmtVolume(v) {
    volumeReadout.innerHTML =
      `${Math.round(v)}<small>%</small>`;

    paintFill(
      volumeSlider,
      v / 250
    );

    highlightPreset(
      "volume",
      v
    );
  }

  function fmtSpeed(v) {
    speedReadout.innerHTML =
      `${v.toFixed(2)}<small>x</small>`;

    paintFill(
      speedSlider,
      (v - 0.25) /
        (10 - 0.25)
    );

    highlightPreset(
      "speed",
      v
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
            ) - value
          ) < 0.001
        );
      });
  }

  /*
   * Current page does not have a usable
   * Overdrive content script
   */
  function setUnavailable() {
    if (volumeUnavailable) {
      volumeUnavailable.hidden =
        false;
    }
  }

  /*
   * Current page has a usable
   * Overdrive content script
   */
  function setAvailable() {
    if (volumeUnavailable) {
      volumeUnavailable.hidden =
        true;
    }
  }

  /*
   * Send a message to content.js
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

            resolve(response);
          }
        );
      }
    );
  }

  async function init() {
    const [tab] =
      await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

    if (
      !tab ||
      !tab.id
    ) {
      siteLabel.textContent =
        "no active tab";

      setUnavailable();
      disableControls();

      return;
    }

    activeTabId =
      tab.id;

    let host =
      "this page";

    try {
      host =
        new URL(
          tab.url
        ).hostname ||
        "this page";
    } catch (error) {
      // Keep "this page".
    }

    siteLabel.textContent =
      host;

    /*
     * Ask content.js for this tab's
     * current settings
     *
     * content.js handles:
     *
     * - restoring the tab settings
     * - falling back to the site default
     */
    const state =
      await send({
        type:
          "overdrive:getState",
      });

    /*
     * Content script is unavailable
     */
    if (!state) {
      setUnavailable();
      disableControls();

      return;
    }

    /*
     * Content script is available
     */
    setAvailable();

    volumeSlider.value =
      state.volume;

    speedSlider.value =
      state.speed;

    fmtVolume(
      state.volume
    );

    fmtSpeed(
      state.speed
    );
  }

  function disableControls() {
    [
      volumeSlider,
      speedSlider,
      resetBtn,
    ].forEach((el) => {
      el.disabled = true;
    });

    document
      .querySelectorAll(
        ".step, .presets button"
      )
      .forEach((el) => {
        el.disabled = true;
      });
  }

  /*
   * Volume slider
   */
  volumeSlider.addEventListener(
    "input",
    async () => {
      const value =
        Number(
          volumeSlider.value
        );

      fmtVolume(value);

      await send({
        type:
          "overdrive:setVolume",
        value,
      });
    }
  );

  /*
   * Speed slider
   */
  speedSlider.addEventListener(
    "input",
    async () => {
      const value =
        Number(
          speedSlider.value
        );

      fmtSpeed(value);

      await send({
        type:
          "overdrive:setSpeed",
        value,
      });
    }
  );

  /*
   * +/- buttons
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

            volumeSlider.value =
              value;

            fmtVolume(value);

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

          speedSlider.value =
            value;

          fmtSpeed(value);

          await send({
            type:
              "overdrive:setSpeed",
            value,
          });
        }
      );
    });

  /*
   * Preset buttons
   */
  document
    .querySelectorAll(
      ".presets button"
    )
    .forEach((btn) => {
      btn.addEventListener(
        "click",
        async () => {
          const group =
            btn.closest(
              ".presets"
            ).dataset.target;

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
            volumeSlider.value =
              value;

            fmtVolume(value);

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
          speedSlider.value =
            value;

          fmtSpeed(value);

          await send({
            type:
              "overdrive:setSpeed",
            value,
          });
        }
      );
    });

  /*
   * Reset button
   *
   * Resets the current tab to:
   *
   * 100% volume
   * 1x speed
   */
  resetBtn.addEventListener(
    "click",
    async () => {
      const result =
        await send({
          type:
            "overdrive:reset",
        });

      if (!result) {
        return;
      }

      volumeSlider.value =
        result.volume;

      speedSlider.value =
        result.speed;

      fmtVolume(
        result.volume
      );

      fmtSpeed(
        result.speed
      );
    }
  );

  /*
   * Start popup
   */
  init();
})();
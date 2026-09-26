(() => {
  const volumeSlider = document.getElementById("volumeSlider");
  const speedSlider = document.getElementById("speedSlider");
  const volumeReadout = document.getElementById("volumeReadout");
  const speedReadout = document.getElementById("speedReadout");
  const siteLabel = document.getElementById("siteLabel");
  const mediaStatus = document.getElementById("mediaStatus");
  const mediaStatusCount = document.getElementById("mediaStatusCount");
  const mediaStatusLabel = document.getElementById("mediaStatusLabel");
  const resetBtn = document.getElementById("resetBtn");

  let activeTabId = null;

  // Same inset-aware formula used for the ticks and default marker in
  // popup.html: the native thumb's center travels from 8px (its radius)
  // to calc(100% - 8px), never the full 0–100% of the track. Painting
  // the fill up to this same point keeps the color boundary glued to
  // the thumb everywhere on the track, including at the default value.
  function fillStop(frac) {
    return `calc(8px + ${frac} * (100% - 16px))`;
  }

  function paintFill(slider, frac) {
    const stop = fillStop(frac);
    slider.style.background =
      `linear-gradient(to right, var(--accent) 0, var(--accent) ${stop}, var(--line) ${stop}, var(--line) 100%)`;
  }

  function fmtVolume(v) {
    volumeReadout.innerHTML = `${Math.round(v)}<small>%</small>`;
    paintFill(volumeSlider, v / 250);
    highlightPreset("volume", v);
  }
  function fmtSpeed(v) {
    speedReadout.innerHTML = `${v.toFixed(2)}<small>x</small>`;
    paintFill(speedSlider, (v - 0.25) / (10 - 0.25));
    highlightPreset("speed", v);
  }

  function highlightPreset(target, value) {
    const group = document.querySelector(`.presets[data-target="${target}"]`);
    if (!group) return;
    group.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", Math.abs(Number(btn.dataset.value) - value) < 0.001);
    });
  }

  // Status pill always shows the live player count on the page, with a
  // dot and color that shift from idle (grey) to active (pulsing green)
  // depending on whether Overdrive found anything to control.
  function setMediaStatus(count) {
    mediaStatus.classList.remove("status--active", "status--idle", "status--warn");
    mediaStatusCount.textContent = count;
    mediaStatusLabel.textContent = count === 1 ? "player" : "players";
    mediaStatus.classList.add(count > 0 ? "status--active" : "status--idle");
  }

  function setUnavailable() {
    mediaStatus.classList.remove("status--active", "status--idle");
    mediaStatus.classList.add("status--warn");
    mediaStatusCount.textContent = "—";
    mediaStatusLabel.textContent = "unavailable";
  }

  function send(message) {
    return new Promise((resolve) => {
      if (activeTabId == null) return resolve(null);
      chrome.tabs.sendMessage(activeTabId, message, (response) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response);
      });
    });
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      siteLabel.textContent = "no active tab";
      setUnavailable();
      disableControls();
      return;
    }
    activeTabId = tab.id;

    let host = "this page";
    try { host = new URL(tab.url).hostname || "this page"; } catch (e) {}
    siteLabel.textContent = host;

    const state = await send({ type: "overdrive:getState" });
    if (!state) {
      setUnavailable();
      disableControls();
      return;
    }

    volumeSlider.value = state.volume;
    speedSlider.value = state.speed;
    fmtVolume(state.volume);
    fmtSpeed(state.speed);
    setMediaStatus(state.mediaCount || 0);
  }

  function disableControls() {
    [volumeSlider, speedSlider, resetBtn].forEach((el) => (el.disabled = true));
    document.querySelectorAll(".step, .presets button").forEach((el) => (el.disabled = true));
  }

  volumeSlider.addEventListener("input", async () => {
    const v = Number(volumeSlider.value);
    fmtVolume(v);
    await send({ type: "overdrive:setVolume", value: v });
  });

  speedSlider.addEventListener("input", async () => {
    const v = Number(speedSlider.value);
    fmtSpeed(v);
    await send({ type: "overdrive:setSpeed", value: v });
  });

  document.querySelectorAll(".step").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.target;
      const dir = btn.classList.contains("step--plus") ? 1 : -1;
      if (target === "volume") {
        const v = Math.min(250, Math.max(0, Number(volumeSlider.value) + dir * 1));
        volumeSlider.value = v;
        fmtVolume(v);
        await send({ type: "overdrive:setVolume", value: v });
      } else {
        const v = Math.min(10, Math.max(0.25, Math.round((Number(speedSlider.value) + dir * 0.05) * 100) / 100));
        speedSlider.value = v;
        fmtSpeed(v);
        await send({ type: "overdrive:setSpeed", value: v });
      }
    });
  });

  document.querySelectorAll(".presets button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const group = btn.closest(".presets").dataset.target;
      const value = Number(btn.dataset.value);
      if (group === "volume") {
        volumeSlider.value = value;
        fmtVolume(value);
        await send({ type: "overdrive:setVolume", value });
      } else {
        speedSlider.value = value;
        fmtSpeed(value);
        await send({ type: "overdrive:setSpeed", value });
      }
    });
  });

  resetBtn.addEventListener("click", async () => {
    const res = await send({ type: "overdrive:reset" });
    if (res) {
      volumeSlider.value = res.volume;
      speedSlider.value = res.speed;
      fmtVolume(res.volume);
      fmtSpeed(res.speed);
    }
  });

  init();
})();
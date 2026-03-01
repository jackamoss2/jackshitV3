/**
 * Settings Manager
 * Handles all viewer settings sliders, localStorage persistence, and reset buttons.
 */

const SETTINGS_KEY = 'jackshit-viewer-settings';
const defaults = { speed: 0.1, zoomSpeed: 8, sensitivity: 0.001, renderDist: 2000, uiScale: 1.15 };

let settings = {};

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Initialise all settings — load saved values, wire sliders and reset buttons.
 * @param {object} controls  FirstPersonControls instance
 * @param {THREE.PerspectiveCamera} camera
 */
export function initSettings(controls, camera) {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  settings = { ...defaults, ...saved };

  // Apply saved settings
  controls.speed = settings.speed;
  controls.sprintMultiplier = settings.zoomSpeed;
  controls.sensitivity = settings.sensitivity;
  camera.far = settings.renderDist;
  camera.updateProjectionMatrix();
  document.getElementById('ui-overlay').style.zoom = settings.uiScale;

  // ── Slider elements ────────────────────────────────
  const speedSlider = document.getElementById('setting-speed');
  const speedVal    = document.getElementById('setting-speed-val');
  speedSlider.value = settings.speed;
  speedVal.textContent = settings.speed.toFixed(2);

  const zoomSlider = document.getElementById('setting-zoom-speed');
  const zoomVal    = document.getElementById('setting-zoom-speed-val');
  zoomSlider.value = settings.zoomSpeed;
  zoomVal.textContent = settings.zoomSpeed.toFixed(1);

  const sensSlider = document.getElementById('setting-sensitivity');
  const sensVal    = document.getElementById('setting-sensitivity-val');
  sensSlider.value = settings.sensitivity;
  sensVal.textContent = settings.sensitivity.toFixed(4);

  const distSlider = document.getElementById('setting-render-dist');
  const distVal    = document.getElementById('setting-render-dist-val');
  distSlider.value = settings.renderDist;
  distVal.textContent = settings.renderDist;

  const uiScaleSlider = document.getElementById('setting-ui-scale');
  const uiScaleVal    = document.getElementById('setting-ui-scale-val');
  uiScaleSlider.value = settings.uiScale;
  uiScaleVal.textContent = settings.uiScale.toFixed(2);

  // ── Slider input handlers ──────────────────────────
  speedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    controls.speed = val;
    speedVal.textContent = val.toFixed(2);
    saveSetting('speed', val);
  });

  zoomSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    controls.sprintMultiplier = val;
    zoomVal.textContent = val.toFixed(1);
    saveSetting('zoomSpeed', val);
  });

  sensSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    controls.sensitivity = val;
    sensVal.textContent = val.toFixed(4);
    saveSetting('sensitivity', val);
  });

  distSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    camera.far = val;
    camera.updateProjectionMatrix();
    distVal.textContent = val;
    saveSetting('renderDist', val);
  });

  uiScaleSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('ui-overlay').style.zoom = val;
    uiScaleVal.textContent = val.toFixed(2);
    saveSetting('uiScale', val);
  });

  // ── Reset buttons ──────────────────────────────────
  const resetMap = {
    speed:       { slider: speedSlider,   valEl: speedVal,   fmt: v => v.toFixed(2), apply: v => { controls.speed = v; } },
    zoomSpeed:   { slider: zoomSlider,    valEl: zoomVal,    fmt: v => v.toFixed(1), apply: v => { controls.sprintMultiplier = v; } },
    sensitivity: { slider: sensSlider,    valEl: sensVal,    fmt: v => v.toFixed(4), apply: v => { controls.sensitivity = v; } },
    renderDist:  { slider: distSlider,    valEl: distVal,    fmt: v => String(v),    apply: v => { camera.far = v; camera.updateProjectionMatrix(); } },
    uiScale:     { slider: uiScaleSlider, valEl: uiScaleVal, fmt: v => v.toFixed(2), apply: v => { document.getElementById('ui-overlay').style.zoom = v; } },
  };

  document.querySelectorAll('.setting-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.setting;
      const entry = resetMap[key];
      if (!entry) return;
      const def = defaults[key];
      entry.slider.value = def;
      entry.valEl.textContent = entry.fmt(def);
      entry.apply(def);
      saveSetting(key, def);
    });
  });
}

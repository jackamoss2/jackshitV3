import * as THREE from '../libs/three.module.js';

/**
 * Settings Manager
 * Handles all viewer settings sliders, localStorage persistence, and reset buttons.
 */

const SETTINGS_KEY = 'jackshit-viewer-settings';
const defaults = { speed: 0.1, zoomSpeed: 8, sensitivity: 0.001, renderDist: 2000, vertExag: 1, fileSizeCap: 50, uiScale: 1.15, confirmDelete: true, darkMode: true };

let settings = {};

let _renderer = null;
let _scene = null;

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Initialise all settings — load saved values, wire sliders and reset buttons.
 * @param {object} controls  FirstPersonControls instance
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 */
export function initSettings(controls, camera, renderer, scene) {
  _renderer = renderer;
  _scene = scene;
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  settings = { ...defaults, ...saved };

  // Apply saved settings
  controls.speed = settings.speed;
  controls.sprintMultiplier = settings.zoomSpeed;
  controls.sensitivity = settings.sensitivity;
  camera.far = settings.renderDist;
  camera.updateProjectionMatrix();
  document.getElementById('ui-overlay').style.zoom = settings.uiScale;

  // Apply theme
  applyTheme(settings.darkMode);

  // ── Checkbox elements ──────────────────────────────
  const confirmDeleteCb = document.getElementById('setting-confirm-delete');
  confirmDeleteCb.checked = settings.confirmDelete;
  confirmDeleteCb.addEventListener('change', () => {
    saveSetting('confirmDelete', confirmDeleteCb.checked);
  });

  const darkModeCb = document.getElementById('setting-dark-mode');
  darkModeCb.checked = settings.darkMode;
  darkModeCb.addEventListener('change', () => {
    saveSetting('darkMode', darkModeCb.checked);
    applyTheme(darkModeCb.checked);
  });

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

  const vertExagSlider = document.getElementById('setting-vert-exag');
  const vertExagVal    = document.getElementById('setting-vert-exag-val');
  vertExagSlider.value = settings.vertExag;
  vertExagVal.textContent = settings.vertExag + '\u00d7';

  const fileCapSlider = document.getElementById('setting-file-size-cap');
  const fileCapVal    = document.getElementById('setting-file-size-cap-val');
  fileCapSlider.value = settings.fileSizeCap;
  fileCapVal.textContent = settings.fileSizeCap;

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
    zoomVal.textContent = val;
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

  vertExagSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    vertExagVal.textContent = val + '\u00d7';
    saveSetting('vertExag', val);
    applyVerticalExaggeration(scene, val);
  });

  fileCapSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    fileCapVal.textContent = val;
    saveSetting('fileSizeCap', val);
  });

  uiScaleSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('ui-overlay').style.zoom = val;
    uiScaleVal.textContent = val.toFixed(2);
    saveSetting('uiScale', val);
  });

  // ── Reset buttons ──────────────────────────────────
  const resetMap = {
    speed:       { slider: speedSlider,    valEl: speedVal,    fmt: v => v.toFixed(2),       apply: v => { controls.speed = v; } },
    zoomSpeed:   { slider: zoomSlider,     valEl: zoomVal,     fmt: v => String(v),           apply: v => { controls.sprintMultiplier = v; } },
    sensitivity: { slider: sensSlider,     valEl: sensVal,     fmt: v => v.toFixed(4),        apply: v => { controls.sensitivity = v; } },
    renderDist:  { slider: distSlider,     valEl: distVal,     fmt: v => String(v),           apply: v => { camera.far = v; camera.updateProjectionMatrix(); } },
    vertExag:    { slider: vertExagSlider,  valEl: vertExagVal,  fmt: v => v + '\u00d7',       apply: v => { applyVerticalExaggeration(scene, v); } },
    fileSizeCap: { slider: fileCapSlider,   valEl: fileCapVal,   fmt: v => String(v),          apply: () => {} },
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

/** Check whether delete confirmation is enabled. */
export function shouldConfirmDelete() {
  return settings.confirmDelete !== false;
}

/** Get the file size cap in bytes. */
export function getFileSizeCap() {
  return (settings.fileSizeCap || defaults.fileSizeCap) * 1024 * 1024;
}

/** Get the current vertical exaggeration factor. */
export function getVertExag() {
  return settings.vertExag || defaults.vertExag;
}

/** Apply vertical exaggeration to all meshes in the scene. */
function applyVerticalExaggeration(scene, factor) {
  scene.traverse(obj => {
    if (obj.isMesh && obj.userData.baseScaleY !== undefined) {
      obj.scale.y = factor * obj.userData.baseScaleY;
    }
  });
}

/** Apply dark or light theme. */
function applyTheme(isDark) {
  document.body.classList.toggle('light-mode', !isDark);
  const color = isDark ? 0x1a1a1a : 0xe2e2e2;
  if (_renderer) _renderer.setClearColor(color, 1);
  if (_scene) _scene.background = new THREE.Color(color);
}

import * as THREE from '../libs/three.module.js';

/**
 * Settings Manager
 * Handles all viewer settings sliders, localStorage persistence, and reset buttons.
 */

const SETTINGS_KEY = 'jackshit-viewer-settings';
const defaults = { speed: 0.1, zoomSpeed: 8, sensitivity: 0.001, renderDist: 2000, vertExag: 1, fileSizeCap: 50, uiScale: 1.15, confirmDelete: true, confirmLeave: true, darkMode: true };

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

  const confirmLeaveCb = document.getElementById('setting-confirm-leave');
  confirmLeaveCb.checked = settings.confirmLeave;
  confirmLeaveCb.addEventListener('change', () => {
    saveSetting('confirmLeave', confirmLeaveCb.checked);
  });

  // ── Theme toggle button (in toolbar) ──────────────
  const themeBtn = document.getElementById('toolbar-theme');
  function updateThemeBtn(isDark) {
    if (themeBtn) themeBtn.textContent = isDark ? '☾' : '☀';
  }
  updateThemeBtn(settings.darkMode);
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isDark = !document.body.classList.contains('light-mode');
      const newDark = !isDark;
      saveSetting('darkMode', newDark);
      applyTheme(newDark);
      updateThemeBtn(newDark);
    });
  }

  // ── Sliders: definition table drives setup, input handling, and reset ────────
  const sliderDefs = [
    { key: 'speed',       id: 'setting-speed',         fmt: v => v.toFixed(2),  apply: v => { controls.speed = v; } },
    { key: 'zoomSpeed',   id: 'setting-zoom-speed',    fmt: v => v.toFixed(1),  apply: v => { controls.sprintMultiplier = v; } },
    { key: 'sensitivity', id: 'setting-sensitivity',   fmt: v => v.toFixed(4),  apply: v => { controls.sensitivity = v; } },
    { key: 'renderDist',  id: 'setting-render-dist',   fmt: v => String(v),     apply: v => { camera.far = v; camera.updateProjectionMatrix(); } },
    { key: 'vertExag',    id: 'setting-vert-exag',     fmt: v => v + '\u00d7',  apply: v => { applyVerticalExaggeration(scene, v); } },
    { key: 'fileSizeCap', id: 'setting-file-size-cap', fmt: v => String(v),     apply: () => {} },
    { key: 'uiScale',     id: 'setting-ui-scale',      fmt: v => v.toFixed(2),  apply: v => { document.getElementById('ui-overlay').style.zoom = v; } },
  ];

  const sliderRefs = {}; // key → { slider, valEl, def }
  for (const def of sliderDefs) {
    const slider = document.getElementById(def.id);
    const valEl  = document.getElementById(def.id + '-val');
    slider.value      = settings[def.key];
    valEl.textContent = def.fmt(settings[def.key]);
    slider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      valEl.textContent = def.fmt(val);
      def.apply(val);
      saveSetting(def.key, val);
    });
    sliderRefs[def.key] = { slider, valEl, def };
  }

  // ── Reset buttons ──────────────────────────────────
  document.querySelectorAll('.setting-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const ref = sliderRefs[btn.dataset.setting];
      if (!ref) return;
      const def = defaults[btn.dataset.setting];
      ref.slider.value  = def;
      ref.valEl.textContent = ref.def.fmt(def);
      ref.def.apply(def);
      saveSetting(btn.dataset.setting, def);
    });
  });
}

/** Check whether delete confirmation is enabled. */
export function shouldConfirmDelete() {
  return settings.confirmDelete !== false;
}

/** Check whether leave-page confirmation is enabled. */
export function shouldConfirmLeave() {
  return settings.confirmLeave !== false;
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
  const color = isDark ? 0x1a1714 : 0xf2efe8;
  if (_renderer) _renderer.setClearColor(color, 1);
  if (_scene) _scene.background = new THREE.Color(color);
}

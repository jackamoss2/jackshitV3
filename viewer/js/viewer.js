// three.js imports
import * as THREE from './libs/three.module.js';
import { FirstPersonControls } from './modules/firstPersonControls.js';
import { LightsSetup } from './modules/lightsSetup.js';

// UI imports
import { initUI, setStatus } from './modules/uiController.js';
import { initUpload } from './modules/uploadHandler.js';
import { initDataTree, onObjectJumpTo } from './modules/dataTree.js';

// data imports
import { loadLandXML } from './modules/data transformation/xmlParser.js';
import { addFile } from './modules/sceneData.js';

// CRS imports
import { onCRSChange } from './modules/crsManager.js';

// utility imports
import { preventSpaceOnFocusedButtons } from './modules/utility/preventSpacebarButtonPress.js';




// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('threejs-canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(window.devicePixelRatio);
LightsSetup(scene);

// Create a cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshStandardMaterial({ color: 0x0077ff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

//constrols setup
const statusEl = document.getElementById('status-text');
const controls = new FirstPersonControls(camera, renderer.domElement, scene, {
  speed: .1,
  onEnter: () => { setStatus('Press Esc to Exit'); statusEl.classList.add('status-active'); },
  onExit: () => { setStatus('Ready'); statusEl.classList.remove('status-active'); }
});
window.controls = controls;

// Position the camera
camera.position.z = 5;







// utility ------------------------------------------------------------------------------

preventSpaceOnFocusedButtons();
initUI();
initUpload();
initDataTree();
setStatus('Ready');

// CRS display in status bar
const crsEl = document.getElementById('crs-display');
onCRSChange((state) => {
  if (state.crsName && state.crsName !== 'Unknown CRS') {
    crsEl.textContent = state.crsName;
    crsEl.classList.add('crs-active');
    crsEl.title = state.origin
      ? `Origin offset: (${state.origin.x.toFixed(1)}, ${state.origin.y.toFixed(1)}, ${state.origin.z.toFixed(1)})`
      : 'Coordinate Reference System';
  }
});

// Jump-to from data tree → frame camera on object
onObjectJumpTo((obj) => {
  if (obj.mesh) controls.frameObject(obj.mesh);
});

// Settings — load from localStorage or use defaults
const SETTINGS_KEY = 'jackshit-viewer-settings';
const defaults = { speed: 0.1, zoomSpeed: 8, sensitivity: 0.001, renderDist: 2000 };
const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
const settings = { ...defaults, ...saved };

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Apply saved settings
controls.speed = settings.speed;
controls.sprintMultiplier = settings.zoomSpeed;
controls.sensitivity = settings.sensitivity;
camera.far = settings.renderDist;
camera.updateProjectionMatrix();

const speedSlider = document.getElementById('setting-speed');
const speedVal = document.getElementById('setting-speed-val');
speedSlider.value = settings.speed;
speedVal.textContent = settings.speed.toFixed(2);

const zoomSlider = document.getElementById('setting-zoom-speed');
const zoomVal = document.getElementById('setting-zoom-speed-val');
zoomSlider.value = settings.zoomSpeed;
zoomVal.textContent = settings.zoomSpeed.toFixed(1);

const sensSlider = document.getElementById('setting-sensitivity');
const sensVal = document.getElementById('setting-sensitivity-val');
sensSlider.value = settings.sensitivity;
sensVal.textContent = settings.sensitivity.toFixed(4);

const distSlider = document.getElementById('setting-render-dist');
const distVal = document.getElementById('setting-render-dist-val');
distSlider.value = settings.renderDist;
distVal.textContent = settings.renderDist;

// Settings sliders
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

// Reset buttons
const resetMap = {
  speed:       { slider: speedSlider, valEl: speedVal,  fmt: v => v.toFixed(2), apply: v => { controls.speed = v; } },
  zoomSpeed:   { slider: zoomSlider,  valEl: zoomVal,   fmt: v => v.toFixed(1), apply: v => { controls.sprintMultiplier = v; } },
  sensitivity: { slider: sensSlider,  valEl: sensVal,   fmt: v => v.toFixed(4), apply: v => { controls.sensitivity = v; } },
  renderDist:  { slider: distSlider,  valEl: distVal,   fmt: v => String(v),    apply: v => { camera.far = v; camera.updateProjectionMatrix(); } },
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

// Handle uploaded XML files
document.getElementById('data-panel-body').addEventListener('file-uploaded', (e) => {
  const { name, content } = e.detail;
  setStatus(`Loading ${name}...`);
  try {
    const { fileMeta, objects } = loadLandXML(content);
    objects.forEach(obj => scene.add(obj.mesh));
    addFile(name, objects, fileMeta);
    if (objects.length > 0) {
      controls.frameObject(objects[0].mesh);
    }
    setStatus(`Loaded ${name} (${objects.length} surface${objects.length !== 1 ? 's' : ''})`);
  } catch (err) {
    console.error(err);
    setStatus(`Error loading ${name}`);
  }
});

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    controls.update();
}

animate();
// three.js imports
import * as THREE from './libs/three.module.js';
import { FirstPersonControls } from './modules/firstPersonControls.js';
import { LightsSetup } from './modules/lightsSetup.js';

// UI imports
import { initUI, setStatus } from './modules/uiController.js';
import { initUpload } from './modules/uploadHandler.js';
import { initDataTree, onObjectJumpTo } from './modules/dataTree.js';
import { initSettings } from './modules/settingsManager.js';
import { initFileHandler } from './modules/fileHandler.js';

// CRS imports
import { onCRSChange, getOrigin } from './modules/crsManager.js';

// utility imports
import { preventSpaceOnFocusedButtons } from './modules/utility/preventSpacebarButtonPress.js';


// ── Scene setup ──────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('threejs-canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(window.devicePixelRatio);
LightsSetup(scene);

// Default cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshStandardMaterial({ color: 0x0077ff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// ── Controls ─────────────────────────────────────────
const statusEl = document.getElementById('status-text');
const controls = new FirstPersonControls(camera, renderer.domElement, scene, {
  speed: .1,
  onEnter: () => { setStatus('Press Esc to Exit'); statusEl.classList.add('status-active'); },
  onExit: () => { setStatus('Ready'); statusEl.classList.remove('status-active'); }
});
window.controls = controls;
camera.position.z = 5;

// ── Initialise modules ──────────────────────────────
preventSpaceOnFocusedButtons();
initUI();
initUpload();
initDataTree();
initSettings(controls, camera, renderer, scene);
initFileHandler(scene, controls);
setStatus('Ready');

// ── CRS display ─────────────────────────────────────
const crsEl = document.getElementById('crs-display');
onCRSChange((state) => {
  const name = state.crsName;
  if (!name) {
    // No files loaded — empty
    crsEl.textContent = '';
    crsEl.className = 'status-right';
    crsEl.title = 'Coordinate Reference System';
  } else if (name === 'No CRS' || name === 'Mixed CRS') {
    // Warning state
    crsEl.textContent = name;
    crsEl.className = 'status-right crs-warning';
    crsEl.title = name === 'Mixed CRS'
      ? 'Loaded files have different coordinate reference systems'
      : 'No coordinate reference system found in loaded files';
  } else {
    // Valid CRS
    crsEl.textContent = name;
    crsEl.className = 'status-right crs-active';
    crsEl.title = state.origin
      ? `Origin offset: (${state.origin.x.toFixed(1)}, ${state.origin.y.toFixed(1)}, ${state.origin.z.toFixed(1)})`
      : 'Coordinate Reference System';
  }
});

// ── Data tree callbacks ─────────────────────────────
onObjectJumpTo((obj) => {
  if (obj.mesh) controls.frameObject(obj.mesh);
});

// ── Resize ──────────────────────────────────────────
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

// ── Coordinate display ──────────────────────────────
const coordsEl = document.getElementById('status-coords');
let lastCoordsText = '';

function updateCoords() {
  const o = getOrigin();
  if (!o) {
    if (lastCoordsText !== '') {
      coordsEl.textContent = '';
      lastCoordsText = '';
    }
    return;
  }
  // scene → LandXML: x=northing, z=easting, y=elevation
  const easting  = camera.position.z + o.y;
  const northing = camera.position.x + o.x;
  const elev     = camera.position.y + o.z;
  const text = `E: ${easting.toFixed(3)}  N: ${northing.toFixed(3)}  Elev: ${elev.toFixed(3)}`;
  if (text !== lastCoordsText) {
    coordsEl.textContent = text;
    lastCoordsText = text;
  }
}

// ── Animation loop ──────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
  controls.update();
  updateCoords();
}

animate();
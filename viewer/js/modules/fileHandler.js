/**
 * File Handler
 * Handles file upload events and file deletion (mesh cleanup).
 * LandXML is parsed on the main thread (DOMParser required).
 * DEM parsing runs in a Web Worker to keep the UI responsive.
 */

import * as THREE from '../libs/three.module.js';
import { addFile, findFile, getFiles } from './sceneData.js';
import { onFileDelete } from './dataTree.js';
import { setStatus } from './uiController.js';
import { setCRS, removeCRSForFile, resetOrigin, initOriginFromPoints, getOrigin } from './crsManager.js';
import { parseLandXML } from './xmlParser.js';

// Spin up the parse worker once (used for DEM only)
const worker = new Worker(new URL('./parseWorker.js', import.meta.url));

/**
 * Send a file to the parse worker and await the result.
 * @returns {Promise<object>}
 */
function workerParse(type, content, fileName) {
  return new Promise((resolve, reject) => {
    const handler = (e) => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errHandler);
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error));
    };
    const errHandler = (err) => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errHandler);
      reject(err);
    };
    worker.addEventListener('message', handler);
    worker.addEventListener('error', errHandler);

    // Transfer ArrayBuffer for GeoTIFF (avoids copy)
    const transfers = (content instanceof ArrayBuffer) ? [content] : [];
    worker.postMessage({ type, content, fileName }, transfers);
  });
}

/**
 * Build a Three.js Mesh from the worker's surface data.
 * Mirrors the same transform & material as XMLtoThree_Surface / DEMtoThree_Surface.
 */
function buildMeshFromWorkerData(surfaceData, surfaceIndex) {
  const { vertexBuffer, centroid } = surfaceData;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertexBuffer, 3));
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(1, 1, -1);
  geometry.computeVertexNormals();

  const isLight = document.body.classList.contains('light-mode');
  const material = new THREE.MeshStandardMaterial({
    color: isLight ? 0x5a5a5a : 0x808080,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: surfaceIndex,
    polygonOffsetUnits: surfaceIndex,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = surfaceData.name;
  mesh.userData.baseScaleY = 1;

  // Set origin from the first surface's raw bbox centroid (same first-call-wins logic)
  const bboxCentroid = surfaceData.rawBBox.centroid;
  initOriginFromPoints([[bboxCentroid.x, bboxCentroid.y, bboxCentroid.z]]);

  const origin = getOrigin() || { x: 0, y: 0, z: 0 };
  const cx = centroid.x, cy = centroid.y, cz = centroid.z;
  const dx = cx - origin.x;
  const dy = cy - origin.y;
  const dz = cz - origin.z;
  mesh.position.set(dx, dz, dy);

  return mesh;
}

// ── Sample definitions ─────────────────────────────────
// Each key is a ?sample= query-param value, mapping to file paths + types.
const SAMPLES = {
  'wilsonville-ramp': [
    { path: 'geometry/Wilsonville_Ramp.xml', type: 'landxml', readAs: 'text' },
  ],
  'mt-hood': [
    { path: 'geometry/Mt Hood Clipped.tif', type: 'geotiff', readAs: 'arraybuffer' },
  ],
  'eg-fg': [
    { path: 'geometry/EG.xml', type: 'landxml', readAs: 'text' },
    { path: 'geometry/FG.xml', type: 'landxml', readAs: 'text' },
  ],
};

/**
 * Parse content and load into scene. Routes LandXML to main thread, DEM to worker.
 */
async function parseAndLoad(name, content, fileType, scene) {
  setStatus(`Loading ${name}...`);

  try {
    let result;
    if (fileType === 'landxml') {
      result = parseLandXML(content, name);
    } else {
      result = await workerParse(fileType, content, name);
    }

    const { surfaces, fileMeta, crsAttrs } = result;

    const objects = surfaces.map((surfData, i) => {
      const mesh = buildMeshFromWorkerData(surfData, i);
      return {
        mesh,
        type: surfData.type || 'Surface',
        name: surfData.name,
        metadata: surfData.meta || {},
      };
    });

    objects.forEach(obj => scene.add(obj.mesh));
    const fileEntry = addFile(name, objects, fileMeta);
    setCRS(fileEntry.id, crsAttrs);

    const count = objects.length;
    const label = (fileType === 'landxml') ? 'surface' : 'DEM';
    setStatus(`Loaded ${name} (${count} ${label}${count !== 1 ? 's' : ''})`);
  } catch (err) {
    console.error(err);
    setStatus(`Error loading ${name}`);
  }
}

/**
 * Load and parse a single file by URL.
 */
async function loadFileFromURL(url, fileType, scene) {
  const fileName = decodeURIComponent(url.split('/').pop());
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const content = (fileType === 'geotiff') ? await resp.arrayBuffer() : await resp.text();
    await parseAndLoad(fileName, content, fileType, scene);
  } catch (err) {
    console.error(err);
    setStatus(`Error loading ${fileName}`);
  }
}

/**
 * Position camera above the scene's combined bounding box, looking at the centre.
 */
function positionCameraAboveScene(scene, camera) {
  const box = new THREE.Box3();
  scene.traverse(obj => {
    if (obj.isMesh) box.expandByObject(obj);
  });
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  // Place camera above and slightly offset, at a distance proportional to the extent
  const maxSpan = Math.max(size.x, size.y, size.z);
  const offset = maxSpan * 0.6;
  camera.position.set(center.x + offset * 0.3, center.y + offset, center.z + offset * 0.3);
  camera.lookAt(center);
}

/**
 * Initialise file handling — upload listener, delete callback, and sample auto-load.
 * @param {THREE.Scene} scene
 * @param {object} controls  FirstPersonControls instance
 * @param {THREE.Camera} camera
 */
export function initFileHandler(scene, controls, camera) {

  // Handle uploaded files — parse and load into scene
  document.getElementById('data-panel-body').addEventListener('file-uploaded', async (e) => {
    const { name, content, fileType } = e.detail;
    await parseAndLoad(name, content, fileType, scene);
  });

  // Delete file from data tree → remove meshes from scene and dispose resources
  onFileDelete((fileId) => {
    const file = findFile(fileId);
    if (!file) return;
    removeCRSForFile(fileId);
    for (const group of Object.values(file.groups)) {
      for (const obj of group) {
        if (obj.mesh) {
          scene.remove(obj.mesh);
          if (obj.mesh.geometry) obj.mesh.geometry.dispose();
          if (obj.mesh.material) {
            if (Array.isArray(obj.mesh.material)) {
              obj.mesh.material.forEach(m => m.dispose());
            } else {
              obj.mesh.material.dispose();
            }
          }
        }
      }
    }

    // If scene is now empty, reset origin so next load gets a fresh one
    if (getFiles().length <= 1) {
      // <= 1 because removeFile hasn't been called yet (it fires after this callback)
      resetOrigin();
    }
  });

  // ── Auto-load sample from query param ──────────────
  const params = new URLSearchParams(window.location.search);
  const sampleKey = params.get('sample');
  if (sampleKey && SAMPLES[sampleKey]) {
    // Remove the default cube
    const cube = scene.getObjectByName('__default_cube__');
    if (cube) {
      scene.remove(cube);
      if (cube.geometry) cube.geometry.dispose();
      if (cube.material) cube.material.dispose();
    }

    const files = SAMPLES[sampleKey];
    (async () => {
      for (const f of files) {
        await loadFileFromURL(f.path, f.type, scene);
      }
      // Position camera above the loaded geometry
      positionCameraAboveScene(scene, camera);
    })();
  }
}

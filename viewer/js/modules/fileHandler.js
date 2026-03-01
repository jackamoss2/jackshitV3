/**
 * File Handler
 * Handles file upload events and file deletion (mesh cleanup).
 * Parsing runs in a Web Worker to keep the UI responsive.
 */

import * as THREE from '../libs/three.module.js';
import { addFile, findFile, getFiles } from './sceneData.js';
import { onFileDelete } from './dataTree.js';
import { setStatus } from './uiController.js';
import { setCRS, removeCRSForFile, resetOrigin, initOriginFromPoints, getOrigin } from './crsManager.js';

// Spin up the parse worker once
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

/**
 * Initialise file handling — upload listener and delete callback.
 * @param {THREE.Scene} scene
 * @param {object} controls  FirstPersonControls instance
 */
export function initFileHandler(scene, controls) {

  // Handle uploaded files — parse in worker, build meshes on main thread
  document.getElementById('data-panel-body').addEventListener('file-uploaded', async (e) => {
    const { name, content, fileType } = e.detail;
    setStatus(`Loading ${name}...`);

    try {
      const result = await workerParse(fileType, content, name);
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
}

/**
 * File Handler
 * Handles LandXML file upload events and file deletion (mesh cleanup).
 */

import { loadLandXML } from './data transformation/xmlParser.js';
import { addFile, findFile, getFiles } from './sceneData.js';
import { onFileDelete } from './dataTree.js';
import { setStatus } from './uiController.js';
import { setCRS, removeCRSForFile, resetOrigin } from './crsManager.js';

/**
 * Initialise file handling — upload listener and delete callback.
 * @param {THREE.Scene} scene
 * @param {object} controls  FirstPersonControls instance
 */
export function initFileHandler(scene, controls) {

  // Handle uploaded XML files
  document.getElementById('data-panel-body').addEventListener('file-uploaded', (e) => {
    const { name, content } = e.detail;
    setStatus(`Loading ${name}...`);
    try {
      const { fileMeta, objects, crsAttrs } = loadLandXML(content, name);
      objects.forEach(obj => scene.add(obj.mesh));
      const fileEntry = addFile(name, objects, fileMeta);
      setCRS(fileEntry.id, crsAttrs);
      setStatus(`Loaded ${name} (${objects.length} surface${objects.length !== 1 ? 's' : ''})`);
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

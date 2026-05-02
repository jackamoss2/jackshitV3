/**
 * File Handler
 * Handles file upload events and file deletion (mesh cleanup).
 * LandXML is parsed on the main thread (DOMParser required).
 * DEM parsing runs in a Web Worker to keep the UI responsive.
 */

import * as THREE from '../libs/three.module.js';
import { addFile, findFile, getFiles, removeObject, onSetDisplayMode } from './sceneData.js';
import { onFileDelete, onObjectDelete } from './dataTree.js';
import { setStatus } from './uiController.js';
import { setCRS, removeCRSForFile, resetOrigin, initOriginFromPoints, getOrigin } from './crsManager.js';
import { parseLandXML } from './xmlParser.js';

// ── Contour ShaderMaterial ───────────────────────────────────────────────────
const CONTOUR_VERT = `
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CONTOUR_FRAG = `
uniform float uMinY;
uniform float uMaxY;
uniform float uInterval;
uniform vec3  uLineColor;
uniform vec3  uBaseColor;
varying vec3 vWorldPos;
void main() {
  float t = fract(vWorldPos.y / uInterval);
  // Anti-aliased line: thin band near 0
  float fw = fwidth(vWorldPos.y / uInterval);
  float line = 1.0 - smoothstep(fw * 0.5, fw * 1.5, min(t, 1.0 - t));
  vec3 col = mix(uBaseColor, uLineColor, line);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildContourMaterial(minY, maxY, interval) {
  const autoInterval = interval || Math.max(0.5, Math.round((maxY - minY) / 20));
  return new THREE.ShaderMaterial({
    uniforms: {
      uMinY:      { value: minY },
      uMaxY:      { value: maxY },
      uInterval:  { value: autoInterval },
      uLineColor: { value: new THREE.Color(0x000000) },
      uBaseColor: { value: new THREE.Color(0x888888) },
    },
    vertexShader:   CONTOUR_VERT,
    fragmentShader: CONTOUR_FRAG,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
}

/**
 * Switch a surface mesh between 'solid' and 'contour' display modes.
 * Stores the original solid material on mesh.userData so it can be restored.
 */
export function setDisplayMode(mesh, mode) {
  if (!mesh || !mesh.isMesh) return;
  if (mode === 'contour') {
    if (!mesh.userData._solidMaterial) mesh.userData._solidMaterial = mesh.material;
    const minY = (mesh.userData.elevMinY ?? 0);
    const maxY = (mesh.userData.elevMaxY ?? 100);
    mesh.material = buildContourMaterial(minY, maxY);
  } else {
    if (mesh.userData._solidMaterial) {
      mesh.material.dispose();
      mesh.material = mesh.userData._solidMaterial;
      mesh.userData._solidMaterial = null;
    }
  }
}

/**
 * Serialize a file entry's xmlDoc to an XML string, inject visual settings,
 * and trigger a browser download. No-op if the file has no xmlDoc (e.g. DEM).
 * @param {object} fileEntry - entry from sceneData
 */
export function exportFileXML(fileEntry) {
  if (!fileEntry?.xmlDoc) return;

  // Collect non-default styles to embed
  const styles = [];
  for (const group of Object.values(fileEntry.groups)) {
    for (const obj of group) {
      if (obj.style?.color) {
        styles.push({ name: obj.name, color: obj.style.color, displayMode: obj.style.displayMode || 'solid' });
      }
    }
  }

  // Remove previous viewer metadata, then re-inject if any
  const doc = fileEntry.xmlDoc;
  doc.querySelectorAll('Feature[code="JackshitViewer3D"]').forEach(el => el.remove());
  if (styles.length > 0) {
    const feature = doc.createElement('Feature');
    feature.setAttribute('code', 'JackshitViewer3D');
    const prop = doc.createElement('Property');
    prop.setAttribute('label', 'styles');
    prop.setAttribute('value', JSON.stringify(styles));
    feature.appendChild(prop);
    doc.documentElement.appendChild(feature);
  }

  const xml = new XMLSerializer().serializeToString(doc);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileEntry.name.endsWith('.xml') ? fileEntry.name : fileEntry.name + '.xml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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

  // Store elevation range for contour shader
  const bbox = surfaceData.rawBBox;
  mesh.userData.elevMinY = bbox.min.z;  // Z in LandXML = elevation
  mesh.userData.elevMaxY = bbox.max.z;

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

// ── Line-geometry colours per feature type ──────────────────────────────────
const LINE_COLORS = {
  PipeNetwork: 0x00BFFF,
  Structure:   0x40E0D0,
  Alignment:   0xFF8C00,
  FeatureLine: 0x90EE90,
};

/**
 * Build a Three.js LineSegments object from a lineBuffer produced by the parser.
 */
function buildLineFromWorkerData(objData) {
  const { lineBuffer, centroid } = objData;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(lineBuffer, 3));
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(1, 1, -1);

  const color    = LINE_COLORS[objData.type] ?? 0xAAAAAA;
  const material = new THREE.LineBasicMaterial({ color });
  const lineObj  = new THREE.LineSegments(geometry, material);
  lineObj.name   = objData.name;

  const bboxCentroid = objData.rawBBox.centroid;
  initOriginFromPoints([[bboxCentroid.x, bboxCentroid.y, bboxCentroid.z]]);

  const origin = getOrigin() || { x: 0, y: 0, z: 0 };
  lineObj.position.set(
    centroid.x - origin.x,
    centroid.z - origin.z,
    centroid.y - origin.y
  );

  return lineObj;
}

// ── LandXML (N, E, Z) → Three.js world (x, y, z) given scene origin ──────────
// Three.js world = (N - oN,  Z - oZ,  E - oE)
function landxmlToThree(n, e, z, origin) {
  return new THREE.Vector3(n - origin.x, z - origin.z, e - origin.y);
}

/**
 * Build a merged Three.js Mesh of oriented cylinders, one per pipe segment.
 * Each pipe uses its CircPipe outer radius and is oriented along its 3D axis.
 */
function buildPipeNetworkMesh(objData) {
  const { pipeSegments, rawBBox } = objData;
  initOriginFromPoints([[rawBBox.centroid.x, rawBBox.centroid.y, rawBBox.centroid.z]]);
  const origin = getOrigin() || { x: 0, y: 0, z: 0 };

  const positions = [], normals = [], indices = [];
  let vertOffset = 0;
  const yAxis = new THREE.Vector3(0, 1, 0);

  for (const seg of pipeSegments) {
    const p1  = landxmlToThree(seg.start[0], seg.start[1], seg.start[2], origin);
    const p2  = landxmlToThree(seg.end[0],   seg.end[1],   seg.end[2],   origin);
    const len = p1.distanceTo(p2);
    if (len < 1e-4) continue;

    const cyl = new THREE.CylinderGeometry(seg.radiusOut, seg.radiusOut, len, 10, 1, false);

    const dir  = new THREE.Vector3().subVectors(p2, p1).normalize();
    const quat = new THREE.Quaternion();
    const dot  = dir.dot(yAxis);
    if (dot < -0.9999) {
      quat.set(1, 0, 0, 0); // 180° around X for antiparallel case
    } else if (dot < 0.9999) {
      quat.setFromUnitVectors(yAxis, dir);
    }
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    cyl.applyMatrix4(new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)));

    const pa = cyl.attributes.position.array;
    const na = cyl.attributes.normal.array;
    const ia = cyl.index.array;
    for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
    for (let i = 0; i < na.length; i++) normals.push(na[i]);
    for (let i = 0; i < ia.length; i++) indices.push(ia[i] + vertOffset);
    vertOffset += pa.length / 3;
    cyl.dispose();
  }

  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(normals),   3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x00BFFF, roughness: 0.5, metalness: 0.15 }));
  mesh.name = objData.name;
  return mesh;
}

/**
 * Build a merged Three.js Mesh of vertical tapered cylinders, one per manhole structure.
 * Bottom radius = CircStruct radius; top radius = 25% of that (cone neck typical of manholes).
 * Positioned from elevSump (barrel base) to elevRim (cover).
 */
function buildStructureMesh(objData) {
  const { structSegments, rawBBox } = objData;
  initOriginFromPoints([[rawBBox.centroid.x, rawBBox.centroid.y, rawBBox.centroid.z]]);
  const origin = getOrigin() || { x: 0, y: 0, z: 0 };

  const positions = [], normals = [], indices = [];
  let vertOffset = 0;

  for (const seg of structSegments) {
    const height = seg.zRim - seg.zSump;
    if (height < 1e-4) continue;

    const rBase = seg.radiusOut;
    // Split into barrel (lower 80%) and cone neck (upper 20%) for manhole shape
    const barrelH = height * 0.80;
    const neckH   = height * 0.20;
    const rNeck   = rBase * 0.30; // ~30% radius at top — typical manhole cone

    const tx = seg.northing - origin.x;
    const tz = seg.easting  - origin.y;

    // Barrel: full-radius cylinder for lower portion
    const barrel = new THREE.CylinderGeometry(rBase, rBase, barrelH, 14, 1, false);
    const barrelMid = (seg.zSump + seg.zSump + barrelH) / 2 - origin.z; // midpoint of barrel
    barrel.applyMatrix4(new THREE.Matrix4().makeTranslation(tx, (seg.zSump - origin.z) + barrelH / 2, tz));

    // Cone neck: tapered top section
    const neck = new THREE.CylinderGeometry(rNeck, rBase, neckH, 14, 1, false);
    neck.applyMatrix4(new THREE.Matrix4().makeTranslation(tx, (seg.zRim - origin.z) - neckH / 2, tz));

    for (const cyl of [barrel, neck]) {
      const pa = cyl.attributes.position.array;
      const na = cyl.attributes.normal.array;
      const ia = cyl.index.array;
      for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
      for (let i = 0; i < na.length; i++) normals.push(na[i]);
      for (let i = 0; i < ia.length; i++) indices.push(ia[i] + vertOffset);
      vertOffset += pa.length / 3;
      cyl.dispose();
    }
  }

  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(normals),   3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x40E0D0, roughness: 0.4, metalness: 0.2 }));
  mesh.name = objData.name + ' — Structures';
  return mesh;
}

/**
 * Build a THREE.Group containing both the pipe mesh and structure mesh for a network.
 * The group is treated as a single scene object so visibility/delete affects both together.
 */
function buildNetworkMesh(objData) {
  const group = new THREE.Group();
  group.name = objData.name;
  if (objData.pipeSegments) {
    const pipeMesh = buildPipeNetworkMesh(objData);
    if (pipeMesh) { pipeMesh.name = objData.name + ' — Pipes'; group.add(pipeMesh); }
  }
  if (objData.structSegments) {
    const structMesh = buildStructureMesh(objData);
    if (structMesh) group.add(structMesh);
  }
  return group.children.length > 0 ? group : null;
}

/** Recursively remove a mesh/group from the scene and dispose all GPU resources. */
function disposeMesh(obj, scene) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });
}

// Each key is a ?sample= query-param value, mapping to file paths + types.
const SAMPLES = {
  'wilsonville-ramp': [
    { path: 'geometry/C/Wilsonville_Ramp.xml', type: 'landxml', readAs: 'text' },
  ],
  'mt-hood': [
    { path: 'geometry/Mt Hood Clipped.tif', type: 'geotiff', readAs: 'arraybuffer' },
  ],
  'eg-fg': [
    { path: 'geometry/C/EG.xml', type: 'landxml', readAs: 'text' },
    { path: 'geometry/C/FG.xml', type: 'landxml', readAs: 'text' },
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

    const { surfaces, fileMeta, crsAttrs, xmlDoc } = result;

    let surfaceIdx = 0;
    const objects = surfaces.map(surfData => {
      let mesh;
      if (surfData.pipeSegments || surfData.structSegments) {
        mesh = buildNetworkMesh(surfData);
      } else if (surfData.lineBuffer) {
        mesh = buildLineFromWorkerData(surfData);
      } else {
        mesh = buildMeshFromWorkerData(surfData, surfaceIdx++);
      }
      if (!mesh) return null;
      return {
        mesh,
        type: surfData.type || 'Surface',
        name: surfData.name,
        metadata: surfData.meta || {},
      };
    }).filter(Boolean);

    objects.forEach(obj => scene.add(obj.mesh));
    const fileEntry = addFile(name, objects, fileMeta, xmlDoc ?? null);
    setCRS(fileEntry.id, crsAttrs);

    const count      = objects.length;
    const allSurfaces = objects.every(o => o.type === 'Surface');
    const label       = (fileType === 'geotiff' || fileType === 'asc') ? 'DEM'
                      : allSurfaces ? 'surface' : 'object';
    setStatus(`Loaded ${name} (${count} ${label}${count !== 1 ? 's' : ''})`);
  } catch (err) {
    console.error(err);
    const msg = err?.message ? `: ${err.message}` : '';
    setStatus(`Error loading ${name}${msg}`);
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
    const msg = err?.message ? `: ${err.message}` : '';
    setStatus(`Error loading ${fileName}${msg}`);
  }
}

/**
 * Position camera above the scene's combined bounding box, looking at the centre.
 */
function positionCameraAboveScene(scene, camera) {
  const box = new THREE.Box3();
  scene.traverse(obj => {
    if (obj.isMesh || obj.isLine) box.expandByObject(obj);
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

  // Wire up display mode changes from sceneData
  onSetDisplayMode(setDisplayMode);

  // Handle uploaded files — parse and load into scene
  document.getElementById('data-panel-body').addEventListener('file-uploaded', async (e) => {
    const { name, content, fileType } = e.detail;
    await parseAndLoad(name, content, fileType, scene);
  });

  // Delete single object from data tree → remove mesh from scene and dispose resources
  onObjectDelete(({ objId, fileId }) => {
    const file = findFile(fileId);
    if (!file) return;
    for (const group of Object.values(file.groups)) {
      const obj = group.find(o => o.id === objId);
      if (obj?.mesh) { disposeMesh(obj.mesh, scene); break; }
    }
    const totalObjs = getFiles().reduce((sum, f) => sum + Object.values(f.groups).reduce((s, g) => s + g.length, 0), 0);
    const fileObjCount = Object.values(file.groups).reduce((s, g) => s + g.length, 0);
    if (fileObjCount <= 1) removeCRSForFile(fileId);
    if (totalObjs <= 1) resetOrigin();
  });

  // Delete file from data tree → remove meshes from scene and dispose resources
  onFileDelete((fileId) => {
    const file = findFile(fileId);
    if (!file) return;
    removeCRSForFile(fileId);
    for (const group of Object.values(file.groups)) {
      for (const obj of group) disposeMesh(obj.mesh, scene);
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

import * as THREE from '../../libs/three.module.js';
import { initOriginFromPoints, getOrigin } from '../crsManager.js';

// parse a LandXML point string into [x, y, z]
function parseCoords(text) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 2) parts.push(0);
  if (parts.some(isNaN)) return null;
  return parts;
}

/**
 * @param {Element} surfaceNode
 * @param {number} surfaceIndex - used for polygonOffset to avoid Z-fighting
 * @returns {{ mesh: THREE.Mesh, rawPoints: number[][] }}
 */
export function createSurfaceMesh(surfaceNode, surfaceIndex = 0) {
  const surfaceName = surfaceNode.getAttribute("name") || "LandXML_Surface";

  // --- collect points ---
  const pointsMap = new Map();
  const rawPoints = [];
  surfaceNode.querySelectorAll("P").forEach(node => {
    const coordsArr = parseCoords(node.textContent);
    if (!coordsArr) return;
    pointsMap.set(node.getAttribute("id"), coordsArr);
    rawPoints.push(coordsArr);
  });

  // Register global scene origin (first call wins)
  initOriginFromPoints(rawPoints);

  // Compute this surface's own centroid in raw LandXML space
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of rawPoints) {
    cx += x; cy += y; cz += z;
  }
  cx /= rawPoints.length;
  cy /= rawPoints.length;
  cz /= rawPoints.length;

  // --- collect faces (vertices relative to surface centroid → always small for Float32) ---
  const vertexArray = [];
  surfaceNode.querySelectorAll("Faces > F").forEach(node => {
    if (node.getAttribute("i") === "1") return; // skip invisible
    const ids = node.textContent.trim().split(/\s+/);
    if (ids.length !== 3) return;

    const coords = ids.map(id => pointsMap.get(id));
    if (coords.includes(undefined)) return;

    coords.forEach(([x, y, z]) => {
      vertexArray.push(x - cx, y - cy, z - cz);
    });
  });

  // --- create geometry ---
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertexArray), 3)
  );

  // coordinate transform: LandXML -> Three.js
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(1, 1, -1);

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x808080,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: surfaceIndex,
    polygonOffsetUnits: surfaceIndex,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = surfaceName;

  // Position mesh in scene space using float64 (mesh.position)
  // Raw offset from global origin: (cx - origin.x, cy - origin.y, cz - origin.z)
  // LandXML→Three.js transform: rotateX(-PI/2) + scale(1,1,-1) gives (dx, dz, dy)
  const origin = getOrigin() || { x: 0, y: 0, z: 0 };
  const dx = cx - origin.x;
  const dy = cy - origin.y;
  const dz = cz - origin.z;
  mesh.position.set(dx, dz, dy);

  return { mesh, rawPoints };
}
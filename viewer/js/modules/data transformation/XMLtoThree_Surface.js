import * as THREE from '../../libs/three.module.js';
import { initOriginFromPoints, applyOffset } from '../crsManager.js';

// parse a LandXML point string into [x, y, z]
function parseCoords(text) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 2) parts.push(0);
  if (parts.some(isNaN)) return null;
  return parts;
}

/**
 * @param {Element} surfaceNode
 * @returns {{ mesh: THREE.Mesh, rawPoints: number[][] }}
 */
export function createSurfaceMesh(surfaceNode) {
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

  // Establish scene origin from first surface's points
  initOriginFromPoints(rawPoints);

  // --- collect faces (apply offset) ---
  const vertexArray = [];
  surfaceNode.querySelectorAll("Faces > F").forEach(node => {
    if (node.getAttribute("i") === "1") return; // skip invisible
    const ids = node.textContent.trim().split(/\s+/);
    if (ids.length !== 3) return;

    const coords = ids.map(id => pointsMap.get(id));
    if (coords.includes(undefined)) return;

    coords.forEach(([x, y, z]) => {
      const [ox, oy, oz] = applyOffset(x, y, z);
      vertexArray.push(ox, oy, oz);
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
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = surfaceName;

  return { mesh, rawPoints };
}
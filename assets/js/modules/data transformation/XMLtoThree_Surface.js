import * as THREE from 'three';

// parse a LandXML point string into [x, y, z]
function parseCoords(text) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 2) parts.push(0);
  if (parts.some(isNaN)) return null;
  return parts;
}

export function createSurfaceMesh(surfaceNode) {
  const surfaceName = surfaceNode.getAttribute("name") || "LandXML_Surface";

  // --- collect points ---
  const pointsMap = new Map();
  surfaceNode.querySelectorAll("P").forEach(node => {
    const coordsArr = parseCoords(node.textContent);
    if (!coordsArr) return;
    pointsMap.set(node.getAttribute("id"), coordsArr);
  });

  // --- collect faces ---
  const vertexArray = [];
  surfaceNode.querySelectorAll("Faces > F").forEach(node => {
    if (node.getAttribute("i") === "1") return; // skip invisible
    const ids = node.textContent.trim().split(/\s+/);
    if (ids.length !== 3) return;

    const coords = ids.map(id => pointsMap.get(id));
    if (coords.includes(undefined)) return;

    coords.forEach(([x, y, z]) => vertexArray.push(x, y, z));
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

  return mesh;
}
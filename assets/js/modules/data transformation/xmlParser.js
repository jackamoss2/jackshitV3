import { createSurfaceMesh } from './surfaceMesh.js';

export function loadLandXML(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");

  const objects = [];

  xmlDoc.querySelectorAll("Surface").forEach(surfaceNode => {
    const mesh = createSurfaceMesh(surfaceNode);
    objects.push({ mesh, type: "Surface", metadata: {} });
  });

  // Future: xmlDoc.querySelectorAll("Pipe") → call pipe builder

  return objects;
}
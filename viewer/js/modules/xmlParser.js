/**
 * LandXML Parser (main thread)
 * Parses LandXML text into surface data with centroid-relative Float32Array vertex buffers.
 * Runs on the main thread using DOMParser (guaranteed available).
 *
 * Returns: { surfaces: [ { name, type, vertexBuffer, centroid, rawBBox, meta } ], fileMeta, crsAttrs }
 */

function computeBBox(rawPoints) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of rawPoints) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    centroid: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
  };
}

function computeCentroid(rawPoints) {
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of rawPoints) { cx += x; cy += y; cz += z; }
  const n = rawPoints.length;
  return { x: cx / n, y: cy / n, z: cz / n };
}

function parseCoords(text) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 2) parts.push(0);
  if (parts.some(isNaN)) return null;
  return parts;
}

/**
 * Parse a LandXML string into structured surface data.
 * @param {string} xmlString
 * @param {string} fileName
 * @returns {{ surfaces, fileMeta, crsAttrs }}
 */
export function parseLandXML(xmlString, fileName) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');

  // File-level metadata
  const fileMeta = {};
  const root = xmlDoc.documentElement;
  if (root) {
    if (root.getAttribute('version')) fileMeta['LandXML Version'] = root.getAttribute('version');
    const date = root.getAttribute('date') || '';
    const time = root.getAttribute('time') || '';
    if (date || time) fileMeta['Date'] = [date, time].filter(Boolean).join(' ');
  }

  const crs = xmlDoc.querySelector('CoordinateSystem');
  if (crs) {
    if (crs.getAttribute('desc'))             fileMeta['CRS'] = crs.getAttribute('desc');
    if (crs.getAttribute('horizontalDatum'))  fileMeta['Horizontal Datum'] = crs.getAttribute('horizontalDatum');
    if (crs.getAttribute('verticalDatum'))    fileMeta['Vertical Datum'] = crs.getAttribute('verticalDatum');
    if (crs.getAttribute('datum'))            fileMeta['Datum'] = crs.getAttribute('datum');
    if (crs.getAttribute('horizontalCoordinateSystemName')) fileMeta['Coordinate System'] = crs.getAttribute('horizontalCoordinateSystemName');
    if (crs.getAttribute('rotationAngle'))    fileMeta['Rotation Angle'] = crs.getAttribute('rotationAngle');
  }

  const project = xmlDoc.querySelector('Project');
  if (project) {
    if (project.getAttribute('name')) fileMeta['Source Path'] = project.getAttribute('name');
    if (project.getAttribute('desc')) fileMeta['Project Desc'] = project.getAttribute('desc');
  }

  const app = xmlDoc.querySelector('Application');
  if (app) {
    const appName = app.getAttribute('name') || '';
    const appVer = app.getAttribute('version') || '';
    if (appName || appVer) fileMeta['Application'] = [appName, appVer].filter(Boolean).join(' ');
  }

  const units = xmlDoc.querySelector('Units');
  if (units) {
    const metric = units.querySelector('Metric, Imperial');
    if (metric) {
      if (metric.getAttribute('linearUnit'))  fileMeta['Linear Unit'] = metric.getAttribute('linearUnit');
      if (metric.getAttribute('areaUnit'))    fileMeta['Area Unit'] = metric.getAttribute('areaUnit');
      if (metric.getAttribute('volumeUnit'))  fileMeta['Volume Unit'] = metric.getAttribute('volumeUnit');
      if (metric.getAttribute('angularUnit')) fileMeta['Angular Unit'] = metric.getAttribute('angularUnit');
    }
  }

  const crsAttrs = {};
  if (fileMeta['CRS'])               crsAttrs.CRS = fileMeta['CRS'];
  if (fileMeta['Horizontal Datum'])   crsAttrs['Horizontal Datum'] = fileMeta['Horizontal Datum'];
  if (fileMeta['Vertical Datum'])     crsAttrs['Vertical Datum'] = fileMeta['Vertical Datum'];
  if (fileMeta['Datum'])              crsAttrs.Datum = fileMeta['Datum'];
  if (fileMeta['Coordinate System'])  crsAttrs['Coordinate System'] = fileMeta['Coordinate System'];

  // Parse surfaces
  const surfaces = [];
  const surfaceNodes = xmlDoc.querySelectorAll('Surface');

  surfaceNodes.forEach((surfaceNode, i) => {
    const name = surfaceNode.getAttribute('name') || `Surface ${i + 1}`;
    const desc = surfaceNode.getAttribute('desc') || '';
    const surfType = surfaceNode.getAttribute('surfType') || '';

    // Collect points
    const pointsMap = new Map();
    const rawPoints = [];
    surfaceNode.querySelectorAll('P').forEach(node => {
      const coords = parseCoords(node.textContent);
      if (!coords) return;
      pointsMap.set(node.getAttribute('id'), coords);
      rawPoints.push(coords);
    });

    if (rawPoints.length === 0) return;

    const centroid = computeCentroid(rawPoints);
    const cx = centroid.x, cy = centroid.y, cz = centroid.z;

    // Collect faces — vertices relative to centroid
    const verts = [];
    surfaceNode.querySelectorAll('Faces > F').forEach(node => {
      if (node.getAttribute('i') === '1') return;
      const ids = node.textContent.trim().split(/\s+/);
      if (ids.length !== 3) return;
      const coords = ids.map(id => pointsMap.get(id));
      if (coords.includes(undefined)) return;
      coords.forEach(([x, y, z]) => {
        verts.push(x - cx, y - cy, z - cz);
      });
    });

    if (verts.length === 0) return;

    const vertexBuffer = new Float32Array(verts);
    const bbox = computeBBox(rawPoints);

    surfaces.push({
      name,
      type: 'Surface',
      vertexBuffer,
      centroid,
      rawBBox: bbox,
      meta: {
        description: desc,
        'Surface Type': surfType,
        vertices: vertexBuffer.length / 3,
        triangles: vertexBuffer.length / 9,
        'Easting Range':   `${bbox.min.y.toFixed(2)} - ${bbox.max.y.toFixed(2)}`,
        'Northing Range':  `${bbox.min.x.toFixed(2)} - ${bbox.max.x.toFixed(2)}`,
        'Elevation Range': `${bbox.min.z.toFixed(2)} - ${bbox.max.z.toFixed(2)}`,
      }
    });
  });

  return { ok: true, surfaces, fileMeta, crsAttrs };
}

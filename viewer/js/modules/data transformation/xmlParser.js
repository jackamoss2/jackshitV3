import { createSurfaceMesh } from './XMLtoThree_Surface.js';
import { computeWorldBBox, getOrigin } from '../crsManager.js';

export function loadLandXML(xmlString, fileName) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");

  // ── File-level metadata ──────────────────────────
  const fileMeta = {};

  const root = xmlDoc.documentElement;
  if (root) {
    if (root.getAttribute('version')) fileMeta['LandXML Version'] = root.getAttribute('version');
    const date = root.getAttribute('date') || '';
    const time = root.getAttribute('time') || '';
    if (date || time) fileMeta['Date'] = [date, time].filter(Boolean).join(' ');
  }

  // Coordinate system
  const crs = xmlDoc.querySelector('CoordinateSystem');
  if (crs) {
    if (crs.getAttribute('desc'))             fileMeta['CRS'] = crs.getAttribute('desc');
    if (crs.getAttribute('horizontalDatum'))  fileMeta['Horizontal Datum'] = crs.getAttribute('horizontalDatum');
    if (crs.getAttribute('verticalDatum'))    fileMeta['Vertical Datum'] = crs.getAttribute('verticalDatum');
    if (crs.getAttribute('datum'))            fileMeta['Datum'] = crs.getAttribute('datum');
    if (crs.getAttribute('horizontalCoordinateSystemName')) fileMeta['Coordinate System'] = crs.getAttribute('horizontalCoordinateSystemName');
    if (crs.getAttribute('rotationAngle'))    fileMeta['Rotation Angle'] = crs.getAttribute('rotationAngle');
  }

  // Project info
  const project = xmlDoc.querySelector('Project');
  if (project) {
    if (project.getAttribute('name')) fileMeta['Source Path'] = project.getAttribute('name');
    if (project.getAttribute('desc')) fileMeta['Project Desc'] = project.getAttribute('desc');
  }

  // Application info
  const app = xmlDoc.querySelector('Application');
  if (app) {
    const appName = app.getAttribute('name') || '';
    const appVer = app.getAttribute('version') || '';
    if (appName || appVer) fileMeta['Application'] = [appName, appVer].filter(Boolean).join(' ');
  }

  // Units
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

  // ── Collect CRS attributes (registered by fileHandler after addFile assigns an ID) ──
  const crsAttrs = {};
  if (fileMeta['CRS'])               crsAttrs.CRS = fileMeta['CRS'];
  if (fileMeta['Horizontal Datum'])   crsAttrs['Horizontal Datum'] = fileMeta['Horizontal Datum'];
  if (fileMeta['Vertical Datum'])     crsAttrs['Vertical Datum'] = fileMeta['Vertical Datum'];
  if (fileMeta['Datum'])              crsAttrs.Datum = fileMeta['Datum'];
  if (fileMeta['Coordinate System'])  crsAttrs['Coordinate System'] = fileMeta['Coordinate System'];

  // ── Parse objects ────────────────────────────────
  const objects = [];

  xmlDoc.querySelectorAll("Surface").forEach((surfaceNode, i) => {
    const { mesh, rawPoints } = createSurfaceMesh(surfaceNode, i);
    const name = surfaceNode.getAttribute('name') || `Surface ${i + 1}`;
    const desc = surfaceNode.getAttribute('desc') || '';
    const surfType = surfaceNode.getAttribute('surfType') || '';
    mesh.name = name;

    // Compute real-world bounding box from raw coordinates
    const bbox = computeWorldBBox(rawPoints);
    const bboxMeta = {};
    if (bbox) {
      bboxMeta['Easting Range'] = `${bbox.min.y.toFixed(2)} - ${bbox.max.y.toFixed(2)}`;
      bboxMeta['Northing Range'] = `${bbox.min.x.toFixed(2)} - ${bbox.max.x.toFixed(2)}`;
      bboxMeta['Elevation Range'] = `${bbox.min.z.toFixed(2)} - ${bbox.max.z.toFixed(2)}`;
    }

    objects.push({
      mesh,
      type: "Surface",
      name,
      metadata: {
        description: desc,
        'Surface Type': surfType,
        vertices: mesh.geometry?.attributes?.position?.count || 0,
        triangles: Math.floor((mesh.geometry?.attributes?.position?.count || 0) / 3),
        ...bboxMeta,
      }
    });
  });

  // Future: xmlDoc.querySelectorAll("Pipe") → call pipe builder

  return { fileMeta, objects, crsAttrs };
}
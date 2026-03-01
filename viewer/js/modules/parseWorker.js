/**
 * Parse Worker
 * Runs heavy file parsing off the main thread so the UI stays responsive.
 *
 * Receives: { type: 'landxml'|'geotiff'|'asc', content, fileName }
 * Returns:  { surfaces: [ { name, vertexBuffer, centroid, rawBBox, meta } ], fileMeta, crsAttrs }
 *
 * The vertexBuffer is a Float32Array (transferable) with centroid-relative vertices.
 * The main thread builds Three.js meshes from these lightweight results.
 */

// ── Shared helpers ──────────────────────────────────

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

// ── LandXML parsing (no DOM imports needed — use DOMParser in worker) ──

function parseCoords(text) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 2) parts.push(0);
  if (parts.some(isNaN)) return null;
  return parts;
}

function parseLandXML(xmlString, fileName) {
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

  return { surfaces, fileMeta, crsAttrs };
}

// ── DEM: ASCII Grid parsing ─────────────────────────

function parseASCGrid(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = {};
  let dataStartLine = 0;

  for (let i = 0; i < lines.length && i < 10; i++) {
    const match = lines[i].match(/^(\w+)\s+(.+)$/i);
    if (!match) break;
    const key = match[1].toLowerCase();
    const val = parseFloat(match[2]);
    if (isNaN(val)) break;
    header[key] = val;
    dataStartLine = i + 1;
  }

  const ncols = header.ncols;
  const nrows = header.nrows;
  const cellsize = header.cellsize;
  if (!ncols || !nrows || !cellsize) throw new Error('Invalid ASCII Grid');

  const nodata = header.nodata_value ?? header.nodata ?? -9999;
  const isCenter = ('xllcenter' in header);
  const xll = (header.xllcorner ?? header.xllcenter ?? 0) - (isCenter ? cellsize / 2 : 0);
  const yll = (header.yllcorner ?? header.yllcenter ?? 0) - (isCenter ? cellsize / 2 : 0);

  const data = new Float64Array(ncols * nrows);
  let idx = 0;
  for (let i = dataStartLine; i < lines.length && idx < data.length; i++) {
    const vals = lines[i].trim().split(/\s+/);
    for (const v of vals) {
      if (idx >= data.length) break;
      data[idx++] = parseFloat(v);
    }
  }

  return {
    width: ncols, height: nrows, data,
    origin: { easting: xll, northing: yll + nrows * cellsize },
    resolution: { x: cellsize, y: -cellsize },
    nodata, crs: null,
    meta: { 'Format': 'ASCII Grid', 'Grid Size': `${ncols} × ${nrows}`, 'Cell Size': `${cellsize}`, 'NODATA Value': `${nodata}` }
  };
}

// ── DEM: GeoTIFF parsing (uses geotiff.js loaded via importScripts) ──

async function parseGeoTIFFInWorker(arrayBuffer) {
  // geotiff loaded via importScripts in the message handler
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const width  = image.getWidth();
  const height = image.getHeight();
  const origin = image.getOrigin();
  const res    = image.getResolution();
  const bbox   = image.getBoundingBox();

  const rasters = await image.readRasters();
  const elevBand = rasters[0];
  const data = new Float64Array(elevBand.length);
  for (let i = 0; i < elevBand.length; i++) data[i] = elevBand[i];

  let nodata = null;
  try { if (typeof image.getGDALNoData === 'function') { const nd = image.getGDALNoData(); if (nd !== null && nd !== undefined) nodata = nd; } } catch(_) {}
  if (nodata === null) {
    try {
      const fd = image.fileDirectory;
      if (fd?.hasTag?.('GDAL_NODATA')) nodata = parseFloat(fd.getValue('GDAL_NODATA'));
      else if (fd?.GDAL_NODATA !== undefined) nodata = parseFloat(fd.GDAL_NODATA);
    } catch(_) {}
  }

  let crsEpsg = null;
  try {
    const gk = (typeof image.getGeoKeys === 'function') ? image.getGeoKeys() : image.geoKeys;
    if (gk) crsEpsg = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || null;
  } catch(_) {}

  return {
    width, height, data,
    origin: { easting: origin[0], northing: origin[1] },
    resolution: { x: res[0], y: res[1] },
    nodata,
    crs: crsEpsg ? { epsg: crsEpsg } : null,
    meta: {
      'Format': 'GeoTIFF', 'Grid Size': `${width} × ${height}`,
      'Pixel Size': `${Math.abs(res[0]).toFixed(4)} × ${Math.abs(res[1]).toFixed(4)}`,
      'Bounding Box': `E: ${bbox[0].toFixed(2)} - ${bbox[2].toFixed(2)}, N: ${bbox[1].toFixed(2)} - ${bbox[3].toFixed(2)}`,
      ...(nodata !== null ? { 'NODATA Value': `${nodata}` } : {}),
      ...(crsEpsg ? { 'EPSG': `${crsEpsg}` } : {}),
    }
  };
}

// ── DEM: Grid → triangulated surface data ───────────

const MAX_GRID_DIM = 1024;

function buildDEMSurface(gridData, surfaceName) {
  const { width, height, data, origin: gridOrigin, resolution, nodata } = gridData;

  const maxDim = Math.max(width, height);
  const step = maxDim > MAX_GRID_DIM ? Math.ceil(maxDim / MAX_GRID_DIM) : 1;
  const sampledW = Math.floor((width - 1) / step) + 1;
  const sampledH = Math.floor((height - 1) / step) + 1;
  const downsampled = step > 1;

  const rawPoints = [];
  const grid  = new Float64Array(sampledW * sampledH);
  const valid = new Uint8Array(sampledW * sampledH);

  for (let sr = 0; sr < sampledH; sr++) {
    const origRow = sr * step;
    for (let sc = 0; sc < sampledW; sc++) {
      const origCol = sc * step;
      const val = data[origRow * width + origCol];
      const idx = sr * sampledW + sc;
      if ((nodata !== null && val === nodata) || isNaN(val) || !isFinite(val) || val < -1e+10 || val > 1e+10) {
        valid[idx] = 0; grid[idx] = 0; continue;
      }
      const easting  = gridOrigin.easting  + origCol * resolution.x;
      const northing = gridOrigin.northing + origRow * resolution.y;
      grid[idx] = val; valid[idx] = 1;
      rawPoints.push([northing, easting, val]);
    }
  }

  if (rawPoints.length === 0) throw new Error('DEM contains no valid elevation data');

  const centroid = computeCentroid(rawPoints);
  const cx = centroid.x, cy = centroid.y, cz = centroid.z;

  const verts = [];
  for (let sr = 0; sr < sampledH - 1; sr++) {
    for (let sc = 0; sc < sampledW - 1; sc++) {
      const i00 = sr * sampledW + sc;
      const i10 = (sr + 1) * sampledW + sc;
      const i01 = sr * sampledW + (sc + 1);
      const i11 = (sr + 1) * sampledW + (sc + 1);
      if (!valid[i00] || !valid[i10] || !valid[i01] || !valid[i11]) continue;

      const r0 = sr * step, r1 = (sr + 1) * step;
      const c0 = sc * step, c1 = (sc + 1) * step;
      const e00 = gridOrigin.easting + c0 * resolution.x, n00 = gridOrigin.northing + r0 * resolution.y;
      const e10 = gridOrigin.easting + c0 * resolution.x, n10 = gridOrigin.northing + r1 * resolution.y;
      const e01 = gridOrigin.easting + c1 * resolution.x, n01 = gridOrigin.northing + r0 * resolution.y;
      const e11 = gridOrigin.easting + c1 * resolution.x, n11 = gridOrigin.northing + r1 * resolution.y;

      verts.push(n00 - cx, e00 - cy, grid[i00] - cz);
      verts.push(n10 - cx, e10 - cy, grid[i10] - cz);
      verts.push(n01 - cx, e01 - cy, grid[i01] - cz);
      verts.push(n10 - cx, e10 - cy, grid[i10] - cz);
      verts.push(n11 - cx, e11 - cy, grid[i11] - cz);
      verts.push(n01 - cx, e01 - cy, grid[i01] - cz);
    }
  }

  if (verts.length === 0) throw new Error('No valid triangles from DEM');

  const vertexBuffer = new Float32Array(verts);
  const bbox = computeBBox(rawPoints);

  return {
    name: surfaceName,
    type: 'DEM',
    vertexBuffer,
    centroid,
    rawBBox: bbox,
    downsampled,
    meta: {
      ...gridData.meta,
      vertices: vertexBuffer.length / 3,
      triangles: vertexBuffer.length / 9,
      ...(downsampled ? { 'Downsampled': 'Yes', 'Display Resolution': `Downsampled from ${width} × ${height}` } : {}),
      'Easting Range':   `${bbox.min.y.toFixed(2)} - ${bbox.max.y.toFixed(2)}`,
      'Northing Range':  `${bbox.min.x.toFixed(2)} - ${bbox.max.x.toFixed(2)}`,
      'Elevation Range': `${bbox.min.z.toFixed(2)} - ${bbox.max.z.toFixed(2)}`,
    }
  };
}

// ── DEM orchestrator ────────────────────────────────

async function parseDEM(content, fileName, fileType) {
  let gridData;
  if (fileType === 'asc') {
    gridData = parseASCGrid(content);
  } else if (fileType === 'geotiff') {
    gridData = await parseGeoTIFFInWorker(content);
  } else {
    throw new Error(`Unknown DEM type: ${fileType}`);
  }

  const surfaceName = fileName.replace(/\.[^.]+$/, '');
  const surface = buildDEMSurface(gridData, surfaceName);

  const fileMeta = { ...gridData.meta };
  if (surface.downsampled) {
    fileMeta['Display Resolution'] = `Downsampled to fit viewer (original ${gridData.width} × ${gridData.height})`;
  }

  const crsAttrs = {};
  if (gridData.crs?.epsg) crsAttrs.CRS = `EPSG:${gridData.crs.epsg}`;

  return { surfaces: [surface], fileMeta, crsAttrs };
}

// ── Message handler ─────────────────────────────────

let geotiffLoaded = false;

self.onmessage = async (e) => {
  const { type, content, fileName } = e.data;

  try {
    let result;

    if (type === 'landxml') {
      result = parseLandXML(content, fileName);
    } else {
      // Load geotiff.js in the worker on first DEM use
      if (!geotiffLoaded && (type === 'geotiff')) {
        importScripts('https://cdn.jsdelivr.net/npm/geotiff');
        geotiffLoaded = true;
      }
      result = await parseDEM(content, fileName, type);
    }

    // Collect transferable buffers
    const transfers = result.surfaces.map(s => s.vertexBuffer.buffer);

    self.postMessage({ ok: true, ...result }, transfers);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};

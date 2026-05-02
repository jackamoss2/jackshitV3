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

// ── Alignment / pipe-network helpers ─────────────────────────────────────────

/** Parse a "N E [Z]" text node to [northing, easting, elevation?]. Returns null on failure. */
function parsePoint2D(text) {
  if (!text) return null;
  const p = text.trim().split(/\s+/).map(Number);
  if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return null;
  return p;
}

/** Tessellate a circular arc into 2D points [[N, E], ...]. */
function tessellateArc(startN, startE, endN, endE, centerN, centerE, rot, nSegs = 32) {
  const r = Math.hypot(startN - centerN, startE - centerE);
  let a0 = Math.atan2(startE - centerE, startN - centerN);
  let a1 = Math.atan2(endE - centerE, endN - centerN);
  if (rot !== 'cw') { if (a1 <= a0) a1 += 2 * Math.PI; }
  else              { if (a1 >= a0) a1 -= 2 * Math.PI; }
  const pts = [];
  for (let i = 0; i <= nSegs; i++) {
    const a = a0 + (a1 - a0) * (i / nSegs);
    pts.push([centerN + r * Math.cos(a), centerE + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Walk a CoordGeom element and return a 2D (or 3D if coords carry Z) polyline [[N,E,(Z)], ...].
 * Handles Line, Curve (arc tessellation), and Spiral (straight approximation).
 */
function tessellateCoordGeom(cgNode) {
  const pts = [];
  let prev = null;
  for (const child of cgNode.children) {
    const tag = child.localName;
    if (tag === 'Line') {
      const s = parsePoint2D(child.querySelector('Start')?.textContent);
      const e = parsePoint2D(child.querySelector('End')?.textContent);
      if (!s || !e) continue;
      if (!prev || Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 1e-6) pts.push(s);
      pts.push(e);
      prev = e;
    } else if (tag === 'Curve') {
      const s  = parsePoint2D(child.querySelector('Start')?.textContent);
      const e  = parsePoint2D(child.querySelector('End')?.textContent);
      const cn = parsePoint2D(child.querySelector('Center')?.textContent);
      if (!s || !e) continue;
      if (cn) {
        const rot    = child.getAttribute('rot') || 'ccw';
        const arcPts = tessellateArc(s[0], s[1], e[0], e[1], cn[0], cn[1], rot);
        const si     = (prev && Math.hypot(arcPts[0][0] - prev[0], arcPts[0][1] - prev[1]) < 1e-6) ? 1 : 0;
        for (let i = si; i < arcPts.length; i++) pts.push(arcPts[i]);
      } else {
        if (!prev || Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 1e-6) pts.push(s);
        pts.push(e);
      }
      prev = pts[pts.length - 1];
    } else if (tag === 'Spiral') {
      const s = parsePoint2D(child.querySelector('Start')?.textContent);
      const e = parsePoint2D(child.querySelector('End')?.textContent);
      if (s && e) {
        if (!prev || Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 1e-6) pts.push(s);
        pts.push(e);
        prev = e;
      }
    }
  }
  return pts;
}

/**
 * Build a (station → elevation) interpolation function from a ProfAlign element.
 * Supports both text-content PVI ("station elev") and attribute PVI (sta/station + elev).
 * Returns null if no valid PVIs found.
 */
function buildProfileFn(profAlignNode) {
  const pvis = [];
  profAlignNode.querySelectorAll('PVI').forEach(pvi => {
    let sta  = parseFloat(pvi.getAttribute('sta') || pvi.getAttribute('station') || '');
    let elev = parseFloat(pvi.getAttribute('elev') || '');
    if (isNaN(sta) || isNaN(elev)) {
      const parts = pvi.textContent.trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) [sta, elev] = parts;
    }
    if (!isNaN(sta) && !isNaN(elev)) pvis.push({ sta, elev });
  });
  if (pvis.length === 0) return null;
  pvis.sort((a, b) => a.sta - b.sta);
  return (station) => {
    if (station <= pvis[0].sta) return pvis[0].elev;
    if (station >= pvis[pvis.length - 1].sta) return pvis[pvis.length - 1].elev;
    for (let i = 0; i < pvis.length - 1; i++) {
      if (station >= pvis[i].sta && station <= pvis[i + 1].sta) {
        const t = (station - pvis[i].sta) / (pvis[i + 1].sta - pvis[i].sta);
        return pvis[i].elev + t * (pvis[i + 1].elev - pvis[i].elev);
      }
    }
    return pvis[pvis.length - 1].elev;
  };
}

/**
 * Convert a 3D polyline [[N,E,Z], ...] to a Float32Array of paired line-segment vertices
 * (centroid-relative), ready for THREE.LineSegments.
 */
function polylineToLineBuffer(pts, centroid) {
  const cx = centroid.x, cy = centroid.y, cz = centroid.z ?? 0;
  const verts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    verts.push(a[0] - cx, a[1] - cy, (a[2] ?? 0) - cz);
    verts.push(b[0] - cx, b[1] - cy, (b[2] ?? 0) - cz);
  }
  return new Float32Array(verts);
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
 * @returns {{ surfaces, fileMeta, crsAttrs, xmlDoc }}
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
  let _metricEl = null;
  if (units) {
    const metric = units.querySelector('Metric, Imperial');
    _metricEl = metric;
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

  // ── Unit-aware diameter → linear converter ─────────────────────────────────
  // Convert any LandXML unit name to meters, then ratio-convert diam→linear.
  const _UNIT_M = {
    meter: 1, metre: 1,
    millimeter: 0.001, millimetre: 0.001,
    kilometer: 1000, kilometre: 1000,
    foot: 0.3048, feet: 0.3048, internationalfoot: 0.3048,
    ussurveyfoot: 1200 / 3937, 'us survey foot': 1200 / 3937,
    inch: 0.0254, inches: 0.0254,
    yard: 0.9144, metre: 1,
  };
  const _toM = (u) => _UNIT_M[u.toLowerCase().replace(/[\s_-]/g, '')] ?? 1;
  const _linearUnit   = (_metricEl?.getAttribute('linearUnit')   || 'meter');
  const _diamUnitAttr = (_metricEl?.getAttribute('diameterUnit') || '');
  const _linearM = _toM(_linearUnit);
  const _diamM   = _diamUnitAttr ? _toM(_diamUnitAttr) : null;
  const diamToLinear = (d) => {
    if (!d || isNaN(d) || d <= 0) return 0;
    if (_diamM !== null) return d * _diamM / _linearM;   // exact conversion
    // heuristic: value suspiciously large? assume same "small" unit (inches in foot context, mm in meter)
    const threshold = _linearUnit.toLowerCase().includes('foot') ? 20 : 10;
    if (d > threshold) {
      const guessM = _linearUnit.toLowerCase().includes('foot') ? 0.0254 : 0.001;
      return d * guessM / _linearM;
    }
    return d;
  };

  // ── Parse Pipe Networks ──────────────────────────────────────────────────────
  xmlDoc.querySelectorAll('PipeNetwork').forEach((netNode, ni) => {
    const netName = netNode.getAttribute('name') || `PipeNetwork ${ni + 1}`;
    const netType = netNode.getAttribute('pipeNetType') || '';
    const tl      = netType ? ` (${netType})` : '';

    // Build structure lookup: name → { northing, easting, elevRim, elevSump, inverts, radiusOut }
    const structMap = new Map();
    netNode.querySelectorAll('Struct').forEach(s => {
      const sName    = s.getAttribute('name');
      const centerPt = parsePoint2D(s.querySelector('Center')?.textContent);
      if (!centerPt || !sName) return;
      const elevRim  = parseFloat(s.getAttribute('elevRim'));
      const elevSump = parseFloat(s.getAttribute('elevSump'));
      const inverts  = {};
      s.querySelectorAll('Invert').forEach(inv => {
        const ref  = inv.getAttribute('refPipe');
        const elev = parseFloat(inv.getAttribute('elev'));
        const dir  = inv.getAttribute('flowDir');
        if (ref && !isNaN(elev)) { inverts[ref] = inverts[ref] || {}; inverts[ref][dir] = elev; }
      });
      const circStruct = s.querySelector('CircStruct');
      const structDiam = circStruct ? parseFloat(circStruct.getAttribute('diameter')) : NaN;
      const radiusOut  = isNaN(structDiam) ? 0.5 : diamToLinear(structDiam) / 2;
      const desc       = (s.getAttribute('desc') || '').toLowerCase();
      const isNull     = desc.includes('null');
      structMap.set(sName, { northing: centerPt[0], easting: centerPt[1], elevRim, elevSump, inverts, radiusOut, isNull });
    });

    // ── Pipe segments ───────────────────────────────────────────────────────────
    const pipeSegs = [];
    netNode.querySelectorAll('Pipe').forEach(pipeNode => {
      const pipeName = pipeNode.getAttribute('name') || '';
      const sStruct  = structMap.get(pipeNode.getAttribute('refStart'));
      const eStruct  = structMap.get(pipeNode.getAttribute('refEnd'));
      if (!sStruct || !eStruct) return;

      const getZ = (st, pn, preferDir) => {
        const inv = st.inverts[pn];
        if (inv) {
          if (inv[preferDir] !== undefined) return inv[preferDir];
          const vals = Object.values(inv);
          if (vals.length) return vals[0];
        }
        return isNaN(st.elevSump) ? st.elevRim : st.elevSump;
      };
      const sz = getZ(sStruct, pipeName, 'out');
      const ez = getZ(eStruct, pipeName, 'in');
      if (isNaN(sz) || isNaN(ez)) return;

      const circPipe  = pipeNode.querySelector('CircPipe');
      const pipeDiam  = circPipe ? parseFloat(circPipe.getAttribute('diameter')) : NaN;
      const radiusOut = isNaN(pipeDiam) ? 0.15 : diamToLinear(pipeDiam) / 2;
      pipeSegs.push({
        start:     [sStruct.northing, sStruct.easting, sz],
        end:       [eStruct.northing, eStruct.easting, ez],
        radiusOut,
        name:      pipeName,
      });
    });

    // ── Structure segments ──────────────────────────────────────────────────────
    const structSegs = [];
    structMap.forEach((s, sName) => {
      if (s.isNull) return;   // Civil 3D null structures: needed for pipe routing, never rendered
      const zRim  = isNaN(s.elevRim)  ? NaN : s.elevRim;
      const zSump = isNaN(s.elevSump) ? (!isNaN(zRim) ? zRim - 2 : NaN) : s.elevSump;
      if (isNaN(zSump) || isNaN(zRim) || zRim <= zSump) return;
      structSegs.push({ northing: s.northing, easting: s.easting, zSump, zRim, radiusOut: s.radiusOut, name: sName });
    });

    // ── Emit one combined entry per network (pipes + structures together) ───────
    if (pipeSegs.length > 0 || structSegs.length > 0) {
      const allPts = [
        ...pipeSegs.flatMap(s => [s.start, s.end]),
        ...structSegs.flatMap(s => [[s.northing, s.easting, s.zSump], [s.northing, s.easting, s.zRim]]),
      ];
      const c = computeCentroid(allPts);
      const b = computeBBox(allPts);
      surfaces.push({
        name:           `${netName}${tl}`,
        type:           'PipeNetwork',
        pipeSegments:   pipeSegs.length   > 0 ? pipeSegs   : undefined,
        structSegments: structSegs.length > 0 ? structSegs : undefined,
        centroid:       c,
        rawBBox:        b,
        meta: {
          'Network':         netName,
          'Network Type':    netType || '—',
          'Pipe Count':      pipeSegs.length,
          'Structure Count': structSegs.length,
          'Easting Range':   `${b.min.y.toFixed(2)} – ${b.max.y.toFixed(2)}`,
          'Northing Range':  `${b.min.x.toFixed(2)} – ${b.max.x.toFixed(2)}`,
          'Elevation Range': `${b.min.z.toFixed(2)} – ${b.max.z.toFixed(2)}`,
        }
      });
    }
  });

  // ── Parse Alignments ─────────────────────────────────────────────────────────
  // Fallback elevation for 2D alignments: average of any surfaces already parsed.
  const surfaceElev = surfaces.filter(s => s.type === 'Surface' || s.type === 'DEM');
  const fallbackZ   = surfaceElev.length > 0
    ? surfaceElev.reduce((sum, s) => sum + s.centroid.z, 0) / surfaceElev.length : 0;

  xmlDoc.querySelectorAll('Alignment').forEach((alNode, ai) => {
    const alName   = alNode.getAttribute('name') || `Alignment ${ai + 1}`;
    const alDesc   = alNode.getAttribute('desc') || '';
    const staStart = parseFloat(alNode.getAttribute('staStart')) || 0;
    const alLength = alNode.getAttribute('length') || '';
    const cgNode   = alNode.querySelector('CoordGeom');
    if (!cgNode) return;

    const pts2D = tessellateCoordGeom(cgNode);
    if (pts2D.length < 2) return;

    const profAlignNode = alNode.querySelector('ProfAlign');
    const elevFn        = profAlignNode ? buildProfileFn(profAlignNode) : null;

    let pts3D;
    if (elevFn) {
      let cumDist = staStart;
      pts3D = pts2D.map((p, i) => {
        if (i > 0) cumDist += Math.hypot(p[0] - pts2D[i - 1][0], p[1] - pts2D[i - 1][1]);
        return [p[0], p[1], elevFn(cumDist)];
      });
    } else {
      pts3D = pts2D.map(p => [p[0], p[1], p[2] ?? fallbackZ]);
    }

    const alCentroid = computeCentroid(pts3D);
    const alBbox     = computeBBox(pts3D);
    const lineBuffer = polylineToLineBuffer(pts3D, alCentroid);
    if (lineBuffer.length < 6) return;

    surfaces.push({
      name:       alName,
      type:       'Alignment',
      lineBuffer,
      centroid:   alCentroid,
      rawBBox:    alBbox,
      meta: {
        ...(alDesc   ? { Description: alDesc }    : {}),
        ...(alLength ? { Length:      alLength }  : {}),
        'Has Profile': elevFn ? 'Yes' : 'No',
        'Point Count': pts3D.length,
        'Easting Range':  `${alBbox.min.y.toFixed(2)} – ${alBbox.max.y.toFixed(2)}`,
        'Northing Range': `${alBbox.min.x.toFixed(2)} – ${alBbox.max.x.toFixed(2)}`,
        ...(elevFn ? { 'Elevation Range': `${alBbox.min.z.toFixed(2)} – ${alBbox.max.z.toFixed(2)}` } : {}),
      }
    });
  });

  // ── Parse PlanFeatures (Civil 3D feature lines) ──────────────────────────────
  xmlDoc.querySelectorAll('PlanFeature').forEach((pfNode, fi) => {
    const pfName = pfNode.getAttribute('name') || `Feature ${fi + 1}`;
    const cgNode = pfNode.querySelector('CoordGeom');
    if (!cgNode) return;

    const pts3D = [];
    let prev = null;
    cgNode.querySelectorAll('Line').forEach(lineNode => {
      const s = parsePoint2D(lineNode.querySelector('Start')?.textContent);
      const e = parsePoint2D(lineNode.querySelector('End')?.textContent);
      if (!s || !e) return;
      if (!prev || Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 1e-6) pts3D.push(s);
      pts3D.push(e);
      prev = e;
    });
    if (pts3D.length < 2) return;

    const hasZ   = pts3D.some(p => p.length >= 3 && !isNaN(p[2]));
    const rawPts = pts3D.map(p => [p[0], p[1], hasZ ? (p[2] ?? fallbackZ) : fallbackZ]);
    const pfCentroid = computeCentroid(rawPts);
    const pfBbox     = computeBBox(rawPts);
    const lineBuffer = polylineToLineBuffer(rawPts, pfCentroid);
    if (lineBuffer.length < 6) return;

    surfaces.push({
      name:       pfName,
      type:       'FeatureLine',
      lineBuffer,
      centroid:   pfCentroid,
      rawBBox:    pfBbox,
      meta: {
        'Points': pts3D.length,
        ...(hasZ ? { 'Elevation Range': `${pfBbox.min.z.toFixed(2)} – ${pfBbox.max.z.toFixed(2)}` } : {}),
      }
    });
  });

  return { ok: true, surfaces, fileMeta, crsAttrs, xmlDoc };
}

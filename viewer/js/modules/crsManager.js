/**
 * CRS Manager
 * Manages the scene origin offset so large real-world coordinates
 * are relocated near (0,0,0) in Three.js to avoid float32 jitter.
 *
 * The first data loaded sets the scene origin. All subsequent data
 * is offset by the same amount so spatial relationships are preserved.
 *
 * LandXML coords are (northing, easting, elevation) — we map:
 *   LandXML Y → world X  (easting)
 *   LandXML Z → world Y  (elevation)
 *   LandXML X → world Z  (northing)
 *   (then the geometry rotateX / scale in XMLtoThree handles the flip)
 *
 * The origin stored here is in *raw LandXML* coordinate space
 * (before the Three.js axis conversion), so offset is applied
 * before the geometry transform.
 */

let origin = null;        // { x, y, z } in raw LandXML space (northing, easting, elev)
let crsName = null;       // string from <CoordinateSystem desc="...">
let crsInfo = {};         // full CRS attributes from XML
let onChangeCallbacks = [];

/** Register a listener for origin/CRS changes. */
export function onCRSChange(cb) {
    onChangeCallbacks.push(cb);
}

function notify() {
    const state = getState();
    onChangeCallbacks.forEach(cb => cb(state));
}

/**
 * Set the CRS info (call once per file load, first one wins for origin).
 * @param {object} info  - CRS attributes from xmlParser ({ CRS, Datum, ... })
 */
export function setCRS(info) {
    if (!crsName && info.CRS) {
        crsName = info.CRS;
    }
    if (Object.keys(crsInfo).length === 0) {
        crsInfo = { ...info };
    }
    notify();
}

/** Get the current CRS display name. */
export function getCRSName() {
    return crsName || 'Unknown CRS';
}

/** Get all CRS details. */
export function getCRSInfo() {
    return { ...crsInfo };
}

/**
 * Determine and set the scene origin from a set of raw LandXML points.
 * Only sets origin on the first call — subsequent calls are no-ops.
 * @param {number[][]} rawPoints - array of [x, y, z] in LandXML space
 */
export function initOriginFromPoints(rawPoints) {
    if (origin) return;  // already set
    if (!rawPoints || rawPoints.length === 0) return;

    // Use centroid of all points as origin
    let sx = 0, sy = 0, sz = 0;
    for (const [x, y, z] of rawPoints) {
        sx += x; sy += y; sz += z;
    }
    const n = rawPoints.length;
    origin = {
        x: sx / n,
        y: sy / n,
        z: sz / n
    };
    notify();
}

/** Returns whether origin has been established. */
export function hasOrigin() {
    return origin !== null;
}

/** Get the raw origin in LandXML coordinate space. */
export function getOrigin() {
    return origin ? { ...origin } : null;
}

/**
 * Apply origin offset to a raw LandXML coordinate.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number[]} [x - ox, y - oy, z - oz]
 */
export function applyOffset(x, y, z) {
    if (!origin) return [x, y, z];
    return [x - origin.x, y - origin.y, z - origin.z];
}

/**
 * Convert a scene-space coordinate back to real-world LandXML coords.
 * (Inverse of the offset — does NOT undo the Three.js axis transform.)
 * @param {number} sx - scene x (was raw x - origin.x)
 * @param {number} sy - scene y
 * @param {number} sz - scene z
 * @returns {{ x: number, y: number, z: number }} real-world coords
 */
export function toWorldCoords(sx, sy, sz) {
    if (!origin) return { x: sx, y: sy, z: sz };
    return {
        x: sx + origin.x,
        y: sy + origin.y,
        z: sz + origin.z
    };
}

/**
 * Compute a real-world bounding box from raw LandXML points.
 * @param {number[][]} rawPoints - array of [x, y, z]
 * @returns {{ min: {x,y,z}, max: {x,y,z}, centroid: {x,y,z} }}
 */
export function computeWorldBBox(rawPoints) {
    if (!rawPoints || rawPoints.length === 0) return null;

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
        centroid: {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            z: (minZ + maxZ) / 2,
        }
    };
}

/** Get full state snapshot for UI display. */
export function getState() {
    return {
        crsName: getCRSName(),
        crsInfo: getCRSInfo(),
        origin: getOrigin(),
        hasOrigin: hasOrigin()
    };
}

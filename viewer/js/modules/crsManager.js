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
let crsEntries = new Map(); // fileKey → { name, info }
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
 * Set/update the CRS info for a particular file.
 * @param {string} fileKey - unique key for the file (e.g. file name)
 * @param {object} info    - CRS attributes from xmlParser ({ CRS, Datum, ... })
 */
export function setCRS(fileKey, info) {
    crsEntries.set(fileKey, {
        name: info.CRS || null,
        info: { ...info }
    });
    notify();
}

/**
 * Remove the CRS entry for a file (call on file deletion).
 * @param {string} fileKey
 */
export function removeCRSForFile(fileKey) {
    crsEntries.delete(fileKey);
    notify();
}

/** Get the current CRS display name (derived from all loaded files). */
export function getCRSName() {
    if (crsEntries.size === 0) return null; // no files loaded

    const names = new Set();
    let hasMissing = false;
    for (const entry of crsEntries.values()) {
        if (entry.name) names.add(entry.name);
        else hasMissing = true;
    }

    if (names.size === 0) return 'No CRS';            // all files lack CRS
    if (names.size === 1 && !hasMissing) return [...names][0]; // all files share one CRS
    return 'Mixed CRS';                                // different CRS or some missing
}

/** Get all CRS details (merged from first entry that has info). */
export function getCRSInfo() {
    for (const entry of crsEntries.values()) {
        if (Object.keys(entry.info).length > 0) return { ...entry.info };
    }
    return {};
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

/**
 * Reset the scene origin (call when all files have been removed).
 * The next file load will re-establish a fresh origin.
 */
export function resetOrigin() {
    origin = null;
    notify();
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

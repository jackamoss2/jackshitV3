/**
 * Scene Data Store
 * Central registry of all objects in the scene, organised by source file.
 *
 * Structure:
 *   files = [
 *     {
 *       id:       'file-0',
 *       name:     'site.xml',
 *       groups: {
 *         Surface: [
 *           { id: 'obj-0', name: 'Existing Ground', mesh, metadata, visible }
 *         ],
 *         PipeNetwork: [ ... ],
 *         Points: [ ... ]
 *       }
 *     }
 *   ]
 */

let files = [];
let nextFileId = 0;
let nextObjId = 0;
let onChange = null;

/** Register a callback that fires whenever the store changes. */
export function onStoreChange(cb) {
    onChange = cb;
}

function notify() {
    if (onChange) onChange(files);
}

/**
 * Add a parsed file and its objects to the store.
 * @param {string} fileName
 * @param {{ mesh, type, name?, metadata? }[]} objects
 * @param {object} [fileMeta] - file-level metadata (CRS, project, etc.)
 * @returns {object} the file entry
 */
export function addFile(fileName, objects, fileMeta = {}) {
    const fileEntry = {
        id: `file-${nextFileId++}`,
        name: fileName,
        metadata: fileMeta,
        groups: {}
    };

    for (const obj of objects) {
        const type = obj.type || 'Other';
        if (!fileEntry.groups[type]) fileEntry.groups[type] = [];

        const entry = {
            id: `obj-${nextObjId++}`,
            name: obj.name || obj.mesh?.name || `${type} ${fileEntry.groups[type].length + 1}`,
            mesh: obj.mesh,
            metadata: obj.metadata || {},
            visible: true
        };

        fileEntry.groups[type].push(entry);
    }

    files.push(fileEntry);
    notify();
    return fileEntry;
}

/** Remove a file and all its objects from the store. */
export function removeFile(fileId) {
    files = files.filter(f => f.id !== fileId);
    notify();
}

/** Find a file entry by id. */
export function findFile(fileId) {
    return files.find(f => f.id === fileId) || null;
}

/** Find an object entry by id across all files. */
export function findObject(objId) {
    for (const file of files) {
        for (const group of Object.values(file.groups)) {
            const found = group.find(o => o.id === objId);
            if (found) return found;
        }
    }
    return null;
}

/** Toggle visibility of an object. Returns new visibility state. */
export function toggleVisibility(objId) {
    const obj = findObject(objId);
    if (!obj) return;
    obj.visible = !obj.visible;
    if (obj.mesh) obj.mesh.visible = obj.visible;
    notify();
    return obj.visible;
}

/** Get all file entries (read-only snapshot). */
export function getFiles() {
    return files;
}

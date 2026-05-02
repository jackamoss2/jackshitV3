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
const changeListeners = [];
let onDisplayModeChange = null;

/** Register a handler called when displayMode is set on an object. */
export function onSetDisplayMode(cb) { onDisplayModeChange = cb; }

/** Register a callback that fires whenever the store changes. Returns an unsubscribe fn. */
export function onStoreChange(cb) {
    changeListeners.push(cb);
    return () => { const i = changeListeners.indexOf(cb); if (i !== -1) changeListeners.splice(i, 1); };
}

function notify() {
    for (const cb of changeListeners) cb(files);
}

/**
 * Add a parsed file and its objects to the store.
 * @param {string} fileName
 * @param {{ mesh, type, name?, metadata? }[]} objects
 * @param {object} [fileMeta] - file-level metadata (CRS, project, etc.)
 * @param {Document|null} [xmlDoc] - original parsed XML DOM for round-trip save
 * @returns {object} the file entry
 */
export function addFile(fileName, objects, fileMeta = {}, xmlDoc = null) {
    const fileEntry = {
        id: `file-${nextFileId++}`,
        name: fileName,
        metadata: fileMeta,
        xmlDoc,
        groups: {}
    };

    for (const obj of objects) {
        const type = obj.type || 'Other';
        if (!fileEntry.groups[type]) fileEntry.groups[type] = [];

        let defaultColor = '#888888';
        if (obj.mesh) {
            let found = false;
            obj.mesh.traverse(child => {
                if (!found && child.isMesh && child.material?.color) {
                    defaultColor = '#' + child.material.color.getHexString();
                    found = true;
                }
            });
        }
        const entry = {
            id: `obj-${nextObjId++}`,
            name: obj.name || obj.mesh?.name || `${type} ${fileEntry.groups[type].length + 1}`,
            mesh: obj.mesh,
            metadata: obj.metadata || {},
            visible: true,
            style: { color: null, displayMode: 'solid', defaultColor }
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

/** Remove a single object from the store. If its group or file becomes empty, those are pruned too. */
export function removeObject(objId) {
    for (const file of files) {
        for (const [type, group] of Object.entries(file.groups)) {
            const idx = group.findIndex(o => o.id === objId);
            if (idx === -1) continue;
            group.splice(idx, 1);
            if (group.length === 0) delete file.groups[type];
            if (Object.keys(file.groups).length === 0) files = files.filter(f => f.id !== file.id);
            notify();
            return;
        }
    }
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

/** Set visibility of all objects in a named group within a file. */
export function setGroupVisibility(fileId, type, visible) {
    const file = files.find(f => f.id === fileId);
    if (!file || !file.groups[type]) return;
    for (const obj of file.groups[type]) {
        obj.visible = visible;
        if (obj.mesh) obj.mesh.visible = visible;
    }
    notify();
}

/** Get all file entries (read-only snapshot). */
export function getFiles() {
    return files;
}

/** Rename a file entry. */
export function renameFile(fileId, newName) {
    const file = files.find(f => f.id === fileId);
    if (!file || !newName.trim()) return;
    file.name = newName.trim();
    notify();
}

/** Rename an object entry. */
export function renameObject(objId, newName) {
    const obj = findObject(objId);
    if (!obj || !newName.trim()) return;
    obj.name = newName.trim();
    notify();
}

/** Get the style object for an object entry. */
export function getStyle(objId) {
    const obj = findObject(objId);
    return obj ? obj.style : null;
}

/**
 * Patch the style of an object and update its mesh material color if provided.
 * @param {string} objId
 * @param {{ color?: string, displayMode?: string }} patch
 */
export function setStyle(objId, patch) {
    const obj = findObject(objId);
    if (!obj) return;
    Object.assign(obj.style, patch);
    if (patch.color !== undefined && obj.mesh) {
        obj.mesh.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.color?.set(patch.color);
            }
        });
    }
    if (patch.displayMode !== undefined && obj.mesh && obj.mesh.isMesh) {
        if (onDisplayModeChange) onDisplayModeChange(obj.mesh, patch.displayMode);
        // Re-apply color if set
        if (obj.style.color) obj.mesh.material.color?.set(obj.style.color);
    }
}

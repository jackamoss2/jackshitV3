/**
 * Data Tree
 * Renders the scene data store as an interactive file tree inside #data-tree.
 * Supports collapsible groups, visibility toggles, and metadata selection.
 */

import { getFiles, toggleVisibility, setGroupVisibility, findFile, removeFile, removeObject, onStoreChange } from './sceneData.js';
import { shouldConfirmDelete } from './settingsManager.js';

// Inline SVG icons (14×14, currentColor)
const svgEye = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const svgEyeOff = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const svgTarget = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>`;
const svgTrash = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

const svgFile = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

let selectedId = null;   // can be an obj id or file id
let onSelect = null;
let onJumpTo = null;
let onDelete = null;
let onDeleteObj = null;
const collapsedNodes = new Set(); // persists collapsed state across re-renders

/** Set callback when user clicks an object row. Receives the object entry. */
export function onObjectSelect(cb) {
    onSelect = cb;
}

/** Set callback for "Jump to" button. Receives the object entry. */
export function onObjectJumpTo(cb) {
    onJumpTo = cb;
}

/** Set callback for file deletion. Receives fileId. Called after user confirms. */
export function onFileDelete(cb) {
    onDelete = cb;
}

/** Set callback for single-object deletion. Receives { objId, fileId }. Called after user confirms. */
export function onObjectDelete(cb) {
    onDeleteObj = cb;
}

/** Initialise the data tree — call once after DOM ready. */
export function initDataTree() {
    onStoreChange(() => render());
    render();
}

function render() {
    const container = document.getElementById('data-tree');
    if (!container) return;

    const files = getFiles();

    if (files.length === 0) {
        container.innerHTML = '<p class="tree-empty">No data loaded.</p>';
        updateMetadataPanel(null);
        return;
    }

    let html = '';
    for (const file of files) {
        // Detect flat-DEM files: single group "DEM" with exactly one object
        const groupKeys = Object.keys(file.groups);
        const isDEM = groupKeys.length === 1 && groupKeys[0] === 'DEM' && file.groups.DEM.length === 1;

        if (isDEM) {
            const obj = file.groups.DEM[0];
            const sel = (obj.id === selectedId || file.id === selectedId) ? ' selected' : '';
            const visIcon = obj.visible ? svgEye : svgEyeOff;
            html += `<div class="tree-node tree-file tree-flat-dem">`;
            html += `  <div class="tree-row tree-row-dem${sel}" data-file-id="${file.id}" data-obj-id="${obj.id}">`;
            html += `    <span class="tree-label">${esc(file.name)}</span>`;
            html += `    <span class="tree-row-actions">`;
            html += `      <button class="tree-jumpto" data-obj-id="${obj.id}" title="Jump to object">${svgTarget}</button>`;
            html += `      <span class="tree-visibility" data-obj-id="${obj.id}" title="Toggle visibility">${visIcon}</span>`;
            html += `      <button class="tree-delete" data-file-id="${file.id}" title="Delete file">${svgTrash}</button>`;
            html += `    </span>`;
            html += `  </div>`;
            html += `</div>`;
        } else {
            const fileSel = file.id === selectedId ? ' selected' : '';
            const fileCollapsed = collapsedNodes.has(file.id) ? ' collapsed' : '';
            html += `<div class="tree-node tree-file${fileCollapsed}" data-node-id="${file.id}">`;
            html += `  <div class="tree-row tree-row-file${fileSel}" data-file-id="${file.id}">`;
            html += `    <span class="tree-toggle">▼</span>`;
            html += `    <span class="tree-label">${esc(file.name)}</span>`;
            html += `    <span class="tree-row-actions">`;
            html += `      <button class="tree-delete" data-file-id="${file.id}" title="Delete file">${svgTrash}</button>`;
            html += `    </span>`;
            html += `  </div>`;
            html += `  <div class="tree-children">`;

            const GROUP_LABELS = {
                Surface: 'Surfaces', DEM: 'DEMs', PipeNetwork: 'Pipe Networks',
                Alignment: 'Alignments', FeatureLine: 'Feature Lines',
            };
            const groupEntries = Object.entries(file.groups).filter(([, objs]) => objs.length > 0);
            const multiGroup = groupEntries.length > 1;

            for (const [type, objects] of groupEntries) {
                const groupLabel = GROUP_LABELS[type] || type;
                if (multiGroup) {
                    const allVis = objects.every(o => o.visible);
                    const groupNodeId = `${file.id}::${type}`;
                    const groupCollapsed = collapsedNodes.has(groupNodeId) ? ' collapsed' : '';
                    html += `    <div class="tree-node tree-group${groupCollapsed}" data-node-id="${groupNodeId}">`;
                    html += `      <div class="tree-row tree-row-group" data-file-id="${file.id}" data-group-type="${type}">`;
                    html += `        <span class="tree-toggle">▼</span>`;
                    html += `        <span class="tree-label">${esc(groupLabel)}</span>`;
                    html += `        <span class="tree-group-count">${objects.length}</span>`;
                    html += `        <span class="tree-row-actions">`;
                    html += `          <span class="tree-visibility tree-group-vis" data-file-id="${file.id}" data-group-type="${type}" title="Toggle group visibility">${allVis ? svgEye : svgEyeOff}</span>`;
                    html += `        </span>`;
                    html += `      </div>`;
                    html += `      <div class="tree-children">`;
                }
                for (const obj of objects) {
                    const sel = obj.id === selectedId ? ' selected' : '';
                    const visIcon = obj.visible ? svgEye : svgEyeOff;
                    html += `        <div class="tree-row tree-row-obj${sel}" data-obj-id="${obj.id}">`;
                    html += `          <span class="tree-label">${esc(obj.name)}</span>`;
                    html += `          <span class="tree-row-actions">`;
                    html += `            <button class="tree-jumpto" data-obj-id="${obj.id}" title="Jump to object">${svgTarget}</button>`;
                    html += `            <span class="tree-visibility" data-obj-id="${obj.id}" title="Toggle visibility">${visIcon}</span>`;
                    html += `            <button class="tree-delete-obj" data-obj-id="${obj.id}" data-file-id="${file.id}" title="Delete object">${svgTrash}</button>`;
                    html += `          </span>`;
                    html += `        </div>`;
                }
                if (multiGroup) {
                    html += `      </div>`;
                    html += `    </div>`;
                }
            }

            html += `  </div>`;
            html += `</div>`;
        }
    }

    container.innerHTML = html;
    attachEvents(container);
}

function attachEvents(container) {
    // Collapse / expand toggles
    container.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const node = toggle.closest('.tree-node');
            if (!node) return;
            node.classList.toggle('collapsed');
            const nodeId = node.dataset.nodeId;
            if (nodeId) {
                if (node.classList.contains('collapsed')) collapsedNodes.add(nodeId);
                else collapsedNodes.delete(nodeId);
            }
        });
    });

    // Per-object visibility toggles
    container.querySelectorAll('.tree-visibility:not(.tree-group-vis)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleVisibility(btn.dataset.objId);
        });
    });

    // Group visibility toggles — set all objects in the group
    container.querySelectorAll('.tree-group-vis').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const file = findFile(btn.dataset.fileId);
            if (!file) return;
            const objs = file.groups[btn.dataset.groupType] || [];
            const allVis = objs.every(o => o.visible);
            setGroupVisibility(btn.dataset.fileId, btn.dataset.groupType, !allVis);
        });
    });

    // Group row header click — collapse/expand group
    container.querySelectorAll('.tree-row-group').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.tree-row-actions')) return;
            const node = row.closest('.tree-node');
            if (!node) return;
            node.classList.toggle('collapsed');
            const nodeId = node.dataset.nodeId;
            if (nodeId) {
                if (node.classList.contains('collapsed')) collapsedNodes.add(nodeId);
                else collapsedNodes.delete(nodeId);
            }
        });
    });

    // File row selection — show file metadata
    container.querySelectorAll('.tree-row-file').forEach(row => {
        row.addEventListener('click', () => {
            selectedId = row.dataset.fileId;
            clearSelection(container);
            row.classList.add('selected');
            const file = findFile(row.dataset.fileId);
            if (file) updateMetadataPanel({ name: file.name, metadata: file.metadata });
        });
    });

    // Flat DEM row selection — show merged file + object metadata
    container.querySelectorAll('.tree-row-dem').forEach(row => {
        row.addEventListener('click', () => {
            selectedId = row.dataset.objId;
            clearSelection(container);
            row.classList.add('selected');
            const file = findFile(row.dataset.fileId);
            if (file && file.groups.DEM && file.groups.DEM[0]) {
                const obj = file.groups.DEM[0];
                const merged = { ...file.metadata, ...obj.metadata };
                updateMetadataPanel({ name: file.name, metadata: merged });
                if (onSelect) onSelect(obj);
            }
        });
    });

    // Object row selection — show object metadata
    container.querySelectorAll('.tree-row-obj').forEach(row => {
        row.addEventListener('click', () => {
            selectedId = row.dataset.objId;
            clearSelection(container);
            row.classList.add('selected');

            const files = getFiles();
            for (const file of files) {
                for (const group of Object.values(file.groups)) {
                    const obj = group.find(o => o.id === selectedId);
                    if (obj) {
                        updateMetadataPanel(obj);
                        if (onSelect) onSelect(obj);
                        return;
                    }
                }
            }
        });
    });

    // Delete individual object buttons
    container.querySelectorAll('.tree-delete-obj').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const { objId, fileId } = btn.dataset;
            const file = findFile(fileId);
            if (!file) return;
            let objName = objId;
            for (const group of Object.values(file.groups)) {
                const obj = group.find(o => o.id === objId);
                if (obj) { objName = obj.name; break; }
            }
            const doDelete = () => {
                if (onDeleteObj) onDeleteObj({ objId, fileId });
                removeObject(objId);
            };
            if (shouldConfirmDelete()) {
                showDeleteConfirm(objName, doDelete);
            } else {
                doDelete();
            }
        });
    });

    // Delete file buttons
    container.querySelectorAll('.tree-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fileId = btn.dataset.fileId;
            const file = findFile(fileId);
            if (!file) return;
            const doDelete = () => {
                if (onDelete) onDelete(fileId);
                removeFile(fileId);
            };
            if (shouldConfirmDelete()) {
                showDeleteConfirm(file.name, doDelete);
            } else {
                doDelete();
            }
        });
    });

    // Jump-to buttons
    container.querySelectorAll('.tree-jumpto').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const objId = btn.dataset.objId;
            const files = getFiles();
            for (const file of files) {
                for (const group of Object.values(file.groups)) {
                    const obj = group.find(o => o.id === objId);
                    if (obj && onJumpTo) {
                        onJumpTo(obj);
                        return;
                    }
                }
            }
        });
    });
}

function clearSelection(container) {
    container.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
}

function updateMetadataPanel(item) {
    const panel = document.getElementById('data-metadata');
    if (!panel) return;

    if (!item || !item.metadata || Object.keys(item.metadata).length === 0) {
        panel.innerHTML = '';
        return;
    }

    let html = `<div class="meta-title">${esc(item.name)}</div>`;
    html += '<table class="meta-table">';
    for (const [key, value] of Object.entries(item.metadata)) {
        if (value === '' || value === null || value === undefined) continue;
        html += `<tr><td class="meta-key">${esc(key)}</td><td class="meta-val">${esc(String(value))}</td></tr>`;
    }
    html += '</table>';
    panel.innerHTML = html;
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

/** Show a styled confirmation popup before deleting a file. */
function showDeleteConfirm(fileName, onConfirm) {
    // Remove any existing popup
    const existing = document.getElementById('delete-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'delete-confirm-overlay';
    overlay.className = 'delete-confirm-overlay';
    overlay.innerHTML = `
        <div class="delete-confirm-box">
            <p class="delete-confirm-msg">Delete <strong>${esc(fileName)}</strong>?</p>
            <div class="delete-confirm-actions">
                <button class="delete-confirm-btn delete-btn-cancel">Cancel</button>
                <button class="delete-confirm-btn delete-btn-ok">Delete</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.delete-btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.delete-btn-ok').addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

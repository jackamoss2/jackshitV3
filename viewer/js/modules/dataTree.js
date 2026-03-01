/**
 * Data Tree
 * Renders the scene data store as an interactive file tree inside #data-tree.
 * Supports collapsible groups, visibility toggles, and metadata selection.
 */

import { getFiles, toggleVisibility, findFile, removeFile, onStoreChange } from './sceneData.js';
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
        const fileSel = file.id === selectedId ? ' selected' : '';
        html += `<div class="tree-node tree-file">`;
        html += `  <div class="tree-row tree-row-file${fileSel}" data-file-id="${file.id}">`;
        html += `    <span class="tree-toggle">▼</span>`;
        html += `    <span class="tree-label">${esc(file.name)}</span>`;
        html += `    <span class="tree-row-actions">`;
        html += `      <button class="tree-delete" data-file-id="${file.id}" title="Delete file">${svgTrash}</button>`;
        html += `    </span>`;
        html += `  </div>`;
        html += `  <div class="tree-children">`;

        for (const objects of Object.values(file.groups)) {
            for (const obj of objects) {
                const sel = obj.id === selectedId ? ' selected' : '';
                const visIcon = obj.visible ? svgEye : svgEyeOff;
                html += `    <div class="tree-row tree-row-obj${sel}" data-obj-id="${obj.id}">`;
                html += `      <span class="tree-label">${esc(obj.name)}</span>`;
                html += `      <span class="tree-row-actions">`;
                html += `        <button class="tree-jumpto" data-obj-id="${obj.id}" title="Jump to object">${svgTarget}</button>`;
                html += `        <span class="tree-visibility" data-obj-id="${obj.id}" title="Toggle visibility">${visIcon}</span>`;
                html += `      </span>`;
                html += `    </div>`;
            }
        }

        html += `  </div>`;
        html += `</div>`;
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
            if (node) node.classList.toggle('collapsed');
        });
    });

    // Visibility toggles
    container.querySelectorAll('.tree-visibility').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleVisibility(btn.dataset.objId);
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

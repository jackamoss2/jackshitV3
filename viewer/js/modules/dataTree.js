/**
 * Data Tree
 * Renders the scene data store as an interactive file tree inside #data-tree.
 * Supports collapsible groups, visibility toggles, and metadata selection.
 */

import { getFiles, toggleVisibility, findFile, onStoreChange } from './sceneData.js';

let selectedId = null;   // can be an obj id or file id
let onSelect = null;
let onJumpTo = null;

/** Set callback when user clicks an object row. Receives the object entry. */
export function onObjectSelect(cb) {
    onSelect = cb;
}

/** Set callback for "Jump to" button. Receives the object entry. */
export function onObjectJumpTo(cb) {
    onJumpTo = cb;
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
        html += `    <span class="tree-icon">📄</span>`;
        html += `    <span class="tree-label">${esc(file.name)}</span>`;
        html += `  </div>`;
        html += `  <div class="tree-children">`;

        for (const [type, objects] of Object.entries(file.groups)) {
            html += `  <div class="tree-node tree-group">`;
            html += `    <div class="tree-row tree-row-group">`;
            html += `      <span class="tree-toggle">▼</span>`;
            html += `      <span class="tree-label">${esc(type)}s (${objects.length})</span>`;
            html += `    </div>`;
            html += `    <div class="tree-children">`;

            for (const obj of objects) {
                const sel = obj.id === selectedId ? ' selected' : '';
                const vis = obj.visible ? '👁' : '👁‍🗨';
                html += `    <div class="tree-row tree-row-obj${sel}" data-obj-id="${obj.id}">`;
                html += `      <span class="tree-visibility" data-obj-id="${obj.id}" title="Toggle visibility">${vis}</span>`;
                html += `      <span class="tree-label">${esc(obj.name)}</span>`;
                html += `      <button class="tree-jumpto" data-obj-id="${obj.id}" title="Jump to object">⎆</button>`;
                html += `    </div>`;
            }

            html += `    </div>`;
            html += `  </div>`;
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

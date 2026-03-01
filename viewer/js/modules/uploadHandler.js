/**
 * Upload Handler
 * Manages drag-and-drop on the data panel and a header upload button.
 * Dispatches a custom 'file-uploaded' event on #data-panel-body with the file contents.
 */

import { getFileSizeCap } from './settingsManager.js';

export function initUpload() {
    const panel = document.getElementById('data-panel-body');
    const input = document.getElementById('upload-input');
    const btn   = document.getElementById('data-upload-btn');
    if (!panel || !input) return;

    // Header button opens file picker
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();   // don't toggle the collapsible
            input.click();
        });
    }

    // File(s) selected via picker
    input.addEventListener('change', () => {
        for (const file of input.files) {
            handleFile(file, panel);
        }
        input.value = '';
    });

    // Drag-and-drop on the data panel body
    panel.addEventListener('dragover', (e) => {
        e.preventDefault();
        panel.classList.add('drag-over');
    });

    panel.addEventListener('dragleave', (e) => {
        // Only remove if we actually left the panel (not entering a child)
        if (!panel.contains(e.relatedTarget)) {
            panel.classList.remove('drag-over');
        }
    });

    panel.addEventListener('drop', (e) => {
        e.preventDefault();
        panel.classList.remove('drag-over');
        for (const file of e.dataTransfer.files) {
            handleFile(file, panel);
        }
    });
}

const SUPPORTED_EXTENSIONS = {
    '.xml':  { type: 'landxml',  readAs: 'text' },
    '.tif':  { type: 'geotiff',  readAs: 'arraybuffer' },
    '.tiff': { type: 'geotiff',  readAs: 'arraybuffer' },
    '.asc':  { type: 'asc',      readAs: 'text' },
};

function handleFile(file, target) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const config = SUPPORTED_EXTENSIONS[ext];

    if (!config) {
        alert(`Unsupported file type: ${ext}\nSupported: .xml, .tif, .tiff, .asc`);
        return;
    }

    const maxSize = getFileSizeCap();
    const warnSize = maxSize / 2;

    if (file.size > maxSize) {
        alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB).\nMaximum file size is ${(maxSize / 1024 / 1024).toFixed(0)} MB (change in Settings).`);
        return;
    }

    if (file.size > warnSize) {
        if (!confirm(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB \u2014 large files may affect performance.\nContinue?`)) {
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = () => {
        target.dispatchEvent(new CustomEvent('file-uploaded', {
            bubbles: true,
            detail: { name: file.name, content: reader.result, fileType: config.type }
        }));
    };

    if (config.readAs === 'arraybuffer') {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

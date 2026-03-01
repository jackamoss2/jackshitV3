/**
 * Upload Handler
 * Manages drag-and-drop on the data panel and a header upload button.
 * Dispatches a custom 'file-uploaded' event on #data-panel-body with the file contents.
 */

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

function handleFile(file, target) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
        alert('Only .xml files are supported.');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        target.dispatchEvent(new CustomEvent('file-uploaded', {
            bubbles: true,
            detail: { name: file.name, content: reader.result }
        }));
    };
    reader.readAsText(file);
}

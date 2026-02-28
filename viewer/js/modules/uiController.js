/**
 * UI Controller
 * Handles toggling panels, status bar updates, and general UI state.
 */

const panels = {};

/** Initialise panel toggle buttons, close buttons, and collapsible sections. */
export function initUI() {
    // Toolbar buttons toggle panels
    document.querySelectorAll('.toolbar-btn[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => togglePanel(btn.dataset.panel));
    });

    // Panel close buttons
    document.querySelectorAll('.panel-close[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => hidePanel(btn.dataset.panel));
    });

    // Collapsible sub-panel headers
    document.querySelectorAll('.collapsible-header').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.parentElement.classList.toggle('open');
        });
    });
}

/** Toggle a panel's visibility by its element id. */
export function togglePanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
}

/** Show a panel. */
export function showPanel(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

/** Hide a panel. */
export function hidePanel(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

/** Update the status bar text. */
export function setStatus(text) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = text;
}

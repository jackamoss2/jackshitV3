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

    initPanelResize();
}

/** Wire up drag-to-resize handles on .ui-panel elements, saving width to localStorage. */
function initPanelResize() {
    document.querySelectorAll('.ui-panel').forEach(panel => {
        const handle = panel.querySelector('.panel-resize-handle');
        if (!handle) return;

        const storageKey = `panel-width-${panel.id}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) panel.style.width = saved + 'px';

        const isLeft = panel.classList.contains('panel-left');

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;
            // Compensate for CSS zoom on #ui-overlay
            const bcr = panel.getBoundingClientRect();
            const scale = startW > 0 ? bcr.width / startW : 1;

            handle.classList.add('resizing');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';

            const onMove = (ev) => {
                const dx = isLeft ? (ev.clientX - startX) : (startX - ev.clientX);
                const newW = Math.min(600, Math.max(180, startW + dx / scale));
                panel.style.width = newW + 'px';
            };

            const onUp = () => {
                handle.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem(storageKey, parseInt(panel.style.width));
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
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

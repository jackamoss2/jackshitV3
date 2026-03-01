/**
 * Site Theme — syncs with the viewer's localStorage setting.
 * Reads/writes `jackshit-viewer-settings.darkMode`.
 * Toggle button switches between ☾ (dark) and ☀ (light).
 */
(function () {
  const SETTINGS_KEY = 'jackshit-viewer-settings';
  const btn = document.getElementById('theme-toggle');

  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }

  function isDark() {
    const s = getSettings();
    return s.darkMode !== false; // default dark
  }

  function apply(dark) {
    document.body.classList.toggle('light-mode', !dark);
    if (btn) btn.textContent = dark ? '☾' : '☀';
  }

  function toggle() {
    const dark = !isDark();
    const s = getSettings();
    s.darkMode = dark;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    apply(dark);
  }

  // Apply on load
  apply(isDark());

  // Wire button
  if (btn) btn.addEventListener('click', toggle);

  // ── Hamburger nav toggle ──────────────────────────
  const hamburger = document.getElementById('nav-hamburger');
  const navLinks = document.getElementById('nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove('open');
      }
    });
  }
})();

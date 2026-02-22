export function preventSpaceOnFocusedButtons() {
  function handler(e) {
    if (e.code !== 'Space') return;

    const active = document.activeElement;
    if (!active) return;

    const isButton =
      active.tagName === 'BUTTON' ||
      (active.tagName === 'INPUT' &&
        ['button', 'submit', 'reset'].includes(active.type)) ||
      active.getAttribute('role') === 'button';

    if (isButton) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  document.addEventListener('keydown', handler);

  return () => document.removeEventListener('keydown', handler);
};
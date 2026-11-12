// Applies the stored theme before the first paint (no flash of the wrong theme). It is an external
// file because the CSP (`script-src 'self'`) forbids inline scripts. Keep it tiny and dependency-free:
// the key and the values must match `src/lib/theme.ts`.
(function () {
  try {
    var preference = localStorage.getItem('cdag-theme');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    }
  } catch (error) {
    // Storage blocked: follow the system preference.
  }
})();

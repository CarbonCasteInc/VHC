// Expose E2E flag so the app can stub all network access during tests.
window.__VH_E2E_OVERRIDE__ = '%VITE_E2E_MODE%' === 'true';

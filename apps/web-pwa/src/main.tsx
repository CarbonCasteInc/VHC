import './e2e-init';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routes';
import './index.css';
import { ThemeProvider } from './components/ThemeProvider';
import { startHealthMonitor } from './hooks/useHealthMonitor';

const DevModelPicker = import.meta.env.DEV
  ? lazy(() => import('./components/dev/DevModelPicker'))
  : null;

const HealthIndicator = import.meta.env.DEV || import.meta.env.VITE_VH_SHOW_HEALTH === 'true'
  ? lazy(() => import('./components/dev/HealthIndicator'))
  : null;

if (typeof window !== 'undefined' && window.location.search) {
  (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__ =
    window.location.search;
}

console.info('[vh:web-pwa] main.tsx executing, mounting router...');
if (typeof window !== 'undefined') {
  startHealthMonitor();
}

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <RouterProvider router={router} />
        {DevModelPicker && (
          <Suspense fallback={null}>
            <DevModelPicker />
          </Suspense>
        )}
        {HealthIndicator && (
          <Suspense fallback={null}>
            <HealthIndicator />
          </Suspense>
        )}
      </ThemeProvider>
    </React.StrictMode>
  );
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | undefined)?.type !== 'VH_CLIENT_OUT_OF_DATE') {
      return;
    }
    window.dispatchEvent(new CustomEvent('vh:client-out-of-date', { detail: event.data }));
  });
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => console.log('[vh:web-pwa] SW registered:', reg))
    .catch((err) => console.warn('[vh:web-pwa] service worker registration failed', err));
}

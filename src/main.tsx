import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');

    // When the network comes back, ask for a Background Sync. Most modern
    // Chromium-based browsers support this natively; for engines that don't
    // (Safari/iOS), we fall back to a direct postMessage which the worker
    // handles identically (see service-worker.js message listener).
    const requestSync = async () => {
      if ('sync' in reg) {
        try {
          // @ts-expect-error - SyncManager not in default TS lib yet
          await reg.sync.register('sync-loop-data');
          return;
        } catch {
          /* fall through to postMessage fallback */
        }
      }
      reg.active?.postMessage({ type: 'REQUEST_SYNC' });
    };

    window.addEventListener('online', requestSync);
    // Also attempt once on boot in case we came online while the tab was closed.
    if (navigator.onLine) requestSync();
  } catch (err) {
    console.error('Service worker registration failed:', err);
  }
}

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

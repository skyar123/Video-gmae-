import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell, so the home-screen app opens without a signal and launches
// instantly with one. Only in a built app: a service worker in front of the
// dev server would serve yesterday's modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A refused registration (private browsing, storage off) costs nothing
      // but the offline shell; everything else works exactly the same.
    });
  });
}

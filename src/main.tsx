import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PwaUpdater } from './pwaUpdateCoordinator';
import { PwaUpdates } from './PwaUpdates';
import { initZoomLock } from './disableZoom';
import '../app/globals.css';
import '../app/forms.css';
import '../app/interactions.css';
import '../app/movements.css';
import './styles.css';
import './ui.css';
import './summary.css';

initZoomLock();

declare const __BUILD_HASH__: string;
const updater = new PwaUpdater({
  window, document, serviceWorker: import.meta.env.PROD ? navigator.serviceWorker : undefined,
  fetch: window.fetch.bind(window), base: import.meta.env.BASE_URL,
  version: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev',
  reload: () => window.location.reload(),
});
createRoot(document.getElementById('root')!).render(
  <StrictMode><PwaUpdates updater={updater}><App /></PwaUpdates></StrictMode>,
);

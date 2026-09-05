import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initZoomLock } from './disableZoom';
import '../app/globals.css';
import '../app/forms.css';
import '../app/interactions.css';
import '../app/movements.css';
import './styles.css';

initZoomLock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

declare const __BUILD_HASH__: string;

if (import.meta.env.PROD) {
  let refreshing = false;
  let hadControllerOnLoad = Boolean(navigator.serviceWorker?.controller);
  let activeRegistration: ServiceWorkerRegistration | null = null;
  const currentBuild = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';

  const reloadApp = () => {
    if (refreshing) return;

    // Si hay un modal abierto o el usuario está escribiendo, diferimos la recarga para no perder datos
    const isModalOpen = Boolean(document.querySelector('.modal-backdrop'));
    const activeEl = document.activeElement;
    const isTyping = Boolean(activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT'));

    if (isModalOpen || isTyping) {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.modal-backdrop')) {
          observer.disconnect();
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return;
    }

    refreshing = true;
    window.location.reload();
  };

  const handleUpdate = () => {
    if (!hadControllerOnLoad) {
      hadControllerOnLoad = true;
      return;
    }
    reloadApp();
  };

  // Sondeo directo e infalible a version.json en GitHub Pages (evita bugs de Safari / WebKit)
  const checkRemoteVersion = async () => {
    if (currentBuild === 'dev' || refreshing) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      if (data.version && data.version !== currentBuild && data.version !== 'dev') {
        activeRegistration?.update().catch(() => undefined);
        reloadApp();
      }
    } catch {
      // Modo offline silencioso
    }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', handleUpdate);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_ACTIVATED') {
        handleUpdate();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
          updateViaCache: 'none',
        })
        .then((registration) => {
          activeRegistration = registration;
          registration.update().catch(() => undefined);

          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });
        })
        .catch(() => undefined);
    });
  }

  // 1. Chequeo automático en segundo plano cada 15 segundos
  setInterval(() => {
    activeRegistration?.update().catch(() => undefined);
    void checkRemoteVersion();
  }, 15000);

  // 2. Chequeo al volver a la pestaña o desbloquear el celular
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      activeRegistration?.update().catch(() => undefined);
      void checkRemoteVersion();
    }
  });

  // 3. Chequeo al ganar foco en la ventana
  window.addEventListener('focus', () => {
    activeRegistration?.update().catch(() => undefined);
    void checkRemoteVersion();
  });

  // 4. Chequeo al recuperar la conexión a internet
  window.addEventListener('online', () => {
    activeRegistration?.update().catch(() => undefined);
    void checkRemoteVersion();
  });
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../app/globals.css';
import '../app/forms.css';
import '../app/interactions.css';
import '../app/movements.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false;
  let hadControllerOnLoad = Boolean(navigator.serviceWorker.controller);

  const reloadApp = () => {
    if (refreshing) return;

    // Si hay un modal abierto o el usuario está escribiendo, esperamos a que termine
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
      // Primera instalación del Service Worker; la página ya vino fresca del servidor
      hadControllerOnLoad = true;
      return;
    }
    reloadApp();
  };

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
        // Chequeo inicial
        registration.update().catch(() => undefined);

        // Si ya había una versión esperando en segundo plano, forzar activación
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Si detecta una versión nueva descargándose, indicarle que active
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

        // 1. Chequeo automático cada 30 segundos (detecta de fondo en compu y celu)
        setInterval(() => {
          registration.update().catch(() => undefined);
        }, 30000);

        // 2. Chequeo al volver a la pestaña o desbloquear el celular
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => undefined);
          }
        });

        // 3. Chequeo al hacer clic o ganar foco en la ventana
        window.addEventListener('focus', () => {
          registration.update().catch(() => undefined);
        });

        // 4. Chequeo al recuperar la conexión a internet
        window.addEventListener('online', () => {
          registration.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  });
}

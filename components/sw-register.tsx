'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let refreshing = false;
    const reloadOnUpdate = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnUpdate);
    navigator.serviceWorker.register('/sw.js').then((registration) => registration.update()).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', reloadOnUpdate);
  }, []);
  return null;
}

import { useState, useEffect } from 'react';

// Interfaz para el evento nativo de instalación de PWA en Chromium/Android
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosModal, setShowIosModal] = useState(false);
  const [showDesktopModal, setShowDesktopModal] = useState(false);

  const isIos = typeof window !== 'undefined' &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    // 1. Detectar si ya está corriendo instalada como PWA (modo standalone)
    const checkStandalone = () => {
      const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
      const isStandaloneNavigator = (navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(isStandaloneMedia || isStandaloneNavigator);
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', checkStandalone);

    // 2. Capturar evento nativo de instalación en Chrome/Android/Edge
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // 3. Detectar cuando se instaló exitosamente
    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener('change', checkStandalone);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function triggerInstall() {
    if (isStandalone) {
      window.alert('¡Pesito ya está instalado en tu dispositivo!');
      return;
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsStandalone(true);
          setDeferredPrompt(null);
        }
      } catch (err) {
        console.error('Error al solicitar instalación PWA:', err);
      }
      return;
    }

    if (isIos) {
      setShowIosModal(true);
      return;
    }

    // Navegadores de escritorio o móviles que no dispararon el evento nativo
    setShowDesktopModal(true);
  }

  return {
    isStandalone,
    isIos,
    canInstall: !isStandalone,
    triggerInstall,
    showIosModal,
    setShowIosModal,
    showDesktopModal,
    setShowDesktopModal,
  };
}

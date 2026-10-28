// @vitest-environment jsdom
import { act, createElement as h, StrictMode, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signOut: vi.fn(),
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    auth: authMocks,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
          abortSignal: () => ({ single: async () => ({ data: null, error: null }) }),
        }),
      }),
      rpc: async () => ({ data: null, error: null }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock('../src/usePwaInstall', () => ({
  usePwaInstall: () => ({
    canInstall: false,
    showIosModal: false,
    showDesktopModal: false,
    triggerInstall: vi.fn(),
    setShowIosModal: vi.fn(),
    setShowDesktopModal: vi.fn(),
  }),
}));

vi.mock('../src/useSwipeBack', () => ({
  useSwipeBack: () => ({ dragOffset: 0, isSwiping: false }),
}));

import {
  isChunkLoadError,
  lazyWithRetry,
  ScreenErrorBoundary,
  ScreenFallback,
} from '../src/lazyWithRetry';
import { App } from '../src/App';

describe('FE-17: Separación de descarga inicial y carga perezosa resiliente', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isChunkLoadError: detección de errores de carga de chunks', () => {
    it('detecta mensajes típicos de fallo de import dinámico en navegadores modernos', () => {
      // Chromium
      expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://pesito.test/assets/Dashboard.js'))).toBe(true);
      // Safari / WebKit
      expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
      expect(isChunkLoadError(new Error('Failed to load module script: https://pesito.test/assets/Admin.js'))).toBe(true);
      // Firefox
      expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://pesito.test/assets/Settings.js'))).toBe(true);
      // Rollup / Webpack
      expect(isChunkLoadError(new Error('Loading chunk 4 failed.'))).toBe(true);
      // Error con nombre explícito
      const namedErr = new Error('Despliegue nuevo');
      namedErr.name = 'ChunkLoadError';
      expect(isChunkLoadError(namedErr)).toBe(true);
    });

    it('devuelve false para errores comunes no vinculados a chunks ni módulos', () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
      expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
      expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
      expect(isChunkLoadError('string random')).toBe(false);
    });
  });

  describe('ScreenFallback: indicador accesible de carga', () => {
    let root: Root, container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
    });

    it('muestra el texto por defecto y la semántica de accesibilidad', async () => {
      await act(async () => {
        root.render(h(ScreenFallback));
      });
      const copy = container.querySelector('.loading-copy');
      expect(copy).not.toBeNull();
      expect(copy?.getAttribute('role')).toBe('status');
      expect(copy?.textContent).toBe('Cargando…');
    });

    it('permite personalizar la etiqueta de carga por pantalla', async () => {
      await act(async () => {
        root.render(h(ScreenFallback, { label: 'Abriendo Ajustes…' }));
      });
      const copy = container.querySelector('.loading-copy');
      expect(copy?.textContent).toBe('Abriendo Ajustes…');
    });
  });

  describe('ScreenErrorBoundary: aislamiento de fallas de renderizado y chunks', () => {
    let root: Root, container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    });

    function BuggyComponent(): never {
      throw new Error('Fallo simulado de pantalla');
    }

    it('renderiza normalmente los componentes hijos sin error', async () => {
      await act(async () => {
        root.render(
          h(
            ScreenErrorBoundary,
            null,
            h('p', { 'data-testid': 'ok' }, 'Contenido normal'),
          ),
        );
      });
      expect(container.querySelector('[data-testid="ok"]')?.textContent).toBe('Contenido normal');
    });

    it('captura errores y muestra una tarjeta accesible con botón de reintento', async () => {
      const handleReset = vi.fn();
      await act(async () => {
        root.render(
          h(
            ScreenErrorBoundary,
            { fallbackTitle: 'No pudimos abrir esta sección', onReset: handleReset },
            h(BuggyComponent),
          ),
        );
      });

      const alertCard = container.querySelector('[role="alert"]');
      expect(alertCard).not.toBeNull();
      expect(alertCard?.querySelector('h1')?.textContent).toBe('No pudimos abrir esta sección');
      expect(alertCard?.querySelector('p')?.textContent).toContain('Revisá tu conexión y volvé a intentar');

      const retryBtn = alertCard?.querySelector('button');
      expect(retryBtn?.textContent).toBe('Reintentar');

      await act(async () => {
        retryBtn?.click();
      });
      expect(handleReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('lazyWithRetry: reintentos y protección de despliegue', () => {
    let memoryStorage: Record<string, string>;
    let storageMock: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

    beforeEach(() => {
      memoryStorage = {};
      storageMock = {
        getItem: (k: string) => memoryStorage[k] ?? null,
        setItem: (k: string, v: string) => { memoryStorage[k] = v; },
        removeItem: (k: string) => { delete memoryStorage[k]; },
      };
    });

    it('resuelve el componente directamente si la importación tiene éxito', async () => {
      const MockComponent = () => h('div', { 'data-testid': 'lazy-ok' }, 'Listo');
      const importer = vi.fn(async () => ({ default: MockComponent }));

      const LazyComp = lazyWithRetry(importer, {
        chunkKey: 'test-direct',
        storage: storageMock,
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            StrictMode,
            null,
            h(Suspense, { fallback: h(ScreenFallback) }, h(LazyComp)),
          ),
        );
      });

      expect(importer).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="lazy-ok"]')?.textContent).toBe('Listo');

      await act(async () => root.unmount());
      container.remove();
    });

    it('se recupera de un microcorte transitorio en el reintento sin recargar la página', async () => {
      const MockComponent = () => h('div', { 'data-testid': 'recovered' }, 'Recuperado');
      let attempts = 0;
      const importer = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError('Failed to fetch dynamically imported module');
        }
        return { default: MockComponent };
      });

      const reloadMock = vi.fn();
      const LazyComp = lazyWithRetry(importer, {
        chunkKey: 'test-recovery',
        retries: 1,
        retryDelayMs: 0,
        reload: reloadMock,
        storage: storageMock,
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            StrictMode,
            null,
            h(Suspense, { fallback: h(ScreenFallback) }, h(LazyComp)),
          ),
        );
      });

      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="recovered"]')?.textContent).toBe('Recuperado');
      });

      expect(importer).toHaveBeenCalledTimes(2);
      expect(reloadMock).not.toHaveBeenCalled();

      await act(async () => root.unmount());
      container.remove();
    });

    it('ante error persistente de chunk ejecuta recarga protegida exactamente una vez', async () => {
      const importer = vi.fn(async () => {
        throw new TypeError('Failed to fetch dynamically imported module: chunk-404.js');
      });

      const reloadMock = vi.fn();
      const LazyComp = lazyWithRetry(importer, {
        chunkKey: 'test-deploy',
        retries: 1,
        retryDelayMs: 0,
        reload: reloadMock,
        storage: storageMock,
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            ScreenErrorBoundary,
            null,
            h(Suspense, { fallback: h(ScreenFallback) }, h(LazyComp)),
          ),
        );
      });

      await vi.waitFor(() => {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      });

      // Se intentó 2 veces (intento 0 y reintento 1)
      expect(importer).toHaveBeenCalledTimes(2);
      // Quedó asentado en storage para prevenir bucle
      expect(storageMock.getItem('pesito_chunk_retry_test-deploy')).toBe('true');

      await act(async () => root.unmount());
      container.remove();
    });

    it('si ya se recargó en la sesión, no vuelve a recargar y propaga el error al ErrorBoundary', async () => {
      // Marcar previamente que ya se intentó recargar en esta sesión
      storageMock.setItem('pesito_chunk_retry_test-no-loop', 'true');

      const importer = vi.fn(async () => {
        throw new TypeError('Failed to fetch dynamically imported module: chunk-still-404.js');
      });

      const reloadMock = vi.fn();
      const LazyComp = lazyWithRetry(importer, {
        chunkKey: 'test-no-loop',
        retries: 1,
        retryDelayMs: 0,
        reload: reloadMock,
        storage: storageMock,
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        root.render(
          h(
            ScreenErrorBoundary,
            { fallbackTitle: 'Error tras recarga previa' },
            h(Suspense, { fallback: h(ScreenFallback) }, h(LazyComp)),
          ),
        );
      });

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"] h1')?.textContent).toBe('Error tras recarga previa');
      });

      // No debe recargar de nuevo (evita bucle infinito)
      expect(reloadMock).not.toHaveBeenCalled();

      await act(async () => root.unmount());
      container.remove();
    });

    it('la carga exitosa limpia cualquier indicador residual previo en sessionStorage', async () => {
      storageMock.setItem('pesito_chunk_retry_test-cleanup', 'true');

      const MockComponent = () => h('div', null, 'Exito');
      const importer = vi.fn(async () => ({ default: MockComponent }));

      const LazyComp = lazyWithRetry(importer, {
        chunkKey: 'test-cleanup',
        storage: storageMock,
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            StrictMode,
            null,
            h(Suspense, { fallback: h(ScreenFallback) }, h(LazyComp)),
          ),
        );
      });

      expect(storageMock.getItem('pesito_chunk_retry_test-cleanup')).toBeNull();

      await act(async () => root.unmount());
      container.remove();
    });
  });

  describe('App: integración de pantallas perezosas y fallback', () => {
    let root: Root, container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
    });

    it('al abrir sin sesión muestra la pantalla de Login tras resolver el chunk perezoso', async () => {
      authMocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      await act(async () => {
        root.render(h(App));
      });

      // Debe resolver el chunk de Login y mostrar los botones de login
      await vi.waitFor(() => {
        const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
        expect(buttons).toContain('Iniciar sesión');
      });
    });
  });
});

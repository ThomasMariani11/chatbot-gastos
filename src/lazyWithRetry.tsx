import React, { Component, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';

export interface LazyRetryOptions {
  /** Clave única para evitar bucles infinitos de recarga */
  chunkKey?: string;
  /** Cantidad de reintentos inmediatos ante microcortes de red antes de recargar (default: 1) */
  retries?: number;
  /** Demora en milisegundos entre reintentos (default: 400) */
  retryDelayMs?: number;
  /** Función para recargar la ventana ante un desajuste de hash tras un despliegue */
  reload?: () => void;
  /** Almacenamiento de sesión para guardar el indicador de recarga */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'ChunkLoadError') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Importing a module script failed') ||
    message.includes('Failed to load module script') ||
    message.includes('dynamically imported module')
  );
}

/**
 * Carga perezosa de componentes con reintento automático ante fallas de red
 * y recarga protegida de página si el chunk fue invalidado por un nuevo despliegue.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  options: LazyRetryOptions = {},
): LazyExoticComponent<T> {
  const {
    chunkKey = 'anonymous',
    retries = 1,
    retryDelayMs = 400,
    reload = () => {
      if (typeof window !== 'undefined') window.location.reload();
    },
    storage = typeof window !== 'undefined' ? window.sessionStorage : undefined,
  } = options;

  return React.lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const loaded = await importer();
        try {
          storage?.removeItem(`pesito_chunk_retry_${chunkKey}`);
        } catch {
          // Ignorar restricciones de almacenamiento (modo incógnito/cuota)
        }
        return loaded;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          } else {
            await Promise.resolve();
          }
        }
      }
    }

    if (isChunkLoadError(lastError)) {
      const retryKey = `pesito_chunk_retry_${chunkKey}`;
      let alreadyRetried = false;
      try {
        alreadyRetried = storage?.getItem(retryKey) === 'true';
      } catch {
        // Ignorar error de acceso a storage
      }

      if (!alreadyRetried) {
        try {
          storage?.setItem(retryKey, 'true');
        } catch {
          // Ignorar error de acceso a storage
        }
        reload();
        // Mantener la promesa pendiente mientras el navegador procesa la recarga
        return new Promise<{ default: T }>(() => {});
      }
    }

    throw lastError;
  });
}

export interface ScreenErrorBoundaryProps {
  children?: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

export interface ScreenErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, ScreenErrorBoundaryState> {
  override state: ScreenErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[ScreenErrorBoundary] Error de carga o renderizado:', error?.message);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  override render() {
    if (this.state.hasError) {
      return (
        <main className="auth-page">
          <section className="auth-card" role="alert">
            <h1>{this.props.fallbackTitle || 'No pudimos cargar esta sección'}</h1>
            <p>Revisá tu conexión y volvé a intentar. Tus datos siguen guardados.</p>
            <button type="button" onClick={this.handleRetry}>
              Reintentar
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ScreenFallback({ label = 'Cargando…' }: { label?: string }) {
  return (
    <main className="auth-page">
      <p className="loading-copy" role="status">
        {label}
      </p>
    </main>
  );
}

import { Icon } from './Icons';
import { useProfileDraft } from './useProfileDraft';
import { useUpdateBlocker } from './PwaUpdates';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { lazyWithRetry, ScreenErrorBoundary, ScreenFallback } from './lazyWithRetry';
import type { UserProfile } from './Settings';
import { supabase } from './supabase';
import { hasActiveSubscription } from './subscription';

const Dashboard = lazyWithRetry(
  () => import('./Dashboard').then((m) => ({ default: m.Dashboard })),
  { chunkKey: 'dashboard' },
);

const Settings = lazyWithRetry(
  () => import('./Settings').then((m) => ({ default: m.Settings })),
  { chunkKey: 'settings' },
);

const AdminPanel = lazyWithRetry(
  () => import('./AdminPanel').then((m) => ({ default: m.AdminPanel })),
  { chunkKey: 'admin' },
);

const Paywall = lazyWithRetry(
  () => import('./Paywall').then((m) => ({ default: m.Paywall })),
  { chunkKey: 'paywall' },
);

const Login = lazyWithRetry(
  () => import('./Login').then((m) => ({ default: m.Login })),
  { chunkKey: 'login' },
);

type View = 'dashboard' | 'settings' | 'admin';

export function App() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main className="auth-page"><p className="loading-copy">Abriendo Pesito…</p></main>;
  if (!session) {
    return (
      <ScreenErrorBoundary fallbackTitle="No pudimos cargar el ingreso">
        <Suspense fallback={<ScreenFallback label="Abriendo Pesito…" />}>
          <Login />
        </Suspense>
      </ScreenErrorBoundary>
    );
  }
  return (
    <ScreenErrorBoundary>
      <AuthenticatedApp key={session.user.id} session={session} />
    </ScreenErrorBoundary>
  );
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [view, setView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      if (window.location.hash === '#settings') return 'settings';
      if (window.location.hash === '#admin') return 'admin';
    }
    return 'dashboard';
  });

  // Navegación sincronizada con el historial del navegador para soporte total de gestos
  // como deslizar desde el borde en Safari iOS y navegación hacia atrás en Android/PWA
  const navigateTo = useCallback((nextView: View) => {
    if (nextView === 'settings') {
      window.history.pushState({ view: 'settings' }, '', '#settings');
      setView('settings');
    } else if (nextView === 'admin') {
      window.history.pushState({ view: 'admin' }, '', '#admin');
      setView('admin');
    } else {
      if (window.location.hash === '#settings' || window.location.hash === '#admin' || window.history.state?.view) {
        window.history.back();
      } else {
        setView('dashboard');
        try {
          window.history.replaceState({ view: 'dashboard' }, '', window.location.pathname + window.location.search);
        } catch {
          // ignore
        }
      }
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const stateView = (event.state?.view as View | undefined);
      const hash = window.location.hash;
      if (stateView === 'settings' || hash === '#settings') {
        setView('settings');
      } else if (stateView === 'admin' || hash === '#admin') {
        setView('admin');
      } else {
        setView('dashboard');
      }
    };

    // Asegurar que el estado base exista en el historial para permitir volver siempre
    if (typeof window !== 'undefined') {
      if (!window.history.state?.view) {
        if (window.location.hash === '#settings') {
          window.history.replaceState({ view: 'dashboard' }, '', window.location.pathname + window.location.search);
          window.history.pushState({ view: 'settings' }, '', '#settings');
        } else if (window.location.hash === '#admin') {
          window.history.replaceState({ view: 'dashboard' }, '', window.location.pathname + window.location.search);
          window.history.pushState({ view: 'admin' }, '', '#admin');
        } else {
          window.history.replaceState({ view: 'dashboard' }, '', window.location.pathname + window.location.search);
        }
      }
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const requestId = useRef(0);
  const isAdmin = profile?.role === 'admin';
  const nameDraft = useProfileDraft(session.user.id, profile);
  useUpdateBlocker(nameDraft.state.dirty || nameDraft.state.saving, 'Guardá o descartá tus cambios en Ajustes para actualizar.');
  useUpdateBlocker(showSignOutConfirm);

  const handleRequestSignOut = () => {
    setShowSignOutConfirm(true);
  };

  const handleConfirmSignOut = async () => {
    setShowSignOutConfirm(false);
    await supabase.auth.signOut();
  };

  const loadProfile = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (currentRequest !== requestId.current) return;
      if (error || !data || data.id !== session.user.id) throw new Error('Perfil no disponible');
      setProfile(data as UserProfile);
      setProfileError(false);
    } catch {
      if (currentRequest !== requestId.current) return;
      setProfile(null);
      setProfileError(true);
    } finally {
      if (currentRequest === requestId.current) setLoadingProfile(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    setLoadingProfile(true);
    void loadProfile();
    const refresh = () => { void loadProfile(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      requestId.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [loadProfile]);

  const isSubscriptionActive = hasActiveSubscription(profile);

  const renderSignOutModal = () => {
    if (!showSignOutConfirm) return null;
    return (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        onClick={() => setShowSignOutConfirm(false)}
      >
        <div
          className="movement-form"
          style={{ maxWidth: '380px', textAlign: 'center', padding: '26px 20px', gap: '16px' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="dialog-symbol"><Icon name="logOut" size={32} /></div>
          <div>
            <p className="eyebrow" style={{ color: '#e24b4b', marginBottom: '4px' }}>CERRAR SESIÓN</p>
            <h2 id="logout-confirm-title" style={{ margin: 0, fontSize: '19px', fontWeight: 800 }}>¿Cerrar sesión en Pesito?</h2>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.45 }}>
              Vas a salir de tu cuenta. Para volver a ingresar vas a necesitar solicitar un enlace de acceso con tu correo.
            </p>
          </div>
          <div className="modal-actions-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="modal-btn-cancel"
              style={{
                cursor: 'pointer',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowSignOutConfirm(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="danger-button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleConfirmSignOut()}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (session === undefined || (session && loadingProfile)) {
    return (
      <main className="auth-page">
        <p className="loading-copy">Abriendo Pesito…</p>
      </main>
    );
  }

  if (profileError || !profile) return (
    <>
      <main className="auth-page"><section className="auth-card">
        <h1>No pudimos verificar tu acceso</h1>
        <p role="alert">Revisá tu conexión y volvé a intentar. Tus datos siguen guardados.</p>
        <button type="button" onClick={() => { setLoadingProfile(true); void loadProfile(); }}>Reintentar</button>
        <button type="button" className="button-link" onClick={handleRequestSignOut}>Cerrar sesión</button>
      </section></main>
      {renderSignOutModal()}
    </>
  );

  // Paywall bloqueante para clientes vencidos o suspendidos
  if (!isSubscriptionActive && profile) {
    return (
      <>
        <Suspense fallback={<ScreenFallback label="Abriendo suscripción…" />}>
          <Paywall
            userId={session.user.id}
            userEmail={session.user.email}
            subscriptionStatus={profile.subscription_status}
            subscriptionUntil={profile.subscription_until}
            onSuccess={() => void loadProfile()}
            onSignOut={handleRequestSignOut}
          />
        </Suspense>
        {renderSignOutModal()}
      </>
    );
  }

  if (view === 'admin' && isAdmin) {
    return (
      <>
        <Suspense fallback={<ScreenFallback label="Abriendo Administración…" />}>
          <AdminPanel
            userId={session.user.id}
            onBack={() => navigateTo('dashboard')}
            onSignOut={handleRequestSignOut}
          />
        </Suspense>
        {renderSignOutModal()}
      </>
    );
  }

  if (view === 'settings') {
    return (
      <>
        <Suspense fallback={<ScreenFallback label="Abriendo Ajustes…" />}>
          <Settings
            userId={session.user.id}
            userEmail={session.user.email}
            userProfile={profile}
            nameDraft={nameDraft}
            isAdmin={isAdmin}
            onOpenAdmin={() => navigateTo('admin')}
            onBack={() => navigateTo('dashboard')}
            onSignOut={handleRequestSignOut}
            onRefreshProfile={() => void loadProfile()}
          />
        </Suspense>
        {renderSignOutModal()}
      </>
    );
  }

  return (
    <>
      <Suspense fallback={<ScreenFallback label="Abriendo Pesito…" />}>
        <Dashboard
          userId={session.user.id}
          userEmail={session.user.email}
          userProfile={profile}
          isAdmin={isAdmin}
          onOpenAdmin={() => navigateTo('admin')}
          onOpenSettings={() => navigateTo('settings')}
          onSignOut={handleRequestSignOut}
        />
      </Suspense>
      {renderSignOutModal()}
    </>
  );
}

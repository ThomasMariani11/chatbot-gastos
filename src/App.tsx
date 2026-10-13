import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AdminPanel } from './AdminPanel';
import { Dashboard } from './Dashboard';
import { Login } from './Login';
import { Paywall } from './Paywall';
import { Settings, type UserProfile } from './Settings';
import { supabase } from './supabase';
import { hasActiveSubscription } from './subscription';

type View = 'dashboard' | 'settings' | 'admin';

export function App() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main className="auth-page"><p className="loading-copy">Abriendo Pesito…</p></main>;
  if (!session) return <Login />;
  return <AuthenticatedApp key={session.user.id} session={session} />;
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [view, setView] = useState<View>('dashboard');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const requestId = useRef(0);
  const isAdmin = profile?.role === 'admin';

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
          <div style={{ fontSize: '38px', lineHeight: 1 }}>🚪</div>
          <div>
            <p className="eyebrow" style={{ color: '#e24b4b', marginBottom: '4px' }}>CERRAR SESIÓN</p>
            <h2 id="logout-confirm-title" style={{ margin: 0, fontSize: '19px', fontWeight: 800 }}>¿Cerrar sesión en Pesito?</h2>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#6d7d77', lineHeight: 1.45 }}>
              Vas a salir de tu cuenta. Para volver a ingresar vas a necesitar solicitar un enlace de acceso con tu correo.
            </p>
          </div>
          <div className="modal-actions-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="modal-btn-cancel"
              style={{
                height: '44px',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '14px',
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                cursor: 'pointer',
              }}
              onClick={() => setShowSignOutConfirm(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="danger-button"
              style={{
                height: '44px',
                borderRadius: '12px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 800,
                background: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fca5a5',
                cursor: 'pointer',
              }}
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
        <Paywall
          userId={session.user.id}
          userEmail={session.user.email}
          subscriptionStatus={profile.subscription_status}
          subscriptionUntil={profile.subscription_until}
          onSuccess={() => void loadProfile()}
          onSignOut={handleRequestSignOut}
        />
        {renderSignOutModal()}
      </>
    );
  }

  if (view === 'admin' && isAdmin) {
    return (
      <>
        <AdminPanel
          userId={session.user.id}
          onBack={() => setView('dashboard')}
          onSignOut={handleRequestSignOut}
        />
        {renderSignOutModal()}
      </>
    );
  }

  if (view === 'settings') {
    return (
      <>
        <Settings
          userId={session.user.id}
          userEmail={session.user.email}
          userProfile={profile}
          isAdmin={isAdmin}
          onOpenAdmin={() => setView('admin')}
          onBack={() => setView('dashboard')}
          onSignOut={handleRequestSignOut}
          onRefreshProfile={() => void loadProfile()}
        />
        {renderSignOutModal()}
      </>
    );
  }

  return (
    <>
      <Dashboard
        userId={session.user.id}
        userEmail={session.user.email}
        userProfile={profile}
        isAdmin={isAdmin}
        onOpenAdmin={() => setView('admin')}
        onOpenSettings={() => setView('settings')}
        onSignOut={handleRequestSignOut}
      />
      {renderSignOutModal()}
    </>
  );
}

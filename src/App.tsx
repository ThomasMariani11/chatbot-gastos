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
  const requestId = useRef(0);
  const isAdmin = profile?.role === 'admin';

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

  if (session === undefined || (session && loadingProfile)) {
    return (
      <main className="auth-page">
        <p className="loading-copy">Abriendo Pesito…</p>
      </main>
    );
  }

  if (profileError || !profile) return (
    <main className="auth-page"><section className="auth-card">
      <h1>No pudimos verificar tu acceso</h1>
      <p role="alert">Revisá tu conexión y volvé a intentar. Tus datos siguen guardados.</p>
      <button type="button" onClick={() => { setLoadingProfile(true); void loadProfile(); }}>Reintentar</button>
      <button type="button" className="button-link" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
    </section></main>
  );

  // Paywall bloqueante para clientes vencidos o suspendidos
  if (!isSubscriptionActive && profile) {
    return (
      <Paywall
        userId={session.user.id}
        userEmail={session.user.email}
        subscriptionStatus={profile.subscription_status}
        subscriptionUntil={profile.subscription_until}
        onSuccess={() => void loadProfile()}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  if (view === 'admin' && isAdmin) {
    return (
      <AdminPanel
        userId={session.user.id}
        onBack={() => setView('dashboard')}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  if (view === 'settings') {
    return (
      <Settings
        userId={session.user.id}
        userEmail={session.user.email}
        userProfile={profile}
        isAdmin={isAdmin}
        onOpenAdmin={() => setView('admin')}
        onBack={() => setView('dashboard')}
        onSignOut={() => supabase.auth.signOut()}
        onRefreshProfile={() => void loadProfile()}
      />
    );
  }

  return (
    <Dashboard
      userId={session.user.id}
      userEmail={session.user.email}
      isAdmin={isAdmin}
      onOpenAdmin={() => setView('admin')}
      onOpenSettings={() => setView('settings')}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

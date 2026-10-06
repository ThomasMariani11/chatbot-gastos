import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AdminPanel } from './AdminPanel';
import { Dashboard } from './Dashboard';
import { Login } from './Login';
import { Paywall } from './Paywall';
import { Settings, type UserProfile } from './Settings';
import { supabase } from './supabase';

type View = 'dashboard' | 'settings' | 'admin';

export function App() {
  const [session, setSession] = useState<Session | null>();
  const [view, setView] = useState<View>('dashboard');
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session?.user?.id) {
      setIsAdmin(false);
      setProfile(null);
      setLoadingProfile(false);
      return;
    }

    try {
      const [roleRes, profileRes] = await Promise.all([
        supabase.rpc('get_my_role'),
        supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      ]);

      const isUserAdmin = roleRes.data === 'admin' || profileRes.data?.role === 'admin';
      setIsAdmin(isUserAdmin);

      if (profileRes.data) {
        setProfile(profileRes.data as UserProfile);
      }
    } catch {
      // ignore
    } finally {
      setLoadingProfile(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    setLoadingProfile(true);
    void loadProfile();
  }, [loadProfile]);

  const isSubscriptionActive = useMemo(() => {
    if (isAdmin) return true; // Administrador siempre activo y vitalicio
    if (!profile) return true; // Durante carga inicial no bloquear prematuramente
    if (profile.subscription_status === 'suspended') return false;
    if (profile.subscription_status === 'expired') return false;
    if (profile.subscription_status === 'pending_code') return false;
    if (!profile.subscription_until) return true; // null = acceso vitalicio
    return new Date(profile.subscription_until).getTime() > Date.now();
  }, [isAdmin, profile]);

  if (session === undefined || (session && loadingProfile)) {
    return (
      <main className="auth-page">
        <p className="loading-copy">Abriendo Pesito…</p>
      </main>
    );
  }

  if (!session) return <Login />;

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

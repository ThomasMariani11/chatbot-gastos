import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AdminPanel } from './AdminPanel';
import { Dashboard } from './Dashboard';
import { Login } from './Login';
import { Settings } from './Settings';
import { supabase } from './supabase';

type View = 'dashboard' | 'settings' | 'admin';

export function App() {
  const [session, setSession] = useState<Session | null>();
  const [view, setView] = useState<View>('dashboard');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setIsAdmin(false);
      return;
    }
    supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsAdmin(data?.role === 'admin');
      });
  }, [session?.user?.id]);

  if (session === undefined) return <main className="auth-page"><p className="loading-copy">Abriendo Pesito…</p></main>;
  if (!session) return <Login />;

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
        isAdmin={isAdmin}
        onOpenAdmin={() => setView('admin')}
        onBack={() => setView('dashboard')}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  return (
    <Dashboard
      userId={session.user.id}
      isAdmin={isAdmin}
      onOpenAdmin={() => setView('admin')}
      onOpenSettings={() => setView('settings')}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

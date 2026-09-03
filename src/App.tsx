import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Dashboard } from './Dashboard';
import { Login } from './Login';
import { Settings } from './Settings';
import { supabase } from './supabase';

type View = 'dashboard' | 'settings';

export function App() {
  const [session, setSession] = useState<Session | null>();
  const [view, setView] = useState<View>('dashboard');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main className="auth-page"><p className="loading-copy">Abriendo Pesito…</p></main>;
  if (!session) return <Login />;
  if (view === 'settings') return <Settings userId={session.user.id} onBack={() => setView('dashboard')} />;
  return <Dashboard userId={session.user.id} onOpenSettings={() => setView('settings')} onSignOut={() => supabase.auth.signOut()} />;
}

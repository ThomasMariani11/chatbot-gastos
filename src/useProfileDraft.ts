import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ProfileDraft, type ProfileRecord, type NameWriter } from './profileDraft';
import { supabase } from './supabase';
export const writeProfileName: NameWriter = async (userId, names, signal) => {
  const { data, error } = await supabase.from('profiles').update({ ...names, updated_at: new Date().toISOString() })
    .eq('id', userId).select('id,first_name,last_name').abortSignal(signal).single();
  if (error || !data) throw new Error('No se confirmó el perfil');
  return data as ProfileRecord;
};
export function useProfileDraft(userId: string, profile: ProfileRecord | null) {
  const draft = useMemo(() => new ProfileDraft(userId, writeProfileName), [userId]);
  useEffect(() => { draft.activate(); return () => draft.deactivate(); }, [draft]);
  const id = profile?.id, firstName = profile?.first_name, lastName = profile?.last_name;
  useEffect(() => { if (id) draft.receive({ id, first_name: firstName, last_name: lastName }); }, [draft, id, firstName, lastName]);
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot);
  return { draft, state };
}

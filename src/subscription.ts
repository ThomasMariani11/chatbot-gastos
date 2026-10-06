type Subscription = {
  role: string;
  subscription_status: string;
  subscription_until: string | null;
};

export function hasActiveSubscription(profile: Subscription | null, now = Date.now()): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (profile.role !== 'client' || profile.subscription_status !== 'active') return false;
  return profile.subscription_until === null || Date.parse(profile.subscription_until) > now;
}

export function clientSubscriptionMetrics(profiles: Subscription[], now = Date.now()) {
  const active = profiles.filter((profile) => profile.role === 'client' && hasActiveSubscription(profile, now));
  return {
    activeClientsCount: active.length,
    expiringSoonCount: active.filter((profile) => profile.subscription_until !== null
      && Date.parse(profile.subscription_until) <= now + 7 * 86400000).length,
  };
}

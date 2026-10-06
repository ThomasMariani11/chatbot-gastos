-- La renovación y la lectura del perfil permanecen disponibles tras vencer.
create or replace function public.has_active_subscription()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'admin' or (
        role = 'client' and subscription_status = 'active'
        and (subscription_until is null or subscription_until > now())
      ))
  );
$$;

revoke all on function public.has_active_subscription() from public;
grant execute on function public.has_active_subscription() to authenticated;

-- Restrictivas: se combinan con las políticas existentes de propiedad (AND).
create policy "subscription required for transactions" on public.transactions
  as restrictive for all to authenticated
  using ((select public.has_active_subscription()))
  with check ((select public.has_active_subscription()));

create policy "subscription required for budgets" on public.budgets
  as restrictive for all to authenticated
  using ((select public.has_active_subscription()))
  with check ((select public.has_active_subscription()));

create policy "subscription required for categories" on public.categories
  as restrictive for all to authenticated
  using ((select public.has_active_subscription()))
  with check ((select public.has_active_subscription()));

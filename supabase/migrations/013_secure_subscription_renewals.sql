-- Conserva la firma para Settings y Paywall, pero el destinatario debe ser
-- siempre el usuario autenticado. El alta inicial usa bootstrap_user (010).
create or replace function public.redeem_invitation_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_code public.invitation_codes%rowtype;
  v_new_until timestamptz;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'Solo podés canjear códigos para tu propia cuenta.');
  end if;

  -- Serializa renovaciones simultáneas del mismo usuario para no perder días.
  select * into v_profile from public.profiles where id = auth.uid() for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'No encontramos tu perfil. Contactá a soporte.');
  end if;
  if v_profile.subscription_status = 'suspended' then
    return jsonb_build_object('success', false, 'error', 'Tu cuenta está pausada. Contactá al administrador para reactivarla.');
  end if;
  -- No consume un código ni convierte un acceso vitalicio en temporal.
  -- pending_code + NULL es un alta sin activar, no un plan vitalicio.
  if v_profile.role = 'admin' or
     (v_profile.subscription_status = 'active' and v_profile.subscription_until is null) then
    return jsonb_build_object('success', false, 'error', 'Tu cuenta ya tiene acceso vitalicio. El código no fue utilizado.');
  end if;

  select * into v_code from public.invitation_codes
    where upper(trim(code)) = upper(trim(p_code)) and is_used = false
    for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Código de invitación inválido o ya utilizado.');
  end if;

  if v_code.duration_days is null then
    v_new_until := null;
  else
    v_new_until := greatest(now(), v_profile.subscription_until)
      + make_interval(days => v_code.duration_days);
  end if;

  update public.profiles
    set subscription_status = 'active', subscription_until = v_new_until, updated_at = now()
    where id = auth.uid();
  update public.invitation_codes
    set is_used = true, used_by = auth.uid(), used_at = now()
    where id = v_code.id;

  return jsonb_build_object('success', true, 'duration_days', v_code.duration_days,
    'subscription_until', v_new_until);
end;
$$;

revoke all on function public.redeem_invitation_code(text, uuid) from public, anon;
grant execute on function public.redeem_invitation_code(text, uuid) to authenticated;

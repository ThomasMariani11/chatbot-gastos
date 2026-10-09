-- ============================================================================
-- Migración 015: Permitir múltiples transacciones por mensaje de WhatsApp
-- y corregir confirm_draft_group
-- ============================================================================

-- 1. Eliminar la restricción UNIQUE en transactions(wa_message_id)
-- En el modelo de carga múltiple (lotes), un solo mensaje de WhatsApp
-- puede generar múltiples transacciones legítimas (ej: súper, nafta y trabajo).
alter table public.transactions drop constraint if exists transactions_wa_message_id_key;
create index if not exists transactions_wa_message_id_idx on public.transactions(wa_message_id);

-- 2. Reemplazar confirm_draft_group con trazabilidad de posición en wa_message_id
create or replace function public.confirm_draft_group(
  p_group_id uuid,
  p_user_id uuid,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.draft_groups%rowtype;
  v_profile public.profiles%rowtype;
  v_item record;
  v_first_tx_id uuid;
  v_inst_tx_id uuid;
  v_tx_count integer := 0;
  v_item_wa_id text;
begin
  -- 1. Validar perfil y suscripción activa
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Usuario no encontrado.');
  end if;

  if v_profile.role <> 'admin' then
    if v_profile.subscription_status = 'suspended' then
      return jsonb_build_object('success', false, 'error', 'Tu cuenta se encuentra en pausa.');
    end if;
    if v_profile.subscription_status = 'expired' or
       v_profile.subscription_status = 'pending_code' or
       (v_profile.subscription_until is not null and v_profile.subscription_until < now()) then
      return jsonb_build_object('success', false, 'error', 'Tu suscripción en Pesito ha finalizado.');
    end if;
  end if;

  -- 2. Bloquear grupo con FOR UPDATE y verificar estado y versión
  select * into v_group from public.draft_groups where id = p_group_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'El grupo de movimientos pendiente no existe.');
  end if;

  if v_group.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'El grupo ya fue ' || v_group.status || '.');
  end if;

  if p_expected_version is not null and v_group.version <> p_expected_version then
    return jsonb_build_object(
      'success', false,
      'error', 'El borrador fue actualizado concurrentemente. Por favor revisá el resumen más reciente antes de confirmar.',
      'current_version', v_group.version
    );
  end if;

  -- 3. Verificar que no haya operaciones pendientes con datos faltantes críticos
  if exists (
    select 1 from public.draft_items
    where group_id = p_group_id and status = 'pending' and cardinality(missing_fields) > 0
  ) then
    return jsonb_build_object('success', false, 'error', 'Hay movimientos con datos faltantes. Por favor completalos o quitalos antes de confirmar.');
  end if;

  if not exists (
    select 1 from public.draft_items where group_id = p_group_id and status = 'pending'
  ) then
    return jsonb_build_object('success', false, 'error', 'No hay movimientos pendientes para guardar.');
  end if;

  -- 4. Convertir cada item pendiente en transacciones definitivas
  for v_item in (
    select * from public.draft_items
    where group_id = p_group_id and status = 'pending'
    order by position asc
  ) loop
    v_item_wa_id := case
      when v_item.wa_message_id is null then null
      else v_item.wa_message_id || ':' || v_item.position
    end;

    if v_item.installments <= 1 then
      -- Operación simple en 1 pago
      insert into public.transactions (
        user_id,
        kind,
        description,
        amount_ars,
        currency,
        occurred_on,
        category_id,
        status,
        source,
        confidence,
        wa_message_id,
        installment_count,
        confirmed_at
      ) values (
        p_user_id,
        v_item.kind,
        v_item.description,
        v_item.amount,
        v_item.currency,
        v_item.occurred_on,
        v_item.category_id,
        'confirmed',
        v_item.source,
        v_item.confidence,
        v_item_wa_id,
        1,
        now()
      );
      v_tx_count := v_tx_count + 1;
    else
      -- Operación en cuotas: dividir centavos y programar meses
      declare
        v_total_cents bigint := round(v_item.amount * 100);
        v_base_cents bigint := v_total_cents / v_item.installments;
        v_rem_cents bigint := v_total_cents % v_item.installments;
        v_installment_amount numeric;
        v_first_month_str text := coalesce(v_item.first_installment_month, to_char(v_item.occurred_on, 'YYYY-MM'));
        v_start_year int := split_part(v_first_month_str, '-', 1)::int;
        v_start_month int := split_part(v_first_month_str, '-', 2)::int;
        v_curr_date date;
        v_idx int;
      begin
        v_first_tx_id := null;

        for v_idx in 0..(v_item.installments - 1) loop
          if v_idx = v_item.installments - 1 then
            v_installment_amount := (v_base_cents + v_rem_cents)::numeric / 100.0;
          else
            v_installment_amount := v_base_cents::numeric / 100.0;
          end if;

          v_curr_date := (make_date(v_start_year, v_start_month, 1) + (v_idx || ' months')::interval)::date;

          insert into public.transactions (
            user_id,
            kind,
            description,
            amount_ars,
            currency,
            occurred_on,
            category_id,
            status,
            source,
            confidence,
            wa_message_id,
            installment_group_id,
            installment_number,
            installment_count,
            first_installment_month,
            confirmed_at
          ) values (
            p_user_id,
            v_item.kind,
            v_item.description,
            v_installment_amount,
            v_item.currency,
            v_curr_date,
            v_item.category_id,
            'confirmed',
            v_item.source,
            v_item.confidence,
            case when v_idx = 0 then v_item_wa_id else null end,
            v_first_tx_id,
            v_idx + 1,
            v_item.installments,
            v_first_month_str,
            now()
          ) returning id into v_inst_tx_id;

          if v_idx = 0 then
            v_first_tx_id := v_inst_tx_id;
            update public.transactions set installment_group_id = v_first_tx_id where id = v_first_tx_id;
          end if;

          v_tx_count := v_tx_count + 1;
        end loop;
      end;
    end if;

    -- Actualizar estado del ítem en el borrador
    update public.draft_items
    set status = 'confirmed', updated_at = now()
    where id = v_item.id;
  end loop;

  -- 5. Cerrar el grupo
  update public.draft_groups
  set status = 'confirmed', updated_at = now()
  where id = p_group_id;

  return jsonb_build_object(
    'success', true,
    'confirmed_movements', (select count(*) from public.draft_items where group_id = p_group_id and status = 'confirmed'),
    'created_transactions', v_tx_count
  );
end;
$$;

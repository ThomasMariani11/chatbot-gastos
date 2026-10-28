-- BE-16: Separar errores de negocio, persistencia y envío.
-- 1. Saneamiento de confirm_draft_group y discard_draft_group: sin SQLERRM ni enums crudos.
-- 2. Trazabilidad en fail_whatsapp_job: distingue fallo de entrega (QUEUE_SEND_RETRY) de fallo de procesamiento.
begin;
set local lock_timeout = '5s';

-- 1. confirm_draft_group seguro sin SQLERRM
create or replace function public.confirm_draft_group(
  p_group_id uuid,
  p_user_id uuid,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
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
       (v_profile.subscription_until is not null and v_profile.subscription_until < clock_timestamp()) then
      return jsonb_build_object('success', false, 'error', 'Tu suscripción en Pesito ha finalizado.');
    end if;
  end if;

  -- 2. Bloquear grupo con FOR UPDATE y verificar estado y versión
  select * into v_group from public.draft_groups where id = p_group_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'El grupo de movimientos pendiente no existe.');
  end if;

  if v_group.status <> 'open' then
    return jsonb_build_object(
      'success', false,
      'error', case
        when v_group.status = 'confirmed' then 'Esta lista ya fue confirmada anteriormente.'
        when v_group.status = 'discarded' then 'Esta lista ya fue descartada.'
        else 'La lista no está abierta.'
      end
    );
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
        clock_timestamp()
      );
      v_tx_count := v_tx_count + 1;
    else
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
            clock_timestamp()
          ) returning id into v_inst_tx_id;

          if v_idx = 0 then
            v_first_tx_id := v_inst_tx_id;
            update public.transactions set installment_group_id = v_first_tx_id where id = v_first_tx_id;
          end if;

          v_tx_count := v_tx_count + 1;
        end loop;
      end;
    end if;

    update public.draft_items
    set status = 'confirmed', updated_at = clock_timestamp()
    where id = v_item.id;
  end loop;

  -- 5. Cerrar el grupo
  update public.draft_groups
  set status = 'confirmed', updated_at = clock_timestamp()
  where id = p_group_id;

  return jsonb_build_object(
    'success', true,
    'confirmed_movements', (select count(*) from public.draft_items where group_id = p_group_id and status = 'confirmed'),
    'created_transactions', v_tx_count
  );
exception when others then
  raise warning '%', json_build_object('event', 'confirm_draft_group_failed', 'sqlstate', SQLSTATE)::text;
  return jsonb_build_object(
    'success', false,
    'error', 'hubo un problema técnico al registrar las operaciones. Tu lista pendiente se conserva intacta; probá confirmar nuevamente en unos momentos.'
  );
end;
$$;

-- 2. discard_draft_group seguro sin SQLERRM
create or replace function public.discard_draft_group(
  p_group_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_group public.draft_groups%rowtype;
begin
  select * into v_group from public.draft_groups where id = p_group_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Grupo no encontrado.');
  end if;

  update public.draft_groups
  set status = 'discarded', updated_at = clock_timestamp()
  where id = p_group_id;

  update public.draft_items
  set status = 'removed', updated_at = clock_timestamp()
  where group_id = p_group_id and status = 'pending';

  return jsonb_build_object('success', true, 'message', 'Lote de movimientos descartado.');
exception when others then
  raise warning '%', json_build_object('event', 'discard_draft_group_failed', 'sqlstate', SQLSTATE)::text;
  return jsonb_build_object('success', false, 'error', 'No se pudo descartar el lote pendiente por un error técnico.');
end;
$$;

-- 3. fail_whatsapp_job: distinguir reintentos de envío de fallos de interpretación
create or replace function public.fail_whatsapp_job(p_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id = p_id;
  perform public.assert_whatsapp_lease(q.wa_id, p_token);
  select * into q from public.whatsapp_message_queue where id = p_id for update;
  if q.status <> 'processing' then return; end if;

  update public.whatsapp_message_queue set
    status = 'failed',
    scheduled_for = clock_timestamp() + make_interval(secs => least(300, 5 * power(2, least(greatest(attempts - coalesce(capacity_resumes, 0), 0), 6))::integer)),
    error_message = case when q.effect_applied then 'QUEUE_SEND_RETRY' else 'QUEUE_RETRY_REQUIRED' end
    where id = p_id;

  update public.inbound_events set
    status = 'failed',
    error_code = case when q.effect_applied then 'QUEUE_SEND_RETRY' else 'QUEUE_RETRY_REQUIRED' end
    where wa_message_id = q.wa_message_id;
end;
$$;

-- 4. Permisos
revoke all on function public.confirm_draft_group(uuid, uuid, integer),
  public.discard_draft_group(uuid, uuid),
  public.fail_whatsapp_job(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.confirm_draft_group(uuid, uuid, integer),
  public.discard_draft_group(uuid, uuid),
  public.fail_whatsapp_job(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;

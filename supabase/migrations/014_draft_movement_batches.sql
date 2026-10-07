-- ============================================================================
-- Migración 014: Tablas y funciones para carga múltiple de movimientos por WhatsApp
-- ============================================================================

-- 1. Tabla de Grupos Pendientes (Borradores de movimientos)
create table if not exists public.draft_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'confirmed', 'discarded', 'expired')),
  version integer not null default 1,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists draft_groups_user_status_idx on public.draft_groups(user_id, status);
create index if not exists draft_groups_activity_idx on public.draft_groups(user_id, last_activity_at desc);

-- 2. Tabla de Ítems Individuales del Borrador
create table if not exists public.draft_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.draft_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position >= 1 and position <= 20),
  kind public.transaction_kind not null default 'expense',
  description text not null check (char_length(description) between 1 and 160),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  occurred_on date not null default current_date,
  category_id uuid references public.categories(id) on delete set null,
  installments integer not null default 1 check (installments between 1 and 60),
  first_installment_month text,
  status text not null default 'pending' check (status in ('pending', 'removed', 'confirmed')),
  missing_fields text[] not null default '{}',
  confidence numeric(4,3) default 1.0,
  source text not null default 'text' check (source in ('text', 'audio', 'image', 'pwa')),
  wa_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, position)
);

create index if not exists draft_items_group_idx on public.draft_items(group_id, position);
create index if not exists draft_items_user_status_idx on public.draft_items(user_id, status);

-- 3. Cola persistente de mensajes de WhatsApp
create table if not exists public.whatsapp_message_queue (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,
  wa_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,
  error_message text,
  received_at timestamptz not null default now(),
  scheduled_for timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wa_queue_user_status_idx on public.whatsapp_message_queue(user_id, status, scheduled_for);
create index if not exists wa_queue_wa_id_status_idx on public.whatsapp_message_queue(wa_id, status, scheduled_for);

-- 4. Seguridad RLS
alter table public.draft_groups enable row level security;
alter table public.draft_items enable row level security;
alter table public.whatsapp_message_queue enable row level security;

create policy "own draft groups select" on public.draft_groups for select using (auth.uid() = user_id);
create policy "own draft groups modify" on public.draft_groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own draft items select" on public.draft_items for select using (auth.uid() = user_id);
create policy "own draft items modify" on public.draft_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own wa queue select" on public.whatsapp_message_queue for select using (auth.uid() = user_id);
create policy "own wa queue modify" on public.whatsapp_message_queue for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Función SQL Atómica: Confirmar grupo de borradores y crear movimientos definitivos
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
        v_item.wa_message_id,
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
            case when v_idx = 0 then v_item.wa_message_id else null end,
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

-- 6. Función para Descartar/Cancelar Grupo
create or replace function public.discard_draft_group(
  p_group_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.draft_groups%rowtype;
begin
  select * into v_group from public.draft_groups where id = p_group_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Grupo no encontrado.');
  end if;

  update public.draft_groups
  set status = 'discarded', updated_at = now()
  where id = p_group_id;

  update public.draft_items
  set status = 'removed', updated_at = now()
  where group_id = p_group_id and status = 'pending';

  return jsonb_build_object('success', true, 'message', 'Lote de movimientos descartado.');
end;
$$;

-- 7. Función RPC: Obtener borrador activo o detectar si expiró (> 24h)
create or replace function public.get_active_draft_group(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.draft_groups%rowtype;
  v_items jsonb;
  v_is_stale boolean;
begin
  select * into v_group from public.draft_groups
  where user_id = p_user_id and status = 'open'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Detectar inactividad > 24 horas
  v_is_stale := v_group.last_activity_at < (now() - interval '24 hours');

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', di.id,
      'position', di.position,
      'kind', di.kind,
      'description', di.description,
      'amount', di.amount,
      'currency', di.currency,
      'occurred_on', di.occurred_on,
      'category_name', c.name,
      'installments', di.installments,
      'first_installment_month', di.first_installment_month,
      'status', di.status,
      'missing_fields', di.missing_fields
    ) order by di.position asc
  ), '[]'::jsonb)
  into v_items
  from public.draft_items di
  left join public.categories c on c.id = di.category_id
  where di.group_id = v_group.id and di.status = 'pending';

  return jsonb_build_object(
    'found', true,
    'group_id', v_group.id,
    'version', v_group.version,
    'last_activity_at', v_group.last_activity_at,
    'is_stale', v_is_stale,
    'items', v_items
  );
end;
$$;

grant execute on function public.confirm_draft_group(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.discard_draft_group(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_active_draft_group(uuid) to authenticated, service_role;

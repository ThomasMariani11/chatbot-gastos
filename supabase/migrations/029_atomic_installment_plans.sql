-- API de planes para PWA. Compatible con padre cancelado y primera cuota de WhatsApp.
-- No migra ni repara importes existentes. Las operaciones nuevas son transaccionales.
begin;
create table public.installment_plan_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.installment_plan_requests enable row level security;
revoke all on public.installment_plan_requests from public, anon, authenticated;

create function public.installment_plan_snapshot(p_group uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb; v_version text;
begin
  if not exists(select 1 from public.transactions where id=p_group and user_id=p_user)
     or exists(select 1 from public.transactions where installment_group_id=p_group and user_id<>p_user) then
    raise exception 'No encontramos un plan propio válido.' using errcode='42501';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')),
    coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'description',t.description,'amount_ars',t.amount_ars,'currency',t.currency,
      'occurred_on',t.occurred_on,'category_id',t.category_id,'kind',t.kind,
      'installment_number',t.installment_number,'installment_count',t.installment_count,
      'installment_group_id',t.installment_group_id
    ) order by t.installment_number,t.id) filter(where t.status='confirmed'),'[]'::jsonb)
  into v_version,v_rows from public.transactions t
  where (t.id=p_group or t.installment_group_id=p_group) and t.user_id=p_user;
  return jsonb_build_object('group_id',p_group,'version',v_version,'rows',v_rows);
end $$;
revoke all on function public.installment_plan_snapshot(uuid,uuid) from public,anon,authenticated;

create function public.get_installment_plan(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.has_active_subscription() then
    raise exception 'Necesitás una cuenta activa.' using errcode='42501';
  end if;
  return public.installment_plan_snapshot(p_group_id,auth.uid());
end $$;
revoke all on function public.get_installment_plan(uuid) from public,anon;
grant execute on function public.get_installment_plan(uuid) to authenticated;

create function public.installment_calendar_date(p_reference date,p_offset integer,p_day integer)
returns date language sql immutable set search_path=pg_catalog as $$
  select (date_trunc('month',p_reference)::date + make_interval(months=>p_offset)
    + make_interval(days=>least(p_day,extract(day from (date_trunc('month',p_reference)
      + make_interval(months=>p_offset+1)-interval '1 day'))::integer)-1))::date;
$$;
revoke all on function public.installment_calendar_date(date,integer,integer) from public,anon,authenticated;

create function public.mutate_installment_plan(
  p_request_id uuid,p_action text,p_group_id uuid default null,p_expected_version text default null,
  p_item_id uuid default null,p_payload jsonb default '{}'::jsonb,p_apply_all boolean default true
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_group uuid:=p_group_id; v_hash text; v_request public.installment_plan_requests%rowtype;
  v_snapshot jsonb; v_root public.transactions%rowtype; v_item public.transactions%rowtype;
  v_count integer; v_old_count integer; v_reference date; v_number integer; v_day integer; v_start date;
  v_amount numeric; v_total numeric; v_cents bigint; v_base bigint; v_remainder bigint;
  v_category uuid; v_description text; v_currency text; v_i integer; v_result jsonb; v_key text;
  v_has_parent boolean; v_profile public.profiles%rowtype;
begin
  if v_user is null then raise exception 'Necesitás una cuenta activa.' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=v_user for share;
  if not found or not (v_profile.role='admin' or (v_profile.role='client' and v_profile.subscription_status='active'
      and (v_profile.subscription_until is null or v_profile.subscription_until>now()))) then
    raise exception 'Necesitás una cuenta activa.' using errcode='42501';
  end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
     or p_action not in ('create','edit','delete_plan','delete_installment') or p_action is null or p_apply_all is null then
    raise exception 'Solicitud de plan inválida.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_array(p_action,p_group_id,p_expected_version,p_item_id,p_payload,p_apply_all)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_request_id::text,29));
  select * into v_request from public.installment_plan_requests where user_id=v_user and request_id=p_request_id;
  if found then
    if v_request.request_hash<>v_hash then
      raise exception 'El intento ya se usó para otra operación.' using errcode='22023';
    end if;
    return v_request.result;
  end if;

  if p_action='create' then
    if p_group_id is not null or p_item_id is not null then
      raise exception 'La compra nueva no puede reutilizar un grupo.' using errcode='22023';
    end if;
    for v_key in select jsonb_object_keys(p_payload) loop
      if v_key not in ('description','category_id','currency','amount','amount_mode','installment_count','reference_date','reference_number') then
        raise exception 'Campo de compra inválido.' using errcode='22023';
      end if;
    end loop;
    v_count:=(p_payload->>'installment_count')::integer;
    v_number:=(p_payload->>'reference_number')::integer;
    v_reference:=(p_payload->>'reference_date')::date;
    v_amount:=(p_payload->>'amount')::numeric;
    v_category:=(p_payload->>'category_id')::uuid;
    v_description:=trim(p_payload->>'description'); v_currency:=p_payload->>'currency';
    if v_count is null or v_count not between 2 and 60 or v_number is null or v_number not between 1 and v_count
       or v_reference is null or not isfinite(v_reference) or v_description is null or length(v_description) not between 1 and 160
       or v_currency is null or v_currency not in ('ARS','USD') or v_amount is null
       or not (v_amount>0 and v_amount<=999999999999.99) or v_amount<>round(v_amount,2)
       or coalesce(p_payload->>'amount_mode','') not in ('total','quota') then
      raise exception 'Revisá importe, moneda, fecha y cantidad de cuotas (2 a 60).' using errcode='22023';
    end if;
    if not exists(select 1 from public.categories where id=v_category and user_id=v_user and kind='expense' and active) then
      raise exception 'Elegí una categoría propia de gastos.' using errcode='42501';
    end if;
    v_total:=case when p_payload->>'amount_mode'='quota' then v_amount*v_count else v_amount end;
    if v_total>999999999999.99 or round(v_total*100)<v_count then
      raise exception 'El total debe admitir cuotas positivas dentro del límite.' using errcode='22023';
    end if;
    v_cents:=(v_total*100)::bigint; v_base:=v_cents/v_count; v_remainder:=v_cents%v_count;
    v_day:=extract(day from v_reference)::integer;
    v_start:=public.installment_calendar_date(v_reference,-(v_number-1),1);
    v_group:=gen_random_uuid();
    insert into public.transactions(id,user_id,kind,description,amount_ars,currency,occurred_on,category_id,status,source,installment_count,first_installment_month)
    values(v_group,v_user,'expense',v_description,v_total,v_currency,public.installment_calendar_date(v_start,0,v_day),v_category,'cancelled','pwa',v_count,to_char(v_start,'YYYY-MM'));
    for v_i in 1..v_count loop
      insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,category_id,status,source,installment_group_id,installment_number,installment_count,first_installment_month,confirmed_at)
      values(v_user,'expense',v_description,(v_base+case when v_i=v_count then v_remainder else 0 end)::numeric/100,
        v_currency,public.installment_calendar_date(v_start,v_i-1,v_day),v_category,'confirmed','pwa',v_group,v_i,v_count,to_char(v_start,'YYYY-MM'),now());
    end loop;
  else
    if v_group is null or p_expected_version is null then
      raise exception 'Volvé a abrir el plan antes de modificarlo.' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||v_group::text,30));
    perform 1 from public.transactions where (id=v_group or installment_group_id=v_group) and user_id=v_user order by id for update;
    v_snapshot:=public.installment_plan_snapshot(v_group,v_user);
    if v_snapshot->>'version' is distinct from p_expected_version then
      raise exception 'El plan cambió. Volvé a abrirlo para revisar la versión actual.' using errcode='40001';
    end if;
    if jsonb_array_length(v_snapshot->'rows')=0 then
      raise exception 'El plan ya no tiene cuotas activas.' using errcode='P0002';
    end if;
    select * into v_root from public.transactions where id=v_group and user_id=v_user;
    v_has_parent:=v_root.status='cancelled' and v_root.installment_number is null;
    select * into v_item from public.transactions
      where user_id=v_user and status='confirmed' and (id=v_group or installment_group_id=v_group)
      and (p_item_id is null or id=p_item_id) order by installment_number limit 1;
    if not found then raise exception 'No encontramos esa cuota en el plan.' using errcode='42501'; end if;
    v_old_count:=v_item.installment_count;
    if v_old_count is null or v_old_count not between 2 and 60 or exists(select 1 from public.transactions
       where (id=v_group or installment_group_id=v_group) and user_id=v_user and status='confirmed'
       and (kind<>'expense' or installment_number is null or installment_number not between 1 and v_old_count
         or installment_count is null or installment_count<>v_old_count or currency is null or currency<>v_item.currency
         or amount_ars is null or amount_ars<=0 or occurred_on is null))
       or exists(select installment_number from public.transactions
         where (id=v_group or installment_group_id=v_group) and user_id=v_user and status='confirmed'
         group by installment_number having count(*)>1) then
      raise exception 'El plan tiene datos inconsistentes y requiere revisión.' using errcode='22023';
    end if;
    if p_action in ('delete_plan','delete_installment') then
      if p_payload<>'{}'::jsonb or (p_action='delete_installment' and p_item_id is null) then
        raise exception 'Solicitud de eliminación inválida.' using errcode='22023';
      end if;
      -- Cancelar conserva el ancla del grupo aunque se quite la primera cuota de WhatsApp.
      update public.transactions set status='cancelled',updated_at=now()
        where user_id=v_user and (id=v_group or installment_group_id=v_group)
        and (p_action='delete_plan' or id=p_item_id);
    else
      if p_item_id is null then raise exception 'Seleccioná una cuota de referencia.' using errcode='22023'; end if;
      for v_key in select jsonb_object_keys(p_payload) loop
        if v_key not in ('description','category_id','currency','amount','schedule','installment_count','new_installment_amount','occurred_on') then
          raise exception 'Campo de edición inválido.' using errcode='22023';
        end if;
      end loop;
      if not p_apply_all and (p_payload ? 'schedule' or p_payload ? 'installment_count' or p_payload ? 'new_installment_amount') then
        raise exception 'La reprogramación y cantidad se aplican al plan completo.' using errcode='22023';
      end if;
      v_count:=coalesce((p_payload->>'installment_count')::integer,v_old_count);
      v_description:=case when p_payload ? 'description' then trim(p_payload->>'description') else v_item.description end;
      v_currency:=case when p_payload ? 'currency' then p_payload->>'currency' else v_item.currency end;
      if v_count not between 2 and 60 or v_description is null or length(v_description) not between 1 and 160
         or v_currency is null or v_currency not in ('ARS','USD') or (not p_apply_all and p_payload ? 'currency' and v_currency<>v_item.currency) then
        raise exception 'Revisá los datos del plan; la moneda corresponde a toda la compra.' using errcode='22023';
      end if;
      if p_payload ? 'amount' then
        v_amount:=(p_payload->>'amount')::numeric;
        if v_amount is null or not(v_amount>0 and v_amount<=999999999999.99) or v_amount<>round(v_amount,2) then
          raise exception 'Importe inválido.' using errcode='22023';
        end if;
      end if;
      if p_payload ? 'category_id' then
        v_category:=(p_payload->>'category_id')::uuid;
        if not exists(select 1 from public.categories where id=v_category and user_id=v_user and kind='expense' and active) then
          raise exception 'Elegí una categoría propia de gastos.' using errcode='42501';
        end if;
      end if;
      if p_payload ? 'occurred_on' then
        v_reference:=(p_payload->>'occurred_on')::date;
        if p_apply_all or v_reference is null or not isfinite(v_reference) then
          raise exception 'La fecha individual corresponde a una sola cuota.' using errcode='22023';
        end if;
      end if;
      if p_payload ? 'schedule' then
        v_reference:=(p_payload->'schedule'->>'date')::date;
        v_number:=(p_payload->'schedule'->>'number')::integer;
        if v_reference is null or not isfinite(v_reference) or v_number is null or v_number not between 1 and v_count then
          raise exception 'Fecha de referencia inválida.' using errcode='22023';
        end if;
        v_day:=extract(day from v_reference)::integer;
        v_start:=public.installment_calendar_date(v_reference,-(v_number-1),1);
      end if;
      update public.transactions set
        description=case when p_payload ? 'description' then v_description else description end,
        category_id=case when p_payload ? 'category_id' then v_category else category_id end,
        currency=case when p_payload ? 'currency' then v_currency else currency end,
        amount_ars=case when p_payload ? 'amount' then v_amount else amount_ars end,
        occurred_on=case when p_payload ? 'schedule' then public.installment_calendar_date(v_start,installment_number-1,v_day) when p_payload ? 'occurred_on' then v_reference else occurred_on end,
        first_installment_month=case when p_payload ? 'schedule' then to_char(v_start,'YYYY-MM') else first_installment_month end,
        installment_count=v_count,updated_at=now()
      where user_id=v_user and status='confirmed' and (id=v_group or installment_group_id=v_group)
        and (p_apply_all or id=p_item_id) and installment_number<=v_count;
      if p_apply_all and v_count<v_old_count then
        update public.transactions set status='cancelled',updated_at=now()
        where user_id=v_user and (id=v_group or installment_group_id=v_group) and status='confirmed' and installment_number>v_count;
      end if;
      if p_apply_all and v_count>v_old_count then
        v_amount:=coalesce((p_payload->>'new_installment_amount')::numeric,v_amount);
        if v_amount is null or not(v_amount>0 and v_amount<=999999999999.99) or v_amount<>round(v_amount,2) then
          raise exception 'Indicá el importe de las cuotas nuevas.' using errcode='22023';
        end if;
        if v_start is null then
          -- Derivar el calendario del conjunto, no de febrero ni de la cuota seleccionada.
          select max(extract(day from occurred_on))::integer into v_day from public.transactions
            where user_id=v_user and status='confirmed' and (id=v_group or installment_group_id=v_group);
          select public.installment_calendar_date(occurred_on,-(installment_number-1),1) into v_start
            from public.transactions where user_id=v_user and status='confirmed'
            and (id=v_group or installment_group_id=v_group) order by installment_number limit 1;
        end if;
        for v_i in (v_old_count+1)..v_count loop
          insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,category_id,status,source,installment_group_id,installment_number,installment_count,first_installment_month,confirmed_at)
          values(v_user,'expense',v_description,v_amount,v_currency,public.installment_calendar_date(v_start,v_i-1,v_day),coalesce(v_category,v_item.category_id),'confirmed','pwa',v_group,v_i,v_count,to_char(v_start,'YYYY-MM'),now());
        end loop;
      end if;
    end if;
    -- Solo un padre cancelado sin número representa metadatos. Nunca una cuota de WhatsApp.
    if v_has_parent then
      update public.transactions set amount_ars=(select coalesce(sum(amount_ars),0) from public.transactions
          where installment_group_id=v_group and user_id=v_user and status='confirmed'),
        description=case when p_action='edit' and p_apply_all then v_description else description end,
        currency=case when p_action='edit' and p_apply_all then v_currency else currency end,
        category_id=case when p_action='edit' and p_apply_all and p_payload ? 'category_id' then v_category else category_id end,
        installment_count=case when p_action='edit' then v_count else installment_count end,
        occurred_on=case when v_start is not null then public.installment_calendar_date(v_start,0,v_day) else occurred_on end,
        first_installment_month=case when v_start is not null then to_char(v_start,'YYYY-MM') else first_installment_month end,
        updated_at=now() where id=v_group and user_id=v_user;
    end if;
  end if;
  v_result:=public.installment_plan_snapshot(v_group,v_user)||jsonb_build_object('success',true);
  insert into public.installment_plan_requests(user_id,request_id,request_hash,result) values(v_user,p_request_id,v_hash,v_result);
  return v_result;
end $$;
revoke all on function public.mutate_installment_plan(uuid,text,uuid,text,uuid,jsonb,boolean) from public,anon;
grant execute on function public.mutate_installment_plan(uuid,text,uuid,text,uuid,jsonb,boolean) to authenticated;
commit;

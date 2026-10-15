-- INF-03 / BE-06. Aditiva: no reprocesa mensajes de la versión anterior.
begin;
set local lock_timeout = '5s';

do $$ begin
  if exists(select 1 from public.draft_groups where status='open' group by user_id having count(*)>1) then
    raise exception 'QUEUE_DUPLICATE_OPEN_GROUPS: revisar sin eliminar pendientes';
  end if;
end $$;
create unique index draft_groups_one_open_per_user on public.draft_groups(user_id) where status='open';
alter table public.draft_items drop constraint draft_items_position_check;
alter table public.draft_items add constraint draft_items_position_check check(position>=1);
alter table public.draft_items add column source_operation_index integer;
alter table public.draft_items add column legacy_transaction_id uuid unique;
alter table public.draft_items add constraint draft_items_legacy_owner_fkey foreign key(legacy_transaction_id,user_id)
  references public.transactions(id,user_id) on delete set null (legacy_transaction_id);
create unique index draft_items_message_operation on public.draft_items(wa_message_id,source_operation_index)
  where wa_message_id is not null and source_operation_index is not null;

alter table public.whatsapp_message_queue drop constraint whatsapp_message_queue_status_check;
alter table public.whatsapp_message_queue add constraint whatsapp_message_queue_status_check
  check(status in ('pending','processing','processed','failed','waiting'));
alter table public.whatsapp_message_queue
  add column queue_version integer not null default 1,
  add column enqueue_order bigint generated always as identity,
  add column parsed_result jsonb,
  add column effect_applied boolean not null default false,
  add column reply_text text,
  add column reply_sent_at timestamptz,
  add column pause_reason text,
  add column confirmation_group_id uuid,
  add column confirmation_version integer;
create index wa_queue_v2_order on public.whatsapp_message_queue(wa_id,enqueue_order) where queue_version=2 and status<>'processed';

create table public.whatsapp_worker_state(
  wa_id text primary key,
  lease_token uuid,
  lease_until timestamptz,
  user_id uuid references auth.users(id) on delete set null,
  last_received_at timestamptz not null default clock_timestamp(),
  summary_pending boolean not null default false,
  shown_group_id uuid,
  shown_version integer,
  shown_at timestamptz
);
create table public.whatsapp_user_leases(
  user_id uuid primary key references auth.users(id) on delete cascade,
  lease_token uuid not null,
  lease_until timestamptz not null
);
create table public.whatsapp_queue_control(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.whatsapp_queue_control(singleton) values(true);
create function public.guard_open_whatsapp_draft() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='pending' and (select enabled from public.whatsapp_queue_control where singleton) then
    perform 1 from public.draft_groups where id=new.group_id and user_id=new.user_id and status='open' for update;
    if not found then raise exception 'QUEUE_GROUP_CLOSED'; end if;
    if (select count(*) from public.draft_items where group_id=new.group_id and status='pending' and id<>new.id)>=20 then
      raise exception 'QUEUE_GROUP_CAPACITY';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_open_whatsapp_draft() from public,anon,authenticated;
create trigger tr_guard_open_whatsapp_draft before insert or update on public.draft_items
  for each row execute function public.guard_open_whatsapp_draft();
alter table public.whatsapp_worker_state enable row level security;
alter table public.whatsapp_user_leases enable row level security;
alter table public.whatsapp_queue_control enable row level security;
revoke all on public.whatsapp_worker_state,public.whatsapp_user_leases,public.whatsapp_queue_control from public,anon,authenticated;
grant all on public.whatsapp_worker_state,public.whatsapp_user_leases,public.whatsapp_queue_control to service_role;

-- Invocar explícitamente durante el corte, después de drenar la versión vieja.
-- No ejecuta/guarda propuestas, las traslada a una lista que exige nuevo resumen.
create function public.migrate_whatsapp_legacy_proposals() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare t public.transactions; g public.draft_groups; pos integer; migrated integer:=0;
begin
  if (select enabled from public.whatsapp_queue_control where singleton)
    or exists(select 1 from public.inbound_events where status='processing' and processed_at is null) then raise exception 'QUEUE_CUTOVER_NOT_QUIET'; end if;
  for t in select * from public.transactions where status='pending' and source in ('text','audio','image') order by user_id,created_at,id for update loop
    if t.amount_ars is null or t.amount_ars<=0 or t.occurred_on is null then raise exception 'QUEUE_LEGACY_PROPOSAL_REVIEW_REQUIRED'; end if;
    select * into g from public.draft_groups where user_id=t.user_id and status='open' for update;
    if (select count(*) from public.draft_items where group_id=g.id and status='pending')>=20 then raise exception 'QUEUE_LEGACY_CAPACITY_REVIEW_REQUIRED'; end if;
    if g.id is null then insert into public.draft_groups(user_id,last_activity_at) values(t.user_id,t.created_at) returning * into g; end if;
    select coalesce(max(position),0)+1 into pos from public.draft_items where group_id=g.id;
    insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,occurred_on,category_id,installments,first_installment_month,
      confidence,source,wa_message_id,source_operation_index,legacy_transaction_id)
      values(g.id,t.user_id,pos,t.kind,t.description,t.amount_ars,t.currency,t.occurred_on,t.category_id,t.installment_count,t.first_installment_month,
        t.confidence,t.source,'legacy:'||t.id,1,t.id);
    update public.transactions set status='cancelled',updated_at=clock_timestamp() where id=t.id and status='pending';
    update public.draft_groups set version=version+1 where id=g.id;
    migrated:=migrated+1;
  end loop;
  return migrated;
end $$;
revoke all on function public.migrate_whatsapp_legacy_proposals() from public,anon,authenticated,service_role;

create function public.enqueue_whatsapp_messages(p_messages jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m jsonb; s public.whatsapp_worker_state; u uuid; g uuid; v integer; inserted_id uuid; actors text[]:='{}';
begin
  if not (select enabled from public.whatsapp_queue_control where singleton) then
    raise exception 'QUEUE_DISABLED';
  end if;
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>100 then raise exception 'QUEUE_INVALID_PAYLOAD'; end if;
  -- Adquirir siempre los actores en el mismo orden: evita deadlocks entre payloads.
  for m in select value from jsonb_array_elements(p_messages) order by value->>'from' loop
    if coalesce(m->>'id','')='' or coalesce(m->>'from','')='' or coalesce(m->>'type','')='' then raise exception 'QUEUE_INVALID_MESSAGE'; end if;
    insert into public.whatsapp_worker_state(wa_id) values(m->>'from') on conflict do nothing;
    perform 1 from public.whatsapp_worker_state where wa_id=m->>'from' for update;
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    select * into s from public.whatsapp_worker_state where wa_id=m->>'from';
    select user_id into u from public.whatsapp_links where wa_id=m->>'from' and status='active';
    g:=null; v:=null;
    -- Un CONFIRMAR demorado por Meta no puede aprovechar un resumen que todavía
    -- no existía cuando el cliente lo envió. Ante timestamps ambiguos, pedir otro.
    if not s.summary_pending and coalesce(m->>'timestamp','') ~ '^[0-9]{1,12}$'
      and to_timestamp((m->>'timestamp')::double precision)>s.shown_at
      and not exists(select 1 from public.whatsapp_message_queue q
      where q.wa_id=s.wa_id and q.queue_version=2 and q.status not in ('processed','waiting')) then
      select id,version into g,v from public.draft_groups where id=s.shown_group_id and user_id=u
        and version=s.shown_version and status='open';
    end if;
    insert into public.inbound_events(wa_message_id,wa_id,status) values(m->>'id',m->>'from','queued')
      on conflict(wa_message_id) do nothing returning id into inserted_id;
    if inserted_id is null then continue; end if;
    insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,confirmation_group_id,confirmation_version)
      values(m->>'id',m->>'from',u,m,2,g,v);
    update public.whatsapp_worker_state set last_received_at=clock_timestamp() where wa_id=m->>'from';
    actors:=array_append(actors,m->>'from');
  end loop;
  return jsonb_build_object('actors',to_jsonb(actors));
end $$;

create function public.claim_whatsapp_actor(p_wa_id text,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.whatsapp_worker_state; u uuid; acquired uuid;
begin
  if not (select enabled from public.whatsapp_queue_control where singleton) then return false; end if;
  select * into s from public.whatsapp_worker_state where wa_id=p_wa_id for update;
  if not found or (s.lease_until>clock_timestamp() and s.lease_token is distinct from p_token) then return false; end if;
  select user_id into u from public.whatsapp_links where wa_id=p_wa_id and status='active';
  if u is not null then
    insert into public.whatsapp_user_leases(user_id,lease_token,lease_until) values(u,p_token,clock_timestamp()+interval '90 seconds')
    on conflict(user_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until
    where whatsapp_user_leases.lease_until<=clock_timestamp() or whatsapp_user_leases.lease_token=p_token
    returning lease_token into acquired;
    if acquired is null then return false; end if;
  end if;
  update public.whatsapp_worker_state set lease_token=p_token,lease_until=clock_timestamp()+interval '90 seconds',user_id=u where wa_id=p_wa_id;
  return true;
end $$;

create function public.assert_whatsapp_lease(p_wa_id text,p_token uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.whatsapp_worker_state; current_owner uuid;
begin
  select * into s from public.whatsapp_worker_state where wa_id=p_wa_id for update;
  if not found or s.lease_token is distinct from p_token or not(s.lease_until>clock_timestamp()) then raise exception 'QUEUE_LEASE_LOST'; end if;
  if s.user_id is not null then
    perform 1 from public.whatsapp_user_leases where user_id=s.user_id and lease_token=p_token and lease_until>clock_timestamp() for update;
    if not found then raise exception 'QUEUE_USER_LEASE_LOST'; end if;
    select user_id into current_owner from public.whatsapp_links where wa_id=p_wa_id and status='active';
    if current_owner is distinct from s.user_id then raise exception 'QUEUE_LINK_CHANGED'; end if;
  end if;
  return s.user_id;
end $$;

create function public.next_whatsapp_job(p_wa_id text,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue; waiting boolean;
begin
  perform public.assert_whatsapp_lease(p_wa_id,p_token);
  select exists(select 1 from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status='waiting') into waiting;
  select * into q from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status<>'processed' and status<>'waiting'
    and (not waiting or btrim(payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )')
    order by enqueue_order limit 1 for update;
  if not found or q.scheduled_for>clock_timestamp() then return null; end if;
  if q.attempts>=5 and not q.effect_applied then
    update public.whatsapp_message_queue set effect_applied=true,pause_reason='manual_review',reply_text='No pude procesar uno de tus mensajes después de varios intentos. Quedó conservado para revisión; no lo di por cargado. Contactá a soporte o respondé CANCELAR para descartar el lote.' where id=q.id;
  end if;
  update public.whatsapp_message_queue set status='processing',attempts=attempts+1 where id=q.id returning * into q;
  return to_jsonb(q);
end $$;

create function public.checkpoint_whatsapp_job(p_id uuid,p_token uuid,p_result jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  perform public.assert_whatsapp_lease(q.wa_id,p_token);
  update public.whatsapp_message_queue set parsed_result=p_result where id=p_id and not effect_applied;
end $$;

create function public.apply_whatsapp_job(p_id uuid,p_token uuid,p_action jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue; u uuid; g public.draft_groups; item jsonb; n integer; pos integer; idx integer:=0;
  category uuid; reply text; action text:=p_action->>'kind'; outcome jsonb; target integer; affected integer; valid_account boolean;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  u:=public.assert_whatsapp_lease(q.wa_id,p_token);
  select * into q from public.whatsapp_message_queue where id=p_id for update;
  if q.effect_applied then return to_jsonb(q); end if;
  if q.status<>'processing' or q.queue_version<>2 then raise exception 'QUEUE_INVALID_STATE'; end if;
  if action='reply' then
    reply:=p_action->>'text';
    if coalesce((p_action->>'clear_summary')::boolean,false) then
      update public.whatsapp_worker_state set summary_pending=false,shown_group_id=null,shown_version=null where wa_id=q.wa_id;
    end if;
  elsif action='link' then
    -- La vinculación se aplica una sola vez junto al checkpoint del mensaje.
    select user_id into u from public.whatsapp_links where link_code_hash=p_action->>'hash' and link_code_expires_at>clock_timestamp() for update;
    if u is null then reply:='El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.';
    else
      -- No cambiar un usuario mientras otro trabajador tenga una concesión activa.
      perform 1 from public.whatsapp_user_leases where user_id=u and lease_until>clock_timestamp() and lease_token<>p_token for update;
      if found then raise exception 'QUEUE_LINK_BUSY'; end if;
      update public.whatsapp_links set wa_id=null,status='pending' where wa_id=q.wa_id and user_id<>u;
      update public.profiles set phone_number=null where phone_number=q.wa_id and id<>u;
      update public.whatsapp_links set wa_id=q.wa_id,status='active',linked_at=clock_timestamp(),link_code_hash=null,link_code_expires_at=null where user_id=u;
      update public.profiles set phone_number=q.wa_id where id=u;
      reply:='¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅';
    end if;
  else
    if q.user_id is not null and q.user_id is distinct from u then raise exception 'QUEUE_LINK_CHANGED'; end if;
    select role='admin' or (role='client' and subscription_status='active' and (subscription_until is null or subscription_until>clock_timestamp()))
      into valid_account from public.profiles where id=u for share;
    if u is null or valid_account is distinct from true then raise exception 'QUEUE_ACCOUNT_UNAVAILABLE'; end if;
    select * into g from public.draft_groups where user_id=u and status='open' for update;
    if g.id is not null and g.last_activity_at<clock_timestamp()-interval '24 hours' and action not in ('resume','discard') then
      update public.whatsapp_message_queue set pause_reason='stale' where id=q.id;
      update public.whatsapp_worker_state set summary_pending=true where wa_id=q.wa_id;
      reply:='Tenés una lista de hace más de 24 horas. Respondé RETOMAR o DESCARTAR. Conservé este mensaje para procesarlo después.';
    elsif action='resume' or action='discard' then
      if g.id is not null then
        if action='discard' then perform public.discard_draft_group(g.id,u);
        else update public.draft_groups set last_activity_at=clock_timestamp() where id=g.id; end if;
      end if;
      update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null
        where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='stale';
      reply:=case when action='resume' then 'Retomamos tu lista. Voy a procesar los mensajes que quedaron en espera.' else 'Lista anterior descartada. Voy a procesar los mensajes que quedaron en espera.' end;
      update public.whatsapp_worker_state set summary_pending=true,shown_version=null where wa_id=q.wa_id;
    elsif action='confirm' then
      if g.id is null then reply:='No tenés movimientos pendientes para guardar.';
      elsif q.confirmation_group_id is distinct from g.id or q.confirmation_version is distinct from g.version then
        reply:='La lista cambió o había mensajes en procesamiento. Revisá el próximo resumen y respondé CONFIRMAR nuevamente.';
        update public.whatsapp_worker_state set summary_pending=true where wa_id=q.wa_id;
      else
        outcome:=public.confirm_draft_group(g.id,u,q.confirmation_version);
        reply:=case when (outcome->>'success')::boolean then '¡Listo! Se guardaron '||(outcome->>'confirmed_movements')||' movimientos en tu cuenta de Pesito ✅💰'
          else 'No pudimos guardar: '||(outcome->>'error') end;
        if (outcome->>'success')::boolean then
          update public.whatsapp_worker_state set summary_pending=false,shown_group_id=null,shown_version=null where wa_id=q.wa_id;
          update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null
            where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='capacity';
        end if;
      end if;
    elsif action='cancel' then
      if g.id is not null then perform public.discard_draft_group(g.id,u); end if;
      update public.transactions set status='cancelled' where user_id=u and status='pending';
      -- CANCELAR también descarta explícitamente los mensajes retenidos del lote.
      update public.whatsapp_message_queue set status='processed',processed_at=clock_timestamp() where wa_id=q.wa_id and queue_version=2 and status='waiting';
      update public.whatsapp_worker_state set summary_pending=false,shown_group_id=null,shown_version=null where wa_id=q.wa_id;
      reply:='Se descartaron los movimientos pendientes 🗑️.';
    elsif action='summary' then
      update public.whatsapp_worker_state set summary_pending=true where wa_id=q.wa_id;
    elsif action in ('remove','edit') then
      target:=(p_action->>'position')::integer;
      if action='remove' then
        update public.draft_items set status='removed',updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
      else
        update public.draft_items set amount=coalesce((p_action->>'amount')::numeric,amount),description=coalesce(nullif(p_action->>'description',''),description),updated_at=clock_timestamp()
          where group_id=g.id and user_id=u and position=target and status='pending';
      end if;
      get diagnostics affected=row_count;
      if affected<>1 then reply:='No encontré ese movimiento en tu lista pendiente.';
      else
        update public.draft_groups set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp() where id=g.id;
        update public.whatsapp_worker_state set summary_pending=true,shown_version=null where wa_id=q.wa_id;
        update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null
          where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='capacity';
      end if;
    elsif action='add' then
      n:=jsonb_array_length(p_action->'items');
      if n<1 then raise exception 'QUEUE_EMPTY_EXTRACTION'; end if;
      if n>20 or n+(select count(*) from public.draft_items where group_id=g.id and status='pending')>20 then
        update public.whatsapp_message_queue set pause_reason='capacity' where id=q.id;
        reply:='El lote admite 20 movimientos. No agregué parcialmente este mensaje: quedó en espera. Quitá movimientos o confirmá los actuales; si este mensaje tiene más de 20, cancelá y dividilo en mensajes más pequeños.';
      else
        if g.id is null then insert into public.draft_groups(user_id) values(u) returning * into g; end if;
        select coalesce(max(position),0) into pos from public.draft_items where group_id=g.id;
        for item in select value from jsonb_array_elements(p_action->'items') loop
          idx:=idx+1; pos:=pos+1; category:=null;
          select id into category from public.categories where user_id=u and kind=(item->>'kind')::public.transaction_kind
            and lower(name)=lower(coalesce(item->>'category','Otros')) limit 1;
          if category is null then select id into category from public.categories where user_id=u and kind=(item->>'kind')::public.transaction_kind and name='Otros' limit 1; end if;
          insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,occurred_on,category_id,installments,first_installment_month,confidence,source,wa_message_id,source_operation_index,missing_fields)
          values(g.id,u,pos,(item->>'kind')::public.transaction_kind,item->>'description',(item->>'totalAmountArs')::numeric,coalesce(item->>'currency','ARS'),
            coalesce((item->>'occurredOn')::date,(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date),category,
            coalesce((item->>'installments')::integer,1),item->>'firstInstallmentMonth',coalesce((item->>'confidence')::numeric,1),q.payload->>'type',q.wa_message_id,idx,
            array(select jsonb_array_elements_text(coalesce(item->'missingFields','[]'::jsonb))));
        end loop;
        update public.draft_groups set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp() where id=g.id;
        update public.whatsapp_worker_state set summary_pending=true,shown_group_id=null,shown_version=null where wa_id=q.wa_id;
      end if;
    else raise exception 'QUEUE_INVALID_ACTION'; end if;
  end if;
  update public.whatsapp_message_queue set effect_applied=true,reply_text=reply,error_message=null where id=q.id returning * into q;
  return to_jsonb(q);
end $$;

create function public.finish_whatsapp_job(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  perform public.assert_whatsapp_lease(q.wa_id,p_token);
  if not q.effect_applied then raise exception 'QUEUE_NO_EFFECT'; end if;
  update public.whatsapp_message_queue set status=case when pause_reason is null then 'processed' else 'waiting' end,
    processed_at=case when pause_reason is null then clock_timestamp() else null end,reply_sent_at=clock_timestamp() where id=p_id;
  update public.inbound_events set status=case when q.pause_reason is null then 'processed' else 'waiting' end,processed_at=clock_timestamp(),error_code=null where wa_message_id=q.wa_message_id;
end $$;

create function public.fail_whatsapp_job(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  perform public.assert_whatsapp_lease(q.wa_id,p_token);
  update public.whatsapp_message_queue set status='failed',scheduled_for=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(attempts,6))::integer)),error_message='QUEUE_RETRY_REQUIRED' where id=p_id;
  update public.inbound_events set status='failed',error_code='QUEUE_RETRY_REQUIRED' where wa_message_id=q.wa_message_id;
end $$;

create function public.whatsapp_summary_snapshot(p_wa_id text,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid; s public.whatsapp_worker_state;
begin
  u:=public.assert_whatsapp_lease(p_wa_id,p_token);
  select * into s from public.whatsapp_worker_state where wa_id=p_wa_id;
  if not s.summary_pending or s.last_received_at>clock_timestamp()-interval '3 seconds'
    or exists(select 1 from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status not in ('processed','waiting')) then return null; end if;
  if u is null or not exists(select 1 from public.profiles where id=u and (role='admin' or (role='client' and subscription_status='active' and (subscription_until is null or subscription_until>clock_timestamp())))) then return null; end if;
  if exists(select 1 from public.app_settings where user_id=u and not whatsapp_responses_enabled)
    or (exists(select 1 from public.system_config where key='bot_active' and value='false') and not exists(select 1 from public.profiles where id=u and role='admin')) then return null; end if;
  return public.get_active_draft_group(u);
end $$;

create function public.mark_whatsapp_summary_sent(p_wa_id text,p_token uuid,p_group_id uuid,p_version integer) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.assert_whatsapp_lease(p_wa_id,p_token);
  update public.whatsapp_worker_state set summary_pending=false,shown_group_id=p_group_id,shown_version=p_version,shown_at=clock_timestamp()
    where wa_id=p_wa_id and not exists(select 1 from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status not in ('processed','waiting'))
    and (p_group_id is null or exists(select 1 from public.draft_groups where id=p_group_id and version=p_version and status='open'));
end $$;

create function public.release_whatsapp_actor(p_wa_id text,p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.whatsapp_worker_state set lease_until=clock_timestamp() where wa_id=p_wa_id and lease_token=p_token;
  update public.whatsapp_user_leases set lease_until=clock_timestamp() where lease_token=p_token;
end $$;

create function public.due_whatsapp_actors() returns setof text
language sql security definer set search_path=pg_catalog,public as $$
  select s.wa_id from public.whatsapp_worker_state s
  left join lateral (
    select q.id,q.scheduled_for from public.whatsapp_message_queue q where q.wa_id=s.wa_id and q.queue_version=2 and q.status not in ('processed','waiting')
      and (not exists(select 1 from public.whatsapp_message_queue w where w.wa_id=s.wa_id and w.queue_version=2 and w.status='waiting')
        or btrim(q.payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )')
    order by q.enqueue_order limit 1
  ) head on true
  where (s.lease_until is null or s.lease_until<=clock_timestamp())
    and ((head.id is not null and head.scheduled_for<=clock_timestamp())
      or (head.id is null and s.summary_pending and s.last_received_at<=clock_timestamp()-interval '3 seconds'))
    and (select enabled from public.whatsapp_queue_control where singleton)
    order by s.last_received_at limit 20
$$;

-- Todas las RPC nuevas son internas: ninguna concede ejecución a clientes.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('enqueue_whatsapp_messages','claim_whatsapp_actor','assert_whatsapp_lease','next_whatsapp_job','checkpoint_whatsapp_job','apply_whatsapp_job',
     'finish_whatsapp_job','fail_whatsapp_job','whatsapp_summary_snapshot','mark_whatsapp_summary_sent','release_whatsapp_actor','due_whatsapp_actors') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;

-- Alta PWA idempotente y recuperación/cancelación de envíos inciertos.
-- No cambia movimientos existentes ni las RPC de edición de cuotas de 029.
begin;
create table public.pwa_entry_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  entry_type text not null check (entry_type in ('movement','plan')),
  state text not null check (state in ('saved','cancelled')),
  payload_hash text,
  entity_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id,request_id),
  check ((state='saved' and payload_hash is not null and entity_id is not null)
    or (state='cancelled' and payload_hash is null and entity_id is null))
);
-- entity_id es una lápida intencional: borrar el movimiento no borra su deduplicación.
alter table public.pwa_entry_requests enable row level security;
revoke all on public.pwa_entry_requests from public,anon,authenticated;

create function public.submit_pwa_entry(
 p_request_id uuid,p_entry_type text,p_payload jsonb default '{}'::jsonb,p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_user uuid:=auth.uid(); v_profile public.profiles%rowtype;
 v_receipt public.pwa_entry_requests%rowtype; v_hash text; v_id uuid; v_plan jsonb;
 v_kind public.transaction_kind; v_description text; v_amount numeric; v_currency text;
 v_date date; v_category uuid; v_key text; v_replayed boolean:=false; v_state text;
begin
 if v_user is null then raise exception 'Necesitás una cuenta activa.' using errcode='42501';end if;
 select * into v_profile from public.profiles where id=v_user for share;
 if not found or not (v_profile.role='admin' or (v_profile.role='client' and v_profile.subscription_status='active'
   and (v_profile.subscription_until is null or v_profile.subscription_until>now()))) then
   raise exception 'Necesitás una cuenta activa.' using errcode='42501';
 end if;
 if p_request_id is null or p_entry_type is null or p_entry_type not in ('movement','plan')
   or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_cancel is null
   or (p_cancel and p_payload<>'{}'::jsonb) then
   raise exception 'Envío inválido.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pwa-entry:'||v_user::text||':'||p_request_id::text,30));
 select * into v_receipt from public.pwa_entry_requests where user_id=v_user and request_id=p_request_id;
 if found then
   v_replayed:=true;
   if v_receipt.state='cancelled' then
     return jsonb_build_object('state','cancelled','entity_id',null,'entry_type',v_receipt.entry_type,'replayed',true);
   end if;
   if not p_cancel and (v_receipt.entry_type<>p_entry_type or v_receipt.payload_hash<>md5(p_payload::text)) then
     raise exception 'El intento corresponde a otros datos.' using errcode='22023';
   end if;
   v_id:=v_receipt.entity_id;
 else
   if p_cancel then
     insert into public.pwa_entry_requests(user_id,request_id,entry_type,state)
     values(v_user,p_request_id,p_entry_type,'cancelled');
     return jsonb_build_object('state','cancelled','entity_id',null,'entry_type',p_entry_type,'replayed',false);
   end if;
   v_hash:=md5(p_payload::text);
   if p_entry_type='plan' then
     v_plan:=public.mutate_installment_plan(p_request_id,'create',null,null,null,p_payload,true);
     v_id:=(v_plan->>'group_id')::uuid;
   else
     for v_key in select jsonb_object_keys(p_payload) loop
       if v_key not in ('kind','description','amount','currency','occurred_on','category_id') then
         raise exception 'Campo inválido.' using errcode='22023';
       end if;
     end loop;
     if coalesce(p_payload->>'kind','') not in ('expense','income') then
       raise exception 'Tipo inválido.' using errcode='22023';
     end if;
     v_kind:=(p_payload->>'kind')::public.transaction_kind;
     v_description:=trim(p_payload->>'description');v_amount:=(p_payload->>'amount')::numeric;
     v_currency:=p_payload->>'currency';v_date:=(p_payload->>'occurred_on')::date;v_category:=(p_payload->>'category_id')::uuid;
     if v_description is null or length(v_description) not between 1 and 160 or v_amount is null
       or not(v_amount>0 and v_amount<=999999999999.99) or v_amount<>round(v_amount,2)
       or v_currency is null or v_currency not in ('ARS','USD') or v_date is null or not isfinite(v_date) then
       raise exception 'Revisá descripción, importe, moneda y fecha.' using errcode='22023';
     end if;
     if not exists(select 1 from public.categories where id=v_category and user_id=v_user and kind=v_kind and active) then
       raise exception 'Elegí una categoría propia y activa del tipo indicado.' using errcode='42501';
     end if;
     insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,category_id,status,source,confirmed_at)
     values(v_user,v_kind,v_description,v_amount,v_currency,v_date,v_category,'confirmed','pwa',now()) returning id into v_id;
   end if;
   insert into public.pwa_entry_requests(user_id,request_id,entry_type,state,payload_hash,entity_id)
   values(v_user,p_request_id,p_entry_type,'saved',v_hash,v_id);
 end if;
 -- Un envío reintentado nunca recrea una compra que luego fue eliminada.
 v_state:=case when exists(select 1 from public.transactions where user_id=v_user and status='confirmed'
    and (id=v_id or (v_receipt.entry_type='plan' or p_entry_type='plan') and installment_group_id=v_id)) then 'saved' else 'removed' end;
 return jsonb_build_object('state',v_state,'entity_id',v_id,'entry_type',coalesce(v_receipt.entry_type,p_entry_type),'replayed',v_replayed);
end $$;
revoke all on function public.submit_pwa_entry(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.submit_pwa_entry(uuid,text,jsonb,boolean) to authenticated;
commit;
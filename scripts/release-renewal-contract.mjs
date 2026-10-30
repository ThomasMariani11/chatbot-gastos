// Solo se invoca mediante el adaptador del stack descartable, nunca contra Supabase alojado.
export async function smokeRenewalContract(sql, id, { transaction = true } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Identidad de fixture inválida.');
  await sql(`${transaction ? 'begin;' : ''}
    update public.whatsapp_queue_control set enabled=true;
    update public.whatsapp_ops_config set verified_test_sender_digits='1555'||repeat('0',7);
    update public.whatsapp_links set wa_id='synthetic-release-renewal',status='active',linked_at=clock_timestamp() where user_id='${id}';
    insert into public.invitation_codes(code,duration_days)values('RELEASE-PAYMENT-ADMIN',30);
    insert into auth.users(id,email,raw_user_meta_data)values('43000000-0000-4000-8000-000000000099','payment-admin@example.invalid','{"invitation_code":"RELEASE-PAYMENT-ADMIN"}');
    -- Fixture nueva del stack local: no depende de promover un perfil mediante UPDATE,
    -- operación que las guardas de producción correctamente impiden.
    delete from public.profiles where id='43000000-0000-4000-8000-000000000099';
    insert into public.profiles(id,email,role,subscription_status,subscription_until)
      values('43000000-0000-4000-8000-000000000099','payment-admin@example.invalid','admin','active',null);
    do $$declare j jsonb;r jsonb;req uuid;code text;token uuid:=gen_random_uuid();n jsonb;before_until timestamptz;begin
      select subscription_until into before_until from public.profiles where id='${id}';
      for i in 1..2 loop
        perform public.enqueue_whatsapp_messages(jsonb_build_array(jsonb_build_object('id','release-renewal-'||i,'from','synthetic-release-renewal','type','text','text',jsonb_build_object('body','RENOVAR'),'timestamp',floor(extract(epoch from clock_timestamp()))::text)));
        if not public.claim_whatsapp_actor('synthetic-release-renewal',token) then raise exception 'RENEWAL_LEASE_MISSING';end if;
        j:=public.next_whatsapp_job('synthetic-release-renewal',token);
        perform public.apply_whatsapp_job((j->>'id')::uuid,token,'{"kind":"renewal_request"}');
        perform public.finish_whatsapp_job((j->>'id')::uuid,token);
      end loop;
      if (select count(*) from public.subscription_renewal_requests where user_id='${id}')<>1 then raise exception 'RENEWAL_REQUEST_DUPLICATED';end if;
      select id into req from public.subscription_renewal_requests where user_id='${id}';
      perform set_config('request.jwt.claim.sub','43000000-0000-4000-8000-000000000099',true);
      r:=public.admin_confirm_renewal_payment(req,30);
      if r->>'replayed' is distinct from 'false' then raise exception 'RENEWAL_PAYMENT_FAILED';end if;
      r:=public.admin_confirm_renewal_payment(req,30);
      if r->>'replayed' is distinct from 'true' then raise exception 'RENEWAL_PAYMENT_NOT_IDEMPOTENT';end if;
      if (select subscription_until from public.profiles where id='${id}') is distinct from before_until then raise exception 'RENEWAL_ACTIVATED_AT_ISSUANCE';end if;
      if (select count(*) from public.subscription_renewal_notices where request_id=req)<>1 then raise exception 'RENEWAL_NOTICE_DUPLICATED';end if;
      select c.code into code from public.invitation_codes c join public.subscription_renewal_requests x on x.code_id=c.id where x.id=req and c.renewal_user_id='${id}';
      if code is null then raise exception 'RENEWAL_RECIPIENT_NOT_BOUND';end if;
      n:=public.claim_subscription_renewal_notice(token);
      if n->>'to' is distinct from 'synthetic-release-renewal' or not public.authorize_subscription_renewal_notice((n->>'id')::uuid,token) then raise exception 'RENEWAL_DISPATCH_NOT_AUTHORIZED';end if;
      perform public.finish_subscription_renewal_notice((n->>'id')::uuid,token,'sent');
      perform set_config('request.jwt.claim.sub','${id}',true);
      r:=public.redeem_invitation_code(code,'${id}');
      if r->>'success' is distinct from 'true' then raise exception 'RENEWAL_REDEMPTION_FAILED';end if;
      r:=public.redeem_invitation_code(code,'${id}');
      if r->>'success' is distinct from 'false' then raise exception 'RENEWAL_REDEMPTION_REPEATED';end if;
      if (select subscription_until from public.profiles where id='${id}') is distinct from greatest(now(),before_until)+interval '30 days'
        or (select state from public.subscription_renewal_requests where id=req)<>'redeemed'
        or (select count(*) from public.subscription_renewal_notices where request_id=req)<>1 then raise exception 'RENEWAL_RESULT_MISMATCH';end if;
      if has_table_privilege('authenticated','public.subscription_renewal_requests','select')
        or has_table_privilege('service_role','public.subscription_renewal_notices','update')
        or has_function_privilege('authenticated','public.claim_subscription_renewal_notice(uuid)','execute')
        or has_function_privilege('service_role','public.register_subscription_renewal(uuid)','execute') then raise exception 'RENEWAL_PRIVATE_CONTRACT_EXPOSED';end if;
    end$$;
    ${transaction ? 'rollback;' : ''}`);
}

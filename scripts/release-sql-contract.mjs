// Solo invocado con el adaptador SQL del contenedor descartable del ensayo.
export async function smokeBusinessContract(sql, id, { transaction = true } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Identidad de fixture inválida.');
  await sql(`${transaction ? 'begin;' : ''}
    do $$begin
      if (select count(*) from information_schema.columns where table_schema='public' and
        ((table_name='invitation_codes' and column_name='expires_at') or
         (table_name='whatsapp_worker_state' and column_name in('link_attempts','link_locked_until','last_link_attempt_at'))))<>4 then
        raise exception 'RELEASE_MISSING_040_COLUMNS';end if;
      if not (select relrowsecurity from pg_class where oid='public.invitation_check_attempts'::regclass)
        or has_table_privilege('anon','public.invitation_check_attempts','select')
        or has_table_privilege('authenticated','public.invitation_check_attempts','select') then
        raise exception 'RELEASE_INVITATION_ATTEMPTS_EXPOSED';end if;
      if has_function_privilege('anon','public.apply_whatsapp_job(uuid,uuid,jsonb)','execute')
        or has_function_privilege('authenticated','public.confirm_draft_group(uuid,uuid,integer)','execute')
        or not has_function_privilege('service_role','public.fail_whatsapp_job(uuid,uuid)','execute') then
        raise exception 'RELEASE_RPC_ACL_CHANGED';end if;
    end$$;
    insert into public.invitation_codes(code,duration_days,expires_at)values('RELEASE-EXPIRED-FIXTURE',30,clock_timestamp()-interval '1 day');
    select set_config('request.jwt.claim.sub','${id}',true);
    do $$declare r jsonb;uid uuid:=gen_random_uuid();before_count integer;begin
      r:=public.check_invitation_code('RELEASE-EXPIRED-FIXTURE');
      if (r->>'valid')::boolean then raise exception 'RELEASE_EXPIRED_CHECK_ACCEPTED';end if;
      r:=public.redeem_invitation_code('RELEASE-EXPIRED-FIXTURE','${id}');
      if (r->>'success')::boolean then raise exception 'RELEASE_EXPIRED_REDEEM_ACCEPTED';end if;
      select count(*) into before_count from auth.users;
      begin
        insert into auth.users(id,email,raw_user_meta_data)values(uid,'expired-release@example.invalid','{"invitation_code":"RELEASE-EXPIRED-FIXTURE"}'::jsonb);
        raise exception 'RELEASE_EXPIRED_SIGNUP_ACCEPTED';
      exception when sqlstate 'P0001' then
        if SQLERRM<>'REGISTRATION_INITIALIZATION_FAILED' then raise;end if;
      end;
      if (select count(*) from auth.users)<>before_count or exists(select 1 from public.profiles where id=uid)
        or (select is_used from public.invitation_codes where code='RELEASE-EXPIRED-FIXTURE') then
        raise exception 'RELEASE_EXPIRED_SIGNUP_PARTIAL';end if;
      for i in 1..20 loop r:=public.check_invitation_code('RELEASE-EXPIRED-FIXTURE');end loop;
      if not exists(select 1 from public.invitation_check_attempts where locked_until>clock_timestamp()) then
        raise exception 'RELEASE_INVITATION_RATE_LIMIT_MISSING';end if;
    end$$;
    update public.whatsapp_queue_control set enabled=true;
    update public.whatsapp_links set wa_id='synthetic-release-link',status='active',link_code_hash=repeat('a',64),link_code_expires_at=clock_timestamp()+interval '5 minutes' where user_id='${id}';
    do $$declare j jsonb;r jsonb;token uuid:=gen_random_uuid();begin
      for i in 1..5 loop
        perform public.enqueue_whatsapp_messages(jsonb_build_array(jsonb_build_object('id','release-link-'||i,'from','synthetic-release-link','type','text','text',jsonb_build_object('body','fixture'))));
        if not public.claim_whatsapp_actor('synthetic-release-link',token) then raise exception 'RELEASE_LINK_LEASE_MISSING';end if;
        j:=public.next_whatsapp_job('synthetic-release-link',token);
        perform public.apply_whatsapp_job((j->>'id')::uuid,token,jsonb_build_object('kind','link','hash',repeat('b',64)));
        perform public.finish_whatsapp_job((j->>'id')::uuid,token);
      end loop;
      if not exists(select 1 from public.whatsapp_worker_state where wa_id='synthetic-release-link' and link_attempts=5 and link_locked_until>clock_timestamp()) then
        raise exception 'RELEASE_LINK_LOCK_MISSING';end if;
      perform public.enqueue_whatsapp_messages('[{"id":"release-link-blocked","from":"synthetic-release-link","type":"text","text":{"body":"fixture"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-link',token);
      perform public.apply_whatsapp_job((j->>'id')::uuid,token,jsonb_build_object('kind','link','hash',repeat('a',64)));
      perform public.finish_whatsapp_job((j->>'id')::uuid,token);
      if not exists(select 1 from public.whatsapp_links where user_id='${id}' and link_code_hash=repeat('a',64)) then
        raise exception 'RELEASE_BLOCKED_LINK_CONSUMED';end if;
      update public.whatsapp_worker_state set link_locked_until=clock_timestamp()-interval '1 second' where wa_id='synthetic-release-link';
      -- Un código vencido sigue rechazándose incluso después del desbloqueo.
      update public.whatsapp_links set link_code_expires_at=clock_timestamp()-interval '1 second' where user_id='${id}';
      perform public.enqueue_whatsapp_messages('[{"id":"release-link-expired","from":"synthetic-release-link","type":"text","text":{"body":"fixture"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-link',token);
      perform public.apply_whatsapp_job((j->>'id')::uuid,token,jsonb_build_object('kind','link','hash',repeat('a',64)));
      perform public.finish_whatsapp_job((j->>'id')::uuid,token);
      if not exists(select 1 from public.whatsapp_links where user_id='${id}' and link_code_hash=repeat('a',64)) then raise exception 'RELEASE_EXPIRED_LINK_CONSUMED';end if;
      update public.whatsapp_links set link_code_expires_at=clock_timestamp()+interval '5 minutes' where user_id='${id}';
      perform public.enqueue_whatsapp_messages('[{"id":"release-link-valid","from":"synthetic-release-link","type":"text","text":{"body":"fixture"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-link',token);
      perform public.apply_whatsapp_job((j->>'id')::uuid,token,jsonb_build_object('kind','link','hash',repeat('a',64)));
      if not exists(select 1 from public.whatsapp_links where user_id='${id}' and status='active' and link_code_hash is null and wa_id='synthetic-release-link')
        or not exists(select 1 from public.profiles where id='${id}' and phone_number='synthetic-release-link')
        or not exists(select 1 from public.whatsapp_worker_state where wa_id='synthetic-release-link' and user_id='${id}' and link_attempts=0) then
        raise exception 'RELEASE_ATOMIC_LINK_MISMATCH';end if;
      perform public.finish_whatsapp_job((j->>'id')::uuid,token);
    end$$;
    do $$declare g uuid:=gen_random_uuid();r jsonb;before_count integer;begin
      select count(*) into before_count from public.transactions where user_id='${id}';
      insert into public.draft_groups(id,user_id,status)values(g,'${id}','open');
      insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,occurred_on,status,installments)
        values(g,'${id}',1,'expense','Release fixture',111,'ARS',current_date,'pending',1),
              (g,'${id}',2,'expense','Release fixture',222,'ARS',current_date,'pending',1);
      perform set_config('release.fixture_group',g::text,true);
      perform set_config('release.before_count',before_count::text,true);
    end$$;
    create function public.release_fail_transaction()returns trigger language plpgsql as $$begin
      if new.amount_ars=222 then raise exception 'PRIVATE_RELEASE_PERSISTENCE_CANARY';end if;return new;end$$;
    create trigger release_fail_transaction before insert on public.transactions for each row execute function public.release_fail_transaction();
    do $$declare r jsonb;g uuid:=current_setting('release.fixture_group')::uuid;begin
      r:=public.confirm_draft_group(g,'${id}');
      if (r->>'success')::boolean or r->>'error' not like '%problema técnico%'
        or r::text like '%PRIVATE_RELEASE%' or r::text like '%SQLERRM%'
        or (select count(*) from public.transactions where user_id='${id}')<>current_setting('release.before_count')::integer
        or (select count(*) from public.draft_items where group_id=g and status='pending')<>2 then
        raise exception 'RELEASE_CONFIRM_PARTIAL_OR_UNSAFE';end if;
    end$$;
    drop trigger release_fail_transaction on public.transactions;drop function public.release_fail_transaction();
    create function public.release_fail_discard()returns trigger language plpgsql as $$begin raise exception 'PRIVATE_RELEASE_DISCARD_CANARY';end$$;
    create trigger release_fail_discard before update on public.draft_groups for each row execute function public.release_fail_discard();
    do $$declare r jsonb;begin
      r:=public.discard_draft_group(current_setting('release.fixture_group')::uuid,'${id}');
      if (r->>'success')::boolean or r->>'error' not like '%error técnico%' or r::text like '%PRIVATE_RELEASE%' then
        raise exception 'RELEASE_DISCARD_UNSAFE';end if;
    end$$;
    drop trigger release_fail_discard on public.draft_groups;drop function public.release_fail_discard();
    ${transaction ? 'rollback;' : ''}`);
}

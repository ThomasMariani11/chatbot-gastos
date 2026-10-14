-- Primera etapa: publicar esta RPC y después actualizar la PWA.
-- No revoca todavía las escrituras de las versiones anteriores de la web.
begin;
set local lock_timeout = '5s';

create unique index whatsapp_links_code_hash_unique
  on public.whatsapp_links(link_code_hash) where link_code_hash is not null;

create function public.request_whatsapp_link_code()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_hash text;
  v_expires timestamptz;
  v_constraint text;
begin
  if v_user_id is null then
    raise exception 'Necesitás una sesión con acceso vigente para vincular WhatsApp.' using errcode = '42501';
  end if;

  -- Serializar solicitudes del mismo usuario sin cambiar campos del perfil.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'No se encontró el perfil de la sesión.' using errcode = '42501';
  end if;
  if not public.has_active_subscription() then
    raise exception 'Necesitás una sesión con acceso vigente para vincular WhatsApp.' using errcode = '42501';
  end if;
  v_expires := now() + interval '10 minutes';

  for attempt in 1..10 loop
    -- gen_random_uuid usa aleatoriedad criptográfica. Se conserva el código
    -- de seis dígitos compatible con el webhook, sin depender de pgcrypto.
    v_code := (100000 + (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 900000))::text;
    v_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
    if exists(select 1 from public.whatsapp_links where link_code_hash=v_hash) then continue; end if;
    begin
      insert into public.whatsapp_links(user_id, link_code_hash, link_code_expires_at)
      values (v_user_id, v_hash, v_expires)
      on conflict (user_id) do update set
        link_code_hash = excluded.link_code_hash,
        link_code_expires_at = excluded.link_code_expires_at;
      -- No activa un teléfono ni interrumpe un vínculo existente.
      return jsonb_build_object('code', v_code, 'expires_at', v_expires);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'whatsapp_links_code_hash_unique' then raise; end if;
    end;
  end loop;
  raise exception 'No pudimos generar el código. Intentá nuevamente.';
end;
$$;

revoke all on function public.request_whatsapp_link_code() from public, anon;
grant execute on function public.request_whatsapp_link_code() to authenticated;
commit;

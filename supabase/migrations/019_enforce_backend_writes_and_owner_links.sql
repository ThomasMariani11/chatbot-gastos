-- Segunda etapa: aplicar después de publicar y verificar la PWA con RPC 018.
begin;
set local lock_timeout = '5s';

-- No reparar ni eliminar silenciosamente relaciones históricas inválidas.
do $$
begin
  if exists(select 1 from public.draft_items i join public.draft_groups g on g.id=i.group_id where i.user_id<>g.user_id)
    or exists(select 1 from public.draft_items i join public.categories c on c.id=i.category_id where i.user_id<>c.user_id)
    or exists(select 1 from public.transactions t join public.categories c on c.id=t.category_id where t.user_id<>c.user_id)
    or exists(select 1 from public.transactions t join public.transactions p on p.id=t.installment_group_id where t.user_id<>p.user_id) then
    raise exception 'Hay relaciones entre propietarios distintos; revisar antes de aplicar 019.';
  end if;
end;
$$;

alter table public.draft_groups add constraint draft_groups_id_user_id_key unique(id,user_id);
alter table public.categories add constraint categories_id_user_id_key unique(id,user_id);
alter table public.transactions add constraint transactions_id_user_id_key unique(id,user_id);

alter table public.draft_items
  drop constraint draft_items_group_id_fkey,
  drop constraint draft_items_category_id_fkey,
  add constraint draft_items_group_owner_fkey foreign key(group_id,user_id)
    references public.draft_groups(id,user_id) on delete cascade,
  add constraint draft_items_category_owner_fkey foreign key(category_id,user_id)
    references public.categories(id,user_id) on delete set null (category_id);
alter table public.transactions
  drop constraint transactions_category_id_fkey,
  drop constraint transactions_installment_group_id_fkey,
  add constraint transactions_category_owner_fkey foreign key(category_id,user_id)
    references public.categories(id,user_id) on delete set null (category_id),
  add constraint transactions_installment_owner_fkey foreign key(installment_group_id,user_id)
    references public.transactions(id,user_id) on delete set null (installment_group_id);

revoke all on public.draft_groups, public.draft_items, public.whatsapp_message_queue, public.whatsapp_links
  from public, anon, authenticated;

-- REVOKE sobre la tabla no retira concesiones explícitas por columna.
do $$
declare
  v_table text;
  v_columns text;
begin
  foreach v_table in array array['draft_groups','draft_items','whatsapp_message_queue','whatsapp_links'] loop
    select string_agg(quote_ident(attname), ', ' order by attnum) into v_columns
    from pg_attribute where attrelid=('public.'||v_table)::regclass and attnum>0 and not attisdropped;
    execute format('revoke all (%s) on table public.%I from public, anon, authenticated',v_columns,v_table);
  end loop;
end;
$$;
grant select on public.draft_groups, public.draft_items, public.whatsapp_links to authenticated;
grant select, insert, update, delete on public.draft_groups, public.draft_items, public.whatsapp_message_queue, public.whatsapp_links to service_role;

alter table public.draft_groups enable row level security;
alter table public.draft_items enable row level security;
alter table public.whatsapp_message_queue enable row level security;
alter table public.whatsapp_links enable row level security;

drop policy "own draft groups modify" on public.draft_groups;
drop policy "own draft items modify" on public.draft_items;
drop policy "own wa queue modify" on public.whatsapp_message_queue;
drop policy "own wa queue select" on public.whatsapp_message_queue;
drop policy "own whatsapp link" on public.whatsapp_links;
create policy "own whatsapp link select" on public.whatsapp_links for select to authenticated using(auth.uid()=user_id);

-- phone_number es una copia del vínculo verificado, no un campo editable.
-- SECURITY INVOKER conserva el rol de quien escribió, incluso desde el backend.
create function public.protect_verified_profile_phone()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if new.phone_number is distinct from old.phone_number
    and current_user <> 'service_role'
    and current_user <> pg_get_userbyid((select relowner from pg_class where oid=TG_RELID)) then
    raise exception 'El teléfono solo puede cambiar tras verificar la vinculación.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_verified_profile_phone() from public, anon, authenticated;
create trigger tr_protect_verified_profile_phone before update of phone_number on public.profiles
for each row execute function public.protect_verified_profile_phone();

do $$
declare v_table text;
begin
  foreach v_table in array array['draft_groups','draft_items','whatsapp_message_queue','whatsapp_links'] loop
    if has_any_column_privilege('anon','public.'||v_table,'INSERT')
      or has_any_column_privilege('anon','public.'||v_table,'UPDATE')
      or has_any_column_privilege('authenticated','public.'||v_table,'INSERT')
      or has_any_column_privilege('authenticated','public.'||v_table,'UPDATE')
      or has_table_privilege('anon','public.'||v_table,'DELETE,TRUNCATE')
      or has_table_privilege('authenticated','public.'||v_table,'DELETE,TRUNCATE') then
      raise exception 'Quedan escrituras cliente permitidas en %.',v_table;
    end if;
  end loop;
end;
$$;
commit;

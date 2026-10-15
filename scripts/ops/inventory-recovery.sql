begin read only;
set local statement_timeout = '20s';
select jsonb_build_object(
 'postgres_version', current_setting('server_version'),
 'database_size_bytes',pg_database_size(current_database()),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname) from pg_extension),
 'public_tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'estimated_rows',c.reltuples::bigint) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'auth_user_count',(select count(*) from auth.users),
 'storage_bucket_count',(select count(*) from storage.buckets),
 'storage_object_count',(select count(*) from storage.objects),
 'vault_secret_count',(select count(*) from vault.secrets),
 'cron_extension_present',exists(select 1 from pg_extension where extname='pg_cron'),
 'realtime_public_tables',(select jsonb_agg(tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
 'auth_users_public_triggers',(select jsonb_agg(jsonb_build_object('trigger',t.tgname,'function',p.proname)) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname='public'),
 'auth_custom_trigger_count',(select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname='public'),
 'migration_versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as inventory;
rollback;

import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function prepareLocal(source, directory) {
  const target = resolve(directory);
  if (target === resolve(source) || !target.startsWith(resolve(source, '.temp') + sep) && !target.startsWith(resolve(process.env.TEMP || process.env.TMPDIR || '/tmp') + sep)) throw new Error('El workdir local debe ser descartable, fuera de supabase/ de producción.');
  try { await access(join(target, 'supabase/config.toml')); throw new Error('El workdir ya existe; no se sobrescribe una base local.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(join(target, 'supabase'), { recursive: true });
  await cp(join(source, 'ops/local/config.toml'), join(target, 'supabase/config.toml'));
  await cp(join(source, 'supabase/migrations'), join(target, 'supabase/migrations'), { recursive: true });
  await cp(join(source, 'supabase/functions'), join(target, 'supabase/functions'), { recursive: true });
  // 021/022 originales se instalan con la cola apagada. Esta migración solo existe localmente.
  await writeFile(join(target, 'supabase/migrations/99999999999999_local_only.sql'), `
    select cron.unschedule(jobid) from cron.job where jobname in ('pesito-whatsapp-queue-recovery','pesito-whatsapp-observability','pesito-whatsapp-retention');
    create or replace function public.dispatch_whatsapp_queue_recovery() returns bigint
    language plpgsql security definer set search_path=pg_catalog,public as $$
    begin raise exception 'LOCAL_EXTERNAL_DISPATCH_DISABLED'; end $$;
    update public.whatsapp_queue_control set enabled=false;`);
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  await prepareLocal(root, join(root, '.temp/local'));
  console.log('Workdir local preparado en .temp/local; todavía no se inició ningún servicio.');
}

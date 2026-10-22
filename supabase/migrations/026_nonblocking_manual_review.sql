-- Una revisión manual conserva el mensaje fallido sin bloquear nuevas cargas.
-- Las pausas stale/capacity (y las desconocidas) siguen requiriendo resolución.
-- CREATE OR REPLACE conserva propietario y ACL; no se reescriben filas ni se
-- reintentan mensajes en revisión. El cron normal atenderá los pendientes v2.
begin;
set local lock_timeout='5s';
create or replace function public.next_whatsapp_job(p_wa_id text,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue; waiting boolean;
begin
  perform public.assert_whatsapp_lease(p_wa_id,p_token);
  select exists(select 1 from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status='waiting' and pause_reason is distinct from 'manual_review') into waiting;
  select * into q from public.whatsapp_message_queue where wa_id=p_wa_id and queue_version=2 and status<>'processed' and status<>'waiting'
    and (not waiting or btrim(payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )')
    order by enqueue_order limit 1 for update;
  if not found or q.scheduled_for>clock_timestamp() then return null; end if;
  if q.attempts>=5 and not q.effect_applied then
    update public.whatsapp_message_queue set effect_applied=true,pause_reason='manual_review',reply_text='No pude procesar este mensaje y no lo cargué. Quedó conservado para revisión. Pasame el gasto o ingreso en texto, con el concepto y el monto. Podés seguir enviando otros movimientos; no hace falta cancelar tu lista.' where id=q.id;
  end if;
  update public.whatsapp_message_queue set status='processing',attempts=attempts+1 where id=q.id returning * into q;
  return to_jsonb(q);
end $$;

create or replace function public.due_whatsapp_actors() returns setof text
language sql security definer set search_path=pg_catalog,public as $$
  select s.wa_id from public.whatsapp_worker_state s
  left join lateral (
    select q.id,q.scheduled_for from public.whatsapp_message_queue q where q.wa_id=s.wa_id and q.queue_version=2 and q.status not in ('processed','waiting')
      and (not exists(select 1 from public.whatsapp_message_queue w where w.wa_id=s.wa_id and w.queue_version=2 and w.status='waiting' and w.pause_reason is distinct from 'manual_review')
        or btrim(q.payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )')
    order by q.enqueue_order limit 1
  ) head on true
  where (s.lease_until is null or s.lease_until<=clock_timestamp())
    and ((head.id is not null and head.scheduled_for<=clock_timestamp())
      or (head.id is null and s.summary_pending and s.last_received_at<=clock_timestamp()-interval '3 seconds'))
    and (select enabled from public.whatsapp_queue_control where singleton)
    order by s.last_received_at limit 20
$$;
commit;

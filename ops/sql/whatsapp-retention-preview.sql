-- INF-14. Estimación de solo lectura; NO llama a prune ni cambia retention_enabled.
-- Los resultados son conteos, sin textos, teléfonos, IDs ni comprobantes.
with policy as (
 select retention_enabled,retention_days,last_retention_at from public.whatsapp_ops_config where singleton
), candidates as (
 select q.id,q.processed_at,
 exists(select 1 from public.draft_items d join public.draft_groups g on g.id=d.group_id where d.wa_message_id=q.wa_message_id and (g.status='open' or d.status='pending')) as protected_draft,
 exists(select 1 from public.transactions t where t.user_id=q.user_id and t.status='pending' and (t.wa_message_id=q.wa_message_id or left(t.wa_message_id,length(q.wa_message_id)+1)=q.wa_message_id||':')) as protected_transaction
 from public.whatsapp_message_queue q cross join policy p
 where q.queue_version=2 and q.status='processed' and q.content_redacted_at is null
 and q.processed_at<statement_timestamp()-make_interval(days=>p.retention_days)
), eligible as (
 select id,processed_at from candidates where not protected_draft and not protected_transaction
)
select true as management_sql_ok,statement_timestamp() as estimated_at,
 (select retention_enabled from policy) as retention_enabled,
 (select retention_days from policy) as retention_days,
 (select last_retention_at from policy) as last_retention_at,
 (select count(*) from candidates) as old_completed_with_content,
 (select count(*) from candidates where protected_draft) as protected_by_draft,
 (select count(*) from candidates where protected_transaction) as protected_by_transaction,
 (select count(*) from eligible) as messages_eligible,
 (select count(*) from(select id from eligible order by processed_at limit 500)e) as messages_next_batch,
 (select min(processed_at) from eligible) as oldest_eligible_processed_at,
 (select count(*) from public.whatsapp_message_queue where queue_version=2 and status<>'processed') as unfinished_preserved,
 (select count(*) from public.whatsapp_message_queue where queue_version=1) as legacy_preserved,
 (select count(*) from public.whatsapp_ops_metrics where bucket<statement_timestamp()-interval '90 days') as metrics_eligible,
 (select count(*) from public.whatsapp_ops_notifications where state in('sent','cancelled') and finished_at<statement_timestamp()-interval '90 days') as notices_eligible,
 (select count(*) from public.whatsapp_ops_notifications where state not in('sent','cancelled')) as unresolved_notices_preserved,
 (select count(*) from public.ai_quota_reservations) as quota_receipts_preserved;

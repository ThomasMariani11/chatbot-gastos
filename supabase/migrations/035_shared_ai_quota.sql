-- INF-15: reservas globales diarias; sin contenido, reenvíos ni cargos.
begin;
set local lock_timeout='5s';
create table public.ai_quota_policy(
 lane text primary key check(lane in ('qwen','whisper')),
 daily_limit integer not null check(daily_limit between 1 and 10000),
 enabled boolean not null default true
);
insert into public.ai_quota_policy(lane,daily_limit) values('qwen',100),('whisper',200);
create table public.ai_quota_days(
 day date not null,lane text not null references public.ai_quota_policy(lane),
 reserved integer not null default 0 check(reserved>=0),primary key(day,lane)
);
create table public.ai_quota_reservations(
 job_id uuid not null references public.whatsapp_message_queue(id) on delete cascade,
 attempt integer not null check(attempt>=1),lane text not null references public.ai_quota_policy(lane),
 day date not null,reserved_at timestamptz not null default clock_timestamp(),primary key(job_id,attempt,lane)
);
create index ai_quota_reservation_day on public.ai_quota_reservations(day,lane);
alter table public.ai_quota_policy enable row level security;
alter table public.ai_quota_days enable row level security;
alter table public.ai_quota_reservations enable row level security;
revoke all on public.ai_quota_policy,public.ai_quota_days,public.ai_quota_reservations from public,anon,authenticated,service_role;
create function public.reserve_whatsapp_ai_quota(p_id uuid,p_token uuid,p_attempt integer,p_lane text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;u uuid;cfg public.ai_quota_policy;d date;n integer;valid_account boolean;
begin
 select * into q from public.whatsapp_message_queue where id=p_id;
 if not found then raise exception 'AI_QUOTA_JOB_UNAVAILABLE';end if;
 u:=public.assert_whatsapp_lease(q.wa_id,p_token);
 select * into q from public.whatsapp_message_queue where id=p_id for update;
 if q.queue_version<>2 or q.status<>'processing' or q.effect_applied or q.attempts is distinct from p_attempt or p_attempt is null or p_attempt<1
   or (q.user_id is not null and q.user_id is distinct from u) then raise exception 'AI_QUOTA_JOB_UNAVAILABLE';end if;
 select role='admin' or (role='client' and subscription_status='active' and (subscription_until is null or subscription_until>clock_timestamp())) into valid_account from public.profiles where id=u for share;
 if valid_account is distinct from true then raise exception 'AI_QUOTA_ACCOUNT_UNAVAILABLE';end if;
 -- No hay una ruta a Gemini habilitada en este perfil Free de beta.
 select * into cfg from public.ai_quota_policy where lane=p_lane for update;
 if not found or not cfg.enabled then return jsonb_build_object('allowed',false,'reason','provider_disabled');end if;
 d:=(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date;
 insert into public.ai_quota_days(day,lane)values(d,p_lane) on conflict do nothing;
 select reserved into n from public.ai_quota_days where day=d and lane=p_lane for update;
 if exists(select 1 from public.ai_quota_reservations where job_id=p_id and attempt=p_attempt and lane=p_lane) then
  return jsonb_build_object('allowed',false,'reason','already_reserved');end if;
 if n>=cfg.daily_limit then return jsonb_build_object('allowed',false,'reason','exhausted','used',n,'limit',cfg.daily_limit,'day',d);end if;
 insert into public.ai_quota_reservations(job_id,attempt,lane,day)values(p_id,p_attempt,p_lane,d);
 update public.ai_quota_days set reserved=reserved+1 where day=d and lane=p_lane returning reserved into n;
 return jsonb_build_object('allowed',true,'used',n,'limit',cfg.daily_limit,'day',d);
end $$;
revoke all on function public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text) to service_role;
create function public.whatsapp_ai_quota_dashboard() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date:=(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'AI_QUOTA_ADMIN_REQUIRED';end if;
 return jsonb_build_object('day',d,'resets_at',((d+1)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
 'lanes',(select jsonb_agg(jsonb_build_object('lane',p.lane,'used',coalesce(c.reserved,0),'limit',p.daily_limit,'enabled',p.enabled,
 'level',case when coalesce(c.reserved,0)>=p.daily_limit then 'exhausted' when coalesce(c.reserved,0)*100>=p.daily_limit*90 then 'critical' when coalesce(c.reserved,0)*100>=p.daily_limit*75 then 'warning' else 'ok' end) order by p.lane)
 from public.ai_quota_policy p left join public.ai_quota_days c on c.lane=p.lane and c.day=d));
end $$;
revoke all on function public.whatsapp_ai_quota_dashboard() from public,anon,service_role;
grant execute on function public.whatsapp_ai_quota_dashboard() to authenticated;
commit;

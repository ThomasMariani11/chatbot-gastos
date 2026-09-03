create extension if not exists pgcrypto;

create type public.transaction_kind as enum ('expense', 'income');
create type public.transaction_status as enum ('pending', 'confirmed', 'cancelled');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.transaction_kind not null,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#20b984',
  icon text not null default 'circle',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (date_trunc('month', month) = month),
  amount_ars numeric(14,2) not null check (amount_ars > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.transaction_kind not null,
  description text not null check (char_length(description) between 1 and 160),
  amount_ars numeric(14,2),
  occurred_on date,
  category_id uuid references public.categories(id) on delete set null,
  status public.transaction_status not null default 'pending',
  source text not null check (source in ('text','audio','image','pwa')),
  confidence numeric(4,3) check (confidence between 0 and 1),
  wa_message_id text unique,
  installment_group_id uuid references public.transactions(id) on delete set null,
  installment_number integer check (installment_number is null or installment_number > 0),
  installment_count integer not null default 1 check (installment_count between 1 and 60),
  first_installment_month text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  wa_id text unique,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  link_code_hash text,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp_responses_enabled boolean not null default true,
  paid_service_messages_authorized boolean not null default false,
  cost_guard_date timestamptz not null default '2026-09-30T23:50:00-03:00',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  updated_at timestamptz not null default now()
);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,
  wa_id text not null,
  status text not null,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index transactions_user_date_idx on public.transactions(user_id, occurred_on desc);
create index transactions_status_idx on public.transactions(user_id, status, created_at desc);
create index inbound_events_received_idx on public.inbound_events(received_at desc);

alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.whatsapp_links enable row level security;
alter table public.app_settings enable row level security;
alter table public.inbound_events enable row level security;

create policy "own categories" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own budgets" on public.budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own whatsapp link" on public.whatsapp_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on public.app_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.bootstrap_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings(user_id) values (new.id);
  insert into public.whatsapp_links(user_id) values (new.id);
  insert into public.categories(user_id, kind, name, color, icon) values
    (new.id,'expense','Alimentación','#20b984','utensils'), (new.id,'expense','Transporte','#655ad8','bus'),
    (new.id,'expense','Vivienda','#f4b44d','home'), (new.id,'expense','Servicios','#4f9bd8','receipt'),
    (new.id,'expense','Salud','#ea7172','heart'), (new.id,'expense','Educación','#65778c','book'),
    (new.id,'expense','Ocio','#d56bb1','party'), (new.id,'expense','Compras','#dc8a43','bag'),
    (new.id,'expense','Impuestos','#78857f','landmark'), (new.id,'expense','Deudas','#b45b5b','card'),
    (new.id,'expense','Otros','#9aa5a1','circle'), (new.id,'income','Sueldo','#20b984','wallet'),
    (new.id,'income','Freelance','#655ad8','briefcase'), (new.id,'income','Ventas','#4f9bd8','tag'),
    (new.id,'income','Rendimientos','#f4b44d','chart'), (new.id,'income','Otros','#9aa5a1','circle');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.bootstrap_user();

create or replace function public.monthly_summary(target_month date)
returns table(expenses numeric, income numeric, balance numeric) language sql stable security invoker as $$
  select
    coalesce(sum(amount_ars) filter (where kind='expense'),0),
    coalesce(sum(amount_ars) filter (where kind='income'),0),
    coalesce(sum(case when kind='income' then amount_ars else -amount_ars end),0)
  from public.transactions
  where user_id=auth.uid() and status='confirmed'
    and occurred_on >= date_trunc('month', target_month)
    and occurred_on < date_trunc('month', target_month) + interval '1 month';
$$;

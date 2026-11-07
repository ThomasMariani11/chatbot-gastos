-- BE-20: Reclasificación reversible de movimientos a las categorías nuevas.
-- Esta migración SOLO instala reglas, registro y funciones: no mueve datos.
-- Uso (operación de producción con autorización del propietario, ver
-- docs/operaciones/DEPLOY_Y_ROLLBACK.md):
--   1. select * from public.category_reclass_preview();   -- solo lectura, cantidades agregadas
--   2. select * from public.category_reclass_apply();     -- con nueva autorización; devuelve run_id
--   3. select public.category_reclass_revert('<run_id>'); -- deshace sin pisar ediciones posteriores
-- Las reglas son las de supabase/functions/whatsapp-webhook/category-rules.ts
-- (sqlPatternFor); tests/category-reclassification-sql.test.ts verifica la paridad.
begin;

create table if not exists public.category_reclass_rules (
  kind public.transaction_kind not null,
  name text not null,
  is_new boolean not null,
  pattern text not null,
  primary key (kind, name)
);
alter table public.category_reclass_rules enable row level security;
revoke all on public.category_reclass_rules from public, anon, authenticated, service_role;

-- Literales E'' para que '\y' (límite de palabra) no dependa de standard_conforming_strings.
insert into public.category_reclass_rules(kind, name, is_new, pattern) values
  ('expense', E'Suscripciones', true, E'\\y(netflix|spotify|disney|hbo|prime video|youtube premium|icloud|chatgpt|suscripcion|suscripciones)\\y'),
  ('expense', E'Restaurantes y delivery', true, E'\\y(restaurant|restaurante|pedidosya|rappi|mcdonalds|mostaza|burger|cafe|cafes|cafeteria|bar|parrilla|pizza|pizzeria|sushi|helado|heladeria|delivery)\\y'),
  ('expense', E'Auto', true, E'\\y(mecanico|gomeria|cubiertas|neumaticos|service del auto|seguro del auto|seguro auto|lavadero|lavado del auto|cochera|estacionamiento|vtv)\\y'),
  ('expense', E'Tecnología', true, E'\\y(celular|notebook|computadora|laptop|tablet|auriculares|cargador|teclado|monitor|iphone)\\y'),
  ('expense', E'Hogar', true, E'\\y(mueble|muebles|colchon|heladera|lavarropas|microondas|electrodomestico|electrodomesticos|ferreteria|pintura|plomero|electricista|lavandina|detergente|articulos de limpieza)\\y'),
  ('expense', E'Hijos', true, E'\\y(panales|juguete|juguetes|jugueteria|ninera|guarderia)\\y'),
  ('expense', E'Cuidado personal', true, E'\\y(peluqueria|barberia|corte de pelo|perfumeria|perfume|cosmetica|maquillaje|manicura|depilacion)\\y'),
  ('expense', E'Deporte', true, E'\\y(gimnasio|gym|cancha|padel|natacion|creatina|suplemento|suplementos|proteina|proteinas)\\y'),
  ('expense', E'Mascotas', true, E'\\y(veterinaria|veterinario|balanceado|pet shop|petshop|mascota)\\y'),
  ('expense', E'Viajes', true, E'\\y(pasaje|pasajes|vuelo|vuelos|hotel|hostel|airbnb|booking|excursion|despegar|aerolineas)\\y'),
  ('expense', E'Regalos y donaciones', true, E'\\y(regalo|regalos|donacion|donaciones)\\y'),
  ('expense', E'Alimentación', false, E'\\y(super|supermercado|chango|coto|vea|dia|disco|carrefour|almacen|verduleria|carniceria|panaderia|comida|almuerzo|cena|merienda|desayuno|facturas|kiosco|caramelos)\\y'),
  ('expense', E'Transporte', false, E'\\y(nafta|combustible|ypf|shell|axion|uber|cabify|didi|taxi|colectivo|subte|tren|peaje|sube)\\y'),
  ('expense', E'Servicios', false, E'\\y(luz|gas|agua|internet|wifi|fibertel|telecentro|flow|cable|claro|personal|movistar|expensas|edenor|edesur|metrogas)\\y'),
  ('expense', E'Vivienda', false, E'\\y(alquiler|inmobiliaria)\\y'),
  ('expense', E'Salud', false, E'\\y(farmacia|remedio|medicamento|medico|doctor|dentista|odontologo|psicologo|consulta|analisis|optica)\\y'),
  ('expense', E'Educación', false, E'\\y(colegio|facultad|universidad|curso|taller|capacitacion|libro|apunte)\\y'),
  ('expense', E'Ocio', false, E'\\y(cine|teatro|boliche|recital|salida|cerveza|juego|steam|playstation)\\y'),
  ('expense', E'Compras', false, E'\\y(ropa|zapatillas|remera|pantalon|shopping|zapatos|camisa|buzo|campera)\\y'),
  ('expense', E'Impuestos', false, E'\\y(afip|rentas|monotributo|arba|iibb|impuesto|tasa|patente)\\y'),
  ('expense', E'Deudas', false, E'\\y(prestamo|tarjeta|deuda)\\y'),
  ('income', E'Sueldo', false, E'\\y(sueldo|salario|haberes|quincena|aguinaldo|bono)\\y'),
  ('income', E'Freelance', false, E'\\y(freelance|diseno|proyecto|cliente)\\y'),
  ('income', E'Ventas', false, E'\\y(venta|mercadolibre)\\y'),
  ('income', E'Rendimientos', false, E'\\y(plazo fijo|intereses|dividendos)\\y'),
  ('income', E'Alquileres', true, E'\\y(alquiler|alquileres|inquilino)\\y'),
  ('income', E'Reintegros', true, E'\\y(reintegro|reembolso|devolucion|cashback)\\y'),
  ('income', E'Regalos', true, E'\\y(regalo|regalaron)\\y'),
  ('income', E'Jubilación y asignaciones', true, E'\\y(jubilacion|pension|auh|asignacion|asignaciones|anses)\\y')
on conflict (kind, name) do update set is_new = excluded.is_new, pattern = excluded.pattern;

create table if not exists public.category_reclass_log (
  id bigserial primary key,
  run_id uuid not null,
  transaction_id uuid not null,
  user_id uuid not null,
  from_category_id uuid not null,
  to_category_id uuid not null,
  applied_at timestamptz not null default now(),
  reverted_at timestamptz,
  unique (run_id, transaction_id)
);
create index if not exists category_reclass_log_transaction_idx on public.category_reclass_log(transaction_id);
alter table public.category_reclass_log enable row level security;
revoke all on public.category_reclass_log from public, anon, authenticated, service_role;
revoke all on sequence public.category_reclass_log_id_seq from public, anon, authenticated, service_role;

-- Destino "claro": exactamente una regla del mismo kind coincide y es categoría nueva.
create or replace function public.category_reclass_target(p_kind public.transaction_kind, p_description text)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select case when count(*) = 1 and bool_and(r.is_new) then min(r.name) end
  from public.category_reclass_rules r
  where r.kind = p_kind
    and translate(lower(p_description), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') ~ r.pattern
$$;

-- Filas a mover. Un plan en cuotas (grupo = coalesce(installment_group_id, id)) entra
-- solo si todas sus filas elegibles están en una categoría de origen y van al mismo destino.
create or replace function public.category_reclass_candidates()
returns table(transaction_id uuid, user_id uuid, kind public.transaction_kind,
              from_category_id uuid, to_category_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
  with eligible as (
    select t.id, t.user_id, t.kind, t.category_id,
      coalesce(t.installment_group_id, t.id) as group_key,
      public.category_reclass_target(t.kind, t.description) as target,
      exists (
        select 1 from public.categories c
        where c.id = t.category_id and c.user_id = t.user_id and c.kind = t.kind
          and ((t.kind = 'expense' and c.name in ('Alimentación', 'Transporte', 'Compras', 'Ocio', 'Salud', 'Otros'))
            or (t.kind = 'income' and c.name = 'Otros'))
      ) as from_ok
    from public.transactions t
    where t.status = 'confirmed'
       or (t.status = 'cancelled' and t.installment_number is null and t.installment_group_id is null
           and exists (select 1 from public.transactions s where s.installment_group_id = t.id))
  ), resolved as (
    select e.*, d.id as to_id
    from eligible e
    left join public.categories d
      on d.user_id = e.user_id and d.kind = e.kind and d.name = e.target and d.active
  ), groups as (
    select r.group_key
    from resolved r
    group by r.group_key
    having bool_and(r.from_ok and r.target is not null and r.to_id is not null)
       and count(distinct r.target) = 1
       and count(distinct r.user_id) = 1
       and count(distinct r.kind) = 1
  )
  select r.id, r.user_id, r.kind, r.category_id, r.to_id
  from resolved r
  join groups g on g.group_key = r.group_key
$$;

-- Vista previa de solo lectura: cantidades por par origen → destino, sin conceptos.
create or replace function public.category_reclass_preview()
returns table(kind public.transaction_kind, from_category text, to_category text, movements bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
  select c.kind, f.name, d.name, count(*)
  from public.category_reclass_candidates() c
  join public.categories f on f.id = c.from_category_id
  join public.categories d on d.id = c.to_category_id
  group by c.kind, f.name, d.name
  order by c.kind, f.name, d.name
$$;

-- Aplica en un lote con run_id. Solo mueve (y registra) filas que siguen en su categoría
-- de origen al momento del update. Una segunda ejecución no encuentra candidatos.
create or replace function public.category_reclass_apply()
returns table(run_id uuid, moved bigint)
language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare
  v_run uuid := gen_random_uuid();
  v_moved bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.category_reclass'));
  with c as (
    select * from public.category_reclass_candidates()
  ), u as (
    update public.transactions t
       set category_id = c.to_category_id, updated_at = now()
      from c
     where t.id = c.transaction_id and t.category_id = c.from_category_id
    returning t.id, t.user_id, c.from_category_id, c.to_category_id
  )
  insert into public.category_reclass_log(run_id, transaction_id, user_id, from_category_id, to_category_id, applied_at)
  select v_run, u.id, u.user_id, u.from_category_id, u.to_category_id, now() from u;
  get diagnostics v_moved = row_count;
  return query select v_run, v_moved;
end;
$$;

-- Revierte un lote: restaura solo filas que siguen en la categoría a la que se movieron
-- (no pisa ediciones posteriores del cliente) y marca reverted_at solo en esas filas.
create or replace function public.category_reclass_revert(p_run_id uuid)
returns bigint
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_restored bigint;
begin
  if p_run_id is null then
    raise exception 'RECLASS_RUN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.category_reclass'));
  with r as (
    update public.transactions t
       set category_id = l.from_category_id, updated_at = now()
      from public.category_reclass_log l
     where l.run_id = p_run_id and l.reverted_at is null
       and t.id = l.transaction_id and t.category_id = l.to_category_id
       and exists (select 1 from public.categories c where c.id = l.from_category_id)
    returning l.id
  )
  update public.category_reclass_log l set reverted_at = now() from r where l.id = r.id;
  get diagnostics v_restored = row_count;
  return v_restored;
end;
$$;

revoke all on function public.category_reclass_target(public.transaction_kind, text) from public, anon, authenticated, service_role;
revoke all on function public.category_reclass_candidates() from public, anon, authenticated, service_role;
revoke all on function public.category_reclass_preview() from public, anon, authenticated, service_role;
revoke all on function public.category_reclass_apply() from public, anon, authenticated, service_role;
revoke all on function public.category_reclass_revert(uuid) from public, anon, authenticated, service_role;

commit;

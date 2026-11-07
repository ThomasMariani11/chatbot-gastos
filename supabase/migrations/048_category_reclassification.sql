-- BE-20: Reclasificación reversible de movimientos a las categorías nuevas.
-- Esta migración SOLO instala reglas, registro y funciones: no mueve datos.
-- Uso (operación de producción con autorización del propietario, ver
-- docs/operaciones/DEPLOY_Y_ROLLBACK.md):
--   1. select * from public.category_reclass_preview();   -- solo lectura, cantidades agregadas
--   2. select * from public.category_reclass_apply(<total de la vista previa>); -- con nueva autorización; devuelve run_id
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
  ('expense', E'Restaurantes y delivery', true, E'\\y(restaurant|restaurante|restaurantes|pedidosya|rappi|mcdonalds|mostaza|burger|cafe|cafes|cafeteria|bar|parrilla|pizza|pizzeria|sushi|helado|heladeria|delivery)\\y'),
  ('expense', E'Auto', true, E'\\y(auto|mecanico|gomeria|cubiertas|neumaticos|service del auto|seguro del auto|seguro auto|lavadero|lavado del auto|cochera|estacionamiento|vtv)\\y'),
  ('expense', E'Tecnología', true, E'\\y(tecnologia|celular|notebook|computadora|laptop|tablet|auriculares|cargador|teclado|monitor|iphone)\\y'),
  ('expense', E'Hogar', true, E'\\y(hogar|mueble|muebles|colchon|heladera|lavarropas|microondas|electrodomestico|electrodomesticos|ferreteria|pintura|plomero|electricista|lavandina|detergente|articulos de limpieza)\\y'),
  ('expense', E'Hijos', true, E'\\y(hijo|hijos|panales|juguete|juguetes|jugueteria|ninera|guarderia)\\y'),
  ('expense', E'Cuidado personal', true, E'\\y(cuidado personal|peluqueria|barberia|corte de pelo|perfumeria|perfume|cosmetica|maquillaje|manicura|depilacion)\\y'),
  ('expense', E'Deporte', true, E'\\y(deporte|deportes|gimnasio|gym|cancha|padel|natacion|creatina|suplemento|suplementos|proteina|proteinas)\\y'),
  ('expense', E'Mascotas', true, E'\\y(veterinaria|veterinario|balanceado|pet shop|petshop|mascota|mascotas)\\y'),
  ('expense', E'Viajes', true, E'\\y(viaje|viajes|pasaje aereo|pasajes aereos|vuelo|vuelos|hotel|hostel|airbnb|booking|excursion|despegar|aerolineas)\\y'),
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
  ('income', E'Reintegros', true, E'\\y(reintegro|reintegros|reembolso|devolucion|cashback)\\y'),
  ('income', E'Regalos', true, E'\\y(regalo|regalos|regalaron)\\y'),
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
-- Normalización equivalente a normalizeConcept (TS): NFD, quitar marcas combinantes
-- U+0300–U+036F y minúsculas. Sin la extensión unaccent.
create or replace function public.category_reclass_target(p_kind public.transaction_kind, p_description text)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select case when count(*) = 1 and bool_and(r.is_new) then min(r.name) end
  from public.category_reclass_rules r
  where r.kind = p_kind
    and lower(regexp_replace(normalize(p_description, NFD), E'[\\u0300-\\u036f]', '', 'g')) ~ r.pattern
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
           and exists (select 1 from public.transactions s
                       where s.installment_group_id = t.id and s.status = 'confirmed'))
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

-- Aplica en un lote con run_id. p_expected es el total de la vista previa revisada
-- (suma de movements): si los candidatos difieren, aborta sin mover ni registrar nada.
-- Bloquea todas las filas de los grupos candidatos, recalcula y mueve; si alguna fila
-- planificada no se movió (cambio concurrente), aborta todo: un plan nunca queda partido.
-- Una segunda ejecución no encuentra candidatos.
drop function if exists public.category_reclass_apply();
create or replace function public.category_reclass_apply(p_expected bigint)
returns table(run_id uuid, moved bigint)
language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare
  v_run uuid := gen_random_uuid();
  v_plan jsonb;
  v_planned bigint;
  v_moved bigint;
begin
  if p_expected is null or p_expected < 0 then
    raise exception 'RECLASS_EXPECTED_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.category_reclass'));

  -- 1. Bloquear todas las filas de los grupos candidatos (cabecera y cuotas).
  perform 1 from public.transactions t
   where coalesce(t.installment_group_id, t.id) in (
     select coalesce(x.installment_group_id, x.id)
       from public.category_reclass_candidates() c
       join public.transactions x on x.id = c.transaction_id)
   for update of t;

  -- 2. Recalcular con las filas ya bloqueadas (nuevo snapshot).
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_plan
    from public.category_reclass_candidates() c;
  v_planned := jsonb_array_length(v_plan);
  if v_planned <> p_expected then
    raise exception 'RECLASS_EXPECTED_MISMATCH' using detail = format('expected=%s candidates=%s', p_expected, v_planned);
  end if;

  -- 3. Mover y registrar solo lo que sigue en su categoría de origen.
  with c as (
    select * from jsonb_to_recordset(v_plan)
      as p(transaction_id uuid, user_id uuid, from_category_id uuid, to_category_id uuid)
  ), u as (
    update public.transactions t
       set category_id = c.to_category_id, updated_at = now()
      from c
     where t.id = c.transaction_id and t.user_id = c.user_id and t.category_id = c.from_category_id
    returning t.id, t.user_id, c.from_category_id, c.to_category_id
  )
  insert into public.category_reclass_log(run_id, transaction_id, user_id, from_category_id, to_category_id, applied_at)
  select v_run, u.id, u.user_id, u.from_category_id, u.to_category_id, now() from u;
  get diagnostics v_moved = row_count;

  -- 4. Todo o nada: si algo planificado no se movió, se revierte el lote completo.
  if v_moved <> v_planned then
    raise exception 'RECLASS_CONCURRENT_CHANGE' using detail = format('planned=%s moved=%s', v_planned, v_moved);
  end if;
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
revoke all on function public.category_reclass_apply(bigint) from public, anon, authenticated, service_role;
revoke all on function public.category_reclass_revert(uuid) from public, anon, authenticated, service_role;

commit;

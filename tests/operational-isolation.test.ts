import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
const migrations = new URL('../supabase/migrations/', import.meta.url);
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const admin = '20000000-0000-4000-8000-000000000003';
const ga = '21000000-0000-4000-8000-000000000001';
const gb = '21000000-0000-4000-8000-000000000002';
const ca = '22000000-0000-4000-8000-000000000001';
const cb = '22000000-0000-4000-8000-000000000002';
const ta = '23000000-0000-4000-8000-000000000001';
const tb = '23000000-0000-4000-8000-000000000002';
type Role = 'anon' | 'authenticated' | 'service_role';

async function act(role: Role, sql: string, args: unknown[] = [], actor = a) {
  await db.exec('savepoint operation');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === 'anon' ? '' : actor]);
    const result = await db.query<Record<string, unknown>>(sql, args);
    await db.exec('reset role; release savepoint operation');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint operation; release savepoint operation');
    throw error;
  }
}

async function snapshot() {
  return (await db.query(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.draft_groups t) as groups,
    (select jsonb_agg(to_jsonb(t) order by id) from public.draft_items t) as items,
    (select jsonb_agg(to_jsonb(t) order by id) from public.whatsapp_links t) as links,
    (select jsonb_agg(to_jsonb(t) order by id) from public.whatsapp_message_queue t) as queue,
    (select jsonb_agg(to_jsonb(t) order by id) from public.transactions t) as transactions`)).rows;
}

async function request(actor = a) {
  return (await act('authenticated', 'select public.request_whatsapp_link_code() as result', [], actor)).rows[0].result as { code: string; expires_at: string };
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin nosuperuser nobypassrls;
    create role authenticated nologin nosuperuser nobypassrls;
    create role service_role nologin nosuperuser bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users(id,email) values('${admin}','admin@example.invalid');
  `);
  for (const name of (await readdir(migrations)).filter(name => /^\d+.*\.sql$/.test(name) && name < '018').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/^\uFEFF/, '');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  // Simular concesiones de tablas de Supabase y una concesión por columna.
  await db.exec(`
    grant all on all tables in schema public to anon,authenticated,service_role;
    grant insert(user_id),update(status) on public.whatsapp_links to authenticated;
    insert into public.invitation_codes(code,duration_days) values('ISO-A',30),('ISO-B',30);
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${a}','a@example.invalid','{"invitation_code":"ISO-A"}'),
      ('${b}','b@example.invalid','{"invitation_code":"ISO-B"}');
    insert into public.categories(id,user_id,kind,name) values('${ca}','${a}','expense','Isolation A'),('${cb}','${b}','expense','Isolation B');
    insert into public.draft_groups(id,user_id) values('${ga}','${a}'),('${gb}','${b}');
    insert into public.draft_items(group_id,user_id,position,description,amount,category_id,installments) values
      ('${ga}','${a}',1,'Fixture A',100,'${ca}',3),('${gb}','${b}',1,'Fixture B',200,'${cb}',1);
    insert into public.transactions(id,user_id,kind,description,amount_ars,status,source,category_id,installment_group_id,installment_count,installment_number)
      values('${ta}','${a}','expense','Fixture A',100,'confirmed','pwa','${ca}','${ta}',3,1),
      ('${tb}','${b}','expense','Fixture B',200,'confirmed','pwa','${cb}','${tb}',3,1);
    insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload) values('iso-a','synthetic-a','${a}','{}'),('iso-b','synthetic-b','${b}','{}');
  `);
  const migration018 = await readFile(new URL('018_request_whatsapp_link_code.sql', migrations), 'utf8');
  const migration019 = await readFile(new URL('019_enforce_backend_writes_and_owner_links.sql', migrations), 'utf8');
  await db.exec(migration018);
  // Reproducir escritura ajena y activación directa antes de 019; revertir.
  await db.exec('begin');
  try {
    await act('authenticated', 'insert into public.draft_items(group_id,user_id,position,description,amount) values($1,$2,2,$3,10)', [gb,a,'Cross-owner fixture']);
    await act('authenticated', "update public.whatsapp_links set wa_id='synthetic-unverified',status='active' where user_id=$1", [a]);
    await act('authenticated', "update public.profiles set phone_number='synthetic-unverified' where id=$1", [a]);
    // La migración se detiene ante datos inconsistentes, sin repararlos.
    await expect(db.exec(migration019)).rejects.toThrow('Hay relaciones entre propietarios distintos');
  } finally {
    await db.exec('rollback');
  }
  const before = await snapshot();
  await db.exec(migration019);
  expect(await snapshot()).toEqual(before);
}, 30000);

beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db.close(); });

describe('INF-02 / BE-03: escrituras operativas e integridad de propietario', () => {
  const tables = [
    { name: 'draft_groups', insert: `insert into public.draft_groups(user_id) values('${a}')`, update: `update public.draft_groups set status='discarded' where id='${ga}'`, delete: `delete from public.draft_groups where id='${ga}'` },
    { name: 'draft_items', insert: `insert into public.draft_items(group_id,user_id,position,description,amount) values('${ga}','${a}',2,'Fixture',10)`, update: `update public.draft_items set amount=20 where group_id='${ga}'`, delete: `delete from public.draft_items where group_id='${ga}'` },
    { name: 'whatsapp_message_queue', insert: `insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload) values('iso-new','synthetic','${a}','{}')`, update: "update public.whatsapp_message_queue set status='processed' where wa_message_id='iso-a'", delete: "delete from public.whatsapp_message_queue where wa_message_id='iso-a'" },
    { name: 'whatsapp_links', insert: `insert into public.whatsapp_links(user_id) values('${a}')`, update: `update public.whatsapp_links set status='active' where user_id='${a}'`, delete: `delete from public.whatsapp_links where user_id='${a}'` },
  ];
  for (const role of ['anon','authenticated'] as const) {
    for (const table of tables) {
      for (const operation of ['insert','update','delete'] as const) {
        it(`${role} no puede ${operation} en ${table.name}`, async () => {
          const before = await snapshot();
          await expect(act(role, table[operation])).rejects.toMatchObject({ code: '42501' });
          expect(await snapshot()).toEqual(before);
        });
      }
    }
  }

  it.each(['draft_groups','draft_items','whatsapp_links'])('authenticated solo lee sus filas de %s', async table => {
    const result = await act('authenticated', `select distinct user_id from public.${table}`);
    expect(result.rows).toEqual([{ user_id: a }]);
  });

  it('no expone la cola al cliente y elimina concesiones por columna', async () => {
    await expect(act('authenticated','select * from public.whatsapp_message_queue')).rejects.toMatchObject({ code:'42501' });
    const rights = await db.query("select has_column_privilege('authenticated','public.whatsapp_links','status','UPDATE') as update, has_column_privilege('authenticated','public.whatsapp_links','user_id','INSERT') as insert");
    expect(rights.rows[0]).toEqual({ update:false, insert:false });
  });

  it('anon tampoco lee borradores o vínculos', async () => {
    for (const table of tables) await expect(act('anon', `select * from public.${table.name}`)).rejects.toMatchObject({ code:'42501' });
  });

  it('el backend conserva CRUD en las tablas operativas', async () => {
    for (const table of tables.slice(0,3)) {
      await act('service_role', table.update);
      expect((await act('service_role', `select count(*)::int as count from public.${table.name}`)).rows[0].count).toBeGreaterThan(0);
    }
    await act('service_role',tables[0].insert);
    await act('service_role',tables[1].insert);
    await act('service_role',tables[2].insert);
    await act('service_role',tables[2].delete);
  });

  it('el backend no puede vincular ítems con grupos o categorías ajenos', async () => {
    await expect(act('service_role','insert into public.draft_items(group_id,user_id,position,description,amount) values($1,$2,2,$3,10)',[gb,a,'Cross-owner'])).rejects.toMatchObject({code:'23503'});
    await expect(act('service_role','update public.draft_items set category_id=$1 where group_id=$2',[cb,ga])).rejects.toMatchObject({code:'23503'});
    await expect(act('service_role','update public.draft_items set user_id=$1 where group_id=$2',[b,ga])).rejects.toMatchObject({code:'23503'});
  });

  it('la PWA conserva altas válidas pero no categorías ni cuotas ajenas', async () => {
    const sql = "insert into public.transactions(user_id,kind,description,amount_ars,source,category_id,installment_group_id) values($1,'expense','Fixture',10,'pwa',$2,$3)";
    await act('authenticated',sql,[a,ca,ta]);
    await expect(act('authenticated',sql,[a,cb,null])).rejects.toMatchObject({code:'23503'});
    await expect(act('authenticated',sql,[a,ca,tb])).rejects.toMatchObject({code:'23503'});
  });

  it('borrar una categoría limpia referencias sin borrar el propietario', async () => {
    await act('service_role','delete from public.categories where id=$1',[ca]);
    expect((await db.query('select user_id,category_id from public.draft_items where group_id=$1',[ga])).rows).toEqual([{user_id:a,category_id:null}]);
    expect((await db.query('select user_id,category_id from public.transactions where id=$1',[ta])).rows).toEqual([{user_id:a,category_id:null}]);
  });

  it('borrar el padre limpia solo la referencia de sus cuotas', async () => {
    const child = (await act('service_role',"insert into public.transactions(user_id,kind,description,source,installment_group_id) values($1,'expense','Child','pwa',$2) returning id",[a,ta])).rows[0].id;
    await act('service_role','delete from public.transactions where id=$1',[ta]);
    expect((await db.query('select user_id,installment_group_id from public.transactions where id=$1',[child])).rows).toEqual([{user_id:a,installment_group_id:null}]);
  });

  it('el borrado de grupo conserva la cascada de sus ítems', async () => {
    await act('service_role','delete from public.draft_groups where id=$1',[ga]);
    expect((await db.query('select distinct user_id from public.draft_items')).rows).toEqual([{user_id:b}]);
  });

  it('no permite reasignar padres referenciados a otro propietario', async () => {
    await expect(act('service_role','update public.draft_groups set user_id=$1 where id=$2',[b,ga])).rejects.toMatchObject({code:'23503'});
    await expect(act('service_role','update public.categories set user_id=$1 where id=$2',[b,ca])).rejects.toMatchObject({code:'23503'});
    await expect(act('service_role','update public.transactions set user_id=$1 where id=$2',[b,ta])).rejects.toMatchObject({code:'23503'});
  });

  it('borrar un usuario conserva las cascadas sin afectar al otro cliente', async () => {
    await db.query('delete from auth.users where id=$1',[a]);
    for (const table of ['draft_groups','draft_items','transactions','categories','whatsapp_links','whatsapp_message_queue']) {
      expect((await db.query(`select count(*)::int as count from public.${table} where user_id=$1`,[a])).rows[0]).toEqual({count:0});
      expect((await db.query(`select count(*)::int as count from public.${table} where user_id=$1`,[b])).rows[0]).not.toEqual({count:0});
    }
  });

  it('la confirmación del bot sigue creando cuotas del propietario correcto', async () => {
    const result = await act('service_role','select public.confirm_draft_group($1,$2,1) as result',[ga,a]);
    expect(result.rows[0].result).toMatchObject({success:true,created_transactions:3});
    expect((await db.query('select sum(amount_ars)::text as total from public.transactions where user_id=$1 and description=$2',[a,'Fixture A'])).rows[0]).toEqual({total:'200.00'});
  });

  it('el descarte del bot sigue funcionando', async () => {
    expect((await act('service_role','select public.discard_draft_group($1,$2) as result',[ga,a])).rows[0].result).toMatchObject({success:true});
  });
});

describe('RPC limitada de vinculación', () => {
  it('genera código, hash y vencimiento del servidor solo para la sesión', async () => {
    const beforeB = (await db.query('select * from public.whatsapp_links where user_id=$1',[b])).rows;
    const result = await request();
    expect(result.code).toMatch(/^[1-9]\d{5}$/);
    const stored = await db.query('select link_code_hash,extract(epoch from(link_code_expires_at-now()))::int as seconds,status,wa_id from public.whatsapp_links where user_id=$1',[a]);
    expect(stored.rows[0]).toEqual({link_code_hash:createHash('sha256').update(result.code).digest('hex'),seconds:600,status:'pending',wa_id:null});
    expect((await db.query('select * from public.whatsapp_links where user_id=$1',[b])).rows).toEqual(beforeB);
  });

  it('no recibe otro usuario, teléfono, hash, estado ni vencimiento del cliente', async () => {
    await expect(act('authenticated','select public.request_whatsapp_link_code($1)',[b])).rejects.toMatchObject({code:'42883'});
    await expect(act('authenticated','select public.request_whatsapp_link_code($1,$2)',[a,'synthetic'])).rejects.toMatchObject({code:'42883'});
  });

  it('rechaza anonimato y sesión ausente', async () => {
    await expect(act('anon','select public.request_whatsapp_link_code()')).rejects.toMatchObject({code:'42501'});
    await expect(act('authenticated','select public.request_whatsapp_link_code()',[], '')).rejects.toMatchObject({code:'42501'});
  });

  it.each(['suspended','expired','pending_code','past_due'])('rechaza %s', async status => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
    await db.query("update public.profiles set subscription_status=$1,subscription_until=case when $2 then now()-interval '1 day' else subscription_until end where id=$3",[status==='past_due'?'active':status,status==='past_due',a]);
    await expect(request()).rejects.toMatchObject({code:'42501'});
  });

  it('renovar el código invalida el anterior sin cambiar el vínculo activo', async () => {
    await act('service_role',"update public.whatsapp_links set wa_id='synthetic-verified',status='active',linked_at=now() where user_id=$1",[a]);
    const first = await request();
    const second = await request();
    expect(second.code).not.toBe(first.code);
    expect((await db.query('select status,wa_id from public.whatsapp_links where user_id=$1',[a])).rows[0]).toEqual({status:'active',wa_id:'synthetic-verified'});
    expect((await db.query('select count(*)::int as count from public.whatsapp_links where link_code_hash=$1',[createHash('sha256').update(first.code).digest('hex')])).rows[0]).toEqual({count:0});
  });

  it('no admite dos cuentas con el mismo hash de código', async () => {
    const result = await request();
    const hash = createHash('sha256').update(result.code).digest('hex');
    await expect(act('service_role','update public.whatsapp_links set link_code_hash=$1 where user_id=$2',[hash,b])).rejects.toMatchObject({code:'23505'});
  });

  it('solo el backend activa el vínculo generado y su copia en el perfil', async () => {
    const code = (await request()).code;
    const hash = createHash('sha256').update(code).digest('hex');
    const candidate = await act('service_role','select user_id from public.whatsapp_links where link_code_hash=$1 and link_code_expires_at>now()',[hash]);
    expect(candidate.rows).toEqual([{user_id:a}]);
    await act('service_role',"update public.whatsapp_links set status='active',wa_id='synthetic-verified',link_code_hash=null,link_code_expires_at=null,linked_at=now() where user_id=$1",[a]);
    await act('service_role',"update public.profiles set phone_number='synthetic-verified' where id=$1",[a]);
    await expect(act('authenticated',"update public.profiles set phone_number='synthetic-unverified' where id=$1",[a])).rejects.toMatchObject({code:'42501'});
    expect((await db.query('select phone_number from public.profiles where id=$1',[a])).rows[0]).toEqual({phone_number:'synthetic-verified'});
  });

  it('mantiene la edición de nombres y configuración del usuario', async () => {
    await act('authenticated',"update public.profiles set first_name='Fixture' where id=$1",[a]);
    await act('authenticated','update public.app_settings set whatsapp_responses_enabled=false where user_id=$1',[a]);
    expect((await db.query('select first_name from public.profiles where id=$1',[a])).rows[0]).toEqual({first_name:'Fixture'});
  });
});

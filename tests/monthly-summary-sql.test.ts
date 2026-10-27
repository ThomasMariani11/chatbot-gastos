import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite(), migrations = new URL('../supabase/migrations/', import.meta.url);
const a='81000000-0000-4000-8000-000000000001', b='81000000-0000-4000-8000-000000000002', admin='81000000-0000-4000-8000-000000000003';
type Snapshot={version:number;month:string;budget_ars:string|null;remaining_budget_ars:string|null;currencies:Array<{currency:string;expenses:string;income:string;balance:string;operations:string}>};
async function actor<T>(sql:string,args:unknown[]=[],id:string|null=a,role='authenticated'):Promise<T>{
 await db.exec('savepoint finance_call');
 try{await db.exec('set local role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);const value=(await db.query<{value:T}>(sql,args)).rows[0]?.value;await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);await db.exec('release savepoint finance_call');return value;}
 catch(error){await db.exec('rollback to savepoint finance_call;release savepoint finance_call');throw error;}
}
const snapshot=(month='2026-02-01',user=a)=>actor<Snapshot>('select public.whatsapp_monthly_summary($1,$2::date) as value',[user,month],null,'service_role');
const legacy=(month='2026-02-01',user=a)=>actor<Record<string,string>>("select json_build_object('expenses',expenses::text,'income',income::text,'balance',balance::text) as value from public.monthly_summary($1::date)",[month],user);
const insert=(amount:string,currency='ARS',kind='expense',date:string|null='2026-02-15',status='confirmed',user=a)=>db.query("insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source)values($1,$2::public.transaction_kind,'Solo fixture',$3::numeric,$4,$5::date,$6::public.transaction_status,'pwa')",[user,kind,amount,currency,date,status]);
const lane=(s:Snapshot,currency='ARS')=>s.currencies.find(r=>r.currency===currency)!;
beforeAll(async()=>{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 await db.query('insert into auth.users(id,email)values($1,$2)',[admin,'admin@example.invalid']);
 for(const name of (await readdir(migrations)).filter(n=>/^\d+.*\.sql$/.test(n)&&n<'020').sort()){
  if(name==='002_enable_realtime.sql')continue;const sql=(await readFile(new URL(name,migrations),'utf8')).replaceAll('\r\n','\n').replace(/^\uFEFF/,'').replace('create extension if not exists pgcrypto;','');await db.exec(sql);
 }
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 await db.exec("insert into public.invitation_codes(code,duration_days)values('FINANCE-A',30),('FINANCE-B',30)");
 await db.query(`insert into auth.users(id,email,raw_user_meta_data)values($1,'a@example.invalid','{"invitation_code":"FINANCE-A"}'),($2,'b@example.invalid','{"invitation_code":"FINANCE-B"}')`,[a,b]);
 await db.exec('grant select on public.transactions,public.budgets to authenticated');
 // Reproducción del defecto histórico, con la función real antes de 036.
 await db.exec('begin');await insert('10');await insert('5','USD');expect((await legacy()).expenses).toBe('15.00');await db.exec('rollback');
 await db.exec((await readFile(new URL('036_monthly_financial_summary.sql',migrations),'utf8')).replaceAll('\r\n','\n'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
describe('BE-09: agregación SQL exacta, independiente del límite de filas REST',()=>{
 it('separa monedas, presupuesto y saldo sin escribir datos',async()=>{
  await insert('125.50');await insert('500','ARS','income');await insert('10','USD');await insert('20','USD','income');await db.query("insert into public.budgets(user_id,month,amount_ars)values($1,'2026-02-01',1000),($2,'2026-02-01',9999),($1,'2026-01-01',900)",[a,b]);
  const before=(await db.query('select to_jsonb(t) as value from public.transactions t order by id')).rows;const s=await snapshot();
  expect(s).toMatchObject({version:1,month:'2026-02',budget_ars:'1000.00',remaining_budget_ars:'874.50'});expect(lane(s)).toEqual({currency:'ARS',expenses:'125.50',income:'500.00',balance:'374.50',operations:'2'});expect(lane(s,'USD')).toEqual({currency:'USD',expenses:'10.00',income:'20.00',balance:'10.00',operations:'2'});
  expect((await db.query('select to_jsonb(t) as value from public.transactions t order by id')).rows).toEqual(before);
 });
 it('suma más de 1000 filas sin perder centavos',async()=>{
  await db.query("insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source)select $1,'expense','Volumen ficticio',0.01,'ARS','2026-02-15','confirmed','pwa' from generate_series(1,1501)",[a]);
  expect(lane(await snapshot())).toEqual({currency:'ARS',expenses:'15.01',income:'0',balance:'-15.01',operations:'1501'});
 });
 it('preserva totales superiores al entero seguro de JavaScript como texto decimal',async()=>{
  await db.query("insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source)select $1,'income','Total grande ficticio',999999999999.99,'USD','2026-02-15','confirmed','pwa' from generate_series(1,100)",[a]);
  expect(lane(await snapshot(),'USD')).toMatchObject({income:'99999999999999.00',balance:'99999999999999.00',operations:'100'});
 });
 it.each([['2024-02-15','2024-02-29','2024-03-01'],['2026-02-01','2026-02-28','2026-03-01'],['2026-04-23','2026-04-30','2026-05-01'],['2026-12-01','2026-12-31','2027-01-01']])('incluye fin de mes y excluye el mes siguiente: %s',async(month,last,next)=>{
  await insert('1','ARS','expense',last);await insert('100','ARS','expense',next);expect(lane(await snapshot(month))).toMatchObject({expenses:'1.00',operations:'1'});expect((await legacy(month)).expenses).toBe('1.00');
 });
 it('excluye pendientes, cancelados, otros meses y otras cuentas',async()=>{
  await insert('1');await insert('100','ARS','expense','2026-02-15','pending');await insert('200','ARS','expense','2026-02-15','cancelled');await insert('300','ARS','expense','2026-01-31');await insert('400','ARS','expense','2026-02-15','confirmed',b);
  expect(lane(await snapshot())).toMatchObject({expenses:'1.00',operations:'1'});expect(lane(await snapshot('2026-02-01',b))).toMatchObject({expenses:'400.00',operations:'1'});
 });
 it('el mes vacío conserva ceros reales y presupuesto ausente como null',async()=>{
  const s=await snapshot();expect(s.budget_ars).toBeNull();expect(s.remaining_budget_ars).toBeNull();expect(s.currencies).toHaveLength(2);for(const row of s.currencies)expect(row).toMatchObject({expenses:'0',income:'0',balance:'0',operations:'0'});
 });
 it('un presupuesto menor a lo gastado devuelve disponible negativo en ARS',async()=>{
  await insert('123.45');await insert('999','USD');await db.query("insert into public.budgets(user_id,month,amount_ars)values($1,'2026-02-01',100)",[a]);expect((await snapshot()).remaining_budget_ars).toBe('-23.45');
 });
 it('compatibilidad monthly_summary conserva firma/columnas y retorna solamente ARS',async()=>{
  await insert('10.01');await insert('100','USD');await insert('20.02','ARS','income');expect(await legacy()).toEqual({expenses:'10.01',income:'20.02',balance:'10.01'});
 });
 it('la función invoker aplica identidad incluso al administrador',async()=>{
  await insert('10');await insert('50','ARS','expense','2026-02-15','confirmed',admin);expect((await legacy('2026-02-01',admin)).expenses).toBe('50.00');expect((await legacy('2026-02-01',b)).expenses).toBe('0');
 });
 it.each(['suspended','expired','pending_code'])('rechaza cuenta %s sin anunciar saldo cero',async status=>{
  await db.query('update public.profiles set subscription_status=$1 where id=$2',[status,a]);await expect(snapshot()).rejects.toThrow('FINANCE_ACCOUNT_UNAVAILABLE');await expect(legacy()).rejects.toThrow('FINANCE_ACCOUNT_UNAVAILABLE');
 });
 it('rechaza vencimiento por fecha y cuenta inexistente',async()=>{
  await db.query("update public.profiles set subscription_until=clock_timestamp()-interval '1 second' where id=$1",[a]);await expect(snapshot()).rejects.toThrow('FINANCE_ACCOUNT_UNAVAILABLE');await expect(snapshot('2026-02-01','81000000-0000-4000-8000-000000000099')).rejects.toThrow('FINANCE_ACCOUNT_UNAVAILABLE');
 });
 it.each([null,'infinity','-infinity','9999-01-01'])('rechaza un mes inválido: %s',async month=>{
  await expect(actor('select public.whatsapp_monthly_summary($1,$2::date) as value',[a,month],null,'service_role')).rejects.toThrow('FINANCE_INVALID_MONTH');await expect(actor('select public.monthly_summary($1::date) as value',[month])).rejects.toThrow('FINANCE_INVALID_MONTH');
 });
 it.each(['0','-1','NaN'])('datos confirmados inválidos %s no se convierten en cero',async amount=>{
  await insert(amount);await expect(snapshot()).rejects.toThrow('FINANCE_INVALID_DATA');await expect(legacy()).rejects.toThrow('FINANCE_INVALID_DATA');
 });
 it('un importe desconocido o fecha desconocida confirmados requieren revisión',async()=>{
  await insert('1');await db.exec('update public.transactions set amount_ars=null');await expect(snapshot()).rejects.toThrow('FINANCE_INVALID_DATA');await db.exec('update public.transactions set amount_ars=1,occurred_on=null');await expect(snapshot()).rejects.toThrow('FINANCE_INVALID_DATA');await expect(legacy()).rejects.toThrow('FINANCE_INVALID_DATA');
 });
 it('permisos: solo backend consulta la RPC con usuario explícito; clientes usan la propia',async()=>{
  for(const role of ['anon','authenticated'])await expect(actor('select public.whatsapp_monthly_summary($1,$2::date) as value',[b,'2026-02-01'],a,role)).rejects.toThrow('permission denied');
  await expect(actor('select public.monthly_summary($1::date) as value',['2026-02-01'],null,'anon')).rejects.toThrow('permission denied');
  const def=(await db.query<{prosecdef:boolean;proconfig:string[];provolatile:string}>("select prosecdef,proconfig,provolatile from pg_proc where oid='public.whatsapp_monthly_summary(uuid,date)'::regprocedure")).rows[0];expect(def).toMatchObject({prosecdef:true,provolatile:'s'});expect(def.proconfig).toContain('search_path=pg_catalog, public');
 });
});
it.each(['infinity','-infinity'])('BE-09: una fecha confirmada no finita %s requiere revisión',async date=>{
 await insert('10','ARS','expense',date);await expect(snapshot()).rejects.toThrow('FINANCE_INVALID_DATA');await expect(legacy()).rejects.toThrow('FINANCE_INVALID_DATA');
});
it('BE-09: presupuesto no finito no se oculta como disponible cero',async()=>{
 await db.query("insert into public.budgets(user_id,month,amount_ars)values($1,'2026-02-01','NaN')",[a]);await expect(snapshot()).rejects.toThrow('FINANCE_INVALID_DATA');
});
it('BE-09: una cuenta vitalicia válida puede consultar sin vencimiento',async()=>{
 await db.query('update public.profiles set subscription_until=null where id=$1',[a]);expect((await snapshot()).month).toBe('2026-02');
});
it('BE-09: sin identidad autenticada no devuelve un cero aparente',async()=>{
 await expect(actor('select public.monthly_summary($1::date) as value',['2026-02-01'],null,'authenticated')).rejects.toThrow('FINANCE_AUTH_REQUIRED');
});
it('BE-09: backend sin usuario explícito no puede consultar un resumen',async()=>{
 await expect(actor('select public.whatsapp_monthly_summary($1,$2::date) as value',[null,'2026-02-01'],null,'service_role')).rejects.toThrow('FINANCE_ACCOUNT_UNAVAILABLE');
});

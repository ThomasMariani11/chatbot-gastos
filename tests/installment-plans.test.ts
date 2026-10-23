import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const migrations = new URL('../supabase/migrations/', import.meta.url);
const a='00000000-0000-4000-8000-000000000011', b='00000000-0000-4000-8000-000000000012';
const category='00000000-0000-4000-8000-000000000013', otherCategory='00000000-0000-4000-8000-000000000014';
let sequence=0;
const request=()=> '10000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');
type Snapshot={success?:boolean;group_id:string;version:string;rows:Array<{id:string;amount_ars:number;description:string;occurred_on:string;installment_number:number;installment_count:number;currency:string}>};
async function act(sql:string,args:unknown[]=[],actor=a,role='authenticated') {
  await db.exec('savepoint attempt');
  try {
    await db.exec('set local role '+role);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
    const result=await db.query<{result:Snapshot}>(sql,args);
    await db.exec('reset role; release savepoint attempt');return result.rows[0]?.result;
  } catch(error) { await db.exec('rollback to savepoint attempt; release savepoint attempt');throw error; }
}
async function create(extra:Record<string,unknown>={},id=request(),actor=a) {
  return act('select public.mutate_installment_plan($1,$2,null,null,null,$3::jsonb,true) as result',[id,'create',JSON.stringify({description:'Compra ficticia',category_id:category,currency:'ARS',amount:100,amount_mode:'total',installment_count:3,reference_date:'2026-01-31',reference_number:1,...extra})],actor);
}
async function read(group:string,actor=a){return act('select public.get_installment_plan($1) as result',[group],actor);}
async function change(snapshot:Snapshot,payload:Record<string,unknown>,options:{id?:string;item?:string;all?:boolean;action?:string;actor?:string}={}){
 return act('select public.mutate_installment_plan($1,$2,$3,$4,$5,$6::jsonb,$7) as result',[options.id??request(),options.action??'edit',snapshot.group_id,snapshot.version,options.item??snapshot.rows[0]?.id??null,JSON.stringify(payload),options.all??true],options.actor??a);
}
async function amounts(group:string){return (await read(group)).rows.map(row=>Number(row.amount_ars));}
beforeAll(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;`);
 for(const name of (await readdir(migrations)).filter(n=>/^\d+.*\.sql$/.test(n)&&n<'018').sort()){
  if(name==='002_enable_realtime.sql')continue;
  let sql=await readFile(new URL(name,migrations),'utf8');if(name==='001_initial.sql')sql=sql.replace('create extension if not exists pgcrypto;','');await db.exec(sql.replace(/^\uFEFF/,''));
 }
 await db.exec(`insert into public.invitation_codes(code,duration_days)values('PLANS-A',30),('PLANS-B',30);
 insert into auth.users(id,email,raw_user_meta_data)values('${a}','a@example.invalid','{"invitation_code":"PLANS-A"}'),('${b}','b@example.invalid','{"invitation_code":"PLANS-B"}');
 insert into public.categories(id,user_id,kind,name)values('${category}','${a}','expense','Pruebas cuotas'),('${otherCategory}','${b}','expense','Otra cuenta');
 update public.profiles set role='client',subscription_status='active',subscription_until=now()+interval '30 days' where id in ('${a}','${b}');
 grant select,insert,update,delete on all tables in schema public to authenticated;`);
 await db.exec(await readFile(new URL('029_atomic_installment_plans.sql',migrations),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
describe('planes SQL atómicos con esquema real',()=>{
 it('crea centavos exactos y fechas fin de mes en ARS y USD',async()=>{
   const plan=await create();expect(plan.rows.map(r=>Number(r.amount_ars))).toEqual([33.33,33.33,33.34]);
   expect(plan.rows.map(r=>r.occurred_on)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
   const usd=await create({currency:'USD',amount:12.5,amount_mode:'quota',reference_date:'2026-02-28',reference_number:2});
   expect(usd.rows.map(r=>Number(r.amount_ars))).toEqual([12.5,12.5,12.5]);expect(usd.rows[0].occurred_on).toBe('2026-01-28');
 });
 it('reintentar un alta no duplica ni permite reutilizar un intento con otros datos',async()=>{
   const id=request();const first=await create({},id);expect(await create({},id)).toEqual(first);
   expect((await db.query('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:4});
   await expect(create({amount:200},id)).rejects.toThrow('otra operación');
 });
 it('renombrar conserva centavos y fechas; editar una cuota preserva las otras',async()=>{
   const first=await create();const renamed=await change(first,{description:'Nombre nuevo'});
   expect(await amounts(first.group_id)).toEqual([33.33,33.33,33.34]);expect(renamed.rows.map(r=>r.occurred_on)).toEqual(first.rows.map(r=>r.occurred_on));
   const one=await change(renamed,{amount:40},{item:renamed.rows[1].id,all:false});expect(one.rows.map(r=>Number(r.amount_ars))).toEqual([33.33,40,33.34]);
 });
 it('no convierte la primera cuota de WhatsApp en el importe total',async()=>{
   const plan=await create({amount:300});const first=plan.rows[0];
   await db.query('update public.transactions set installment_group_id=$1 where installment_group_id=$2',[first.id,plan.group_id]);await db.query('delete from public.transactions where id=$1',[plan.group_id]);
   const whatsapp=await read(first.id);await change(whatsapp,{description:'Renombrado WhatsApp'});expect(await amounts(first.id)).toEqual([100,100,100]);
 });
 it('quitar la primera cuota de WhatsApp conserva el ancla y las otras cuotas',async()=>{
   const plan=await create();const first=plan.rows[0];await db.query('update public.transactions set installment_group_id=$1 where installment_group_id=$2',[first.id,plan.group_id]);await db.query('delete from public.transactions where id=$1',[plan.group_id]);
   const wa=await read(first.id);const removed=await change(wa,{}, {action:'delete_installment',item:first.id});
   expect(removed.rows.map(r=>r.installment_number)).toEqual([2,3]);expect(await amounts(first.id)).toEqual([33.33,33.34]);
 });
 it('una cuota eliminada no reaparece al renombrar ni ampliar el plan',async()=>{
   let plan=await create();plan=await change(plan,{}, {action:'delete_installment',item:plan.rows[1].id});
   plan=await change(plan,{description:'Sin restaurar'});expect(plan.rows.map(r=>r.installment_number)).toEqual([1,3]);
   plan=await change(plan,{installment_count:4,new_installment_amount:20});expect(plan.rows.map(r=>r.installment_number)).toEqual([1,3,4]);expect(plan.rows.map(r=>Number(r.amount_ars))).toEqual([33.33,33.34,20]);
 });
 it('ampliar desde febrero conserva el calendario del conjunto sin reescribir fechas',async()=>{
   const plan=await create({installment_count:2});
   const grown=await change(plan,{installment_count:3,new_installment_amount:50},{item:plan.rows[1].id});
   expect(grown.rows.map(r=>r.occurred_on)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
 });
 it('reprogramar preserva identidades y cambiar cantidad es explícito',async()=>{
   let plan=await create();const ids=plan.rows.map(r=>r.id);
   plan=await change(plan,{schedule:{date:'2026-12-31',number:2}});expect(plan.rows.map(r=>r.id)).toEqual(ids);expect(plan.rows.map(r=>r.occurred_on)).toEqual(['2026-11-30','2026-12-31','2027-01-31']);
   plan=await change(plan,{installment_count:2});expect(plan.rows.map(r=>r.installment_number)).toEqual([1,2]);
 });
 it('rechaza versiones obsoletas y conserva el resultado del mismo reintento',async()=>{
   const plan=await create();const id=request();const renamed=await change(plan,{description:'Uno'},{id});expect(await change(plan,{description:'Uno'},{id})).toEqual(renamed);
   await expect(change(plan,{amount:99})).rejects.toThrow('El plan cambió');expect(await amounts(plan.group_id)).toEqual([33.33,33.33,33.34]);
 });
 it('revierte todas las escrituras cuando falla una cuota y permite reintentar',async()=>{
   const plan=await create();await db.exec(`create function public.reject_fixture() returns trigger language plpgsql as $$begin if new.installment_number=2 then raise exception 'Fallo sintético'; end if; return new; end$$;create trigger fail_fixture before update on public.transactions for each row execute function public.reject_fixture();`);
   const id=request();await expect(change(plan,{amount:200},{id})).rejects.toThrow('Fallo sintético');expect(await amounts(plan.group_id)).toEqual([33.33,33.33,33.34]);
   await db.exec('drop trigger fail_fixture on public.transactions');expect((await change(plan,{amount:200},{id})).rows.map(r=>Number(r.amount_ars))).toEqual([200,200,200]);
 });
 it('un fallo del alta no deja padre ni recibo huérfanos',async()=>{
   await db.exec(`create function public.reject_new_fixture() returns trigger language plpgsql as $$begin if new.installment_number=2 then raise exception 'Alta fallida'; end if; return new; end$$;create trigger fail_new_fixture before insert on public.transactions for each row execute function public.reject_new_fixture();`);
   await expect(create()).rejects.toThrow('Alta fallida');expect((await db.query('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:0});expect((await db.query('select count(*)::int as n from public.installment_plan_requests')).rows[0]).toEqual({n:0});
 });
 it('aisla clientes/categorías y rechaza cuentas vencidas o suspendidas',async()=>{
   const plan=await create();await expect(read(plan.group_id,b)).rejects.toThrow('plan propio');await expect(change(plan,{amount:200},{actor:b})).rejects.toThrow('plan propio');await expect(change(plan,{category_id:otherCategory})).rejects.toThrow('categoría propia');
   // Preparación exclusiva de la base descartable: 016 protege también las escrituras DBA.
   await db.exec('alter table public.profiles disable trigger tr_protect_profile_system_fields');
   await db.query("update public.profiles set subscription_status='suspended' where id=$1",[a]);await db.exec('alter table public.profiles enable trigger tr_protect_profile_system_fields');
   await expect(read(plan.group_id)).rejects.toThrow('cuenta activa');await expect(change(plan,{})).rejects.toThrow('cuenta activa');
   await db.exec("select set_config('request.jwt.claim.sub','',true);alter table public.profiles disable trigger tr_protect_profile_system_fields");
   await db.query("update public.profiles set subscription_status='active',subscription_until=now()-interval '1 day' where id=$1",[a]);
   expect((await db.query('select subscription_status,subscription_until<now() as expired from public.profiles where id=$1',[a])).rows[0]).toEqual({subscription_status:'active',expired:true});await db.exec('alter table public.profiles enable trigger tr_protect_profile_system_fields');await expect(create()).rejects.toThrow('cuenta activa');
 });
 it('anon no ejecuta RPC y clientes no escriben recibos ni usan helpers',async()=>{
   await expect(act('select public.get_installment_plan($1) as result',[request()],'','anon')).rejects.toThrow('permission denied');
   await expect(act("insert into public.installment_plan_requests values($1,$2,'x','{}',now())",[a,request()])).rejects.toThrow('permission denied');
   await expect(act('select public.installment_plan_snapshot($1,$2) as result',[request(),b])).rejects.toThrow('permission denied');
 });
 it('valida límites, importes, monedas y campos desconocidos',async()=>{
   for(const extra of [{installment_count:61},{amount:0},{amount:0.01},{currency:'EUR'},{amount:1.001},{unexpected:true}])await expect(create(extra)).rejects.toThrow();
   expect((await db.query('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:0});
 });
 it('elimina un plan de forma idempotente sin tocar otra compra',async()=>{
   const one=await create(),two=await create();const id=request();const deleted=await change(one,{}, {action:'delete_plan',id});expect(deleted.rows).toEqual([]);expect(await change(one,{}, {action:'delete_plan',id})).toEqual(deleted);expect((await read(two.group_id)).rows).toHaveLength(3);
 });
});
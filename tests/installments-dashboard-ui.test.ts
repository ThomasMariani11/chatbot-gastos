// @vitest-environment jsdom
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../src/Dashboard';
import { formatMoney } from '../lib/finance';
const api = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], failed: false, wait: null as Promise<void> | null, calls: [] as Record<string, unknown>[] }));
vi.mock('../src/usePwaInstall',()=>({usePwaInstall:()=>({canInstall:false,showIosModal:false,showDesktopModal:false,triggerInstall:vi.fn(),setShowIosModal:vi.fn(),setShowDesktopModal:vi.fn()})}));
vi.mock('recharts',()=>({ResponsiveContainer:({children}:{children:ReactNode})=>h('div',null,children),PieChart:({children}:{children:ReactNode})=>h('div',null,children),Pie:()=>null,Cell:()=>null}));
vi.mock('../src/dashboardData',()=>({readDashboardSnapshot:async(_user:string,month:string)=>{
 const rows=api.rows.filter(row=>row.status==='confirmed');return{transactions:rows.filter(row=>String(row.occurred_on).startsWith(month)),installments:rows,budget:0,months:['2026-01','2026-02','2026-03'],monthsWarning:false,botState:'unlinked',botPhone:''};
}}));
vi.mock('../src/supabase',()=>({supabase:{
 from:(table:string)=>{const result=()=>({data:table==='categories'?[{id:'cat',name:'Compras',kind:'expense'}]:null,error:null});const q={select:()=>q,eq:()=>q,order:()=>q,abortSignal:()=>q,single:()=>Promise.resolve(result()),then:(done:(value:unknown)=>unknown)=>Promise.resolve(result()).then(done)};return q;},
 channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:async()=>undefined,
 rpc:async(name:string,args:Record<string,unknown>)=>{
  const id=String(args.p_group_id),rows=api.rows.filter(row=>row.installment_group_id===id&&row.status==='confirmed');
  if(name==='get_installment_plan')return{data:{group_id:id,version:'a'.repeat(32),rows},error:null};
  api.calls.push(args);if(api.wait)await api.wait;if(api.failed)return{data:null,error:{message:'Fallo ficticio de eliminación'}};
  api.rows=api.rows.map(row=>row.installment_group_id===id?{...row,status:'cancelled'}:row);
  return{data:{group_id:id,version:'b'.repeat(32),rows:[]},error:null};
 }
}}));
function rows(group:string,amounts=[100,100,100],currency='ARS') {return amounts.map((amount,index)=>({id:group+'-'+(index+1),description:'Celular',amount_ars:amount,currency,kind:'expense',status:'confirmed',occurred_on:'2026-0'+(index+1)+'-15',category_id:'cat',categories:{name:'Compras'},installment_group_id:group,installment_number:index+1,installment_count:3}));}
let root:Root,node:HTMLDivElement;
const card=(id:string)=>node.querySelector<HTMLElement>('[data-installment-group="'+id+'"]');
async function render(){await act(async()=>{root.render(h(StrictMode,null,h(Dashboard,{userId:'person-a',userEmail:'ficticio@example.test',onOpenSettings:()=>{},onSignOut:()=>{}})));});await vi.waitFor(()=>expect(card('plan-a')).not.toBeNull());}
async function click(button:Element|null){expect(button).not.toBeNull();await act(async()=>{(button as HTMLButtonElement).click();});}
async function promptDelete(){await click(card('plan-a')!.querySelector('[aria-haspopup="menu"]'));await click(card('plan-a')!.querySelector('[role="menuitem"].danger'));await vi.waitFor(()=>expect((node.querySelector('.delete-option-btn.danger') as HTMLButtonElement)?.disabled).toBe(false));}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-02-01T15:00:00Z'));vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 window.history.replaceState({},'','/chatbot-gastos/#cuotas');window.sessionStorage.clear();api.rows=[...rows('plan-a'),...rows('plan-b')];api.calls=[];api.failed=false;api.wait=null;
 node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe('Cuotas real con compras homónimas y registros reales',()=>{
 it('muestra centavos y montos distintos desde el corte y mantiene monedas separadas',async()=>{
  api.rows=[...rows('plan-a',[100,200.1,300.2]),...rows('plan-b',[10,20,30],'USD')];await render();
  expect(card('plan-a')!.querySelector('.installment-plan-meta')!.textContent).toContain(formatMoney(500.3));expect(card('plan-b')).toBeNull();
  await click(node.querySelector('[role="tab"][aria-label="Dólares estadounidenses (USD)"]'));expect(card('plan-a')).toBeNull();expect(card('plan-b')!.textContent).toContain('US$ 50');
 });
 it('no cuenta una cuota borrada; la etiqueta original y el progreso conservan su sentido',async()=>{
  api.rows=rows('plan-a',[33.33,33.33,33.34]).filter(row=>row.installment_number!==2);await render();
  expect(card('plan-a')!.textContent).toContain('Cuota 3/3');expect(card('plan-a')!.textContent).toContain('1 cuota');expect(card('plan-a')!.textContent).toContain(formatMoney(33.34));
  const progress=card('plan-a')!.querySelector('[role="progressbar"]')!;expect(progress.getAttribute('aria-valuemax')).toBe('2');expect(progress.getAttribute('aria-valuenow')).toBe('1');
 });
 it('eliminar un plan homónimo envía su ID y deja el otro visible con sus montos',async()=>{
  await render();await promptDelete();await click(node.querySelector('.delete-option-btn.danger'));await vi.waitFor(()=>expect(card('plan-a')).toBeNull());
  expect(card('plan-b')).not.toBeNull();expect(card('plan-b')!.textContent).toContain(formatMoney(300));expect(api.calls).toHaveLength(1);expect(api.calls[0].p_group_id).toBe('plan-a');
 });
 it('un fallo de eliminación conserva ambos planes y permite reintentar',async()=>{
  api.failed=true;await render();await promptDelete();await click(node.querySelector('.delete-option-btn.danger'));
  expect(node.querySelector('[role="alert"]')!.textContent).toContain('No pudimos comprobar el guardado');expect(card('plan-a')).not.toBeNull();expect(card('plan-b')).not.toBeNull();
  api.failed=false;await click(node.querySelector('.delete-option-btn.danger'));await vi.waitFor(()=>expect(card('plan-a')).toBeNull());expect(card('plan-b')).not.toBeNull();
 });
 it('la recarga posterior conserva un tercer plan homónimo llegado mientras se eliminaba',async()=>{
  let release!:()=>void;api.wait=new Promise<void>(resolve=>{release=resolve;});await render();await promptDelete();
  await act(async()=>{const button=node.querySelector<HTMLButtonElement>('.delete-option-btn.danger')!;button.click();button.click();});
  expect(api.calls).toHaveLength(1);api.rows.push(...rows('plan-c',[50,50,50]));await act(async()=>{release();});await vi.waitFor(()=>expect(card('plan-a')).toBeNull());expect(card('plan-b')).not.toBeNull();expect(card('plan-c')).not.toBeNull();
 });
});

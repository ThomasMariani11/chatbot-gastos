// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionPayments } from '../src/SubscriptionPayments';
import type { PaymentRenewal } from '../src/paymentRenewals';

const services=vi.hoisted(()=>({read:vi.fn(),confirm:vi.fn(),wake:vi.fn()}));
vi.mock('../src/supabase',()=>({supabase:{rpc:vi.fn()}}));
vi.mock('../src/paymentRenewals',async importOriginal=>({...await importOriginal<typeof import('../src/paymentRenewals')>(),readPaymentRenewals:services.read,confirmPayment:services.confirm,wakePaymentDelivery:services.wake}));
vi.mock('../src/PwaUpdates',()=>({useUpdateBlocker:vi.fn()}));
const item:PaymentRenewal={id:'request-test',user_id:'client-test',client_name:'Cliente ficticio',state:'requested',requested_at:'2026-10-30T12:00:00Z',paid_at:null,duration_days:null,redeemed_at:null,delivery_state:null,attempts:null,window_open:true};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);services.read.mockReset().mockResolvedValue({total:1,items:[item]});services.confirm.mockReset().mockResolvedValue(undefined);services.wake.mockReset().mockResolvedValue(undefined);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(createElement(SubscriptionPayments)));}
async function click(text:string){const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw Error('No button '+text);await act(async()=>button.click());}
describe('BE-19: panel de confirmación de pagos',()=>{
 it('muestra solicitud, confirma duración una vez y no anuncia membresía activa',async()=>{
  await render();await click('Confirmar pago y enviar código');const dialog=container.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain('solo si ya verificaste el pago');
  let resolve!:()=>void;services.confirm.mockReturnValueOnce(new Promise<void>(r=>{resolve=r;}));
  await act(async()=>{const form=dialog as HTMLFormElement;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(services.confirm).toHaveBeenCalledOnce();expect(services.confirm.mock.calls[0].slice(0,2)).toEqual(['request-test',30]);
  services.read.mockResolvedValue({total:1,items:[{...item,state:'paid',delivery_state:'pending',duration_days:30}]});await act(async()=>resolve());
  expect(container.textContent).toContain('Pago confirmado');expect(container.textContent).toContain('se activa al canjearlo');expect(services.wake).toHaveBeenCalledOnce();
 });
 it('ventana vencida informa que debe volver a escribir, sin ocultar el pago',async()=>{services.read.mockResolvedValue({total:1,items:[{...item,window_open:false}]});await render();expect(container.textContent).toContain('volver a escribir RENOVAR');await click('Confirmar pago y enviar código');expect(container.querySelector('[role="dialog"]')!.textContent).toContain('Conservaremos el pago y el código');});
 it('incertidumbre visible y sin botón de reenvío o nuevo código',async()=>{services.read.mockResolvedValue({total:1,items:[{...item,state:'paid',delivery_state:'uncertain'}]});await render();expect(container.textContent).toContain('Envío incierto');expect(container.textContent).not.toContain('Confirmar pago y enviar código');});
 it('error de confirmación conserva el diálogo y permite comprobar el mismo intento',async()=>{await render();await click('Confirmar pago y enviar código');services.confirm.mockRejectedValueOnce(Error('No pudimos comprobar el pago.'));await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(container.querySelector('[role="dialog"]')).not.toBeNull();expect(container.textContent).toContain('No pudimos comprobar el pago');});
 it('descarta lecturas tardías al cambiar página y aborta al desmontar',async()=>{let resolve!: (v:unknown)=>void;services.read.mockReturnValueOnce(new Promise(r=>{resolve=r;}));await act(async()=>root.render(createElement(SubscriptionPayments,{refreshTick:0})));const signal=services.read.mock.calls[0][1] as AbortSignal;services.read.mockResolvedValue({total:0,items:[]});await act(async()=>root.render(createElement(SubscriptionPayments,{refreshTick:1})));expect(signal.aborted).toBe(true);await act(async()=>resolve({total:1,items:[item]}));expect(container.textContent).not.toContain('Cliente ficticio');});
});

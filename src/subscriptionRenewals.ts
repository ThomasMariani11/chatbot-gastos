import { supabase } from './supabase';
export type RenewalDraft = { clientId: string; action: 'extend' | 'lifetime'; days: number | null };
export type RenewalAttempt = RenewalDraft & { version: 1; actorId: string; requestId: string };
export type RenewalResult = { client_id: string; subscription_status: 'active' | 'suspended'; subscription_until: string | null; days_added: number; replayed: boolean };
type Store = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const key = (actor: string) => 'pesito.pending-renewal.v1:' + actor;
const storageError = 'No pudimos recuperar la renovación en este navegador. Revisá la cuenta antes de iniciar otra.';
export const renewalStorage: Store = {getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)};
export function validateRenewal(draft: RenewalDraft) {
 if (!uuid.test(draft.clientId) || !['extend','lifetime'].includes(draft.action) || (draft.action==='extend' ? !Number.isInteger(draft.days) || Number(draft.days)<1 || Number(draft.days)>3650 : draft.days!==null)) throw new Error('Elegí de 1 a 3650 días, o sin vencimiento.');
}
export function readRenewal(store: Store, actor: string): RenewalAttempt | null {
 try {const raw=store.getItem(key(actor));if(raw===null)return null;if(raw.length>2048)throw Error();const value=JSON.parse(raw) as RenewalAttempt;
 if(value.version!==1||value.actorId!==actor||!uuid.test(value.requestId))throw Error();validateRenewal(value);return value;
 } catch {throw new Error(storageError);}
}
export async function sendRenewal(attempt: RenewalAttempt): Promise<RenewalResult> {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try {const {data,error}=await supabase.rpc('admin_renew_subscription',{p_request_id:attempt.requestId,p_client_id:attempt.clientId,p_action:attempt.action,p_days:attempt.days}).abortSignal(controller.signal);if(error)throw error;return data as RenewalResult;}
 finally {clearTimeout(timer);}
}
export class RenewalSender {
 busy=false;
 private active=true;
 private generation=0;
 activate(){this.active=true;this.generation++;}
 deactivate(){this.active=false;this.generation++;}
 constructor(readonly actor: string,private store: Store=renewalStorage,private send=sendRenewal){}
 pending(){return readRenewal(this.store,this.actor);}
 async run(draft?: RenewalDraft): Promise<RenewalResult|null> {
  if(this.busy||!this.active)return null;this.busy=true;const generation=this.generation;
  try {
   let attempt=this.pending();
   if(!attempt){if(!draft)return null;validateRenewal(draft);attempt={...draft,actorId:this.actor,version:1,requestId:crypto.randomUUID()};
    try{this.store.setItem(key(this.actor),JSON.stringify(attempt));if(this.pending()?.requestId!==attempt.requestId)throw Error();}catch{throw new Error(storageError);}
   }else if(draft&&(draft.clientId!==attempt.clientId||draft.action!==attempt.action||draft.days!==attempt.days))throw new Error('Primero comprobá la renovación pendiente.');
   const result=await this.send(attempt);
   if(!this.active||generation!==this.generation)return null;
   if(!result||result.client_id!==attempt.clientId||!['active','suspended'].includes(result.subscription_status)||typeof result.replayed!=='boolean'||!Number.isInteger(result.days_added)||result.days_added<0||result.days_added>3650||(result.subscription_until!==null&&(typeof result.subscription_until!=='string'||!Number.isFinite(Date.parse(result.subscription_until)))))throw new Error('No pudimos comprobar la renovación.');
   try{if(this.pending()?.requestId!==attempt.requestId)throw Error();this.store.removeItem(key(this.actor));if(this.store.getItem(key(this.actor))!==null)throw Error();}catch{throw new Error('La renovación respondió, pero no pudimos cerrar el intento. Volvé a comprobarlo.');}
   return result;
  } finally {this.busy=false;}
 }
}
export function renewalError(error: unknown): string {
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
 if(code==='42501')return 'Necesitás una sesión de administrador para completar la renovación.';
 if(['22023','22P02'].includes(code))return 'El servidor rechazó esta renovación. Revisá el cliente y la duración con soporte antes de repetirla.';
 if(['PGRST202','42883'].includes(code))return 'La renovación segura todavía no está disponible. Conservamos el intento.';
 return error instanceof Error&&!code&&!/fetch|network|abort|timeout/i.test(error.message)?error.message:'No pudimos confirmar la renovación. Comprobá el mismo intento antes de iniciar otro.';
}

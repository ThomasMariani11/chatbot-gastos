import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
} from '../supabase/functions/whatsapp-webhook/web-push';
import { deliverClientPush, formatClientPush, readVapidConfig, type ClientNotification } from '../supabase/functions/whatsapp-webhook/client-push';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;
async function hmac(key: Bytes, data: Bytes) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, new Uint8Array([...info, 1]))).slice(0, length);
}

/** Receptor de prueba: claves del navegador y descifrado según RFC 8291. */
async function receiver() {
  const keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', keys.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return {
    subscription: { endpoint: 'https://push.example.test/sub/abc', p256dh: base64UrlEncode(publicRaw), auth: base64UrlEncode(auth) },
    async decrypt(body: Bytes) {
      const salt = body.slice(0, 16);
      const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
      const idLength = body[20];
      const senderPublic = body.slice(21, 21 + idLength);
      const ciphertext = body.slice(21 + idLength);
      const senderKey = await subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: senderKey }, keys.privateKey, 256));
      const ikm = await hkdf(auth, shared, new Uint8Array([...encoder.encode('WebPush: info\0'), ...publicRaw, ...senderPublic]), 32);
      const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
      const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
      expect(rs).toBe(4096);
      expect(plain.at(-1)).toBe(2);
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

async function vapidKeys() {
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await subtle.exportKey('jwk', keys.privateKey);
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', keys.publicKey));
  return { config: { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d!, subject: 'https://pesito.example.test/' }, verifyKey: keys.publicKey };
}

describe('Web Push (RFC 8291 / 8292)', () => {
  it('el navegador puede descifrar el payload cifrado', async () => {
    const browser = await receiver();
    const body = await encryptPayload(encoder.encode('{"title":"Hola"}'), browser.subscription);
    expect(await browser.decrypt(body)).toBe('{"title":"Hola"}');
  });

  it('firma un JWT VAPID válido para el origen del endpoint', async () => {
    const { config, verifyKey } = await vapidKeys();
    const header = await vapidAuthorization('https://push.example.test/sub/abc', config, 1_800_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(match[4]).toBe(config.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(match[2])));
    expect(claims).toEqual({ aud: 'https://push.example.test', exp: 1_800_000_000 + 43_200, sub: 'https://pesito.example.test/' });
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, base64UrlDecode(match[3]), encoder.encode(`${match[1]}.${match[2]}`));
    expect(ok).toBe(true);
  });

  it('envía con cabeceras aes128gcm y trata 404/410 como suscripción caducada', async () => {
    const browser = await receiver();
    const { config } = await vapidKeys();
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendWebPush(browser.subscription, '{"title":"x"}', config, { fetch: fetchMock as unknown as typeof fetch })).toBe('sent');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(browser.subscription.endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.Authorization).toMatch(/^vapid t=/);
    expect(await browser.decrypt(init.body as Bytes)).toBe('{"title":"x"}');
    const gone = vi.fn(async () => new Response(null, { status: 410 }));
    expect(await sendWebPush(browser.subscription, '{}', config, { fetch: gone as unknown as typeof fetch })).toBe('gone');
    const fail = vi.fn(async () => new Response(null, { status: 500 }));
    expect(await sendWebPush(browser.subscription, '{}', config, { fetch: fail as unknown as typeof fetch })).toBe('failed');
    expect(await sendWebPush({ ...browser.subscription, endpoint: 'http://inseguro.test/x' }, '{}', config, { fetch: fail as unknown as typeof fetch })).toBe('gone');
  });
});

describe('Despacho de avisos push', () => {
  it('los textos no incluyen importes ni datos personales', () => {
    expect(formatClientPush({ kind: 'subscription_7', days: 5 }).title).toBe('Tu membresía de Pesito vence en 5 días');
    expect(formatClientPush({ kind: 'subscription_1', days: 1 }).title).toContain('menos de 24 horas');
    expect(formatClientPush({ kind: 'subscription_7', days: 5 }).url).toBe('./#settings');
    for (const kind of ['registration_noon', 'registration_night'] as const) {
      const reminder = formatClientPush({ kind, days: null });
      expect(reminder.body.toLowerCase()).toContain('hoy');
      expect(reminder.body).not.toMatch(/\$|\d/);
    }
    expect(formatClientPush({ kind: 'registration_noon', days: null }).title).not.toBe(formatClientPush({ kind: 'registration_night', days: null }).title);
  });

  it('exige VAPID completo y un subject mailto/https', () => {
    expect(readVapidConfig(() => undefined)).toBeNull();
    const env: Record<string, string> = { VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'ftp://x' };
    expect(readVapidConfig((n) => env[n])).toBeNull();
    env.VAPID_SUBJECT = 'https://thomasmariani11.github.io/chatbot-gastos/';
    expect(readVapidConfig((n) => env[n])).not.toBeNull();
  });

  it('cierra cada aviso según el resultado y quita endpoints caducados', async () => {
    const batch: ClientNotification[] = [
      { id: 'n1', kind: 'subscription_7', days: 5, subscriptions: [{ endpoint: 'https://a/1', p256dh: 'x', auth: 'y' }, { endpoint: 'https://a/2', p256dh: 'x', auth: 'y' }] },
      { id: 'n2', kind: 'registration_noon', days: null, subscriptions: [{ endpoint: 'https://a/3', p256dh: 'x', auth: 'y' }] },
      { id: 'n3', kind: 'registration_night', days: null, subscriptions: [{ endpoint: 'https://a/4', p256dh: 'x', auth: 'y' }] },
    ];
    const finished: Record<string, unknown>[] = [];
    let claims = 0;
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_client_notifications') return (claims++ === 0 ? batch : []) as never;
      finished.push(args!);
      return true as never;
    });
    const results: Record<string, 'sent' | 'gone' | 'failed'> = { 'https://a/1': 'gone', 'https://a/2': 'sent', 'https://a/3': 'gone', 'https://a/4': 'failed' };
    const totals = await deliverClientPush(rpc, async (sub) => results[sub.endpoint]);
    expect(totals).toEqual({ sent: 1, failed: 1 });
    expect(finished.map((f) => [f.p_id, f.p_outcome, f.p_gone_endpoints])).toEqual([
      ['n1', 'sent', ['https://a/1']],
      ['n2', 'skipped', ['https://a/3']],
      ['n3', 'failed', []],
    ]);
  });
});

describe('Migración 046', { timeout: 60_000 }, () => {
  const db = new PGlite();
  const sql = (name: string) => readFile(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
  const user = '60000000-0000-4000-8000-000000000001', other = '60000000-0000-4000-8000-000000000002', admin = '60000000-0000-4000-8000-000000000003';
  const NOON = '2026-11-05T12:00:00-03:00';
  const sub = (n: number) => ({ endpoint: `https://push.example.test/${n}`, p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) });

  async function asUser(id: string, fn: () => Promise<unknown>) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('set role authenticated');
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function save(id: string, n: number) {
    const s = sub(n);
    return asUser(id, () => db.query('select public.save_push_subscription($1,$2,$3)', [s.endpoint, s.p256dh, s.auth]));
  }

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public to anon, authenticated, service_role;
      create schema cron; create table cron.job(jobname text, schedule text, command text);
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
    `);
    await db.exec((await sql('001_initial.sql')).replace('create extension if not exists pgcrypto;', ''));
    await db.exec(await sql('005_admin_and_invitations.sql'));
    await db.exec(await sql('045_client_reminder_preferences.sql'));
    await db.exec(await sql('046_client_push_notifications.sql'));
    await db.query('insert into auth.users(id, email) values($1,$4),($2,$5),($3,$6)', [user, other, admin, 'a@example.test', 'b@example.test', 'c@example.test']);
    await db.query("update public.profiles set created_at = '2026-10-01T00:00:00Z'");
    await db.query("update public.profiles set role = 'admin' where id = $1", [admin]);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it('agenda el cron horario y bloquea las RPC de servicio a clientes', async () => {
    expect((await db.query<{ schedule: string }>("select schedule from cron.job where jobname='pesito-client-push'")).rows).toEqual([{ schedule: '7 * * * *' }]);
    await expect(asUser(user, () => db.query("select public.claim_client_notifications(gen_random_uuid(), 10)"))).rejects.toThrow();
    await expect(asUser(user, () => db.query("select public.enqueue_client_notifications()"))).rejects.toThrow();
    await expect(asUser(user, () => db.query('select * from public.push_subscriptions'))).rejects.toThrow();
  });

  it('guarda hasta 5 dispositivos por cuenta y solo borra los propios', async () => {
    for (let n = 1; n <= 6; n++) await save(user, n);
    const rows = await db.query<{ endpoint: string }>('select endpoint from public.push_subscriptions where user_id=$1 order by endpoint', [user]);
    expect(rows.rows.map((r) => r.endpoint)).toEqual([2, 3, 4, 5, 6].map((n) => sub(n).endpoint));
    await asUser(other, () => db.query('select public.delete_push_subscription($1)', [sub(6).endpoint]));
    expect((await db.query('select 1 from public.push_subscriptions where endpoint=$1', [sub(6).endpoint])).rows).toHaveLength(1);
    await asUser(user, () => db.query('select public.delete_push_subscription($1)', [sub(6).endpoint]));
    expect((await db.query('select 1 from public.push_subscriptions where endpoint=$1', [sub(6).endpoint])).rows).toHaveLength(0);
    await expect(asUser(user, () => db.query("select public.save_push_subscription('http://inseguro.test/x', $1, $2)", [sub(1).p256dh, sub(1).auth]))).rejects.toThrow();
  });

  it('encola el vencimiento de día y el registro diario a las 12 y a las 21 si hoy no registró nada', async () => {
    await db.query("update public.profiles set subscription_until = $2::timestamptz + interval '5 days' where id = $1", [user, NOON]);
    await db.query(
      "insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source, created_at) values ($1,'expense','Prueba',100,'2026-11-01','confirmed','pwa',$2::timestamptz - interval '4 days')",
      [user, NOON],
    );
    await save(admin, 9);
    await save(other, 10);
    // other ya registró hoy a la mañana: no recibe recordatorios hoy.
    await db.query("insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source, created_at) values ($1,'expense','Hoy',100,'2026-11-05','confirmed','pwa','2026-11-05T09:00:00-03:00')", [other]);

    const enqueue = async (at: string) => (await db.query<{ n: number }>('select public.enqueue_client_notifications($1) as n', [at])).rows[0].n;
    expect(await enqueue('2026-11-05T03:00:00-03:00')).toBe(0);
    expect(await enqueue('2026-11-05T10:00:00-03:00')).toBe(1); // solo vencimiento
    expect(await enqueue(NOON)).toBe(2); // mediodía: user y admin
    expect(await enqueue('2026-11-05T13:30:00-03:00')).toBe(0); // margen sin duplicar
    expect(await enqueue('2026-11-05T16:00:00-03:00')).toBe(0); // fuera de franja
    expect(await enqueue('2026-11-05T21:07:00-03:00')).toBe(2); // noche
    expect(await enqueue('2026-11-05T23:30:00-03:00')).toBe(0);
    const queued = await db.query<{ user_id: string; kind: string; period_key: string | null; days: number | null }>(
      "select user_id, kind, case when kind like 'registration%' then period_key end as period_key, days from public.client_notifications order by user_id, kind",
    );
    expect(queued.rows).toEqual([
      { user_id: user, kind: 'registration_night', period_key: '2026-11-05', days: null },
      { user_id: user, kind: 'registration_noon', period_key: '2026-11-05', days: null },
      { user_id: user, kind: 'subscription_7', period_key: null, days: 6 }, // encolado a las 10: faltan 5 días y 2 horas
      { user_id: admin, kind: 'registration_night', period_key: '2026-11-05', days: null },
      { user_id: admin, kind: 'registration_noon', period_key: '2026-11-05', days: null },
    ]);
  });

  it('reclama con suscripciones, omite si registró después o apagó recordatorios, y cierra con token', async () => {
    await db.query('update public.app_settings set client_reminders_enabled = false where user_id = $1', [admin]);
    // user registra un movimiento después de encolar: sus recordatorios se omiten.
    await db.query("insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source) values ($1,'expense','Recién',100,'2026-11-05','confirmed','pwa')", [user]);
    await db.exec('set role service_role');
    const claimed = (await db.query<{ r: Array<{ id: string; kind: string; subscriptions: unknown[] }> }>(
      "select public.claim_client_notifications('70000000-0000-4000-8000-000000000001', 10) as r",
    )).rows[0].r;
    expect(claimed.map((n) => n.kind)).toEqual(['subscription_7']);
    expect(claimed[0].subscriptions).toHaveLength(4);
    const target = claimed[0];
    expect((await db.query<{ ok: boolean }>("select public.finish_client_notification($1, '70000000-0000-4000-8000-000000000002', 'sent') as ok", [target.id])).rows[0].ok).toBe(false);
    expect((await db.query<{ ok: boolean }>("select public.finish_client_notification($1, '70000000-0000-4000-8000-000000000001', 'sent', $2) as ok", [target.id, [sub(2).endpoint]])).rows[0].ok).toBe(true);
    await db.exec('reset role');
    const states = await db.query<{ kind: string; state: string }>('select kind, state from public.client_notifications order by user_id, kind');
    expect(states.rows.map((r) => r.kind + ':' + r.state)).toEqual([
      'registration_night:skipped', 'registration_noon:skipped', 'subscription_7:sent',
      'registration_night:skipped', 'registration_noon:skipped',
    ]);
    expect((await db.query('select 1 from public.push_subscriptions where endpoint=$1', [sub(2).endpoint])).rows).toHaveLength(0);
  });
});

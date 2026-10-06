import { describe, expect, it } from 'vitest';
import { clientSubscriptionMetrics, hasActiveSubscription } from '../src/subscription';

const now = Date.parse('2026-10-06T12:00:00Z');
const client = { role: 'client', subscription_status: 'active', subscription_until: null };

describe('acceso por suscripción', () => {
  it('rechaza perfiles ausentes y roles desconocidos', () => {
    expect(hasActiveSubscription(null, now)).toBe(false);
    expect(hasActiveSubscription({ ...client, role: 'unknown' }, now)).toBe(false);
  });
  it.each(['pending_code', 'expired', 'suspended', 'unknown'])('bloquea el estado %s aunque no tenga vencimiento', (status) => {
    expect(hasActiveSubscription({ ...client, subscription_status: status }, now)).toBe(false);
  });
  it('permite administradores y clientes activos vitalicios', () => {
    expect(hasActiveSubscription(client, now)).toBe(true);
    expect(hasActiveSubscription({ ...client, role: 'admin', subscription_status: 'suspended' }, now)).toBe(true);
  });
  it('bloquea al vencer y ante fechas inválidas', () => {
    for (const date of ['2026-10-06T11:59:59Z', '2026-10-06T12:00:00Z', 'invalid']) {
      expect(hasActiveSubscription({ ...client, subscription_until: date }, now)).toBe(false);
    }
    expect(hasActiveSubscription({ ...client, subscription_until: '2026-10-06T12:00:01Z' }, now)).toBe(true);
  });
});

describe('métricas de clientes', () => {
  it('excluye administradores, pendientes, suspendidos y vencidos incluso con fechas futuras', () => {
    const future = '2026-10-08T12:00:00Z';
    const profiles = [client, { ...client, subscription_until: future },
      { ...client, role: 'admin' },
      ...['pending_code', 'suspended', 'expired'].flatMap((status) => [
        { ...client, subscription_status: status },
        { ...client, subscription_status: status, subscription_until: future },
      ]),
      { ...client, subscription_until: '2026-10-06T12:00:00Z' },
      { ...client, subscription_until: 'invalid' },
    ];
    expect(clientSubscriptionMetrics(profiles, now)).toEqual({ activeClientsCount: 2, expiringSoonCount: 1 });
  });
  it('incluye el límite de siete días y excluye vitalicios de próximos a vencer', () => {
    expect(clientSubscriptionMetrics([
      client,
      { ...client, subscription_until: '2026-10-13T12:00:00Z' },
      { ...client, subscription_until: '2026-10-13T12:00:01Z' },
    ], now)).toEqual({ activeClientsCount: 3, expiringSoonCount: 1 });
    expect(clientSubscriptionMetrics([], now)).toEqual({ activeClientsCount: 0, expiringSoonCount: 0 });
  });
});

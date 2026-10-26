import { describe, expect, it } from 'vitest';
import { presentInstallmentPlans } from '../src/installmentPresentation';
const row = (number: number, extra: Record<string, unknown> = {}) => ({ id: 'row-' + number, description: 'Celular', amount_ars: 100, currency: 'ARS', kind: 'expense', status: 'confirmed', occurred_on: '2026-' + String(number).padStart(2, '0') + '-15', installment_group_id: 'plan-a', installment_number: number, installment_count: 3, ...extra });
const plan = (rows: Record<string, unknown>[], month='2026-02', today='2026-02-01') => presentInstallmentPlans(rows, month, today)[0];
describe('cuotas existentes: fechas, centavos e identidad', () => {
  it('suma montos reales e incluye la siguiente cuota, no multiplica la primera', () => {
    const result = plan([row(1), row(2, { amount_ars: 200 }), row(3, { amount_ars: 300 })]);
    expect(result.scheduledCount).toBe(2); expect(result.scheduledTotal).toBe(500); expect(result.totalAmount).toBe(600);
  });
  it('no cuenta cuotas eliminadas ni cambia los números originales', () => {
    const result = plan([row(1), row(2, { status: 'cancelled' }), row(3, { amount_ars: 300 })]);
    expect(result.scheduledCount).toBe(1); expect(result.scheduledTotal).toBe(300); expect(result.nextScheduled?.installmentNumber).toBe(3); expect(result.installmentCount).toBe(3); expect(result.activeCount).toBe(2); expect(result.progressPercent).toBe(50);
  });
  it('respeta centavos sin reconstruir el total original', () => {
    const result = plan([row(1, { amount_ars: 33.33 }), row(3, { amount_ars: 33.34 })], '2026-01', '2026-01-01');
    expect(result.totalAmount).toBe(66.67); expect(result.scheduledTotal).toBe(66.67); expect(result.scheduledCount).toBe(2);
  });
  it('el corte de hoy incluye hoy y excluye fechas anteriores sin suponer que estén pagadas', () => {
    const result = plan([row(1), row(2), row(3)], '2026-01', '2026-02-15');
    expect(result.scheduledFrom).toBe('2026-02-15'); expect(result.scheduledTotal).toBe(200); expect(result.earlierCount).toBe(1);
  });
  it('si se consulta un mes futuro suma desde el día uno de ese mes', () => {
    const result = plan([row(1), row(2), row(3)], '2026-03', '2026-01-20');
    expect(result.scheduledFrom).toBe('2026-03-01'); expect(result.scheduledCount).toBe(1); expect(result.scheduledTotal).toBe(100);
  });
  it('mes sin cuota y plan con inicio futuro mantienen la primera fecha real', () => {
    const result = plan([row(2), row(3)], '2026-01', '2026-01-20');
    expect(result.currentMovement.date).toBe('2026-02-15'); expect(result.nextScheduled?.date).toBe('2026-02-15'); expect(result.scheduledCount).toBe(2); expect(result.earlierCount).toBe(0);
  });
  it('consulta histórica conserva el plan pero no inventa una cuota futura', () => {
    const result = plan([row(1), row(2), row(3)], '2026-02', '2026-10-25');
    expect(result.currentMovement.installmentNumber).toBe(2); expect(result.nextScheduled).toBeUndefined(); expect(result.scheduledCount).toBe(0); expect(result.scheduledTotal).toBe(0);
    expect(presentInstallmentPlans([row(1), row(2), row(3)], '2026-04', '2026-10-25')).toEqual([]);
  });
  it('dos compras homónimas mantienen IDs, importes y monedas independientes', () => {
    const rows = [row(2), row(2, { id: 'other', installment_group_id: 'plan-b', currency: 'USD', amount_ars: 25.12 })];
    const plans = presentInstallmentPlans(rows, '2026-02', '2026-02-01');
    expect(plans.map(p => [p.groupId, p.currency, p.scheduledTotal])).toEqual([['plan-a','ARS',100],['plan-b','USD',25.12]]);
  });
  it('nunca fusiona registros sin grupo por coincidencia del nombre', () => {
    const plans = presentInstallmentPlans([row(1, { installment_group_id: null }), row(2, { installment_group_id: null })], '2026-01', '2026-01-01'); expect(plans.map(p => p.groupId)).toEqual(['row-1','row-2']);
  });
  it('acepta como grupo la primera cuota WhatsApp y no suma un padre cancelado PWA', () => {
    const plans = presentInstallmentPlans([row(1, { installment_group_id: 'row-1' }), row(2, { installment_group_id: 'row-1' }), row(3, { id: 'parent', status: 'cancelled', installment_number: null, amount_ars: 300, installment_group_id: null })], '2026-01', '2026-01-01');
    expect(plans).toHaveLength(1); expect(plans[0].groupId).toBe('row-1'); expect(plans[0].totalAmount).toBe(200);
  });
  it('ordena sin mutar la entrada y usa fechas guardadas aunque los números no estén ordenados', () => {
    const rows = [row(3, { occurred_on: '2026-01-01' }), row(1, { occurred_on: '2026-03-01' })]; const before = JSON.stringify(rows);
    expect(plan(rows, '2026-01', '2026-01-01').nextScheduled?.installmentNumber).toBe(3); expect(JSON.stringify(rows)).toBe(before);
  });
  it('maneja febrero bisiesto y el cambio de año sin crear fechas adicionales', () => {
    const result = plan([row(1, { occurred_on: '2027-12-31' }), row(2, { occurred_on: '2028-02-29' }), row(3, { occurred_on: '2028-03-31' })], '2028-01', '2027-12-20');
    expect(result.nextScheduled?.date).toBe('2028-02-29'); expect(result.scheduledCount).toBe(2);
  });
  it('no trata ingresos en cuotas como gastos', () => { expect(presentInstallmentPlans([row(1, { kind: 'income' })], '2026-01', '2026-01-01')).toEqual([]); });
  it.each([{amount_ars: 1.001}, {amount_ars: null}, {occurred_on: '2026-02-31'}, {installment_number: 0}, {installment_count: 61}, {currency:'EUR'}])('rechaza datos inválidos sin publicar un subtotal: %j', extra => { expect(() => plan([row(1,extra)])).toThrow(); });
  it('rechaza IDs/números duplicados y monedas mixtas dentro de un mismo grupo', () => {
    for (const rows of [[row(1),row(1)],[row(1),row(1,{id:'duplicate-number'})],[row(1),row(2,{currency:'USD'})]]) expect(() => plan(rows)).toThrow();
  });
});

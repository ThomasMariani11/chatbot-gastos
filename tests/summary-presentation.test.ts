import { describe, expect, it } from 'vitest';
import { nextScheduledInstallment } from '../src/summaryPresentation';
describe('fechas programadas en el resumen', () => {
  const rows = [
    { id: 'last', occurred_on: '2027-01-01', amount: 333.34 },
    { id: 'past', occurred_on: '2026-10-01', amount: 333.33 },
    { id: 'next', occurred_on: '2026-11-01', amount: 333.33 },
  ];
  it('no anuncia como próxima una fecha que ya pasó, aunque el mes consultado sea anterior', () => {
    expect(nextScheduledInstallment(rows, '2026-09', '2026-10-23')?.id).toBe('next');
  });
  it('respeta un mes futuro seleccionado y conserva los centavos de la cuota guardada', () => {
    expect(nextScheduledInstallment(rows, '2027-01', '2026-10-23')).toEqual(rows[0]);
  });
  it('incluye una cuota programada para hoy', () => {
    expect(nextScheduledInstallment(rows, '2026-11', '2026-11-01')?.id).toBe('next');
  });
  it('no inventa otra fecha al terminar la compra ni acepta fechas ausentes', () => {
    expect(nextScheduledInstallment([...rows, { id: 'empty', occurred_on: '', amount: 0 }], '2027-02', '2027-02-01')).toBeUndefined();
  });
  it('no reordena ni modifica las operaciones originales', () => {
    const original = structuredClone(rows);
    nextScheduledInstallment(rows, '2026-10', '2026-10-23');
    expect(rows).toEqual(original);
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterMovementsList,
  formatDayGroupLabel,
  groupMovementsByDay,
  nextScheduledInstallment,
  normalizeDashboardSection,
  summarizeMonthlyInstallments,
} from '../src/summaryPresentation';

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

describe('vistas propias de Movimientos y Cuotas (Bloque 3)', () => {
  it('normaliza la sección activa hacia #resumen, #movimientos o #cuotas', () => {
    expect(normalizeDashboardSection('')).toBe('#resumen');
    expect(normalizeDashboardSection('#otro')).toBe('#resumen');
    expect(normalizeDashboardSection('#movimientos')).toBe('#movimientos');
    expect(normalizeDashboardSection('#cuotas')).toBe('#cuotas');
  });

  it('filtra movimientos por búsqueda sin tildes, por tipo y por categoría sin mutar la entrada', () => {
    const sample = [
      { id: '1', title: 'Panadería del barrio', category: 'Alimentación', kind: 'expense' as const, amount: 2500, date: '2026-10-23' },
      { id: '2', title: 'Sueldo mensual', category: 'Sueldo', kind: 'income' as const, amount: 850000, date: '2026-10-22' },
      { id: '3', title: 'Carga SUBE', category: 'Transporte', kind: 'expense' as const, amount: 5000, date: '2026-10-18' },
    ];
    const snapshot = structuredClone(sample);

    expect(filterMovementsList(sample, { query: 'panaderia' }).map((m) => m.id)).toEqual(['1']);
    expect(filterMovementsList(sample, { query: 'alimentacion' }).map((m) => m.id)).toEqual(['1']);
    expect(filterMovementsList(sample, { kind: 'income' }).map((m) => m.id)).toEqual(['2']);
    expect(filterMovementsList(sample, { kind: 'expense', category: 'Transporte' }).map((m) => m.id)).toEqual(['3']);
    expect(sample).toEqual(snapshot);
  });

  it('agrupa movimientos por día (Hoy, Ayer y fecha corta) y calcula el subtotal diario con centavos exactos', () => {
    const items = [
      { id: 'a', title: 'Café', category: 'Restaurantes', kind: 'expense' as const, amount: 1200.5, date: '2026-10-23' },
      { id: 'b', title: 'Super', category: 'Supermercado', kind: 'expense' as const, amount: 8799.5, date: '2026-10-23' },
      { id: 'c', title: 'Reintegro', category: 'Otros', kind: 'income' as const, amount: 3000, date: '2026-10-22' },
      { id: 'd', title: 'Internet', category: 'Servicios', kind: 'expense' as const, amount: 25000, date: '2026-10-18' },
    ];
    expect(formatDayGroupLabel('2026-10-23', '2026-10-23')).toBe('Hoy · 23 oct');
    expect(formatDayGroupLabel('2026-10-22', '2026-10-23')).toBe('Ayer · 22 oct');
    expect(formatDayGroupLabel('2026-10-18', '2026-10-23')).toBe('18 oct');
    expect(formatDayGroupLabel('2025-12-31', '2026-01-01')).toBe('Ayer · 31 dic 2025');
    expect(formatDayGroupLabel('2025-12-31', '2026-10-23')).toBe('31 dic 2025');

    const groups = groupMovementsByDay(items, '2026-10-23');
    expect(groups.map((g) => ({ date: g.date, label: g.label, netAmount: g.netAmount, count: g.items.length }))).toEqual([
      { date: '2026-10-23', label: 'Hoy · 23 oct', netAmount: -10000, count: 2 },
      { date: '2026-10-22', label: 'Ayer · 22 oct', netAmount: 3000, count: 1 },
      { date: '2026-10-18', label: '18 oct', netAmount: -25000, count: 1 },
    ]);
  });

  it('resume el total que se paga este mes en cuotas y la cantidad de compras activas', () => {
    const monthMovements = [
      { amount: 38000.25, kind: 'expense' as const, installmentCount: 6 },
      { amount: 45000.75, kind: 'expense' as const, installmentCount: 12 },
      { amount: 12000, kind: 'expense' as const, installmentCount: 1 },
      { amount: 500000, kind: 'income' as const, installmentCount: null },
    ];
    expect(summarizeMonthlyInstallments(monthMovements, 3)).toEqual({
      monthlyTotal: 83001,
      activePlansCount: 3,
      monthInstallmentsCount: 2,
    });
  });
});

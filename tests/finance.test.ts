import { describe, expect, it } from 'vitest';
import { addMonths, serviceMessagesAllowed, splitInstallments, summarize } from '../lib/finance';

describe('reglas financieras', () => {
  it('reparte cuotas sin perder centavos', () => {
    const result = splitInstallments(100000, 3);
    expect(result).toEqual([33333.33, 33333.33, 33333.34]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(100000);
  });

  it('atraviesa correctamente el cambio de año', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('solo suma movimientos confirmados', () => {
    const summary = summarize([
      { id: '1', description: 'Compra', categoryName: 'Otros', amountArs: 100, occurredOn: '2026-09-01', kind: 'expense', status: 'confirmed' },
      { id: '2', description: 'Pendiente', categoryName: 'Otros', amountArs: 500, occurredOn: '2026-09-01', kind: 'expense', status: 'pending' },
      { id: '3', description: 'Sueldo', categoryName: 'Sueldo', amountArs: 1000, occurredOn: '2026-09-01', kind: 'income', status: 'confirmed' },
    ], 800);
    expect(summary).toMatchObject({ expenses: 100, income: 1000, balance: 900, remainingBudget: 700, budgetPercentage: 13 });
  });

  it('bloquea los mensajes pagos salvo autorización explícita', () => {
    expect(serviceMessagesAllowed(new Date('2026-09-30T23:49:59-03:00'), false)).toBe(true);
    expect(serviceMessagesAllowed(new Date('2026-09-30T23:50:00-03:00'), false)).toBe(false);
    expect(serviceMessagesAllowed(new Date('2026-09-30T23:50:00-03:00'), true)).toBe(true);
  });
});

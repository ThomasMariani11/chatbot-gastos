import type { Movement } from './types';

export function splitInstallments(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total <= 0) throw new Error('El total debe ser mayor que cero.');
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error('La cantidad de cuotas debe estar entre 1 y 60.');
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index === count - 1 ? remainder : 0)) / 100);
}

export function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(month: string, offset: number): string {
  const [year, rawMonth] = month.split('-').map(Number);
  return monthKey(new Date(year, rawMonth - 1 + offset, 1));
}

// Calcular cada cuota desde el día elegido, sin arrastrar el ajuste de febrero.
export function installmentDate(month: string, preferredDay: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(preferredDay) || preferredDay < 1 || preferredDay > 31) {
    throw new Error('Mes o día de cuota inválido.');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1];
  return `${month}-${String(Math.min(preferredDay, daysInMonth)).padStart(2, '0')}`;
}

export function summarize(movements: Movement[], budgetArs: number) {
  const confirmed = movements.filter((movement) => movement.status === 'confirmed');
  const expenses = confirmed.filter((movement) => movement.kind === 'expense').reduce((sum, movement) => sum + movement.amountArs, 0);
  const income = confirmed.filter((movement) => movement.kind === 'income').reduce((sum, movement) => sum + movement.amountArs, 0);
  return {
    expenses,
    income,
    balance: income - expenses,
    remainingBudget: budgetArs - expenses,
    budgetPercentage: budgetArs > 0 ? Math.round((expenses / budgetArs) * 100) : 0,
  };
}

export function serviceMessagesAllowed(now: Date, override: boolean): boolean {
  const billingStart = new Date('2026-09-30T23:50:00-03:00');
  return now < billingStart || override;
}

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

export function formatAmountInput(input: string): string {
  if (!input) return '';
  let raw = String(input).trim();

  // Si el usuario tipeó un punto al final (ej: '67.'), lo interpretamos como coma decimal
  if (raw.endsWith('.')) {
    raw = raw.slice(0, -1) + ',';
  }

  const hasComma = raw.includes(',');
  let intPart = '';
  let decPart = '';

  if (hasComma) {
    const parts = raw.split(',');
    intPart = parts[0].replace(/\D/g, '');
    decPart = parts.slice(1).join('').replace(/\D/g, '').slice(0, 2);
  } else {
    intPart = raw.replace(/\D/g, '');
  }

  if (!intPart && !hasComma) return '';
  if (!intPart && hasComma) intPart = '0';

  const formattedInt = BigInt(intPart).toLocaleString('es-AR');
  return hasComma ? `${formattedInt},${decPart}` : formattedInt;
}

export function parseAmountNumber(val: string): number {
  if (!val) return 0;
  // Quitar puntos de miles y convertir coma decimal a punto
  const normalized = val.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function numberToAmountInput(num: number | '' | null | undefined): string {
  if (num === '' || num === null || num === undefined || Number.isNaN(num) || num <= 0) return '';
  const rounded = Math.round(Number(num) * 100) / 100;
  const parts = String(rounded).split('.');
  const intFormatted = BigInt(parts[0] || '0').toLocaleString('es-AR');
  if (parts.length > 1 && parts[1]) {
    const dec = parts[1].slice(0, 2);
    const paddedDec = dec.length === 1 ? `${dec}0` : dec;
    return `${intFormatted},${paddedDec}`;
  }
  return intFormatted;
}

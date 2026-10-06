import { describe, expect, it } from 'vitest';
import { addMonths, installmentDate } from '../lib/finance';

describe('fechas de cuotas', () => {
  it('ajusta febrero y recupera el día 31 en marzo', () => {
    expect([0, 1, 2, 3].map((offset) => installmentDate(addMonths('2026-01', offset), 31)))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('respeta años bisiestos y la excepción de los siglos', () => {
    expect(installmentDate('2028-02', 31)).toBe('2028-02-29');
    expect(installmentDate('2100-02', 29)).toBe('2100-02-28');
    expect(installmentDate('2000-02', 29)).toBe('2000-02-29');
  });
  it('conserva días válidos y cruza diciembre', () => {
    expect(installmentDate('2026-02', 15)).toBe('2026-02-15');
    expect(installmentDate(addMonths('2026-12', 1), 31)).toBe('2027-01-31');
  });
  it('admite cuotas en curso con inicio en un mes más corto', () => {
    expect(installmentDate(addMonths('2026-03', -1), 31)).toBe('2026-02-28');
    expect(installmentDate('2026-03', 31)).toBe('2026-03-31');
  });
  it('rechaza meses y días inválidos', () => {
    expect(() => installmentDate('2026-13', 1)).toThrow();
    expect(() => installmentDate('2026-01', 0)).toThrow();
    expect(() => installmentDate('2026-01', 32)).toThrow();
    expect(() => installmentDate('2026-01', 1.5)).toThrow();
  });
});

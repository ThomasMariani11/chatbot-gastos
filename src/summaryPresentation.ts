/** Selecciona una fecha ya guardada; no estima vencimientos ni supone pagos. */
export function nextScheduledInstallment<T extends { occurred_on?: unknown }>(
  rows: readonly T[],
  selectedMonth: string,
  today: string,
): T | undefined {
  const from = selectedMonth > today.slice(0, 7) ? selectedMonth + '-01' : today;
  return rows
    .filter(row => typeof row.occurred_on === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on)
      && row.occurred_on >= from)
    .sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on)))[0];
}

export type DashboardSection = '#resumen' | '#movimientos' | '#cuotas';

export function normalizeDashboardSection(hash: string): DashboardSection {
  if (hash === '#movimientos') return '#movimientos';
  if (hash === '#cuotas') return '#cuotas';
  return '#resumen';
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterMovementsList<
  T extends { title: string; category: string; kind: 'expense' | 'income' },
>(
  items: readonly T[],
  options: {
    query?: string;
    kind?: 'all' | 'expense' | 'income';
    category?: string;
  },
): T[] {
  const kindFilter = options.kind ?? 'all';
  const categoryFilter = (options.category ?? 'all').trim();
  const normalizedQuery = normalizeSearchText(options.query ?? '');

  return items.filter((item) => {
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    if (categoryFilter && categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (normalizedQuery) {
      const haystack = normalizeSearchText(`${item.title} ${item.category}`);
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });
}

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shiftIsoDay(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function formatDayGroupLabel(dateStr: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [year, monthNum, dayNum] = dateStr.split('-').map(Number);
  const shortDate = `${dayNum} ${SHORT_MONTHS[(monthNum - 1) % 12]}${String(year) !== today.slice(0, 4) ? ` ${year}` : ''}`;
  if (dateStr === today) return `Hoy · ${shortDate}`;
  if (dateStr === shiftIsoDay(today, -1)) return `Ayer · ${shortDate}`;
  return shortDate;
}

export type DayMovementGroup<T> = {
  date: string;
  label: string;
  netAmount: number;
  items: T[];
};

export function groupMovementsByDay<
  T extends { date: string; amount: number; kind: 'expense' | 'income' },
>(items: readonly T[], today: string): DayMovementGroup<T>[] {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const key = item.date || '';
    const bucket = byDate.get(key);
    if (bucket) bucket.push(item);
    else byDate.set(key, [item]);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayItems]) => {
      const netCents = dayItems.reduce((sum, item) => {
        const cents = Math.round(item.amount * 100);
        return sum + (item.kind === 'income' ? cents : -cents);
      }, 0);
      return {
        date,
        label: formatDayGroupLabel(date, today),
        netAmount: netCents / 100,
        items: dayItems,
      };
    });
}

export function summarizeMonthlyInstallments(
  movements: readonly { amount: number; kind: 'expense' | 'income'; installmentCount?: number | null }[],
  activePlansCount: number,
): { monthlyTotal: number; activePlansCount: number; monthInstallmentsCount: number } {
  const installmentRows = movements.filter(
    (item) => item.kind === 'expense' && (item.installmentCount ?? 0) > 1,
  );
  const totalCents = installmentRows.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  return {
    monthlyTotal: totalCents / 100,
    activePlansCount,
    monthInstallmentsCount: installmentRows.length,
  };
}

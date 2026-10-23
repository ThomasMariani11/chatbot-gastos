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

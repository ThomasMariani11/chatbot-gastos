import { describe, expect, it } from 'vitest';

type DraftItem = {
  position: number;
  kind: 'expense' | 'income';
  description: string;
  amount: number;
  currency: string;
  installments?: number;
  status: string;
};

function formatDraftList(items: DraftItem[]): string {
  const activeItems = items.filter((it) => it.status === 'pending');
  if (activeItems.length === 0) {
    return 'No tenés movimientos pendientes en tu lista.';
  }

  const count = activeItems.length;
  const countText = count === 1 ? '1 movimiento para revisar:' : `${count} movimientos para revisar:`;

  let out = `Tenés ${countText}\n\n`;

  for (const it of activeItems) {
    const isUsd = it.currency === 'USD';
    const icon = it.kind === 'income' ? '🟢' : '🔴';
    const amountStr = isUsd
      ? `US$ ${it.amount.toLocaleString('es-AR', { minimumFractionDigits: it.amount % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 })} [USD]`
      : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(it.amount);

    const instText = (it.installments && it.installments > 1) ? ` (${it.installments} cuotas)` : '';
    out += `${it.position}. ${icon} ${it.description} · ${amountStr}${instText}\n`;
  }

  out += `\nPodés seguir agregando, corregir alguno (ej: "el 2 fue de 5.000"), quitar ("quitá el 2") o responder *CONFIRMAR* para guardar todo.`;
  return out;
}

describe('formateo y persistencia de borradores múltiples', () => {
  it('formatea correctamente múltiples gastos e ingresos con cuotas', () => {
    const items: DraftItem[] = [
      { position: 1, kind: 'expense', description: 'Supermercado', amount: 15000, currency: 'ARS', status: 'pending' },
      { position: 2, kind: 'expense', description: 'Nafta', amount: 4000, currency: 'ARS', installments: 3, status: 'pending' },
      { position: 3, kind: 'income', description: 'Trabajo de diseño', amount: 80000, currency: 'ARS', status: 'pending' },
    ];

    const formatted = formatDraftList(items);
    expect(formatted).toMatch(/Tenés 3 movimientos para revisar:/);
    expect(formatted).toMatch(/1\. 🔴 Supermercado · \$\s*15\.000/);
    expect(formatted).toMatch(/2\. 🔴 Nafta · \$\s*4\.000 \(3 cuotas\)/);
    expect(formatted).toMatch(/3\. 🟢 Trabajo de diseño · \$\s*80\.000/);
    expect(formatted).toMatch(/CONFIRMAR/);
  });

  it('mantiene numeración estable cuando se elimina un ítem', () => {
    const items: DraftItem[] = [
      { position: 1, kind: 'expense', description: 'Supermercado', amount: 15000, currency: 'ARS', status: 'pending' },
      { position: 2, kind: 'expense', description: 'Nafta', amount: 4000, currency: 'ARS', status: 'removed' },
      { position: 3, kind: 'income', description: 'Trabajo de diseño', amount: 80000, currency: 'ARS', status: 'pending' },
    ];

    const formatted = formatDraftList(items);
    expect(formatted).toMatch(/Tenés 2 movimientos para revisar:/);
    expect(formatted).toMatch(/1\. 🔴 Supermercado/);
    expect(formatted).not.toMatch(/2\. 🔴 Nafta/);
    expect(formatted).toMatch(/3\. 🟢 Trabajo de diseño/);
  });

  it('informa correctamente cuando la lista queda vacía', () => {
    const items: DraftItem[] = [
      { position: 1, kind: 'expense', description: 'Supermercado', amount: 15000, currency: 'ARS', status: 'removed' },
    ];
    const formatted = formatDraftList(items);
    expect(formatted).toBe('No tenés movimientos pendientes en tu lista.');
  });
});

import { OperationalFailure } from "./failures.ts";

type CurrencyTotals = {
  currency: "ARS" | "USD";
  expenses: bigint;
  income: bigint;
  balance: bigint;
  operations: bigint;
};
type MonthlySnapshot = {
  month: string;
  budget: bigint | null;
  remaining: bigint | null;
  currencies: CurrencyTotals[];
};
const invalid = (): never => {
  throw new OperationalFailure(
    "database_read",
    "database",
    undefined,
    "QUEUE_BALANCE_READ",
  );
};
function cents(value: unknown): bigint {
  if (
    typeof value !== "string" || value.length > 128 ||
    !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)
  ) return invalid();
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}
export function parseMonthlySnapshot(
  value: unknown,
  expectedMonth: string,
): MonthlySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid();
  }
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 || v.month !== expectedMonth ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(expectedMonth) ||
    !Array.isArray(v.currencies) || v.currencies.length !== 2
  ) return invalid();
  const seen = new Set<string>();
  const currencies = v.currencies.map((item: unknown): CurrencyTotals => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return invalid();
    }
    const r = item as Record<string, unknown>;
    if (
      (r.currency !== "ARS" && r.currency !== "USD") || seen.has(r.currency) ||
      typeof r.operations !== "string" || r.operations.length > 30 ||
      !/^(0|[1-9]\d*)$/.test(r.operations)
    ) return invalid();
    seen.add(r.currency);
    const expenses = cents(r.expenses),
      income = cents(r.income),
      balance = cents(r.balance),
      operations = BigInt(r.operations);
    if (
      expenses < 0n || income < 0n || balance !== income - expenses ||
      (operations === 0n && (expenses !== 0n || income !== 0n))
    ) return invalid();
    return { currency: r.currency, expenses, income, balance, operations };
  });
  const budget = v.budget_ars === null ? null : cents(v.budget_ars);
  const remaining = v.remaining_budget_ars === null
    ? null
    : cents(v.remaining_budget_ars);
  if (
    (budget === null) !== (remaining === null) ||
    (budget !== null &&
      (budget <= 0n ||
        remaining !==
          budget - currencies.find((r) => r.currency === "ARS")!.expenses))
  ) return invalid();
  return { month: expectedMonth, budget, remaining, currencies };
}
function money(amount: bigint, currency: "ARS" | "USD"): string {
  const absolute = amount < 0n ? -amount : amount;
  const whole = (absolute / 100n).toString().replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
  const fraction = absolute % 100n;
  return `${currency === "USD" ? "US$" : "$"} ${
    amount < 0n ? "-" : ""
  }${whole}${fraction ? "," + fraction.toString().padStart(2, "0") : ""}`;
}
export function formatMonthlySnapshot(
  value: unknown,
  expectedMonth: string,
): string {
  const snapshot = parseMonthlySnapshot(value, expectedMonth);
  const ars = snapshot.currencies.find((r) => r.currency === "ARS")!;
  const usd = snapshot.currencies.find((r) => r.currency === "USD")!;
  const monthName = MONTH_NAMES[Number(snapshot.month.slice(5, 7)) - 1] ??
    snapshot.month;
  let body = `📊 *Tu resumen de ${monthName}*\n\n*Pesos*\n💸 Gastos: ${
    money(ars.expenses, "ARS")
  }\n💰 Ingresos: ${money(ars.income, "ARS")}\n📈 Balance: ${
    money(ars.balance, "ARS")
  }`;
  if (snapshot.budget === null) {
    body += "\n💡 Podés fijar un presupuesto mensual en la app.";
  } else if (snapshot.remaining! < 0n) {
    body += `\n⚠️ Te pasaste ${money(-snapshot.remaining!, "ARS")} del presupuesto`;
  } else {
    body += `\n🎯 Te quedan ${money(snapshot.remaining!, "ARS")} del presupuesto`;
  }
  if (usd.operations > 0n) {
    body += `\n\n*Dólares*\n💸 Gastos: ${
      money(usd.expenses, "USD")
    }\n💰 Ingresos: ${money(usd.income, "USD")}\n📈 Balance: ${
      money(usd.balance, "USD")
    }`;
  }
  return body;
}

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

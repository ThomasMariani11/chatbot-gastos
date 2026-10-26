import { describe, expect, it } from "vitest";
import { parseDeterministicMovement as parseOne, parseDeterministicMovements as parseMany } from "../supabase/functions/whatsapp-webhook/local-movements";
const parseDeterministicMovement = (text: string) => parseOne(text, "2026-10-20");
const parseDeterministicMovements = (text: string) => parseMany(text, "2026-10-20");

describe('parseDeterministicMovements', () => {
  it('parses Matias exact messages correctly', () => {
    const res1 = parseDeterministicMovement('21000 creatina');
    expect(res1).toMatchObject({
      kind: 'expense',
      description: 'Creatina',
      totalAmountArs: 21000,
      currency: 'ARS',
      category: 'Salud',
    });

    const res2 = parseDeterministicMovement('Gaste 21000 en creatina');
    expect(res2).toMatchObject({
      kind: 'expense',
      description: 'Creatina',
      totalAmountArs: 21000,
      category: 'Salud',
    });

    const res3 = parseDeterministicMovement('21.000 creatina');
    expect(res3).toMatchObject({
      kind: 'expense',
      description: 'Creatina',
      totalAmountArs: 21000,
      category: 'Salud',
    });

    const res4 = parseDeterministicMovement('21000 suplementos');
    expect(res4).toMatchObject({
      kind: 'expense',
      description: 'Suplementos',
      totalAmountArs: 21000,
      category: 'Salud',
    });
  });

  it('parses other common formats and numbers with k or lucas', () => {
    const res = parseDeterministicMovement('gaste 5000 super');
    expect(res).toMatchObject({
      kind: 'expense',
      description: 'Super',
      totalAmountArs: 5000,
      category: 'Alimentación',
    });

    const resLucas = parseDeterministicMovement('20 lucas nafta');
    expect(resLucas).toMatchObject({
      kind: 'expense',
      description: 'Nafta',
      totalAmountArs: 20000,
      category: 'Transporte',
    });

    const resIncome = parseDeterministicMovement('cobre 80k por diseño');
    expect(resIncome).toMatchObject({
      kind: 'income',
      description: 'Diseño',
      totalAmountArs: 80000,
      category: 'Freelance',
    });

    const resDescFirst = parseDeterministicMovement('creatina 21000');
    expect(resDescFirst).toMatchObject({
      kind: 'expense',
      description: 'Creatina',
      totalAmountArs: 21000,
      category: 'Salud',
    });

    const resDecimals = parseDeterministicMovement('caramelos 250,50');
    expect(resDecimals).toMatchObject({
      kind: 'expense',
      description: 'Caramelos',
      totalAmountArs: 250.5,
      category: 'Alimentación',
    });
  });

  it('parses multiple movements joined by "y"', () => {
    const res = parseDeterministicMovements('gaste 5000 en super y 4000 de nafta');
    expect(res).toHaveLength(2);
    expect(res![0]).toMatchObject({ description: 'Super', totalAmountArs: 5000 });
    expect(res![1]).toMatchObject({ description: 'Nafta', totalAmountArs: 4000 });
  });
});

describe("reglas reales: importes, monedas y lotes completos", () => {
  it.each([
    ["Pagué $15.000,50 en supermercado", 15000.5, "ARS", "Supermercado"],
    ["Cobré USD 100 por diseño", 100, "USD", "Diseño"],
    ["Me ingresó 70mil de una transferencia", 70000, "ARS", "Una transferencia"],
    ["Recibí US$ 25 por venta", 25, "USD", "Venta"],
    ["Gasté u$s100 en herramientas", 100, "USD", "Herramientas"],
    ["Gasté 2,5k en café", 2500, "ARS", "Café"],
    ["Gasté 20 lucas en nafta", 20000, "ARS", "Nafta"],
  ])("%s", (text, amount, currency, description) => {
    expect(parseDeterministicMovement(String(text))).toMatchObject({ totalAmountArs: amount, currency, description });
  });
  it("mantiene los decimales y el concepto compuesto", () => {
    const items = parseDeterministicMovements("Gasté 250,50 en pan y leche y 4000 de nafta");
    expect(items).toHaveLength(2);
    expect(items![0]).toMatchObject({ description: "Pan y leche", totalAmountArs: 250.5 });
  });
  it("varios gastos e ingresos con monedas independientes", () => {
    const items = parseDeterministicMovements("Gasté 5000 super, 6000 proteínas y me ingresó 70mil de una transferencia; cobré 100 USD por diseño");
    expect(items?.map(i => [i.kind, i.totalAmountArs, i.currency])).toEqual([
      ["expense", 5000, "ARS"], ["expense", 6000, "ARS"], ["income", 70000, "ARS"], ["income", 100, "USD"],
    ]);
  });
  it("listas por renglón con viñetas y numeración", () => {
    expect(parseDeterministicMovements("1. Gasté 100 en super\n2. Cobré 200 por diseño")?.map(i => i.totalAmountArs)).toEqual([100, 200]);
    expect(parseDeterministicMovements("- Gasté 100 super\n• Pagué 200 nafta")).toHaveLength(2);
  });
  it("no trunca listas mayores al límite SQL", () => {
    const items = Array.from({ length: 21 }, (_, n) => `Gasté ${n + 1} en super`).join("\n");
    expect(parseDeterministicMovements(items)).toHaveLength(21);
  });
  it("no infiere categorías por fragmentos de otras palabras", () => {
    expect(parseDeterministicMovement("Gasté 1500 en diario")).toMatchObject({ category: "Otros" });
    expect(parseDeterministicMovement("Gasté 1500 en cafetería")).toMatchObject({ category: "Otros" });
    expect(parseDeterministicMovement("Gasté 1500 en proteínas")).toMatchObject({ category: "Salud" });
  });
  it.each([
    "Gasté 5000 super y pagué alquiler",
    "Gasté 5000 en super y me ingresó una transferencia",
    "Cobré 100 por diseño y 200 de otra cosa",
    "Gasté 5000 super, gasté algo en nafta",
    "Gasté 5000 super\n",
    "Gasté 5000 super;",
  ])("rechaza todo el mensaje si no entiende una parte: %s", text => {
    expect(parseDeterministicMovements(text)).toBeNull();
  });
});

describe("fechas y cuotas sin confundirlas con importes", () => {
  it.each([
    ["Ayer gasté 100 en super", "2026-10-19"],
    ["Gasté 100 en super anteayer", "2026-10-18"],
    ["Gasté 100 en super el 19/10/2026", "2026-10-19"],
    ["Gasté 100 en super el 19/10", "2026-10-19"],
    ["Gasté 100 en super 2026-10-01", "2026-10-01"],
    ["Gasté 100 en super", "2026-10-20"],
  ])("%s", (text, occurredOn) => {
    expect(parseDeterministicMovement(text)).toMatchObject({ occurredOn, totalAmountArs: 100, description: "Super" });
  });
  it("resuelve ayer al cambiar de mes/año y rechaza fechas imposibles", () => {
    expect(parseOne("Ayer gasté 100 en super", "2026-01-01")?.occurredOn).toBe("2025-12-31");
    expect(parseOne("Gasté 100 en super 29/02/2024", "2026-10-20")?.occurredOn).toBe("2024-02-29");
    for (const date of ["31/02/2026", "29/02/2026", "2026-13-01"]) expect(parseDeterministicMovement(`Gasté 100 en super ${date}`)).toBeNull();
  });
  it("conserva el total y el primer mes; no divide el importe de las cuotas", () => {
    expect(parseDeterministicMovement("Compré silla por un total de 12000 en 3 cuotas")).toMatchObject({
      totalAmountArs: 12000, description: "Silla", installments: 3, firstInstallmentMonth: "2026-10",
    });
    expect(parseDeterministicMovement("Ayer pagué silla total 100 USD en 3 cuotas")).toMatchObject({ totalAmountArs: 100, currency: "USD", installments: 3, occurredOn: "2026-10-19" });
  });
});

describe("ante dudas, no inventa movimientos", () => {
  it.each([
    "¿Cuánto gasté en super 100?", "El 2 fue de 250", "Quitá el 2", "No gasté 5000 en super",
    "Tengo que pagar 1500 en super", "Me deben 2000 por diseño", "Quizás gasté 1000 en super",
    "Transferencia 5000", "Depósito 5000", "Gasté -100 en super", "Gasté 0 en super", "Gasté 1.00.000 en super",
    "Gasté 99999999999999999999999999 en super", "Gasté 1000000000000 en super",
    "Gasté 100 EUR en super", "Gasté 100 USD pesos en super", "Gasté 100 en super 200 de nafta",
    "Gasté 3 cuotas de 4000 en silla", "Compré silla 12000 en 3 cuotas", "Compré silla total 12000 en 61 cuotas",
    "Cobré total 12000 en 3 cuotas", "Gasté 100 super ayer y hoy", "Gasté 100 super el lunes",
    "Gasté 100 super el mes pasado", "Gasté 5000 por iphone 15", "El 2 de 100", "100",
  ])("%s", text => expect(parseDeterministicMovements(text)).toBeNull());
});

it("reconoce dólar en singular y mantiene cautela con el alcance de fechas y monedas", () => {
  expect(parseDeterministicMovement("Cobré 1 dólar por diseño")).toMatchObject({ currency: "USD", totalAmountArs: 1 });
  for (const text of ["Ayer gasté 100 super y 200 nafta", "Gasté 100 USD super y 200 nafta", "Gasté 100 pesos uruguayos en super", "Se me perdió 5000", "Me pasaron 5000"]) {
    expect(parseDeterministicMovements(text)).toBeNull();
  }
});

it("los ingresos conocidos no se convierten en gastos abreviados", () => {
  expect(parseDeterministicMovement("Vendí 5000 por una bici")).toMatchObject({ kind: "income", totalAmountArs: 5000 });
  expect(parseDeterministicMovement("Salario 5000")).toMatchObject({ kind: "income", totalAmountArs: 5000 });
  for (const text of ["Gané 5000 en un sorteo", "Encontré 5000", "Tenía 5000", "Cuál fue el gasto de 5000", "Mostrame el gasto de 5000"]) expect(parseDeterministicMovements(text)).toBeNull();
});


describe("BE-04: no confundir referencias de producto ni monedas fuera del contrato", () => {
  it.each([
    "Compré tornillos 10/10 por 1500",
    "Compré cable 2/10 por 5000",
    "Compré 1500 de modelo 10/10",
    "Compré una licencia 2026-10-20 por 5000",
    "Gasté 100 super 19/10",
    "Gasté 100 dólares canadienses en super",
    "Cobré 100 dólares australianos por diseño",
    "Gasté 100 pesos colombianos en super",
    "Gasté 100 pesos de Colombia en super",
    "Gasté 100 dólares de Canadá en super",
    "Gasté 100 CAD en super",
    "Cobré 100 AUD por diseño",
    "Gasté 100 COP en super",
    "Gasté 100 CLP en super",
    "Gasté 100 UYU en super",
    "Gasté 100 MXN en super",
    "Gasté 100 CHF en super",
    "Gasté 100 PEN en super",
  ])("deriva el mensaje completo sin modificar datos: %s", text => {
    expect(parseDeterministicMovement(text)).toBeNull();
    expect(parseDeterministicMovements(text)).toBeNull();
    expect(parseDeterministicMovements("Gasté 250 en super; " + text)).toBeNull();
    expect(parseDeterministicMovements(text + "; cobré 500 por diseño")).toBeNull();
  });
  it.each([
    ["Gasté 100 pesos argentinos en super", "expense", 100, "ARS", "Super"],
    ["Cobré 100 dólares estadounidenses por diseño", "income", 100, "USD", "Diseño"],
    ["Gasté ARS 100 en supermercado", "expense", 100, "ARS", "Supermercado"],
    ["Cobré USD 100 por diseño", "income", 100, "USD", "Diseño"],
    ["Gasté ARS 100 por licencia CAD", "expense", 100, "ARS", "Licencia CAD"],
  ])("conserva moneda, importe, tipo y concepto explícitos: %s", (text, kind, amount, currency, description) => {
    expect(parseDeterministicMovement(text)).toMatchObject({kind, totalAmountArs: amount, currency, description});
  });
  it.each([
    "Pagué 1500 el 19/10 en supermercado",
    "Pagué 1500 el día 19/10/2026 en supermercado",
    "Pagué 1500 con fecha 19/10/2026 en supermercado",
    "19/10/2026 pagué 1500 en supermercado",
    "Pagué 1500 en supermercado 2026-10-19",
    "Pagué 1500 en supermercado ayer",
  ])("extrae solo fechas con contexto inequívoco: %s", text => {
    expect(parseDeterministicMovement(text)).toMatchObject({totalAmountArs: 1500, description: "Supermercado", occurredOn: "2026-10-19"});
  });
});

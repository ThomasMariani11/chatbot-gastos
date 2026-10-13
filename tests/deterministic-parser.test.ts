import { describe, expect, it } from 'vitest';

export function parseDeterministicMovement(rawText: string, today: string = '2026-10-13') {
  const text = rawText.trim();
  if (!text) return null;

  const isIncome = /^(ingres[oó]|me\s+ingresaron|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito|sueldo|venta)\b/i.test(text);
  const kind: 'expense' | 'income' = isIncome ? 'income' : 'expense';
  const isUsd = /\b(usd|d[oó]lares?|u\$s|greens?)\b/i.test(text);
  const currency: 'ARS' | 'USD' = isUsd ? 'USD' : 'ARS';

  // Buscar monto numérico
  const amountRegex = /(?:^|\s|\$)(?:usd|u\$s)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(k|mil|lucas?)?\s*(?:pesos?|ars|usd|d[oó]lares?)?(?:\s|$)/i;
  const match = text.match(amountRegex);
  if (!match) return null;

  let rawNum = match[1];
  const multiplier = match[2]?.toLowerCase();

  // Normalizar número argentino
  if (rawNum.includes('.') && rawNum.includes(',')) {
    rawNum = rawNum.replace(/\./g, '').replace(',', '.');
  } else if (rawNum.includes('.')) {
    // Si tiene punto y 3 dígitos al final (ej: 21.000 o 5.000), es separador de miles
    if (/^\d{1,3}(?:\.\d{3})+$/.test(rawNum)) {
      rawNum = rawNum.replace(/\./g, '');
    }
  } else if (rawNum.includes(',')) {
    rawNum = rawNum.replace(',', '.');
  }

  let num = parseFloat(rawNum);
  if (!Number.isFinite(num) || num <= 0) return null;

  if (multiplier === 'k' || multiplier === 'mil' || multiplier === 'luca' || multiplier === 'lucas') {
    num *= 1000;
  }

  // Quitar el monto del texto para obtener la descripción
  let desc = text.replace(match[0], ' ').trim();
  desc = desc.replace(/^(gast[eé]|pagu[eé]|compr[eé]|abone|abon[eé]|carg[uú]e|pagar|gastar)\s*/i, '');
  desc = desc.replace(/^(ingres[oó]|me\s+ingresaron|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito\s+de)\s*/i, '');
  desc = desc.replace(/^(en\s+|de\s+|por\s+)/i, '');
  desc = desc.replace(/\s+(en|de|por)\s*$/i, '');
  desc = desc.trim();

  if (!desc) {
    desc = kind === 'expense' ? 'Gasto general' : 'Ingreso general';
  } else {
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  }

  // Inferir categoría
  const lowerDesc = desc.toLowerCase();
  let category = 'Otros';
  if (kind === 'income') {
    if (/sueldo|salario|haberes|quincena/.test(lowerDesc)) category = 'Sueldo';
    else if (/freelance|diseño|proyecto|cliente/.test(lowerDesc)) category = 'Freelance';
    else if (/venta|vendo|mercadolibre/.test(lowerDesc)) category = 'Ventas';
  } else {
    if (/super|chango|coto|vea|dia|disco|carrefour|almacen|verduleria|carniceria|panaderia|comida|almuerzo|cena|merienda|desayuno|cafe|restaurant|pedidosya|rappi|mcdonalds|mostaza|burger|helado|facturas|kiosco|caramelos/.test(lowerDesc)) category = 'Alimentación';
    else if (/nafta|combustible|ypf|shell|axion|uber|cabify|didi|taxi|colectivo|subte|tren|peaje|estacionamiento|cochera|sube/.test(lowerDesc)) category = 'Transporte';
    else if (/luz|gas|agua|internet|wifi|fibertel|telecentro|flow|cable|claro|personal|movistar|expensas|edenor|edesur|metrogas/.test(lowerDesc)) category = 'Servicios';
    else if (/alquiler|inmobiliaria/.test(lowerDesc)) category = 'Vivienda';
    else if (/farmacia|remedio|medicamento|medico|doctor|dentista|odontologo|psicologo|consulta|analisis|creatina|suplementos?|proteina|optica/.test(lowerDesc)) category = 'Salud';
    else if (/colegio|facultad|universidad|cuota|curso|taller|capacitacion|libro|apunte/.test(lowerDesc)) category = 'Educación';
    else if (/cine|teatro|boliche|recital|salida|bar|cerveza|juego|steam|playstation|netflix|spotify|disney|hbo|prime/.test(lowerDesc)) category = 'Ocio';
    else if (/ropa|zapatillas|remera|pantalon|shopping|zapatos|camisa|buzo|campera/.test(lowerDesc)) category = 'Compras';
    else if (/afip|rentas|monotributo|arba|iibb|impuesto|tasa|patente/.test(lowerDesc)) category = 'Impuestos';
    else if (/prestamo|tarjeta|cuota tarjeta|deuda/.test(lowerDesc)) category = 'Deudas';
  }

  return {
    kind,
    description: desc,
    totalAmountArs: num,
    currency,
    occurredOn: today,
    category,
    installments: 1,
    firstInstallmentMonth: null,
    confidence: 0.95,
    missingFields: [],
  };
}

export function parseDeterministicMovements(text: string, today: string = '2026-10-13') {
  const parts = text.split(/\n|(?:\s+y\s+)|\s*,\s*/i).map((p) => p.trim()).filter(Boolean);
  const results = [];
  for (const part of parts) {
    const mov = parseDeterministicMovement(part, today);
    if (mov) results.push(mov);
  }
  return results.length > 0 ? results : null;
}

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

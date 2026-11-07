// Catálogo único de categorías y palabras clave. Lo consumen el parser
// determinístico, el prompt de IA y la reclasificación SQL (paridad por test).
// Palabras clave ya normalizadas (sin acentos, minúsculas); se permiten frases.

export type CategoryKind = "expense" | "income";
export type CategoryRule = {
  kind: CategoryKind;
  name: string;
  family: string;
  isNew: boolean;
  keywords: string[];
};

const rule = (
  kind: CategoryKind,
  name: string,
  family: string,
  isNew: boolean,
  keywords: string,
): CategoryRule => ({
  kind,
  name,
  family,
  isNew,
  keywords: keywords ? keywords.split(",").map((word) => word.trim()) : [],
});

// El orden de esta lista es la prioridad de categoryFor.
export const CATEGORY_RULES: readonly CategoryRule[] = [
  // Gasto: categorías nuevas primero.
  rule(
    "expense",
    "Suscripciones",
    "Ocio",
    true,
    "netflix, spotify, disney, hbo, prime video, youtube premium, icloud, chatgpt, suscripcion, suscripciones",
  ),
  rule(
    "expense",
    "Restaurantes y delivery",
    "Alimentación",
    true,
    "restaurant, restaurante, pedidosya, rappi, mcdonalds, mostaza, burger, cafe, cafes, cafeteria, bar, parrilla, pizza, pizzeria, sushi, helado, heladeria, delivery",
  ),
  rule(
    "expense",
    "Auto",
    "Transporte",
    true,
    "mecanico, gomeria, cubiertas, neumaticos, service del auto, seguro del auto, seguro auto, lavadero, lavado del auto, cochera, estacionamiento, vtv",
  ),
  rule(
    "expense",
    "Tecnología",
    "Compras",
    true,
    "celular, notebook, computadora, laptop, tablet, auriculares, cargador, teclado, monitor, iphone",
  ),
  rule(
    "expense",
    "Hogar",
    "Compras",
    true,
    "mueble, muebles, colchon, heladera, lavarropas, microondas, electrodomestico, electrodomesticos, ferreteria, pintura, plomero, electricista, lavandina, detergente, articulos de limpieza",
  ),
  rule(
    "expense",
    "Hijos",
    "Compras",
    true,
    "panales, juguete, juguetes, jugueteria, ninera, guarderia",
  ),
  rule(
    "expense",
    "Cuidado personal",
    "Cuidado personal",
    true,
    "peluqueria, barberia, corte de pelo, perfumeria, perfume, cosmetica, maquillaje, manicura, depilacion",
  ),
  rule(
    "expense",
    "Deporte",
    "Salud",
    true,
    "gimnasio, gym, cancha, padel, natacion, creatina, suplemento, suplementos, proteina, proteinas",
  ),
  rule(
    "expense",
    "Mascotas",
    "Mascotas",
    true,
    "veterinaria, veterinario, balanceado, pet shop, petshop, mascota",
  ),
  rule(
    "expense",
    "Viajes",
    "Viajes",
    true,
    "pasaje, pasajes, vuelo, vuelos, hotel, hostel, airbnb, booking, excursion, despegar, aerolineas",
  ),
  rule(
    "expense",
    "Regalos y donaciones",
    "Regalos y donaciones",
    true,
    "regalo, regalos, donacion, donaciones",
  ),
  // Gasto: categorías existentes (sin las palabras que se mudaron).
  rule(
    "expense",
    "Alimentación",
    "Alimentación",
    false,
    "super, supermercado, chango, coto, vea, dia, disco, carrefour, almacen, verduleria, carniceria, panaderia, comida, almuerzo, cena, merienda, desayuno, facturas, kiosco, caramelos",
  ),
  rule(
    "expense",
    "Transporte",
    "Transporte",
    false,
    "nafta, combustible, ypf, shell, axion, uber, cabify, didi, taxi, colectivo, subte, tren, peaje, sube",
  ),
  rule(
    "expense",
    "Servicios",
    "Servicios",
    false,
    "luz, gas, agua, internet, wifi, fibertel, telecentro, flow, cable, claro, personal, movistar, expensas, edenor, edesur, metrogas",
  ),
  rule("expense", "Vivienda", "Vivienda", false, "alquiler, inmobiliaria"),
  rule(
    "expense",
    "Salud",
    "Salud",
    false,
    "farmacia, remedio, medicamento, medico, doctor, dentista, odontologo, psicologo, consulta, analisis, optica",
  ),
  rule(
    "expense",
    "Educación",
    "Educación",
    false,
    "colegio, facultad, universidad, curso, taller, capacitacion, libro, apunte",
  ),
  rule(
    "expense",
    "Ocio",
    "Ocio",
    false,
    "cine, teatro, boliche, recital, salida, cerveza, juego, steam, playstation",
  ),
  rule(
    "expense",
    "Compras",
    "Compras",
    false,
    "ropa, zapatillas, remera, pantalon, shopping, zapatos, camisa, buzo, campera",
  ),
  rule(
    "expense",
    "Impuestos",
    "Impuestos",
    false,
    "afip, rentas, monotributo, arba, iibb, impuesto, tasa, patente",
  ),
  rule("expense", "Deudas", "Deudas", false, "prestamo, tarjeta, deuda"),
  rule("expense", "Otros", "Otros", false, ""),
  // Ingreso.
  rule(
    "income",
    "Sueldo",
    "Sueldo",
    false,
    "sueldo, salario, haberes, quincena, aguinaldo, bono",
  ),
  rule(
    "income",
    "Freelance",
    "Freelance",
    false,
    "freelance, diseno, proyecto, cliente",
  ),
  rule("income", "Ventas", "Ventas", false, "venta, mercadolibre"),
  rule(
    "income",
    "Rendimientos",
    "Rendimientos",
    false,
    "plazo fijo, intereses, dividendos",
  ),
  rule(
    "income",
    "Alquileres",
    "Alquileres",
    true,
    "alquiler, alquileres, inquilino",
  ),
  rule(
    "income",
    "Reintegros",
    "Reintegros",
    true,
    "reintegro, reembolso, devolucion, cashback",
  ),
  rule("income", "Regalos", "Regalos", true, "regalo, regalaron"),
  rule(
    "income",
    "Jubilación y asignaciones",
    "Jubilación y asignaciones",
    true,
    "jubilacion, pension, auh, asignacion, asignaciones, anses",
  ),
  rule("income", "Otros", "Otros", false, ""),
];

export const CATEGORY_NAMES: Record<CategoryKind, readonly string[]> = {
  expense: CATEGORY_RULES.filter((r) => r.kind === "expense").map((r) =>
    r.name
  ),
  income: CATEGORY_RULES.filter((r) => r.kind === "income").map((r) => r.name),
};

export function normalizeConcept(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const matchers = new Map<CategoryRule, RegExp>(
  CATEGORY_RULES.filter((r) => r.keywords.length > 0).map((r) => [
    r,
    new RegExp("\\b(" + r.keywords.join("|") + ")\\b"),
  ]),
);

function matchingRules(description: string, kind: CategoryKind) {
  const text = normalizeConcept(description);
  return CATEGORY_RULES.filter((r) =>
    r.kind === kind && matchers.get(r)?.test(text)
  );
}

export function categoryFor(description: string, kind: CategoryKind): string {
  return matchingRules(description, kind)[0]?.name ?? "Otros";
}

export function categoryFamily(name: string, kind: CategoryKind): string {
  return CATEGORY_RULES.find((r) => r.kind === kind && r.name === name)
    ?.family ?? name;
}

export function matchingCategories(
  description: string,
  kind: CategoryKind,
): string[] {
  return matchingRules(description, kind).map((r) => r.name);
}

// Reclasifica solo con una única coincidencia y si es una categoría nueva.
export function reclassTarget(
  description: string,
  kind: CategoryKind,
): string | null {
  const found = matchingRules(description, kind);
  return found.length === 1 && found[0].isNew ? found[0].name : null;
}

// Patrón para regex de Postgres (\y = límite de palabra).
export function sqlPatternFor(r: CategoryRule): string {
  return "\\y(" + r.keywords.join("|") + ")\\y";
}

export function categoryPromptLines(): string {
  return `  * Gasto: ${CATEGORY_NAMES.expense.join(", ")}\n  * Ingreso: ${
    CATEGORY_NAMES.income.join(", ")
  }`;
}

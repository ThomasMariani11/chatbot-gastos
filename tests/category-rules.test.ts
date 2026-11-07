import { describe, expect, it } from "vitest";
import {
  CATEGORY_NAMES,
  CATEGORY_RULES,
  categoryFamily,
  categoryFor,
  categoryPromptLines,
  reclassTarget,
  sqlPatternFor,
} from "../supabase/functions/whatsapp-webhook/category-rules.ts";

describe("catálogo de categorías", () => {
  it("tiene 22 gastos y 9 ingresos con los nombres esperados", () => {
    expect(CATEGORY_NAMES.expense).toHaveLength(22);
    expect(CATEGORY_NAMES.income).toHaveLength(9);
    for (const name of [
      "Alimentación", "Transporte", "Servicios", "Vivienda", "Salud",
      "Educación", "Ocio", "Compras", "Impuestos", "Deudas", "Otros",
      "Suscripciones", "Restaurantes y delivery", "Auto", "Tecnología",
      "Hogar", "Hijos", "Cuidado personal", "Deporte", "Mascotas", "Viajes",
      "Regalos y donaciones",
    ]) expect(CATEGORY_NAMES.expense).toContain(name);
    for (const name of [
      "Sueldo", "Freelance", "Ventas", "Rendimientos", "Alquileres",
      "Reintegros", "Regalos", "Jubilación y asignaciones", "Otros",
    ]) expect(CATEGORY_NAMES.income).toContain(name);
  });

  it("clasifica con la primera regla que coincide", () => {
    expect(categoryFor("Netflix", "expense")).toBe("Suscripciones");
    expect(categoryFor("PedidosYa", "expense")).toBe("Restaurantes y delivery");
    expect(categoryFor("Cochera", "expense")).toBe("Auto");
    expect(categoryFor("Creatina", "expense")).toBe("Deporte");
    expect(categoryFor("Veterinaria", "expense")).toBe("Mascotas");
    expect(categoryFor("Supermercado", "expense")).toBe("Alimentación");
    expect(categoryFor("Nafta", "expense")).toBe("Transporte");
    expect(categoryFor("Varios", "expense")).toBe("Otros");
    expect(categoryFor("Alquiler", "income")).toBe("Alquileres");
    expect(categoryFor("Jubilación", "income")).toBe(
      "Jubilación y asignaciones",
    );
  });

  it("reclassTarget exige una sola coincidencia y categoría nueva", () => {
    expect(reclassTarget("Netflix", "expense")).toBe("Suscripciones");
    expect(reclassTarget("Super y café", "expense")).toBeNull();
    expect(reclassTarget("Nafta y lavadero", "expense")).toBeNull();
    expect(reclassTarget("Supermercado", "expense")).toBeNull();
    expect(reclassTarget("Varios", "expense")).toBeNull();
  });

  it("resuelve la familia de cada categoría", () => {
    expect(categoryFamily("Restaurantes y delivery", "expense")).toBe(
      "Alimentación",
    );
    expect(categoryFamily("Tecnología", "expense")).toBe("Compras");
  });

  it("genera el patrón SQL con límites de palabra de Postgres", () => {
    const mascotas = CATEGORY_RULES.find((r) => r.name === "Mascotas")!;
    expect(sqlPatternFor(mascotas)).toBe(
      "\\y(veterinaria|veterinario|balanceado|pet shop|petshop|mascota)\\y",
    );
  });

  it("el prompt lista todas las categorías", () => {
    const lines = categoryPromptLines();
    for (const name of [...CATEGORY_NAMES.expense, ...CATEGORY_NAMES.income]) {
      expect(lines).toContain(name);
    }
  });
});

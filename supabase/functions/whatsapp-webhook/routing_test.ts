import { prepareMessage } from "./processor.ts";
import { parseDeterministicMovements } from "./helpers.ts";
import type { Job } from "./queue.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const fixture =
  "Gasté 1100 en librería, 2200 en té y me ingresó 33mil de una transferencia";
function database(suspended = false) {
  const reads: string[] = [];
  let draftReads = 0;
  const db = {
    from: (table: string) => {
      reads.push(table);
      const data = table === "whatsapp_links"
        ? { user_id: "fixture-user" }
        : table === "profiles"
        ? {
          role: "client",
          subscription_status: suspended ? "suspended" : "active",
          subscription_until: null,
        }
        : table === "app_settings"
        ? { whatsapp_responses_enabled: true }
        : table === "system_config"
        ? { value: "true" }
        : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
    rpc: () => {
      draftReads++;
      return Promise.resolve({
        data: { items: [], is_stale: false },
        error: null,
      });
    },
  };
  return {
    db: db as unknown as Parameters<typeof prepareMessage>[0],
    reads,
    draftReads: () => draftReads,
  };
}
function job(body: string): Job {
  return {
    id: "synthetic-job",
    wa_id: "synthetic-route",
    user_id: "fixture-user",
    payload: {
      id: "synthetic-message",
      from: "synthetic-route",
      type: "text",
      text: { body },
    },
    attempts: 1,
    effect_applied: false,
    parsed_result: null,
    reply_text: null,
  };
}
Deno.test("procesador real: tres movimientos mixtos, sin consultas comerciales ni red", async () => {
  const { db, reads } = database();
  let checkpoints = 0;
  const result = await prepareMessage(db, job(fixture), () => {
    checkpoints++;
    return Promise.resolve();
  });
  assert(result.kind === "add", "El movimiento fue interceptado");
  const items = result.items as Array<
    { kind: string; totalAmountArs: number; description: string }
  >;
  assert(
    JSON.stringify(items.map((i) => [i.kind, i.totalAmountArs])) ===
      JSON.stringify([["expense", 1100], ["expense", 2200], ["income", 33000]]),
    "Se perdió o clasificó mal una operación",
  );
  assert(
    !items[2].description.toLowerCase().includes("me ingres"),
    "Descripción sin limpiar",
  );
  assert(checkpoints === 1, "Checkpoint incorrecto");
  assert(
    !reads.includes("transactions"),
    "Se consultó el saldo en vez de cargar",
  );
});
for (
  const text of [
    "Cobré 3400 por transferencia",
    "Me ingresó 3400 de una transferencia",
    "Me ingreso 3400 de una transferencia",
  ]
) {
  Deno.test(`parser real reconoce ingreso: ${text.split(" 3400")[0]}`, () => {
    const item = parseDeterministicMovements(text, "2026-10-15")?.[0];
    assert(
      item?.kind === "income" && item.totalAmountArs === 3400,
      "Ingreso clasificado incorrectamente",
    );
  });
}
Deno.test("consulta comercial real conserva soporte sin interpretar movimientos", async () => {
  const { db, draftReads } = database();
  const result = await prepareMessage(
    db,
    job("¿Cómo renuevo mi membresía?"),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("renovar"),
    "Consulta comercial rota",
  );
  assert(
    draftReads() === 0,
    "No corresponde interpretar una consulta comercial",
  );
});
Deno.test("clasificación no permite operaciones en cuentas suspendidas", async () => {
  const { db, draftReads } = database(true);
  const result = await prepareMessage(
    db,
    job(fixture),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("pausa"),
    "Se omitió el bloqueo",
  );
  assert(
    draftReads() === 0,
    "Se interpretó una operación de cuenta suspendida",
  );
});

Deno.test("corrección por posición no invoca IA ni crea un checkpoint de alta", async () => {
  const { db } = database();
  let checkpoints = 0;
  const result = await prepareMessage(db, job("el 2 fue de 250"), () => {
    checkpoints++;
    return Promise.resolve();
  });
  assert(
    result.kind === "edit" && result.position === 2 && result.amount === 250,
    "Corrección interpretada como alta",
  );
  assert(
    result.description === null && checkpoints === 0,
    "Se reinterpretó o cambió el concepto",
  );
});
Deno.test("una corrección incompleta no modifica ni se convierte en gasto", async () => {
  const { db } = database();
  const input = job("Cambiá la descripción del 2");
  input.parsed_result = {
    intent: "add_movements",
    movements: [{
      kind: "expense",
      description: "No debe agregarse",
      totalAmountArs: 2,
    }],
  };
  const result = await prepareMessage(db, input, () => Promise.resolve());
  assert(
    result.kind === "reply" && String(result.text).includes("No agregué"),
    "Una respuesta IA inválida agregó un gasto",
  );
});
Deno.test("dos correcciones juntas piden aclarar y conservan la lista", async () => {
  const { db } = database();
  const result = await prepareMessage(
    db,
    job("El 2 fue de 250 y el 3 de 500"),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("No modifiqué"),
    "Se aceptó parcialmente una instrucción ambigua",
  );
});

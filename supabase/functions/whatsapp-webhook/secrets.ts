// SEC-20: comparación de secretos en tiempo constante (sin cortar en el primer carácter distinto).
// Compara los SHA-256, así el largo del secreto tampoco se filtra por el tiempo.
export async function sameSecret(actual: string | null | undefined, expected: unknown): Promise<boolean> {
  if (!actual || typeof expected !== "string" || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [actual, expected].map(async (value) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(value)),
      )
    ),
  );
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

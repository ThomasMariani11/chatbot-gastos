// Prueba temporal del bloqueo de CI; se elimina antes de integrar.
import { expect, test } from 'vitest';
test('INF-06: rechazo deliberado para verificar el control', () => { expect(true).toBe(false); });

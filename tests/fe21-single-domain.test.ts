import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FE-21: el Resumen usa una sola implementación del dominio (src/dashboardData.ts),
// sin copias de respaldo que puedan divergir.
const dashboard = readFileSync(join(process.cwd(), 'src', 'Dashboard.tsx'), 'utf8');

describe('FE-21 · una sola implementación del dominio en el Resumen', () => {
  it('no suma totales por su cuenta ni elige entre implementaciones', () => {
    expect(dashboard).not.toContain('Math.round(Number(item.amount) * 100)');
    expect(dashboard).not.toMatch(/'\w+' in dashboardDataModule/);
    expect(dashboard).not.toContain('const fallback: DashboardQueryCache');
  });

  it('importa totales, caché e intervalo desde dashboardData', () => {
    expect(dashboard).toMatch(/import \{[^}]*\bcomputeTotalsByCurrency\b[^}]*\} from '\.\/dashboardData'/);
    expect(dashboard).toMatch(/import \{[^}]*\bcreateDashboardQueryCache\b[^}]*\} from '\.\/dashboardData'/);
    expect(dashboard).toMatch(/import \{[^}]*\bDASHBOARD_POLL_INTERVAL_MS\b[^}]*\} from '\.\/dashboardData'/);
  });
});

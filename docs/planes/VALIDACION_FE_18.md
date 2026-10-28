# Validación FE-18 — Reducir consultas y paginar resultados

## 1. Objetivo
Acotar la frecuencia y el volumen de consultas del cliente web (`Dashboard` y `AdminPanel`), cachear dominios estables con invalidación selectiva por eventos y visibilidad, pausar el polling en segundo plano cuando la pestaña está oculta o sin red, y paginar tanto las lecturas de base de datos que superan los topes del servidor como los listados largos de la interfaz.

## 2. Cambios implementados

### 2.1. Caché por dominio y reducción de consultas en `src/dashboardData.ts` y `src/Dashboard.tsx`
- **`createDashboardQueryCache(userId)`**: almacena en memoria por usuario:
  - `botPhone` (`system_config.whatsapp_bot_phone`, TTL 10 min).
  - `botState` (`whatsapp_links` + `app_settings`, TTL 2 min).
  - `months` (`get_distinct_transaction_months`, TTL 2 min).
  - `installments` (cuotas confirmadas de todos los planes, TTL 1 min).
- **Cambio de mes acotado**: al navegar entre meses (p. ej. `2026-10` → `2026-09`), `readDashboardSnapshot` reutiliza los dominios en caché vigentes y ejecuta únicamente **2 consultas** (`transactions` del mes y `budgets` del mes) en lugar de 7.
- **Categorías estables**: `categories` se carga por `userId` y solo vuelve a pedirse si el usuario reintenta tras un error de carga (`categoriesReloadNonce`), evitando re-consultar categorías en cada cambio de mes o refresco periódico.
- **Invalidación selectiva**:
  - Eventos Realtime en `transactions` invalidan `installments` y `months`.
  - Eventos Realtime en `whatsapp_links` y `app_settings` invalidan `botState`.
  - Al volver a ser visible la pestaña (`visibilitychange` → `visible`), se invalidan `installments` y `botState` y se refresca la vista.
  - Al recuperar conexión (`online`), se invalida toda la caché (`invalidateAll()`) y se refresca.
- **Pausa de polling en segundo plano**:
  - Se reemplazó el intervalo fijo de `5.000 ms` (84 consultas/minuto por pestaña) por `DASHBOARD_POLL_INTERVAL_MS = 30.000 ms` condicionado a `document.visibilityState !== 'hidden'` y `navigator.onLine !== false` (**0 consultas/minuto** con pestaña oculta o sin conexión).

### 2.2. Lectura paginada sin truncamiento y totales exactos por moneda (`src/dashboardData.ts`)
- **`readMonthlyTransactions`**: lee transacciones mensuales en bloques de 250 filas con cursor ordenado por `id` y `count: 'exact'`, verificando que la suma de filas recibidas coincida con el conteo total del servidor antes de entregar los datos. Si un mes supera las 1.000 filas (límite por defecto de PostgREST), se recuperan todas las páginas sin truncar totales ni omitir movimientos.
- **`computeTotalsByCurrency(items, currency)`**: calcula `expenses`, `income` y `balance` sumando en centavos enteros (`Math.round(amount * 100)`) filtrando estrictamente por moneda (`ARS` o `USD`) sin mezclar divisas ni arrastrar errores de punto flotante.

### 2.3. Consolidación de consultas y paginación en `src/AdminPanel.tsx`, `src/Dashboard.tsx` y `src/ui.css`
- **Consolidación de `system_config` en `AdminPanel`**: las 4 consultas individuales (`whatsapp_bot_phone`, `bot_active`, `support_phone`, `payment_alias`) se unifican en una única consulta `.select('key, value').in('key', [...])` con respaldo compatible para mocks simples.
- **Lectura multipágina en `AdminPanel`**: `fetchAllOrderedRows` pagina por bloques (`.range(offset, offset + 499)`) con `count: 'exact'` sobre `profiles` e `invitation_codes` para que las métricas globales (`Clientes`, `Activos`, `Vencen en 7 días`, `Invitaciones libres`) nunca se trunquen.
- **Paginación de interfaz accesible**:
  - `#movimientos` en `Dashboard.tsx`: muestra `MOVEMENTS_PAGE_SIZE = 50` movimientos por página con barra `<nav aria-label="Paginación de movimientos">`, rango visible (`Mostrando X–Y de Z`) y botones `Anterior` / `Siguiente`. Reinicia a la página 1 al cambiar de mes, moneda, búsqueda o filtros.
  - `Clientes` e `Invitaciones` en `AdminPanel.tsx`: muestran `ADMIN_PAGE_SIZE = 20` filas por página con `<nav aria-label="Paginación de clientes">` y `<nav aria-label="Paginación de invitaciones">`, reiniciando a la página 1 al cambiar la búsqueda o el filtro de estado.

## 3. Comparativa de consultas antes y después

| Escenario | Antes | Después (FE-18) |
| --- | --- | --- |
| Carga inicial del Dashboard | 8 consultas (7 snapshot + 1 categorías) | 8 consultas (con caché poblada) |
| Cambio de mes en el selector | 7 consultas | **2 consultas** (`transactions` del mes + `budgets`) |
| Polling con pestaña oculta (1 minuto) | 84 consultas/min (12 × 7) | **0 consultas/min** |
| Polling con pestaña visible (1 minuto) | 84 consultas/min (cada 5 s) | **4 consultas/min** (cada 30 s con caché de dominios estables) |
| Carga de configuración en `AdminPanel` | 4 consultas a `system_config` | **1 consulta** `.in('key', ...)` |

## 4. Evidencia de pruebas
- `tests/fe18-queries-and-pagination.test.ts` (4 tests):
  1. Paginación de >600 transacciones mensuales en múltiples páginas y cálculo exacto en centavos para `ARS` y `USD` sin truncamiento ni mezcla de monedas.
  2. Reutilización de caché al cambiar de mes (reducción de 7 a 2 consultas) e invalidación selectiva de cuotas y estado del bot.
  3. Pausa de polling cuando `document.visibilityState === 'hidden'`, reanudación al volver a `visible` sin recargar categorías y paginación de `#movimientos` con más de 50 operaciones.
  4. Unificación de `system_config` en 1 consulta en `AdminPanel`, preservación de métricas globales y controles de paginación de 20 filas por página en `Clientes` e `Invitaciones`.

import type { DashboardData } from './types';

export const demoDashboard: DashboardData = {
  month: '2026-09',
  budgetArs: 900000,
  botEnabled: true,
  paidServiceMessagesAuthorized: false,
  movements: [
    { id: '1', description: 'Supermercado Coto', categoryName: 'Alimentación', amountArs: 48320, occurredOn: '2026-09-02', kind: 'expense', status: 'confirmed' },
    { id: '2', description: 'Carga SUBE', categoryName: 'Transporte', amountArs: 12000, occurredOn: '2026-09-02', kind: 'expense', status: 'confirmed' },
    { id: '3', description: 'Sueldo', categoryName: 'Sueldo', amountArs: 1250000, occurredOn: '2026-09-01', kind: 'income', status: 'confirmed' },
    { id: '4', description: 'Internet', categoryName: 'Servicios', amountArs: 28900, occurredOn: '2026-09-01', kind: 'expense', status: 'confirmed' },
  ],
};

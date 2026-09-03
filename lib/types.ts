export type TransactionKind = 'expense' | 'income';

export type FinancialProposal = {
  kind: TransactionKind;
  description: string;
  totalAmountArs: number | null;
  occurredOn: string | null;
  category: string | null;
  installments: number;
  firstInstallmentMonth: string | null;
  confidence: number;
  missingFields: Array<'amount' | 'date' | 'category'>;
};

export type Movement = {
  id: string;
  description: string;
  categoryName: string;
  amountArs: number;
  occurredOn: string;
  kind: TransactionKind;
  status: 'pending' | 'confirmed' | 'cancelled';
  installmentNumber?: number;
  installmentCount?: number;
};

export type DashboardData = {
  month: string;
  budgetArs: number;
  movements: Movement[];
  botEnabled: boolean;
  paidServiceMessagesAuthorized: boolean;
};

export type ExtractedMovement = {
  kind: "expense" | "income";
  description: string;
  totalAmountArs: number | null;
  currency: "ARS" | "USD";
  occurredOn: string | null;
  category: string | null;
  installments: number;
  firstInstallmentMonth: string | null;
  confidence: number;
  missingFields: string[];
  clarification?: string | null;
};

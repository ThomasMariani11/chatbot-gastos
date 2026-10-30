export function smokeRenewalContract(
  sql: (statement: string) => Promise<unknown>,
  id: string,
  options?: { transaction?: boolean },
): Promise<void>;

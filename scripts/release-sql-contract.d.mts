export function smokeBusinessContract(
  sql: (query: string) => Promise<unknown>,
  id: string,
  options?: { transaction?: boolean },
): Promise<void>;

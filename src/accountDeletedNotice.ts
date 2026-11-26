// 3.2 (LEG-01): aviso "Tu cuenta fue borrada" que la pantalla de ingreso muestra una sola vez.
// Es una comodidad de esta pestaña: si el almacenamiento no está disponible, no se muestra y nada se rompe.
export const ACCOUNT_DELETED_FLAG = 'pesito-account-deleted';
export const ACCOUNT_DELETED_MESSAGE = 'Tu cuenta fue borrada. Gracias por usar Pesito.';

export function markAccountDeleted(): void {
  try { sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1'); } catch { /* sin almacenamiento */ }
}

export function hasAccountDeletedNotice(): boolean {
  try { return sessionStorage.getItem(ACCOUNT_DELETED_FLAG) === '1'; } catch { return false; }
}

export function clearAccountDeletedNotice(): void {
  try { sessionStorage.removeItem(ACCOUNT_DELETED_FLAG); } catch { /* sin almacenamiento */ }
}

// Errores acotados: no reflejar mensajes SQL, códigos o metadata del servidor.
export function registrationErrorMessage(error: unknown, submitted: boolean): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message).toLowerCase() : '';
  if (message.includes('already registered') || message.includes('user already exists')) return 'Ya existe una cuenta con este correo. Probá iniciar sesión o confirmar tu correo.';
  if (message.includes('database error') || message.includes('registration_initialization_failed')) return 'No se pudo completar el alta. No se consumió tu invitación por este intento. Verificá el código e intentá de nuevo; si sigue fallando, contactanos.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Hay demasiados intentos. Esperá unos minutos antes de volver a probar.';
  if (message.includes('password')) return 'Revisá la contraseña: debe cumplir los requisitos indicados.';
  if (!submitted) return 'No pudimos verificar el código. Comprobá tu conexión e intentá de nuevo.';
  return 'No pudimos comprobar si se creó tu cuenta. Antes de repetir, probá iniciar sesión o revisá tu correo. Conservamos los datos del formulario; no uses otro código todavía.';
}

import type { AuthError } from '@supabase/supabase-js';

export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordCheck {
  valid: boolean;
  checks: {
    length: boolean;
    lowercase: boolean;
    uppercase: boolean;
    number: boolean;
  };
}

export function checkPassword(password: string): PasswordCheck {
  const checks = {
    length: password.length >= MIN_PASSWORD_LENGTH,
    lowercase: /[a-záéíóúñ]/.test(password),
    uppercase: /[A-ZÁÉÍÓÚÑ]/.test(password),
    number: /\d/.test(password),
  };

  return { valid: Object.values(checks).every(Boolean), checks };
}

export function passwordValidationMessage(password: string): string | null {
  const result = checkPassword(password);
  if (result.valid) return null;
  if (!result.checks.length) return `Usá al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  return 'Combiná mayúsculas, minúsculas y al menos un número.';
}

/**
 * Traduce fallos del proveedor a acciones comprensibles para la persona.
 * Los mensajes técnicos completos quedan en consola/observabilidad, nunca en
 * el toast: pueden incluir nombres de infraestructura o detalles de seguridad.
 */
export function authErrorForCustomer(error: unknown, fallback = 'No pudimos completar la operación. Intentá nuevamente.'): string {
  const authError = error as Partial<AuthError> | undefined;
  const code = String(authError?.code ?? '').toLowerCase();
  const message = String(authError?.message ?? '').toLowerCase();
  const value = `${code} ${message}`;

  if (/invalid_credentials|invalid login credentials/.test(value)) {
    return 'El email o la contraseña no son correctos.';
  }
  if (/email_not_confirmed|email not confirmed/.test(value)) {
    return 'Confirmá tu email antes de ingresar. Revisá también correo no deseado.';
  }
  if (/same_password|new password should be different/.test(value)) {
    return 'La nueva contraseña debe ser diferente de la actual.';
  }
  if (/weak_password|password should be at least|password is too weak/.test(value)) {
    return `La contraseña no cumple los requisitos de seguridad.`;
  }
  if (/reauthentication_needed|current_password|password.*incorrect/.test(value)) {
    return 'La contraseña actual no es correcta.';
  }
  if (/over_email_send_rate_limit|rate limit|too many requests/.test(value)) {
    return 'Hiciste varios intentos seguidos. Esperá un minuto y volvé a probar.';
  }
  if (/otp_expired|expired|invalid.*token|token.*invalid/.test(value)) {
    return 'El enlace o código venció. Solicitá uno nuevo.';
  }
  if (/network|failed to fetch|fetch failed/.test(value)) {
    return 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.';
  }
  if (/provider.*not enabled|unsupported provider/.test(value)) {
    return 'Este método de acceso no está disponible por el momento.';
  }
  if (/redirect/.test(value)) {
    return 'No pudimos completar el acceso. Probá nuevamente desde esta página.';
  }

  return fallback;
}

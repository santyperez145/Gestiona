/**
 * Cuenta opcional en checkout: el invitado siempre puede comprar.
 * Crear cuenta reusa storeAuth.signUp y nunca deshace la orden.
 */
export function checkoutDebeIntentarCuenta(input: {
  yaTieneCuenta: boolean;
  quiereCuenta: boolean;
  password: string;
}): { intentar: false } | { intentar: true } | { intentar: false; error: string } {
  if (input.yaTieneCuenta || !input.quiereCuenta) return { intentar: false };
  const password = input.password ?? '';
  if (password.length < 6) {
    return { intentar: false, error: 'La contraseña tiene que tener al menos 6 caracteres, o desmarcá crear cuenta.' };
  }
  return { intentar: true };
}

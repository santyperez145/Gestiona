/**
 * Cuenta opcional en checkout: el invitado siempre puede comprar.
 * Crear cuenta reusa storeAuth.signUp y nunca deshace la orden.
 */
import { passwordValidationMessage } from "@/lib/passwordSecurity";

export function checkoutDebeIntentarCuenta(input: {
  yaTieneCuenta: boolean;
  quiereCuenta: boolean;
  password: string;
}): { intentar: false } | { intentar: true } | { intentar: false; error: string } {
  if (input.yaTieneCuenta || !input.quiereCuenta) return { intentar: false };
  const password = input.password ?? '';
  const passwordError = passwordValidationMessage(password);
  if (passwordError) {
    return { intentar: false, error: `${passwordError} También podés desmarcar crear cuenta y continuar como invitado.` };
  }
  return { intentar: true };
}

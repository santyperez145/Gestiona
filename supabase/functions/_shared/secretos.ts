/**
 * Descifrado de secretos por tenant en reposo.
 *
 * Los secretos (contraseñas SMTP, claves privadas AFIP, secretos de webhooks)
 * se guardan cifrados con el envelope `nerqia:v1` y una clave que vive en
 * Vault. La base expone `secret_decrypt`/`secret_encrypt` sólo a `service_role`,
 * así que este helper debe llamarse con el cliente admin.
 *
 * Transparente con el legado: si un valor todavía está en claro (una fila que
 * la migración no alcanzó), `secret_decrypt` lo devuelve tal cual. Por eso un
 * deploy de la Edge puede adelantarse a la migración sin romper.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** Descifra un secreto del envelope nerqia:v1. Devuelve el valor tal cual si es legado. */
export async function descifrarSecreto(admin: AdminClient, valor: string | null | undefined): Promise<string> {
  if (!valor) return "";
  // Un valor sin envelope no pasó por cifrado: se evita el viaje a la base.
  if (!valor.startsWith("nerqia:v1:")) return valor;

  const { data, error } = await admin.rpc("secret_decrypt", { p_value: valor });
  if (error) throw new Error(`No se pudo descifrar el secreto: ${error.message}`);
  return (data as string) ?? "";
}

/** Cifra un secreto antes de guardarlo. Idempotente con el envelope. */
export async function cifrarSecreto(admin: AdminClient, valor: string | null | undefined): Promise<string> {
  if (!valor) return "";
  if (valor.startsWith("nerqia:v1:")) return valor;

  const { data, error } = await admin.rpc("secret_encrypt", { p_value: valor });
  if (error) throw new Error(`No se pudo cifrar el secreto: ${error.message}`);
  return (data as string) ?? "";
}

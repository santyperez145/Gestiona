/**
 * Lectura de `afip_connection_status` que no se rompe si la migración del
 * certificado propio (20261022000100) todavía no se aplicó.
 *
 * Las migraciones se aplican a mano y el código se publica antes: entre los
 * dos momentos, pedir `certificado_vence` devuelve 42703 y la página de ARCA
 * quedaría en «no pudimos leer el estado fiscal». Se pide con las columnas
 * nuevas y, sólo si faltan, se repite sin ellas (el comercio sigue en el
 * flujo anterior hasta que la migración lo pase a certificado propio).
 */
import { isMissingColumn } from "@/lib/publicDataSource";

export const COLUMNAS_CERTIFICADO_PROPIO =
  "certificado_vence, certificado_emisor, certificado_verificado_ok, certificado_verificado_at, certificado_verificado_motivo, pedido_pendiente, pedido_csr, pedido_ambiente, pedido_creado_at";

type Resultado<T> = { data: T | null; error: { code?: string; message?: string } | null };

export async function conColumnasDelCertificado<T>(
  base: string,
  nuevas: string,
  leer: (columnas: string) => PromiseLike<Resultado<T>>,
): Promise<Resultado<T>> {
  const completo = await leer(`${base}, ${nuevas}`);
  if (!completo.error || !isMissingColumn(completo.error)) return completo;
  console.warn("[ARCA] la migración del certificado propio todavía no está aplicada: se lee sin sus columnas");
  return leer(base);
}

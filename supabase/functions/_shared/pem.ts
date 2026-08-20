/**
 * Validación de PEM, compartida por los dos caminos que reciben certificados:
 * el del comercio (`afip-credentials`) y el de la plataforma
 * (`afip-platform-cert`).
 *
 * Está acá y no duplicada porque un PEM mal validado no falla al guardarse:
 * falla mucho después, al firmar el ticket de WSAA, con un error de node-forge
 * que no menciona el certificado. Una sola regla, un solo lugar donde
 * corregirla.
 */

/** Un PEM válido empieza y termina donde corresponde. */
export function esPem(texto: string, tipo: "CERTIFICATE" | "PRIVATE KEY"): boolean {
  const t = texto.trim();
  if (tipo === "CERTIFICATE") {
    return t.startsWith("-----BEGIN CERTIFICATE-----")
        && t.includes("-----END CERTIFICATE-----");
  }
  // AFIP acepta clave RSA o PKCS#8; las dos formas son válidas.
  return (t.startsWith("-----BEGIN PRIVATE KEY-----") && t.includes("-----END PRIVATE KEY-----"))
      || (t.startsWith("-----BEGIN RSA PRIVATE KEY-----") && t.includes("-----END RSA PRIVATE KEY-----"));
}

export const ERROR_CERT =
  "El certificado no parece un PEM válido (debe empezar con -----BEGIN CERTIFICATE-----)";
export const ERROR_CLAVE =
  "La clave privada no parece un PEM válido (debe empezar con -----BEGIN PRIVATE KEY----- o -----BEGIN RSA PRIVATE KEY-----)";

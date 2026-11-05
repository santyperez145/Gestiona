/**
 * Origen al que Mercado Pago devuelve al comprador después de pagar.
 *
 * El navegador manda su propio origen, pero cualquiera puede pedir un link de
 * pago con un origen inventado: el comprador terminaría en un sitio que copia
 * la tienda. Sólo valen el origen público de Nerqia (y sus subdominios), el
 * dominio propio verificado de la tienda y localhost para desarrollo.
 */
export function origenDeVueltaPermitido(
  valor: unknown,
  opciones: { basePublica?: string | null; dominioPropio?: string | null },
): string | null {
  if (typeof valor !== "string" || !valor || valor.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") {
    return host === "localhost" || host === "127.0.0.1" ? url.origin : null;
  }
  if (url.protocol !== "https:") return null;

  let base: URL | null = null;
  try {
    base = opciones.basePublica ? new URL(opciones.basePublica) : null;
  } catch {
    base = null;
  }
  const hostBase = base?.hostname.toLowerCase();
  if (hostBase && (host === hostBase || host.endsWith(`.${hostBase}`))) return url.origin;
  if (host === "nerqia.app" || host.endsWith(".nerqia.app")) return url.origin;

  const propio = opciones.dominioPropio?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (propio && host === propio) return url.origin;
  return null;
}

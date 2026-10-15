/**
 * Registro propio de errores de la app (migración 20261011002000), para que
 * los errores queden medidos aunque no haya Sentry configurado (medido
 * 2026-10-11: producción no tenía DSN). Sin datos personales: el mensaje se
 * limpia con las mismas reglas que Sentry (emails, tokens), la ruta va sin
 * query string y no se manda usuario ni comercio. Tope por visita y nada en
 * navegadores automatizados. Best-effort: si falla, no pasa nada.
 */
import { getOptionalEnv } from "@/lib/env";
import { redactTelemetryText } from "@/lib/sentry";
import { esNavegadorAutomatizado } from "@/lib/vitalesTienda";

export const MAX_ERRORES_POR_VISITA = 10;
const enviados = new Set<string>();

export function origenDeRuta(pathname: string): "panel" | "tienda" | "otro" {
  if (pathname.startsWith("/tienda/") || pathname === "/tienda") return "tienda";
  if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/registro")) return "otro";
  return "panel";
}

/** Mensaje legible y sin datos personales, o null si no vale la pena mandarlo. */
export function mensajeDeError(error: unknown): string | null {
  const crudo = error instanceof Error ? `${error.name}: ${error.message}`
    : typeof error === "string" ? error
    : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
    : "";
  const limpio = redactTelemetryText(crudo).replace(/\s+/g, " ").trim().slice(0, 300);
  return limpio || null;
}

export function registrarError(error: unknown, pathname = typeof location !== "undefined" ? location.pathname : ""): void {
  try {
    if (esNavegadorAutomatizado()) return;
    const mensaje = mensajeDeError(error);
    if (!mensaje || enviados.has(mensaje) || enviados.size >= MAX_ERRORES_POR_VISITA) return;
    enviados.add(mensaje);
    const url = getOptionalEnv("VITE_SUPABASE_URL");
    const clave = getOptionalEnv("VITE_SUPABASE_ANON_KEY") ?? getOptionalEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (!url || !clave) return;
    void fetch(`${url}/rest/v1/rpc/registrar_error_app`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: clave, Authorization: `Bearer ${clave}` },
      body: JSON.stringify({ p_origen: origenDeRuta(pathname), p_mensaje: mensaje, p_ruta: pathname.slice(0, 120) }),
    }).catch(() => { /* best-effort */ });
  } catch {
    // best-effort
  }
}

/**
 * Espera una consulta y deja su error en el registro (2026-10-15). 71 lecturas
 * hacían `const { data } = await …` y descartaban el error: si fallaban, la
 * pantalla seguía como si no hubiera datos. Devuelve la respuesta tal cual.
 */
export async function conRegistro<T extends { error?: unknown }>(consulta: PromiseLike<T>): Promise<T> {
  const r = await consulta;
  if (r?.error) registrarError(r.error);
  return r;
}

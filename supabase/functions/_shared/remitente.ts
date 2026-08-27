import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
/**
 * De qué dirección sale un correo de la plataforma.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ El remitente estaba hardcodeado en **nueve** funciones, con nueve
 * direcciones distintas del mismo dominio inventado (`@gestiona.app`). Resend
 * sólo entrega desde un dominio verificado en la cuenta, así que si el dominio
 * verificado era otro —o no había ninguno— **todas** rechazaban, y cargar bien
 * la API key no cambiaba nada: no había dónde decirle cuál es el dominio.
 *
 * Ese era el «configuré Resend y no funciona» del 2026-08-27.
 *
 * 📌 Ahora sale de `platform_messaging_config`, que es una fila que el dueño
 * edita desde la consola. Acá no hay ningún secreto: la API key sigue en el
 * entorno de las Edge Functions.
 */

/** Los propósitos que hoy mandan correo. Cada uno puede tener su casilla. */
export type Proposito =
  | "default" | "marketing" | "facturas" | "pedidos"
  | "digest" | "automatizaciones" | "admin";

export interface Remitente {
  /** Lo que va en el `from`: `Nombre <casilla@dominio>`. */
  from: string;
  /** Si el envío está probado contra el proveedor. */
  listo: boolean;
  dominio: string | null;
}

/**
 * Resuelve el remitente para un propósito.
 *
 * 📌 Devuelve el `from` **aunque no esté verificado**, y lo dice en `listo`.
 * Negarse a armarlo dejaría a los crons sin poder ni siquiera intentar, y el
 * error del proveedor —que es la información útil— nunca aparecería.
 *
 * 📌 Arma su propio cliente en vez de recibirlo. Las nueve funciones que mandan
 * correo llaman a su cliente de service role de nueve formas distintas
 * (`admin`, `supabase`, `sb`…), y pedirlo por parámetro convertía un cambio de
 * una línea en nueve ediciones a mano, cada una con su forma de romperse.
 */
export async function remitenteDe(proposito: Proposito = "default"): Promise<Remitente> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    console.error("remitenteDe: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return { from: "", listo: false, dominio: null };
  }
  const admin = createClient(url, serviceRole);
  const { data, error } = await admin.rpc("mensajeria_de_plataforma");
  if (error || !data) {
    console.error("no se pudo leer la configuración de mensajería", error);
    return { from: "", listo: false, dominio: null };
  }

  const dominio = data.email_dominio as string | null;
  const nombre = (data.email_nombre as string) || "Gestiona";
  const casillas = (data.email_casillas ?? {}) as Record<string, string>;
  const casilla = casillas[proposito] || casillas.default || "noreply";

  return {
    from: dominio ? `${nombre} <${casilla}@${dominio}>` : "",
    listo: Boolean(data.email_listo),
    dominio,
  };
}

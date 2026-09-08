import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { SmtpConfig } from "./smtpSender.ts";
/**
 * De qué dirección sale un correo de la plataforma.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ El remitente estaba hardcodeado en **nueve** funciones, con nueve
 * direcciones distintas del mismo dominio inventado (`@nerqia.app`). Resend
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

export type ProveedorCorreoPlataforma =
  | "resend_api"
  | "gmail_smtp"
  | "microsoft_smtp"
  | "zoho_smtp"
  | "smtp_personalizado";

export interface Remitente {
  /** Lo que va en el `from`: `Nombre <casilla@dominio>`. */
  from: string;
  /** Si el envío está probado contra el proveedor. */
  listo: boolean;
  dominio: string | null;
  proveedor: ProveedorCorreoPlataforma;
  transporte: "resend" | "smtp";
  /**
   * El SMTP propio de la plataforma, si está configurado.
   *
   * ⚠️ La contraseña sale del entorno (`SMTP_PASSWORD`), nunca de la base:
   * `platform_messaging_config` la lee el staff desde el navegador.
   */
  smtp: SmtpConfig | null;
  /**
   * Está configurado el servidor pero **falta la contraseña** en el entorno.
   *
   * ⚠️ Sin esto el sistema caía a Resend con un remitente armado para el SMTP
   * —una casilla de Gmail— y Resend contestaba «the gmail.com domain is not
   * verified». Un error verdadero sobre el proveedor equivocado: manda a
   * verificar un dominio que no hace falta verificar, y esconde que lo único
   * que falta es cargar un secreto.
   */
  faltaLaClaveSmtp: boolean;
  faltaConfiguracionSmtp: boolean;
}

const PROVEEDORES_SMTP = new Set<ProveedorCorreoPlataforma>([
  "gmail_smtp", "microsoft_smtp", "zoho_smtp", "smtp_personalizado",
]);

function proveedorValido(value: unknown): ProveedorCorreoPlataforma {
  return value === "gmail_smtp" || value === "microsoft_smtp"
      || value === "zoho_smtp" || value === "smtp_personalizado"
    ? value
    : "resend_api";
}

let cacheConfiguracion: { data: Record<string, unknown>; expiresAt: number } | null = null;

async function configuracionDePlataforma(fresh: boolean): Promise<Record<string, unknown> | null> {
  if (!fresh && cacheConfiguracion && cacheConfiguracion.expiresAt > Date.now()) {
    return cacheConfiguracion.data;
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return null;
  const admin = createClient(url, serviceRole);
  const { data, error } = await admin.rpc("mensajeria_de_plataforma");
  if (error || !data) {
    console.error("no se pudo leer la configuración de mensajería", error);
    return null;
  }

  cacheConfiguracion = {
    data: data as Record<string, unknown>,
    expiresAt: Date.now() + 10_000,
  };
  return cacheConfiguracion.data;
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
export async function remitenteDe(
  proposito: Proposito = "default",
  options: { fresh?: boolean } = {},
): Promise<Remitente> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    console.error("remitenteDe: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return {
      from: "", listo: false, dominio: null, proveedor: "resend_api",
      transporte: "resend", smtp: null, faltaLaClaveSmtp: false,
      faltaConfiguracionSmtp: false,
    };
  }
  const data = await configuracionDePlataforma(options.fresh === true);
  if (!data) {
    return {
      from: "", listo: false, dominio: null, proveedor: "resend_api",
      transporte: "resend", smtp: null, faltaLaClaveSmtp: false,
      faltaConfiguracionSmtp: false,
    };
  }

  const proveedor = proveedorValido(data.email_proveedor);
  const usaSmtp = PROVEEDORES_SMTP.has(proveedor);
  const dominio = data.email_dominio as string | null;
  const nombre = (data.email_nombre as string) || "Nerqia";
  const casillas = (data.email_casillas ?? {}) as Record<string, string>;
  const casilla = casillas[proposito] || casillas.default || "noreply";

  // ⚠️ Con Gmail —y con casi cualquier SMTP— el `From` tiene que ser la misma
  // casilla que se autentica. Mandar «desde» otra dirección hace que el
  // servidor rechace, o que el mensaje caiga en spam por DMARC. Por eso cuando
  // hay SMTP propio el remitente es su casilla y no se arma con el dominio.
  const pass = Deno.env.get("SMTP_PASSWORD");
  const smtp: SmtpConfig | null = (usaSmtp && data.smtp_configurado && pass)
    ? {
        host: String(data.smtp_host),
        port: Number(data.smtp_port) || 465,
        user: String(data.smtp_user),
        pass,
        secure: data.smtp_secure !== false,
        fromName: nombre,
        fromEmail: String(data.smtp_from_email),
      }
    : null;

  const faltaConfiguracionSmtp = usaSmtp && !data.smtp_configurado;
  const faltaLaClaveSmtp = usaSmtp && Boolean(data.smtp_configurado) && !pass;

  const from = usaSmtp
    ? (data.smtp_from_email ? `${nombre} <${String(data.smtp_from_email)}>` : "")
    : (dominio ? `${nombre} <${casilla}@${dominio}>` : "");

  return {
    from,
    proveedor,
    transporte: usaSmtp ? "smtp" : "resend",
    faltaLaClaveSmtp,
    faltaConfiguracionSmtp,
    listo: Boolean(data.email_listo),
    dominio,
    smtp,
  };
}

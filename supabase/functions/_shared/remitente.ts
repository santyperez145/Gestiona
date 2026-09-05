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

export interface Remitente {
  /** Lo que va en el `from`: `Nombre <casilla@dominio>`. */
  from: string;
  /** Si el envío está probado contra el proveedor. */
  listo: boolean;
  dominio: string | null;
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
  /** Proveedor elegido por plataforma; configurar SMTP ya no lo activa solo. */
  proveedor: "resend" | "smtp";
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
    return {
      from: "", listo: false, dominio: null, smtp: null,
      faltaLaClaveSmtp: false, proveedor: "resend",
    };
  }
  const admin = createClient(url, serviceRole);
  const { data, error } = await admin.rpc("mensajeria_de_plataforma");
  if (error || !data) {
    console.error("no se pudo leer la configuración de mensajería", error);
    return {
      from: "", listo: false, dominio: null, smtp: null,
      faltaLaClaveSmtp: false, proveedor: "resend",
    };
  }

  const dominio = data.email_dominio as string | null;
  const nombre = (data.email_nombre as string) || "Nerqia";
  const casillas = (data.email_casillas ?? {}) as Record<string, string>;
  const casilla = casillas[proposito] || casillas.default || "noreply";
  const proveedor: "resend" | "smtp" = data.email_proveedor === "smtp"
    ? "smtp"
    : "resend";

  // ⚠️ Con Gmail —y con casi cualquier SMTP— el `From` tiene que ser la misma
  // casilla que se autentica. Mandar «desde» otra dirección hace que el
  // servidor rechace, o que el mensaje caiga en spam por DMARC. Por eso cuando
  // hay SMTP propio el remitente es su casilla y no se arma con el dominio.
  const pass = Deno.env.get("SMTP_PASSWORD");
  const smtp: SmtpConfig | null = (proveedor === "smtp" && data.smtp_configurado && pass)
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

  const faltaLaClaveSmtp = proveedor === "smtp" && Boolean(data.smtp_configurado) && !pass;

  const from = smtp
    ? `${nombre} <${smtp.fromEmail}>`
    : (dominio ? `${nombre} <${casilla}@${dominio}>` : "");

  return {
    from,
    faltaLaClaveSmtp,
    // Con SMTP propio no hace falta el dominio verificado de Resend: el envío
    // ya sale por otro lado.
    listo: smtp ? true : Boolean(data.email_listo),
    dominio,
    smtp,
    proveedor,
  };
}

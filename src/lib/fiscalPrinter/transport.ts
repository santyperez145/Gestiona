/**
 * Transporte HTTP(S) hacia el controlador fiscal de la red local y
 * configuración del dispositivo.
 *
 * El controlador es hardware de esta caja: su IP se guarda en este
 * dispositivo, por organización. Desde una página HTTPS el navegador sólo
 * permite HTTPS (puerto 8443): hay que aceptar una vez el certificado del
 * equipo y configurar CORS en Epson Manager → Sistema → Red.
 */
import type { EpsonCommand } from "@/lib/fiscalPrinter/epson";

export type ConfigControlador = {
  modelo: "epson_tm_t900fa";
  host: string;
  protocolo: "https" | "http";
  /** Emitir automáticamente cada venta en el controlador. */
  emitirAlCobrar: boolean;
};

const clave = (orgId: string) => `nerqia.fiscalController.${orgId}`;

export function leerConfigControlador(orgId: string | null | undefined): ConfigControlador | null {
  if (!orgId) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(clave(orgId)) || "null");
    if (!raw || raw.modelo !== "epson_tm_t900fa" || !hostValido(raw.host)) return null;
    return { modelo: raw.modelo, host: raw.host, protocolo: raw.protocolo === "http" ? "http" : "https", emitirAlCobrar: raw.emitirAlCobrar === true };
  } catch {
    return null;
  }
}

export function guardarConfigControlador(orgId: string, config: ConfigControlador | null) {
  if (config) localStorage.setItem(clave(orgId), JSON.stringify(config));
  else localStorage.removeItem(clave(orgId));
}

/** IP o nombre de la red local, con puerto opcional; sin esquema ni ruta. */
export function hostValido(host: unknown): host is string {
  return typeof host === "string" && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host.trim()) && host.length <= 100;
}

export function urlControlador(config: Pick<ConfigControlador, "host" | "protocolo">, ruta: string): string {
  const conPuerto = /:\d+$/.test(config.host) ? config.host : `${config.host}:${config.protocolo === "https" ? 8443 : 80}`;
  return `${config.protocolo}://${conPuerto}${ruta}`;
}

export async function enviarLoteEpson(config: ConfigControlador, lote: EpsonCommand[], timeoutMs = 30_000): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(urlControlador(config, "/ext/batch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lote),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    console.error("[controlador] sin conexión", cause);
    throw new Error(config.protocolo === "https"
      ? `No pudimos conectar con el controlador en ${urlControlador(config, "")}. Abrí esa dirección una vez en este navegador para aceptar su certificado y revisá CORS en Epson Manager.`
      : `No pudimos conectar con el controlador en ${urlControlador(config, "")}. Revisá la IP y que esté encendido en la misma red.`);
  }
  if (!response.ok) throw new Error(`El controlador fiscal respondió HTTP ${response.status}`);
  return response.json();
}

/** Resultado impreso que todavía no se registró en la base: un reintento sólo confirma. */
const pendienteKey = (transactionId: string) => `nerqia.fiscalController.pending.${transactionId}`;
export function leerPendiente(transactionId: string): { tipo: string; numero: string } | null {
  try { return JSON.parse(localStorage.getItem(pendienteKey(transactionId)) || "null"); } catch { return null; }
}
export function guardarPendiente(transactionId: string, valor: { tipo: string; numero: string } | null) {
  try {
    if (valor) localStorage.setItem(pendienteKey(transactionId), JSON.stringify(valor));
    else localStorage.removeItem(pendienteKey(transactionId));
  } catch (cause) {
    console.error("[controlador] no se pudo guardar el pendiente local", cause);
  }
}

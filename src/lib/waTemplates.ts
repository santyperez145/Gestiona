/**
 * Plantilla del recordatorio de saldo por WhatsApp (botón en Deudas).
 *
 * ⚠️ Hasta 2026-10-09 Ajustes editaba cinco plantillas —venta, deuda,
 * cumpleaños, reactivación, pedido listo— y sólo la de deuda la leía alguien.
 * Además Deudas tenía su propio texto por defecto, distinto del que mostraba
 * Ajustes: el comercio veía uno y se mandaba otro. Ahora hay una sola, con un
 * solo default, y vive acá.
 *
 * Se guarda en el navegador (localStorage), como antes: llevarla a la base
 * para que la comparta todo el equipo es el paso siguiente, y la UI lo dice.
 */

export const PLANTILLA_DEUDA_POR_DEFECTO =
  "Hola {{nombre}}, te recordamos que tenés un saldo pendiente de {{monto}}. Avisanos cuándo te queda cómodo y lo coordinamos. Gracias.";

function clave(orgId?: string | null): string {
  return `gestiona.wa_templates.${orgId || "default"}`;
}

function leer(orgId?: string | null): Record<string, string> {
  try {
    const valor = JSON.parse(window.localStorage.getItem(clave(orgId)) || "{}");
    return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
  } catch {
    return {};
  }
}

/** La plantilla vigente: la del comercio o, si no cargó ninguna, la de fábrica. */
export function plantillaDeuda(orgId?: string | null): string {
  const propia = leer(orgId).debt;
  return typeof propia === "string" && propia.trim() ? propia : PLANTILLA_DEUDA_POR_DEFECTO;
}

/** `true` si el comercio cambió el texto de fábrica. */
export function plantillaDeudaEsPropia(orgId?: string | null): boolean {
  const propia = leer(orgId).debt;
  return typeof propia === "string" && propia.trim() !== "";
}

export function guardarPlantillaDeuda(orgId: string | null | undefined, texto: string | null): void {
  // Se conservan las demás claves que pudiera haber de versiones anteriores:
  // borrarlas no aporta nada y se pierde texto que alguien escribió.
  const actual = leer(orgId);
  if (texto === null || !texto.trim()) delete actual.debt;
  else actual.debt = texto;
  try { window.localStorage.setItem(clave(orgId), JSON.stringify(actual)); } catch { /* storage bloqueado */ }
}

/** Arma el mensaje con el primer nombre y el monto ya formateado. */
export function mensajeDeuda(plantilla: string, nombreCompleto: string | null | undefined, monto: string): string {
  const nombre = nombreCompleto?.trim() ? nombreCompleto.trim().split(/\s+/)[0] : "cliente";
  return plantilla.replace(/\{\{nombre\}\}/g, nombre).replace(/\{\{monto\}\}/g, monto);
}

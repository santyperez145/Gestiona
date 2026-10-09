/**
 * Bandeja de pendientes fiscales: agrupa comprobantes sin CAE por lo que el
 * comercio tiene que hacer. Sólo lee estado persistido; la autorización y sus
 * reintentos siguen siendo de `afip-authorize` y del outbox fiscal.
 */
import { explicacionesDesdeMensaje } from "../../supabase/functions/_shared/arcaRechazos";

export type GrupoPendienteFiscal =
  | "datos_cliente"
  | "conexion"
  | "importes"
  | "contador"
  | "reintentar"
  | "sin_autorizar"
  | "en_verificacion";

export type ComprobantePendienteFiscal = {
  status: string | null;
  cae: string | null;
  tipo_comprobante: number | null;
  afip_status: string | null;
  afip_error: string | null;
};

export const GRUPOS_PENDIENTE_FISCAL: Record<GrupoPendienteFiscal, { titulo: string; requiereAccion: boolean }> = {
  datos_cliente: { titulo: "Corregir datos del cliente", requiereAccion: true },
  conexion: { titulo: "Revisar conexión ARCA", requiereAccion: true },
  importes: { titulo: "Revisar importes o comprobante asociado", requiereAccion: true },
  contador: { titulo: "Consultar con el contador", requiereAccion: true },
  reintentar: { titulo: "Reintentar autorización", requiereAccion: true },
  sin_autorizar: { titulo: "Listos para autorizar", requiereAccion: true },
  en_verificacion: { titulo: "En verificación con ARCA", requiereAccion: false },
};

/** Orden de la bandeja: primero lo que bloquea más comprobantes futuros. */
export const ORDEN_PENDIENTE_FISCAL: GrupoPendienteFiscal[] = [
  "conexion", "datos_cliente", "importes", "contador", "reintentar", "sin_autorizar", "en_verificacion",
];

const ESTADOS_CON_ERROR = new Set(["rejected", "error", "config_error", "network_error", "validation_error"]);

export function grupoPendienteFiscal(inv: ComprobantePendienteFiscal): GrupoPendienteFiscal | null {
  // Sin tipo no es un comprobante fiscal; con CAE ya está autorizado.
  if (!inv.tipo_comprobante || inv.cae || inv.status === "canceled") return null;
  if (inv.afip_status === "authorized" || inv.afip_status === "not_applicable") return null;
  if (inv.afip_status === "processing") return "en_verificacion";
  if (!inv.afip_status || inv.afip_status === "pending") return "sin_autorizar";
  if (!ESTADOS_CON_ERROR.has(inv.afip_status)) return null;

  if (inv.afip_status === "config_error") return "conexion";
  const accion = explicacionesDesdeMensaje(inv.afip_error)[0]?.accion;
  switch (accion) {
    case "corregir_cliente": return "datos_cliente";
    case "revisar_conexion_arca":
    case "revisar_punto_venta": return "conexion";
    case "corregir_importes":
    case "revisar_comprobante_asociado": return "importes";
    case "consultar_contador": return "contador";
    case "revisar_fecha_numeracion":
    case "reintentar": return "reintentar";
  }
  // Mensajes previos al catálogo: la validación local suele ser del receptor.
  return inv.afip_status === "validation_error" ? "datos_cliente" : "reintentar";
}

export type ResumenPendienteFiscal = { grupo: GrupoPendienteFiscal; cantidad: number };

export function resumenPendientesFiscales(invoices: ComprobantePendienteFiscal[]): ResumenPendienteFiscal[] {
  const conteo = new Map<GrupoPendienteFiscal, number>();
  for (const inv of invoices) {
    const grupo = grupoPendienteFiscal(inv);
    if (grupo) conteo.set(grupo, (conteo.get(grupo) ?? 0) + 1);
  }
  return ORDEN_PENDIENTE_FISCAL
    .filter(grupo => conteo.has(grupo))
    .map(grupo => ({ grupo, cantidad: conteo.get(grupo)! }));
}

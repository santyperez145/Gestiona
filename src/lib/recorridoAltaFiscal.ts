// Recorrido único de alta fiscal (META_FINALIZACION §1: «padrón → delegación
// → punto → prueba»). Las piezas existían por separado en la página de ARCA
// (datos del emisor con «Completar con ARCA», la guía de delegación con su
// verificación, el punto de venta detectado y la salud fiscal), pero el
// comercio no veía en qué paso estaba ni cuál seguía. Se calcula con los
// mismos datos que `saludFiscal`: no consulta ARCA ni corrige nada.
import type { ComprobanteFiscalSalud, ConexionFiscal } from "@/lib/fiscalHealth";
import { estadoCertificado } from "@/lib/certificadoPropio";

export type EstadoPaso = "hecho" | "actual" | "pendiente";

export interface PasoAltaFiscal {
  id: "emisor" | "delegacion" | "punto" | "prueba" | "produccion";
  titulo: string;
  detalle: string;
  /** Ancla de la sección de la página donde se resuelve. */
  ancla: string;
  estado: EstadoPaso;
}

const vacio = (v: unknown) => !String(v ?? "").trim();

export function recorridoAltaFiscal(
  conexion: ConexionFiscal | null,
  comprobantes: ComprobanteFiscalSalud[],
): PasoAltaFiscal[] {
  const emisor = !vacio(conexion?.cuit) && !vacio(conexion?.razon_social) && !vacio(conexion?.domicilio);
  // Con certificado propio (2026-10-22) el paso es tener el certificado
  // aceptado por ARCA; el punto de venta se verifica después.
  const propio = conexion?.modo === "propio";
  const delegacion = propio
    ? ["listo", "por_vencer", "falta_verificar"].includes(estadoCertificado(conexion).fase)
    : !!conexion?.delegacion_verificada;
  const punto = delegacion && !!conexion?.delegacion_verificada && !!conexion?.punto_venta;
  const conCae = comprobantes.some(c => c.cae && c.afip_status === "authorized");
  const produccion = conexion?.environment === "produccion" && conCae;

  const hechos: Record<PasoAltaFiscal["id"], boolean> = { emisor, delegacion, punto, prueba: conCae, produccion };
  const pasos: Omit<PasoAltaFiscal, "estado">[] = [
    {
      id: "emisor", titulo: "Datos del emisor",
      detalle: "CUIT, razón social y domicilio. «Completar con ARCA» los trae del padrón.",
      ancla: "#datos-fiscales",
    },
    propio ? {
      id: "delegacion", titulo: "Tu certificado de ARCA",
      detalle: "Generá el pedido, crealo en ARCA con tu clave fiscal, asocialo a Facturación Electrónica y subilo.",
      ancla: "#conectar-arca",
    } : {
      id: "delegacion", titulo: "Delegación en ARCA",
      detalle: "Autorizá a Nerqia a facturar por vos en el Administrador de Relaciones y verificalo.",
      ancla: "#conectar-arca",
    },
    {
      id: "punto", titulo: "Punto de venta habilitado",
      detalle: "Un punto de venta «Web Services». La verificación te dice cuáles sirven.",
      ancla: "#conectar-arca",
    },
    {
      id: "prueba", titulo: "Primera factura con CAE",
      detalle: "Emití una factura de prueba en homologación para confirmar que todo funciona.",
      ancla: "/facturas?prueba=homologacion",
    },
    {
      id: "produccion", titulo: "Facturar con validez fiscal",
      detalle: "Pasá el ambiente a producción y emití tu primera factura real.",
      ancla: "#datos-fiscales",
    },
  ];

  const primeroPendiente = pasos.findIndex(p => !hechos[p.id]);
  return pasos.map((p, i) => ({
    ...p,
    estado: hechos[p.id] ? "hecho" : i === primeroPendiente ? "actual" : "pendiente",
  }));
}

export function pasosHechos(pasos: PasoAltaFiscal[]): number {
  return pasos.filter(p => p.estado === "hecho").length;
}

/**
 * Factura de prueba guiada: lo que se precarga en Facturas desde
 * `?prueba=homologacion`. Sólo en homologación: en producción sería una
 * factura real, y entonces no se precarga nada.
 */
export function facturaDePrueba(ambiente: string | null | undefined): {
  customer_name: string;
  notes: string;
  item: { description: string; quantity: number; unit_price: number };
} | null {
  if (ambiente !== "homologacion") return null;
  return {
    customer_name: "Consumidor final",
    notes: "Prueba de conexión con ARCA en homologación. No tiene validez fiscal.",
    item: { description: "Factura de prueba (homologación)", quantity: 1, unit_price: 100 },
  };
}

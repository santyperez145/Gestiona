/**
 * Resultado de "Generar comprobantes" (facturar_pendientes) pedido por pedido.
 * La base devuelve el motivo crudo de cada falla; acá se traduce a qué hacer.
 */
export type FallaLote = { orden: string; error: string };

export type ResultadoLote = {
  creadas: number;
  sinImporte: number;
  restantes: number;
  fallas: { orden: string; motivo: string; queHacer: string }[];
};

const SUGERENCIAS: { patron: RegExp; queHacer: string }[] = [
  { patron: /condicion frente al IVA del emisor|condición frente al IVA del emisor/i, queHacer: "Completá tu condición frente al IVA en Ajustes › ARCA y volvé a generar." },
  { patron: /Cambio la condicion frente al IVA|Cambió la condición frente al IVA/i, queHacer: "Tu condición frente al IVA cambió después de la venta: emití este comprobante a mano desde Nueva factura." },
  { patron: /revision fiscal|revisión fiscal|desglose historico|desglose histórico/i, queHacer: "El pedido no guardó su desglose de IVA: emití la factura a mano con el importe cobrado." },
  { patron: /no coincide con el total/i, queHacer: "El total cobrado difiere del detalle del pedido: emití la factura a mano con el importe cobrado." },
  { patron: /renglones fiscales/i, queHacer: "El pedido no tiene productos con detalle fiscal: emití la factura a mano." },
  { patron: /cobro confirmado/i, queHacer: "Esperá a que el pago se acredite; se factura solo cuando quede cobrado." },
  { patron: /permiso|dueno o un administrador|dueño o un administrador/i, queHacer: "Pedile a un dueño o administrador que genere los comprobantes." },
];

const limpiar = (mensaje: string) => mensaje.replace(/^.*?ERROR:\s*/i, "").replace(/^P\d{4}:\s*/, "").trim();

export function sugerenciaFallaLote(mensaje: string): string {
  return SUGERENCIAS.find(s => s.patron.test(mensaje))?.queHacer
    ?? "Abrí el pedido, corregí el dato indicado y volvé a generar; si no se puede, emití la factura a mano.";
}

export function resultadoLote(data: unknown): ResultadoLote {
  const d = (data ?? {}) as { creadas?: number; sin_importe?: number; restantes?: number; fallas?: FallaLote[] };
  return {
    creadas: Number(d.creadas ?? 0),
    sinImporte: Number(d.sin_importe ?? 0),
    restantes: Number(d.restantes ?? 0),
    fallas: (d.fallas ?? []).map(f => ({ orden: String(f.orden ?? "—"), motivo: limpiar(String(f.error ?? "")), queHacer: sugerenciaFallaLote(String(f.error ?? "")) })),
  };
}

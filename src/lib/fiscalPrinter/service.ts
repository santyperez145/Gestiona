/**
 * Emisión de un ticket del POS en el controlador fiscal de este dispositivo.
 *
 * reservar (base) → armar comprobante con lo que la base registró → enviar
 * lote al equipo → confirmar número (base). Si el equipo falla a mitad del
 * comprobante se cancela en el equipo y se libera la reserva, así el ticket
 * puede reintentarse o facturarse electrónicamente.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CondicionIva } from "@/lib/fiscalIdentity";
import {
  CANCELAR_FACTURA_EPSON, interpretarLoteFactura, loteFacturaEpson,
  type CompradorControlador, type DocumentoControlador, type EpsonCommand, type PagoControlador,
} from "@/lib/fiscalPrinter/epson";
import { unidadControlador } from "@/lib/unidadMedida";
import { enviarLoteEpson, guardarPendiente, leerPendiente, type ConfigControlador } from "@/lib/fiscalPrinter/transport";

type LineaVenta = {
  product_name: string;
  quantity: number;
  total_ars: number;
  fiscal_tax_rate: number | null;
  payment_method: string | null;
  split_payments: { method: string; amount: number }[] | null;
  product_id: string | null;
  products?: { sku: string | null; tax_rate: number | null; unidad_medida?: string | null } | null;
};

const MEDIO: Record<string, PagoControlador["medio"]> = {
  efectivo: "efectivo", debito: "debito", credito: "credito", transferencia: "transferencia",
  qr: "qr", fiado: "cuenta_corriente", mayorista: "otro",
};

/** Arma el comprobante con los importes que la base registró, no con el carrito. */
export function documentoDesdeLineas(
  lineas: LineaVenta[],
  opciones: { comprador?: CompradorControlador | null; emisorSinIva: boolean; tasaPorDefecto: number },
): DocumentoControlador {
  const items = lineas.map(l => {
    const cantidad = Number(l.quantity);
    const total = Number(l.total_ars);
    return {
      descripcion: l.product_name,
      cantidad,
      precioUnitario: Math.round((total / cantidad) * 10_000) / 10_000,
      tasaIva: Number(l.fiscal_tax_rate ?? l.products?.tax_rate ?? opciones.tasaPorDefecto),
      codigo: l.products?.sku || String(l.product_id ?? "").slice(0, 13) || "S/C",
      unidad: unidadControlador(l.products?.unidad_medida),
    };
  });
  const total = Math.round(lineas.reduce((s, l) => s + Number(l.total_ars), 0) * 100) / 100;

  const porMedio = new Map<PagoControlador["medio"], number>();
  for (const l of lineas) {
    const partes = l.split_payments?.length ? l.split_payments : [{ method: l.payment_method ?? "efectivo", amount: Number(l.total_ars) }];
    for (const p of partes) {
      const medio = MEDIO[p.method] ?? "otro";
      porMedio.set(medio, (porMedio.get(medio) ?? 0) + Number(p.amount));
    }
  }
  const pagos: PagoControlador[] = [...porMedio.entries()].map(([medio, monto]) => ({ medio, monto: Math.round(monto * 100) / 100 }));
  // Los pagos divididos se redondean por renglón: el último absorbe la diferencia.
  const suma = pagos.reduce((s, p) => s + p.monto, 0);
  if (pagos.length) pagos[pagos.length - 1].monto = Math.round((pagos[pagos.length - 1].monto + total - suma) * 100) / 100;

  return { comprador: opciones.comprador ?? null, items, pagos, emisorSinIva: opciones.emisorSinIva };
}

export type ResultadoEmision =
  | { ok: true; tipo: string; numero: string; yaEmitido?: boolean }
  | { ok: false; motivo: string };

export async function emitirTicketEnControlador(params: {
  orgId: string;
  transactionId: string;
  config: ConfigControlador;
  comprador?: { nombre: string; domicilio?: string | null; tax_id?: string | null; condicion: CondicionIva } | null;
  emisor: string | null | undefined;
  tasaPorDefecto: number;
}): Promise<ResultadoEmision> {
  const { orgId, transactionId, config } = params;
  const rpc = (name: string, args: Record<string, unknown>) =>
    supabase.rpc(name as never, args as never) as unknown as Promise<{ data: any; error: { message: string } | null }>;

  const reserva = await rpc("reservar_comprobante_controlador", { p_org: orgId, p_transaction_id: transactionId, p_modelo: config.modelo });
  if (reserva.error) return { ok: false, motivo: reserva.error.message.replace(/^.*?:\s*/, "") };
  if (reserva.data?.estado === "emitido") return { ok: true, tipo: reserva.data.tipo, numero: reserva.data.numero, yaEmitido: true };
  if (!reserva.data?.ok) return { ok: false, motivo: reserva.data?.motivo ?? "No se pudo reservar el ticket para el controlador" };

  const liberar = () => rpc("liberar_comprobante_controlador", { p_org: orgId, p_transaction_id: transactionId });
  const confirmar = async (tipo: string, numero: string, total: number): Promise<ResultadoEmision> => {
    const confirmacion = await rpc("confirmar_comprobante_controlador", {
      p_org: orgId, p_transaction_id: transactionId, p_tipo: tipo, p_numero: numero, p_total: total,
    });
    if (confirmacion.error) {
      console.error("[controlador] confirmar", confirmacion.error);
      return { ok: false, motivo: `El controlador emitió ${tipo} ${numero}, pero no se pudo registrar. Reintentá: no vuelve a imprimir.` };
    }
    guardarPendiente(transactionId, null);
    return { ok: true, tipo, numero };
  };

  const { data: lineas, error } = await supabase.from("sales")
    .select("product_name, quantity, total_ars, fiscal_tax_rate, payment_method, split_payments, product_id, products(sku, tax_rate, unidad_medida)")
    .eq("org_id", orgId).eq("sale_transaction_id", transactionId).order("created_at");
  if (error || !lineas?.length) {
    await liberar();
    return { ok: false, motivo: "No pudimos leer el ticket registrado para emitirlo" };
  }

  const total = Math.round(lineas.reduce((s, l) => s + Number(l.total_ars), 0) * 100) / 100;
  // Ya impreso en un intento anterior cuyo registro falló: sólo confirmar.
  const pendiente = leerPendiente(transactionId);
  if (pendiente) return confirmar(pendiente.tipo, pendiente.numero, total);

  const c = params.comprador;
  const documento = (c?.tax_id ?? "").replace(/[^0-9]/g, "");
  let lote: EpsonCommand[];
  try {
    lote = loteFacturaEpson(documentoDesdeLineas(lineas as unknown as LineaVenta[], {
      comprador: c ? {
        nombre: c.nombre, domicilio: c.domicilio, condicion: c.condicion,
        documentoTipo: documento ? (documento.length === 11 ? "CUIT" : "DNI") : null, documentoNumero: documento || null,
      } : null,
      emisorSinIva: params.emisor !== "responsable_inscripto",
      tasaPorDefecto: params.tasaPorDefecto,
    }));
  } catch (cause) {
    await liberar();
    return { ok: false, motivo: cause instanceof Error ? cause.message : "No se pudo armar el comprobante" };
  }

  let respuesta: unknown;
  try {
    respuesta = await enviarLoteEpson(config, lote);
  } catch (cause) {
    // Sin respuesta no se sabe si imprimió: la reserva queda para revisar el
    // equipo antes de reintentar o facturar electrónicamente.
    return { ok: false, motivo: cause instanceof Error ? cause.message : "El controlador fiscal no respondió" };
  }

  const resultado = interpretarLoteFactura(respuesta, lote);
  if ("error" in resultado) {
    if (resultado.documentoAbierto) await enviarLoteEpson(config, [CANCELAR_FACTURA_EPSON]).catch(e => console.error("[controlador] cancelar", e));
    await liberar();
    return { ok: false, motivo: resultado.error };
  }

  guardarPendiente(transactionId, { tipo: resultado.tipo, numero: resultado.numero });
  return confirmar(resultado.tipo, resultado.numero, total);
}

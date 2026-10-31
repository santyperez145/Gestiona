import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import type { FilaDeCompra, MedioDePago, MonedaCompra } from "@/lib/compras";

/**
 * Gastos de la compra (2026-10-31): flete, seguro, derechos, tasa de
 * estadística, despachante y depósito entran al costo de cada producto (el
 * costo puesto), como manda la RT 17 (4.2.1). El IVA y las percepciones se
 * pagan pero no son costo. La base reparte y actualiza los costos
 * (`agregar_gasto_a_compra`, migración 20261031000100); acá sólo se arma el
 * pedido y se muestra lo que la base dejó.
 */

export type ConceptoDeGasto = "flete" | "seguro" | "derechos" | "tasa_estadistica" | "despachante" | "deposito" | "flete_local" | "otro";
export type RepartoDeGasto = "valor" | "cantidad" | "peso";
export type PagoDeGasto = "pagado" | "a_pagar" | "registrado";

export const CONCEPTOS_DE_GASTO: Array<{ id: ConceptoDeGasto; label: string }> = [
  { id: "flete", label: "Flete" },
  { id: "seguro", label: "Seguro" },
  { id: "derechos", label: "Derechos de importación" },
  { id: "tasa_estadistica", label: "Tasa de estadística" },
  { id: "despachante", label: "Despachante" },
  { id: "deposito", label: "Depósito fiscal" },
  { id: "flete_local", label: "Flete hasta el local" },
  { id: "otro", label: "Otro" },
];

export const REPARTOS_DE_GASTO: Array<{ id: RepartoDeGasto; label: string }> = [
  { id: "valor", label: "Por valor (lo habitual)" },
  { id: "cantidad", label: "Por unidades" },
  { id: "peso", label: "Por peso" },
];

export const PAGOS_DE_GASTO: Array<{ id: PagoDeGasto; label: string }> = [
  { id: "pagado", label: "Ya lo pagué" },
  { id: "a_pagar", label: "Queda a pagar" },
  { id: "registrado", label: "Ya está cargado en Proveedores o en el Libro IVA" },
];

export interface GastoDeCompra {
  id: string;
  compra_id: string;
  concepto: ConceptoDeGasto;
  detalle: string | null;
  reparto: RepartoDeGasto;
  moneda: MonedaCompra;
  monto: number;
  impuestos: number;
  monto_ars: number;
  pago: PagoDeGasto;
  proveedor: string | null;
  comprobante: string | null;
  fecha: string;
}

export interface FormularioGasto {
  concepto: ConceptoDeGasto;
  detalle: string;
  moneda: MonedaCompra;
  monto: string;
  impuestos: string;
  cotizacion: string;
  reparto: RepartoDeGasto;
  pago: PagoDeGasto;
  medio: MedioDePago;
  proveedorId: string | null;
  proveedor: string;
  comprobante: string;
  fecha: string;
  vencimiento: string;
  actualizarCostos: boolean;
}

export function formularioGastoVacio(fecha: string): FormularioGasto {
  return {
    concepto: "flete", detalle: "", moneda: "ARS", monto: "", impuestos: "", cotizacion: "",
    reparto: "valor", pago: "pagado", medio: "transferencia", proveedorId: null, proveedor: "",
    comprobante: "", fecha, vencimiento: "", actualizarCostos: true,
  };
}

/** «1.234,5», «1234.5» o «1234,50» → 1234.5. Vacío o inválido → null. */
export function numeroDeTexto(texto: string): number | null {
  let t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  // Con coma, los puntos son de miles; sin coma, «1.500» también (en pesos nadie
  // escribe tres decimales), pero «12.5» es un decimal.
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Lo mismo que rechazaría la base, dicho antes de mandarlo. */
export function problemasDelGasto(f: FormularioGasto): string[] {
  const problemas: string[] = [];
  const monto = numeroDeTexto(f.monto);
  if (monto === null || monto <= 0) problemas.push("Cargá el monto sin IVA.");
  if (f.impuestos.trim() && numeroDeTexto(f.impuestos) === null) problemas.push("El IVA y las percepciones tienen que ser un número.");
  if (f.concepto === "otro" && !f.detalle.trim()) problemas.push("Contá qué es el gasto.");
  if (f.moneda === "USD" && !((numeroDeTexto(f.cotizacion) ?? 0) > 0)) problemas.push("Para un gasto en dólares cargá la cotización.");
  if (f.pago === "a_pagar" && !f.proveedorId && !f.proveedor.trim()) problemas.push("Para dejarlo a pagar, elegí a quién.");
  return problemas;
}

export function aDatosDeGasto(f: FormularioGasto): Record<string, unknown> {
  return {
    concepto: f.concepto,
    detalle: f.detalle.trim() || null,
    moneda: f.moneda,
    monto: numeroDeTexto(f.monto),
    impuestos: numeroDeTexto(f.impuestos) ?? 0,
    cotizacion: numeroDeTexto(f.cotizacion),
    reparto: f.reparto,
    pago: f.pago,
    medio: f.pago === "pagado" ? f.medio : null,
    proveedor_id: f.proveedorId,
    proveedor: f.proveedor.trim() || null,
    comprobante: f.comprobante.trim() || null,
    fecha: f.fecha || null,
    vencimiento: f.pago === "a_pagar" ? (f.vencimiento || null) : null,
    actualizar_costos: f.actualizarCostos,
  };
}

export function etiquetaDeGasto(g: Pick<GastoDeCompra, "concepto" | "detalle">): string {
  const base = CONCEPTOS_DE_GASTO.find(c => c.id === g.concepto)?.label ?? "Gasto";
  if (g.concepto === "otro") return g.detalle || "Gasto";
  return g.detalle ? `${base} (${g.detalle})` : base;
}

/** Costo puesto por unidad en pesos: lo de la factura más su parte de los gastos. */
export function costoPuesto(r: Pick<FilaDeCompra, "quantity" | "total_ars" | "gastos_ars">): number {
  const cantidad = Number(r.quantity) || 0;
  if (cantidad <= 0) return 0;
  return Math.round(((Number(r.total_ars) || 0) + (Number(r.gastos_ars) || 0)) * 100 / cantidad) / 100;
}

/** Cuánto suman los gastos sobre lo comprado, en %, con un decimal. */
export function recargoDeLosGastos(totalCompraArs: number, gastosArs: number): number | null {
  if (!(totalCompraArs > 0)) return null;
  return Math.round((gastosArs * 1000) / totalCompraArs) / 10;
}

export interface ResultadoDelReparto {
  costos_actualizados?: number;
  con_compra_posterior?: number;
  sin_cotizacion?: number;
}

/** Qué pasó con los costos, para el aviso después de agregar o quitar. */
export function textoDelReparto(r: ResultadoDelReparto, actualizarCostos: boolean): string {
  if (!actualizarCostos) return "Los costos de los productos quedaron como estaban.";
  const partes: string[] = [];
  const n = Number(r.costos_actualizados) || 0;
  partes.push(n === 0 ? "Ningún costo cambió." : n === 1 ? "Se actualizó el costo de 1 producto." : `Se actualizó el costo de ${n} productos.`);
  const posterior = Number(r.con_compra_posterior) || 0;
  if (posterior > 0) partes.push(posterior === 1
    ? "1 producto tiene una compra posterior y conserva ese costo."
    : `${posterior} productos tienen una compra posterior y conservan ese costo.`);
  const sinCotizacion = Number(r.sin_cotizacion) || 0;
  if (sinCotizacion > 0) partes.push(sinCotizacion === 1
    ? "1 producto con costo en dólares no se actualizó: falta la cotización."
    : `${sinCotizacion} productos con costo en dólares no se actualizaron: falta la cotización.`);
  return partes.join(" ");
}

// ───────────────────────── base ─────────────────────────

/** `disponible: false` mientras la migración no esté aplicada: la sección no se muestra. */
export async function leerGastosDeCompraDB(orgId: string, compraId: string): Promise<{ disponible: boolean; gastos: GastoDeCompra[] }> {
  const { data, error } = await supabase.from("compra_gastos" as never)
    .select("id, compra_id, concepto, detalle, reparto, moneda, monto, impuestos, monto_ars, pago, proveedor, comprobante, fecha")
    .eq("org_id" as never, orgId as never).eq("compra_id" as never, compraId as never)
    .order("created_at" as never, { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return { disponible: false, gastos: [] };
    throw error;
  }
  return { disponible: true, gastos: (data ?? []) as unknown as GastoDeCompra[] };
}

export async function agregarGastoDB(orgId: string, compraId: string, f: FormularioGasto): Promise<ResultadoDelReparto & { gasto_id: string }> {
  const { data, error } = await supabase.rpc("agregar_gasto_a_compra" as never,
    { p_org: orgId, p_compra: compraId, p_datos: aDatosDeGasto(f) } as never);
  if (error) throw error;
  return data as never;
}

export async function quitarGastoDB(orgId: string, gastoId: string): Promise<ResultadoDelReparto> {
  const { data, error } = await supabase.rpc("quitar_gasto_de_compra" as never, { p_org: orgId, p_gasto: gastoId } as never);
  if (error) throw error;
  return data as never;
}

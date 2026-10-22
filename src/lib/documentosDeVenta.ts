/**
 * Todos los documentos de una venta, enlazados (2026-10-22).
 *
 * El dueño pidió que «todo esté totalmente enlazado», y es el diferencial de
 * la Tesis (§3): ver la operación completa en un solo lugar. Cada documento ya
 * guardaba su enlace (el presupuesto convertido, la factura de la venta, el
 * remito de la transacción, la deuda de la venta), pero ninguna pantalla los
 * juntaba: para saber si una venta estaba entregada, facturada y cobrada había
 * que recorrer cuatro pantallas.
 *
 * Acá se arma la línea de la operación con lo que devolvió la base. Si una
 * parte no se pudo leer, se dice cuál; las demás se muestran igual.
 */
import { supabase } from "@/integrations/supabase/client";
import { numeroFiscal } from "@/lib/arcaInvoice";
import { esNotaDeCredito, TIPOS_DE_COMPRA } from "@/lib/libroIvaCompras";
import { nombreDelMedio } from "@/lib/mediosDePago";
import { isMissingRelation } from "@/lib/publicDataSource";
import { estadoDeEntrega, pendientesDeEntrega, type LineaVendida, type Remito } from "@/lib/remitos";
import { leerRemitosDeVenta } from "@/lib/remitosDatos";
import { retryRead } from "@/lib/transientRead";

export interface PresupuestoDeVenta { id: string; numero: string; fecha: string; total: number; estado: string }
export interface FacturaDeVenta {
  id: string; titulo: string; numero: string; fecha: string; total: number;
  autorizada: boolean; rechazada: boolean; esNotaDeCredito: boolean; cae: string | null;
}
export interface PagoDeVenta { fecha: string; monto: number; medio: string }
export interface CuentaDeVenta { total: number; pagado: number; saldo: number; pagos: PagoDeVenta[] }
export interface DevolucionDeVenta { fecha: string; cantidad: number; monto: number }

/** `null` en una parte = no se pudo leer (y se dice en `faltantes`). */
export interface DocumentosDeVenta {
  presupuesto: PresupuestoDeVenta | null;
  remitos: Remito[] | null;
  facturas: FacturaDeVenta[] | null;
  cuenta: CuentaDeVenta | null;
  devoluciones: DevolucionDeVenta[] | null;
  faltantes: string[];
}

export type EstadoDePaso = "hecho" | "parcial" | "pendiente" | "no_aplica" | "desconocido";
export interface PasoDeOperacion { id: "presupuesto" | "entrega" | "factura" | "cobro"; titulo: string; estado: EstadoDePaso; detalle: string }

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const centavos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function tituloDeComprobante(tipo: number | null | undefined): string {
  if (!tipo) return "Factura";
  return TIPOS_DE_COMPRA.find(t => t.codigo === Number(tipo))?.nombre ?? `Comprobante ${tipo}`;
}

/**
 * Los cuatro pasos de una venta, con lo que falta. Una venta de mostrador no
 * tiene remito ni presupuesto y está bien: esos pasos dicen «no aplica».
 */
export function pasosDeOperacion(docs: DocumentosDeVenta, lineas: LineaVendida[], totalVenta: number): PasoDeOperacion[] {
  const pasos: PasoDeOperacion[] = [];

  pasos.push(docs.presupuesto
    ? { id: "presupuesto", titulo: "Presupuesto", estado: "hecho", detalle: `N.º ${docs.presupuesto.numero} · ${ars(docs.presupuesto.total)}` }
    : { id: "presupuesto", titulo: "Presupuesto", estado: "no_aplica", detalle: "Venta directa, sin presupuesto" });

  if (docs.remitos === null) {
    pasos.push({ id: "entrega", titulo: "Entrega", estado: "desconocido", detalle: "No se pudieron leer los remitos" });
  } else if (docs.remitos.length === 0) {
    pasos.push({ id: "entrega", titulo: "Entrega", estado: "no_aplica", detalle: "Sin remito: entregada en el momento" });
  } else {
    const e = estadoDeEntrega(pendientesDeEntrega(lineas, docs.remitos));
    const vigentes = docs.remitos.filter(r => r.estado !== "anulado").length;
    pasos.push({
      id: "entrega", titulo: "Entrega",
      estado: e === "completa" || e === "nada_que_entregar" ? "hecho" : e === "parcial" ? "parcial" : "pendiente",
      detalle: `${vigentes} ${vigentes === 1 ? "remito" : "remitos"} · ${e === "completa" ? "entregada completa" : e === "parcial" ? "falta entregar" : e === "nada_que_entregar" ? "nada que entregar" : "sin entregar"}`,
    });
  }

  if (docs.facturas === null) {
    pasos.push({ id: "factura", titulo: "Factura", estado: "desconocido", detalle: "No se pudieron leer las facturas" });
  } else {
    const facturas = docs.facturas.filter(f => !f.esNotaDeCredito);
    const autorizadas = facturas.filter(f => f.autorizada);
    const notas = docs.facturas.filter(f => f.esNotaDeCredito && f.autorizada);
    if (facturas.length === 0) pasos.push({ id: "factura", titulo: "Factura", estado: "pendiente", detalle: "Sin factura" });
    else if (autorizadas.length === 0) pasos.push({ id: "factura", titulo: "Factura", estado: "pendiente", detalle: facturas.some(f => f.rechazada) ? "Rechazada por ARCA: revisar" : "Sin CAE todavía" });
    else pasos.push({
      id: "factura", titulo: "Factura", estado: "hecho",
      detalle: `${autorizadas.map(f => `${f.titulo} ${f.numero}`).join(", ")}${notas.length ? ` · ${notas.length} ${notas.length === 1 ? "nota de crédito" : "notas de crédito"}` : ""}`,
    });
  }

  if (docs.cuenta === null) {
    pasos.push({ id: "cobro", titulo: "Cobro", estado: "desconocido", detalle: "No se pudo leer el cobro" });
  } else if (docs.cuenta.total === 0) {
    pasos.push({ id: "cobro", titulo: "Cobro", estado: "hecho", detalle: `Cobrada en el momento · ${ars(totalVenta)}` });
  } else if (docs.cuenta.saldo <= 0.005) {
    pasos.push({ id: "cobro", titulo: "Cobro", estado: "hecho", detalle: `Cuenta corriente saldada · ${ars(docs.cuenta.total)}` });
  } else {
    pasos.push({
      id: "cobro", titulo: "Cobro", estado: docs.cuenta.pagado > 0 ? "parcial" : "pendiente",
      detalle: `Debe ${ars(docs.cuenta.saldo)} de ${ars(docs.cuenta.total)}`,
    });
  }
  return pasos;
}

// ── Lectura ────────────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;

function facturaDesdeFila(f: Fila): FacturaDeVenta {
  const tipo = Number(f.tipo_comprobante) || null;
  const fiscal = numeroFiscal(Number(f.punto_venta) || null, Number(f.numero_afip) || null);
  const estado = String(f.afip_status ?? "");
  return {
    id: String(f.id), titulo: tituloDeComprobante(tipo), numero: fiscal ?? String(f.number ?? ""),
    fecha: String(f.issue_date ?? ""), total: Number(f.total) || 0,
    autorizada: Boolean(f.cae) || estado === "authorized",
    rechazada: estado === "rejected" || estado === "error",
    esNotaDeCredito: tipo ? esNotaDeCredito(tipo) : Boolean(f.nota_credito_de),
    cae: (f.cae as string | null) ?? null,
  };
}

export async function leerDocumentosDeVenta(
  orgId: string,
  venta: { saleIds: string[]; saleTransactionId: string | null },
): Promise<DocumentosDeVenta> {
  const faltantes: string[] = [];
  const { saleIds, saleTransactionId: tx } = venta;
  if (saleIds.length === 0) return { presupuesto: null, remitos: [], facturas: [], cuenta: { total: 0, pagado: 0, saldo: 0, pagos: [] }, devoluciones: [], faltantes };

  const [presupuesto, remitos, facturas, cuenta, devoluciones] = await Promise.all([
    (async (): Promise<PresupuestoDeVenta | null | undefined> => {
      const enlace = await retryRead(() => supabase.from("sales").select("quote_id").eq("org_id", orgId).in("id", saleIds).not("quote_id", "is", null).limit(1));
      if (enlace.error) return undefined;
      const quoteId = enlace.data?.[0]?.quote_id as string | undefined;
      if (!quoteId && !tx) return null;
      const q = await retryRead(() => {
        const base = supabase.from("quotes").select("id, quote_number, created_at, total, status").eq("org_id", orgId);
        return (quoteId ? base.eq("id", quoteId) : base.eq("converted_transaction_id", tx as string)).limit(1);
      });
      if (q.error) return undefined;
      const fila = q.data?.[0];
      return fila ? { id: fila.id, numero: fila.quote_number, fecha: fila.created_at, total: Number(fila.total) || 0, estado: fila.status } : null;
    })(),
    leerRemitosDeVenta(orgId, saleIds).then(r => (r.estado === "listo" ? r.datos : r.estado === "inactivo" ? [] : undefined)),
    (async (): Promise<FacturaDeVenta[] | undefined> => {
      // Una factura de varias ventas (facturar_ventas_juntas) no lleva la venta
      // en la cabecera: la venta la apunta con invoice_id.
      const agrupadas = await retryRead(() => supabase.from("sales").select("invoice_id").eq("org_id", orgId).in("id", saleIds).not("invoice_id", "is", null));
      if (agrupadas.error) return undefined;
      const invoiceIds = [...new Set((agrupadas.data ?? []).map(f => String((f as Fila).invoice_id)))];
      const filtro = [`sale_id.in.(${saleIds.join(",")})`, ...(tx ? [`sale_transaction_id.eq.${tx}`] : []),
        ...(invoiceIds.length ? [`id.in.(${invoiceIds.join(",")})`] : [])].join(",");
      const columnas = "id, number, tipo_comprobante, punto_venta, numero_afip, issue_date, total, afip_status, cae, nota_credito_de";
      const r = await retryRead(() => supabase.from("invoices").select(columnas).eq("org_id", orgId).or(filtro).order("issue_date"));
      if (r.error) return undefined;
      const propias = (r.data ?? []) as Fila[];
      const ids = propias.map(f => String(f.id));
      // Las notas de crédito de esas facturas también son de la operación.
      let notas: Fila[] = [];
      if (ids.length) {
        const n = await retryRead(() => supabase.from("invoices").select(columnas).eq("org_id", orgId).in("nota_credito_de", ids));
        if (n.error) return undefined;
        notas = ((n.data ?? []) as Fila[]).filter(f => !ids.includes(String(f.id)));
      }
      return [...propias, ...notas].map(facturaDesdeFila);
    })(),
    (async (): Promise<CuentaDeVenta | undefined> => {
      const d = await retryRead(() => supabase.from("debts").select("id, amount_ars, paid_ars, remaining_ars").eq("org_id", orgId).in("sale_id", saleIds));
      if (d.error) return undefined;
      const deudas = d.data ?? [];
      if (deudas.length === 0) return { total: 0, pagado: 0, saldo: 0, pagos: [] };
      const p = await retryRead(() => supabase.from("debt_payments").select("amount_ars, payment_method, created_at").in("debt_id", deudas.map(x => x.id)).order("created_at"));
      if (p.error) return undefined;
      return {
        total: centavos(deudas.reduce((s, x) => s + Number(x.amount_ars), 0)),
        pagado: centavos(deudas.reduce((s, x) => s + Number(x.paid_ars), 0)),
        saldo: centavos(deudas.reduce((s, x) => s + Number(x.remaining_ars), 0)),
        pagos: (p.data ?? []).map(x => ({ fecha: x.created_at, monto: Number(x.amount_ars) || 0, medio: nombreDelMedio(x.payment_method) })),
      };
    })(),
    (async (): Promise<DevolucionDeVenta[] | undefined> => {
      const r = await retryRead(() => supabase.from("returns").select("quantity, amount_ars, created_at").eq("org_id", orgId).in("sale_id", saleIds).order("created_at"));
      if (r.error) return isMissingRelation(r.error) ? [] : undefined;
      return (r.data ?? []).map(x => ({ fecha: x.created_at, cantidad: Number(x.quantity) || 0, monto: Number(x.amount_ars) || 0 }));
    })(),
  ]);

  if (presupuesto === undefined) faltantes.push("el presupuesto");
  if (remitos === undefined) faltantes.push("los remitos");
  if (facturas === undefined) faltantes.push("las facturas");
  if (cuenta === undefined) faltantes.push("el cobro");
  if (devoluciones === undefined) faltantes.push("las devoluciones");
  return {
    presupuesto: presupuesto ?? null, remitos: remitos ?? null, facturas: facturas ?? null,
    cuenta: cuenta ?? null, devoluciones: devoluciones ?? null, faltantes,
  };
}


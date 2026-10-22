/**
 * Facturar remitos juntos (2026-10-22): de los remitos de un cliente salen
 * sus ventas sin facturar, para una sola factura (`facturar_ventas_juntas`,
 * migración 20261022001200). Un remito manual (sin venta) no tiene precios
 * y no entra; uno anulado tampoco.
 */
import { numeroDeRemito, type Remito } from "@/lib/remitos";

export interface VentaDeRemito { sale_transaction_id: string; invoice_id: string | null; total_ars: number }

export interface VentaParaFacturar {
  transaccion: string;
  fecha: string;
  remitos: string[];
  total: number;
}

export interface ClienteParaFacturar {
  customerId: string;
  nombre: string;
  ventas: VentaParaFacturar[];
}

/** Las ventas facturables agrupadas por cliente; sólo clientes con dos o más. */
export function clientesParaFacturar(remitos: Remito[], ventas: VentaDeRemito[]): ClienteParaFacturar[] {
  const facturada = new Set(ventas.filter(v => v.invoice_id).map(v => v.sale_transaction_id));
  const totales = new Map<string, number>();
  for (const v of ventas) totales.set(v.sale_transaction_id, (totales.get(v.sale_transaction_id) ?? 0) + Number(v.total_ars || 0));

  const porCliente = new Map<string, ClienteParaFacturar>();
  for (const r of remitos) {
    if (r.estado === "anulado" || !r.sale_transaction_id || !r.customer_id) continue;
    if (facturada.has(r.sale_transaction_id) || !totales.has(r.sale_transaction_id)) continue;
    const c = porCliente.get(r.customer_id) ?? { customerId: r.customer_id, nombre: r.cliente_nombre, ventas: [] };
    let venta = c.ventas.find(v => v.transaccion === r.sale_transaction_id);
    if (!venta) {
      venta = { transaccion: r.sale_transaction_id, fecha: r.fecha, remitos: [], total: Math.round((totales.get(r.sale_transaction_id) ?? 0) * 100) / 100 };
      c.ventas.push(venta);
    }
    venta.remitos.push(numeroDeRemito(r.punto_venta, r.numero));
    if (r.fecha < venta.fecha) venta.fecha = r.fecha;
    porCliente.set(r.customer_id, c);
  }
  return [...porCliente.values()]
    .filter(c => c.ventas.length >= 2)
    .map(c => ({ ...c, ventas: [...c.ventas].sort((a, b) => a.fecha.localeCompare(b.fecha)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

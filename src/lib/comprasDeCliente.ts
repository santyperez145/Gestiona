/**
 * Cuántas compras hubo y cada cuánto compra un cliente (2026-10-15).
 *
 * Clientes contaba cada renglón de venta como una compra: Karima, que llevó
 * dos productos el mismo día, figuraba «2 compras · Cada 1 día» y entraba
 * entre los recurrentes. El inicio hacía lo mismo con «ventas de hoy», el
 * mejor día y la mejor hora. Una compra es un ticket; los renglones viejos, de
 * antes de los tickets, se agrupan por cliente y día (sin cliente, cada
 * renglón es una compra: no hay con qué juntarlos). La frecuencia se mide
 * entre días distintos de compra.
 */
import { diaAR } from "@/lib/fechaAR";

/** Día de la compra en Argentina, AAAA-MM-DD. */
export const diaDeCompra = (fecha: string | null | undefined): string => diaAR(fecha);

export interface RenglonDeVenta {
  id?: string | null;
  sale_transaction_id?: string | null;
  date?: string | null;
  customer_name?: string | null;
}

/** El ticket; sin ticket, el cliente y el día; sin cliente, el renglón. */
export function claveDeCompra(venta: RenglonDeVenta): string {
  if (venta.sale_transaction_id) return `t:${venta.sale_transaction_id}`;
  const cliente = String(venta.customer_name ?? "").trim().toLowerCase();
  if (cliente) return `d:${diaDeCompra(venta.date)}:${cliente}`;
  return `r:${venta.id ?? Math.random()}`;
}

/** Cuántas compras (tickets) hay en estos renglones. */
export function contarCompras(ventas: RenglonDeVenta[]): number {
  return new Set(ventas.map(claveDeCompra)).size;
}

/** Días promedio entre compras; 999 si compró un solo día. */
export function frecuenciaEnDias(dias: Iterable<string>): number {
  const distintos = [...new Set([...dias].filter(Boolean))].sort();
  if (distintos.length < 2) return 999;
  const desde = Date.parse(`${distintos[0]}T12:00:00Z`);
  const hasta = Date.parse(`${distintos[distintos.length - 1]}T12:00:00Z`);
  return Math.max(1, Math.round((hasta - desde) / 86400000 / (distintos.length - 1)));
}

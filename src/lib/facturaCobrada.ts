/**
 * ¿Esta factura ya está cobrada? (2026-10-15)
 *
 * Facturas mostraba «Pendiente cobro $1,00» por una factura de un pedido de
 * la tienda que Mercado Pago había cobrado el 31/7: el estado de la factura se
 * cambia a mano y nadie lo había tocado. Si el pedido o la venta de la factura
 * están cobrados, la factura está cobrada, diga lo que diga su estado
 * guardado. Se deriva al leer; no se reescribe la factura.
 */
export interface FacturaConOrigen {
  status: string;
  sale_id?: string | null;
  ecommerce_order_id?: string | null;
  /** Una nota de crédito no se «cobra» por su pedido. */
  nota_credito_de?: string | null;
}

export interface OrigenesCobrados {
  pedidos: Set<string>;
  ventas: Set<string>;
}

export function facturaCobrada(inv: FacturaConOrigen, cobrados: OrigenesCobrados): boolean {
  if (inv.status === "paid") return true;
  if (inv.status === "canceled" || inv.status === "cancelled" || inv.nota_credito_de) return false;
  return Boolean(
    (inv.ecommerce_order_id && cobrados.pedidos.has(inv.ecommerce_order_id))
    || (inv.sale_id && cobrados.ventas.has(inv.sale_id)),
  );
}

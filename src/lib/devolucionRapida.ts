import { supabase } from "@/integrations/supabase/client";
import { allocateSalesReturnRefund, salesReturnTotal, type SalesReturnPreview } from "@/lib/salesReturn";

/**
 * Devolución rápida de la caja (2026-10-14, páginas legacy). Antes hacía tres
 * escrituras sueltas desde el navegador —`returns`, el movimiento de stock y
 * `sales.returned`—: si fallaba a la mitad quedaba a medias, marcaba devuelta la
 * venta entera aunque se devolviera una parte y el reintegro no pasaba por la
 * caja. Ahora usa la misma operación atómica que Devoluciones
 * (`preview_sales_return` + `create_sales_return_v1`): stock, libro, caja y
 * reintegro por el mismo medio con que se cobró, con clave contra duplicados.
 */
export interface ResultadoDevolucionRapida {
  total: number;
  ticket: string;
  repetida: boolean;
  /** Parte del reintegro espera a Mercado Pago (se confirma en Devoluciones). */
  pendienteExterno: boolean;
}

export async function devolverDesdeLaCaja(args: {
  orgId: string;
  saleId: string;
  cantidad: number;
  motivo: string;
  reponerStock: boolean;
  /** Una por intento: repetir el pedido no devuelve dos veces. */
  clave: string;
}): Promise<ResultadoDevolucionRapida> {
  const { data, error } = await supabase.rpc("preview_sales_return", { p_org_id: args.orgId, p_sale_id: args.saleId });
  if (error) throw error;
  const preview = data as unknown as SalesReturnPreview;
  if (!Array.isArray(preview?.lines) || !Array.isArray(preview?.payments)) {
    throw new Error("La venta llegó con un formato inválido");
  }
  const linea = preview.lines.find(l => l.sale_id === args.saleId);
  if (!linea || linea.available_quantity <= 0) throw new Error("Esa venta ya no tiene unidades para devolver");
  const cantidad = Math.trunc(args.cantidad);
  if (cantidad < 1 || cantidad > linea.available_quantity) {
    throw new Error(`Se pueden devolver hasta ${linea.available_quantity} de «${linea.product_name}»`);
  }

  const cantidades = { [args.saleId]: cantidad };
  const total = salesReturnTotal(preview.lines, cantidades);
  const asignaciones = allocateSalesReturnRefund(preview.payments, total)
    .filter(a => a.amount > 0)
    .map(a => ({ payment_transaction_id: a.payment_transaction_id, sale_method: a.payment_transaction_id ? undefined : a.sale_method, amount: a.amount }));
  const enEfectivo = asignaciones.some(a => preview.payments.find(p =>
    (p.payment_transaction_id ?? p.sale_method) === (a.payment_transaction_id ?? a.sale_method))?.execution_mode === "cash");
  if (enEfectivo && !preview.open_cash_session_id) {
    throw new Error("Para devolver efectivo tiene que estar abierta la caja de esa sucursal");
  }

  const { data: r, error: e2 } = await supabase.rpc("create_sales_return_v1", {
    p_org_id: args.orgId, p_sale_id: args.saleId,
    p_lines: [{ sale_id: args.saleId, quantity: cantidad }],
    p_refund_allocations: asignaciones, p_reason: args.motivo.trim(),
    p_notes: undefined, p_restock: args.reponerStock, p_client_return_id: args.clave,
  });
  if (e2) throw e2;
  const resultado = r as unknown as { status: string; reused: boolean };
  return { total, ticket: preview.ticket_code, repetida: !!resultado?.reused, pendienteExterno: resultado?.status !== "completed" };
}

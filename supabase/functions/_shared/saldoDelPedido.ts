/**
 * Saldo a favor aplicado a un pedido de la tienda y lo que queda por cobrar
 * por el medio (migraciones 20261030001400 y 20261030001700).
 *
 * El saldo se lee aparte del pedido para que el cobro y los avisos sigan
 * andando si la columna todavía no llegó a la base: sin la columna no pudo
 * haber saldo aplicado. Cualquier otro error se propaga.
 */

export async function saldoAplicadoDe(admin: any, orderId: string): Promise<number> {
  const { data, error } = await admin
    .from("ecommerce_orders")
    .select("saldo_aplicado_ars")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    const code = String((error as { code?: string }).code ?? "");
    if (code === "42703" || code === "PGRST204") return 0;
    throw error;
  }
  const valor = Number(data?.saldo_aplicado_ars ?? 0);
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/** Lo que se cobra por el medio: el total del pedido menos el saldo aplicado. */
export function montoACobrar(total: number, saldoAplicado: number): number {
  return Math.max(0, Math.round((Number(total) - (Number(saldoAplicado) || 0)) * 100) / 100);
}

export type ResultadoDeAcreditacion = {
  data: unknown;
  error: { message?: string; code?: string } | null;
  /** false si la base no lo acreditó (importe distinto) o si falló. */
  acreditado: boolean;
};

/**
 * Acredita un pago de Mercado Pago con el importe que informó el proveedor.
 * La base decide según el saldo aplicado al pedido; si todavía no tiene la
 * función (deploy antes que la migración), el camino de siempre.
 */
export async function acreditarPagoDePedido(
  admin: any,
  args: { orderId: string; paymentId: string; monto: number | null },
): Promise<ResultadoDeAcreditacion> {
  const monto = typeof args.monto === "number" && Number.isFinite(args.monto) && args.monto > 0 ? args.monto : null;
  const { data, error } = await admin.rpc("acreditar_pago_de_pedido", {
    p_order_id: args.orderId,
    p_payment_id: args.paymentId,
    p_monto: monto,
    p_method: "mercado_pago",
  });
  if (!error) {
    return { data, error: null, acreditado: (data as { ok?: unknown } | null)?.ok !== false };
  }
  const code = String((error as { code?: string }).code ?? "");
  if (code === "42883" || code === "PGRST202") {
    const legacy = await admin.rpc("mark_store_order_paid", {
      p_order_id: args.orderId,
      p_payment_id: args.paymentId,
      p_method: "mercado_pago",
    });
    return { data: legacy.data, error: legacy.error ?? null, acreditado: !legacy.error };
  }
  return { data: null, error, acreditado: false };
}

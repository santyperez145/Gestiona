/**
 * Autoridad de stock por ubicación para POS.
 *
 * El servidor decide el stock: el cliente pidió X unidades, el RPC valida
 * disponibilidad contra la ubicación y devuelve el número de reserva. Confirmar
 * la venta descuenta el stock real; cancelar libera la reserva. Aquí no se
 * descuenta nada localmente: no hay inventario fantasma.
 */

export interface PosStockLocation {
  location_id: string;
  location_name: string;
  stock: number;
  reserved: number;
  available: number;
}

export interface ReserveStockInput {
  slug: string;
  location_id: string;
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  /** Clave idempotente del carrito/venta en curso; repetir no duplica. */
  idempotency_key?: string;
}

export interface ReserveStockResult {
  ok: boolean;
  reservation_id: string | null;
  available: number;
  reserved: number;
  /** Mensaje ya seguro para mostrar al operador. */
  message: string;
}

export interface CommitSaleInput {
  slug: string;
  reservation_id: string;
  payment_method?: string;
}

export interface CommitSaleResult {
  ok: boolean;
  sale_id: string | null;
  message: string;
}

export async function reserveStock(
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
  input: ReserveStockInput,
): Promise<ReserveStockResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, reservation_id: null, available: 0, reserved: 0, message: "Cantidad inválida: debe ser un entero positivo." };
  }
  const { data, error } = await rpc("reserve_stock", {
    p_slug: input.slug,
    p_location_id: input.location_id,
    p_product_id: input.product_id,
    p_variant_id: input.variant_id ?? null,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotency_key ?? null,
  });
  if (error) {
    const msg = /insufficient|stock|no hay/i.test(error.message)
      ? "Sin stock disponible en esta ubicación."
      : "No se pudo reservar stock. Reintentá.";
    return { ok: false, reservation_id: null, available: 0, reserved: 0, message: msg };
  }
  const row = (data ?? {}) as { reservation_id?: string; available?: number; reserved?: number };
  return {
    ok: true,
    reservation_id: row.reservation_id ?? null,
    available: Number(row.available) || 0,
    reserved: Number(row.reserved) || 0,
    message: "Stock reservado para esta venta.",
  };
}

export async function commitSale(
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
  input: CommitSaleInput,
): Promise<CommitSaleResult> {
  const { data, error } = await rpc("commit_pos_sale", {
    p_slug: input.slug,
    p_reservation_id: input.reservation_id,
    p_payment_method: input.payment_method ?? null,
  });
  if (error) {
    return { ok: false, sale_id: null, message: "No se pudo confirmar la venta. El stock no se descuenta." };
  }
  const row = (data ?? {}) as { sale_id?: string };
  return { ok: true, sale_id: row.sale_id ?? null, message: "Venta confirmada: stock descuenta en esta ubicación." };
}

export async function releaseReservation(
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
  slug: string,
  reservation_id: string,
): Promise<{ ok: boolean; message: string }> {
  const { error } = await rpc("release_stock_reservation", {
    p_slug: slug,
    p_reservation_id: reservation_id,
  });
  if (error) {
    return { ok: false, message: "No se pudo liberar la reserva." };
  }
  return { ok: true, message: "Reserva liberada: el stock vuelve a estar disponible." };
}

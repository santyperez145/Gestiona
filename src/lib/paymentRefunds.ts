import { supabase } from "@/integrations/supabase/client";

export type StoreRefundAction = "execute" | "reconcile";

export interface StoreRefundResult {
  ok: boolean;
  status: "not_started" | "processing" | "refunded" | "failed";
  refundId: string | null;
  reused?: boolean;
  orderPaymentStatus?: string | null;
  message?: string;
  error?: string;
}

/**
 * Punto único del panel para operar un reintegro de tienda.
 *
 * El monto nunca forma parte de este contrato: la Edge Function lo obtiene de
 * la solicitud aprobada y lo valida de nuevo en SQL. Así RMA, órdenes y futuras
 * superficies administrativas no inventan una segunda integración.
 */
export async function runStorePaymentRefund({
  orgId,
  returnRequestId,
  action = "execute",
}: {
  orgId: string;
  returnRequestId: string;
  action?: StoreRefundAction;
}): Promise<StoreRefundResult> {
  const { data, error } = await supabase.functions.invoke("refund-store-payment", {
    body: { orgId, returnRequestId, action },
  });
  if (error) throw error;
  const result = (data ?? {}) as StoreRefundResult;
  if (result.status === "failed") {
    throw new Error(result.error || "El reintegro fue rechazado");
  }
  return result;
}

/** Recibe la mercadería y deja el movimiento de stock ligado al RMA. */
export async function receiveStoreReturnRequest(returnRequestId: string) {
  const { data, error } = await supabase.rpc("receive_store_return_request", {
    p_return_request_id: returnRequestId,
  });
  if (error) throw error;
  const result = (data ?? {}) as { ok?: boolean; idempotent?: boolean; quantity?: number; amount?: number; return_ids?: string[] };
  if (!result.ok) throw new Error("No se pudo recibir la mercadería del RMA");
  return result;
}

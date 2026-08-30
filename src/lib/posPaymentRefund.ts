import { supabase } from "@/integrations/supabase/client";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

export type PosPaymentRefundAction = "execute" | "reconcile";

export type PosPaymentRefundResult = {
  ok: boolean;
  status: "pending_external" | "completed";
  refundId: string;
  reused?: boolean;
  returnStatus?: string | null;
  externalRefundId?: string | null;
  message?: string;
  error?: string;
  code?: string;
};

/**
 * Opera un reintegro POS sin aceptar importe ni IDs del proveedor desde UI.
 * La Edge los deriva del cobro original y conserva la misma idempotencia.
 */
export async function runPosPaymentRefund({
  orgId,
  refundId,
  action = "execute",
}: {
  orgId: string;
  refundId: string;
  action?: PosPaymentRefundAction;
}): Promise<PosPaymentRefundResult> {
  const { data, error } = await supabase.functions.invoke("refund-pos-payment", {
    body: { orgId, refundId, action },
  });
  const result = (data ?? {}) as Partial<PosPaymentRefundResult>;
  if (error) {
    throw new Error(
      await mensajeDeEdgeFunction(error, data) || "No se pudo operar el reintegro",
    );
  }
  if (result.error) throw new Error(result.error);
  if (!result.refundId || !result.status) {
    throw new Error("El proveedor devolvió una respuesta de reintegro incompleta");
  }
  return result as PosPaymentRefundResult;
}

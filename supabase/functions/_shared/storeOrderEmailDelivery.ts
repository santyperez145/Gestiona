/**
 * Coordinación durable de emails de órdenes.
 *
 * El claim y el finish son dos transacciones cortas separadas. Nunca se deja
 * una transacción SQL abierta durante la llamada a SMTP/Resend.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { SendResult } from "./smtpSender.ts";

export type StoreOrderEmailAudience = "buyer" | "merchant";
export type StoreOrderEmailEvent =
  | "order_created"
  | "payment_confirmed"
  | "shipped"
  | "delivered";

export interface StoreOrderEmailClaim {
  claimed: boolean;
  duplicate: boolean;
  inProgress: boolean;
  deliveryId?: string;
  claimToken?: string;
  idempotencyKey?: string;
  attempt?: number;
}

export async function claimStoreOrderEmail(
  admin: SupabaseClient,
  input: {
    orderId: string;
    audience: StoreOrderEmailAudience;
    event: StoreOrderEmailEvent;
    recipientEmail: string;
  },
): Promise<StoreOrderEmailClaim> {
  const { data, error } = await admin.rpc("claim_store_order_email", {
    p_order_id: input.orderId,
    p_audience: input.audience,
    p_event: input.event,
    p_recipient_email: input.recipientEmail,
    p_lease_seconds: 300,
  });
  if (error) throw new Error(`No se pudo reservar el email: ${error.message}`);

  const claim = (data ?? {}) as StoreOrderEmailClaim;
  if (claim.claimed && (!claim.deliveryId || !claim.claimToken || !claim.idempotencyKey)) {
    throw new Error("La reserva de email quedó incompleta");
  }
  return claim;
}

export async function finishStoreOrderEmail(
  admin: SupabaseClient,
  claim: StoreOrderEmailClaim,
  result: SendResult,
): Promise<void> {
  if (!claim.deliveryId || !claim.claimToken) {
    throw new Error("No existe una reserva de email para finalizar");
  }

  const { data, error } = await admin.rpc("finish_store_order_email", {
    p_delivery_id: claim.deliveryId,
    p_claim_token: claim.claimToken,
    p_success: result.ok,
    p_provider: result.provider,
    p_provider_message_id: result.messageId ?? null,
    p_error: result.error ?? null,
  });
  if (error) throw new Error(`No se pudo cerrar el email: ${error.message}`);
  if (data !== true) throw new Error("La reserva de email venció antes de registrar el resultado");
}


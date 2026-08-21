/**
 * La liquidación de MercadoPago se usa tanto desde el webhook como desde el
 * Checkout Brick. Tenerla en un solo lugar evita que un canal cobre la
 * comisión en MP pero omita registrarla en Gestiona.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Estado de MercadoPago → estado de `payment_transactions`. */
function mapStatus(mpStatus: string): string {
  if (mpStatus === "approved") return "approved";
  if (mpStatus === "rejected" || mpStatus === "cancelled") return "rejected";
  if (mpStatus === "refunded") return "refunded";
  if (mpStatus === "charged_back") return "charged_back";
  return "pending";
}

/** `payment_type_id` de MP → `method` de nuestro tarifario. */
function mapMethod(mpType: string): string {
  switch (mpType) {
    case "credit_card": return "credit";
    case "debit_card": return "debit";
    case "account_money": return "wallet";
    case "ticket":
    case "atm": return "cash";
    case "bank_transfer": return "transfer";
    default: return "default";
  }
}

/**
 * Registra el cobro con su desglose real delegando en el RPC idempotente
 * `record_payment_settlement`. El monto y la comisión vienen de la respuesta
 * firmada de MercadoPago, no de la pantalla que inició el pago.
 */
export async function recordPaymentTransaction(
  // Las dos funciones construyen el cliente service_role de Supabase. Mantener
  // esta interfaz mínima permite compartir el flujo sin acoplarlo a la versión
  // de `@supabase/supabase-js` que cada Edge Function importa desde esm.sh.
  // `@supabase/supabase-js` expone RPC como un builder thenable, no como un
  // `Promise` nativo. `PromiseLike` conserva el contrato que necesitamos y
  // permite reutilizar este helper desde Edge Functions con versiones distintas
  // del SDK sin ocultar errores de tipo.
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  args: {
    orgId: string;
    paymentId: string;
    payment: Record<string, unknown>;
    status: string;
    gross: number;
    externalRef: string;
  },
) {
  const { orgId, paymentId, payment, status, gross, externalRef } = args;
  if (!orgId || gross <= 0) return;

  try {
    const isStoreOrder = externalRef.startsWith("ecom:") || externalRef.startsWith("order:");
    const refId = externalRef.includes(":") ? externalRef.split(":")[1] : externalRef;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refId);
    const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : [];
    const actualFee = feeDetails
      .filter((f: unknown) => typeof f === "object" && f !== null && (f as { type?: unknown }).type === "mercadopago_fee")
      .reduce((sum: number, f: unknown) => sum + (Number((f as { amount?: unknown }).amount) || 0), 0);

    const { error } = await admin.rpc("record_payment_settlement", {
      p_org_id: orgId,
      p_source: isStoreOrder ? "ecommerce" : "payment_link",
      p_source_id: isUuid ? refId : null,
      p_provider: "mercadopago",
      p_method: mapMethod(String(payment.payment_type_id ?? "")),
      p_installments: Number(payment.installments) || 0,
      p_gross: round2(gross),
      p_external_id: paymentId,
      p_actual_fee: actualFee > 0 ? round2(actualFee) : null,
      p_currency: String(payment.currency_id ?? "ARS"),
      p_status: mapStatus(status),
    });
    if (error) throw error;
  } catch (e) {
    // El cobro ya está confirmado. Dejar evidencia en logs es mejor que hacer
    // que MercadoPago reintente el pago o que el comprador vea un falso error.
    console.error(`record_payment_settlement falló para ${paymentId}:`, e);
  }
}

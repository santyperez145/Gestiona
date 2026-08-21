/**
 * Contrato común entre el checkout y el orquestador de pagos.
 *
 * Las Edge Functions usan service_role para invocar los RPC internos. El
 * navegador nunca recibe ni puede ejecutar estas funciones directamente.
 */

type RpcAdmin = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
};

export type PreparedPaymentAttempt = {
  intentId: string;
  attemptId: string;
  provider: string;
  amount: number;
  method: string;
  state: string;
  attemptState: string;
  clientKey: string | null;
  reused: boolean;
  alreadyAccredited: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`El orquestador devolvió una respuesta inválida: falta ${field}`);
  }
  return value;
}

export async function preparePaymentAttempt(
  admin: RpcAdmin,
  args: {
    orderId: string;
    method?: string | null;
    installments?: number;
    clientKey?: string | null;
  },
): Promise<PreparedPaymentAttempt> {
  const { data, error } = await admin.rpc("pago_intento_preparar", {
    p_order_id: args.orderId,
    p_metodo: args.method ?? null,
    p_cuotas: args.installments ?? 1,
    p_client_key: args.clientKey ?? null,
  });
  if (error) throw new Error(error.message ?? "No se pudo preparar el intento de pago");

  const row = asRecord(data);
  if (!row) throw new Error("El orquestador no devolvió un intento de pago");

  const amount = Number(row.monto);
  return {
    intentId: requiredText(row.intent_id, "intent_id"),
    attemptId: requiredText(row.attempt_id, "attempt_id"),
    provider: requiredText(row.provider, "provider"),
    amount: Number.isFinite(amount) ? amount : 0,
    method: requiredText(row.metodo, "metodo"),
    state: requiredText(row.estado, "estado"),
    attemptState: requiredText(row.attempt_estado, "attempt_estado"),
    clientKey: typeof row.client_key === "string" ? row.client_key : null,
    reused: row.reusado === true,
    alreadyAccredited: row.ya_acreditado === true,
  };
}

export function providerAttemptState(status: string): "aprobado" | "rechazado" | "pendiente" {
  if (status === "approved") return "aprobado";
  if (status === "rejected" || status === "cancelled") return "rechazado";
  return "pendiente";
}

export async function recordPaymentAttempt(
  admin: RpcAdmin,
  args: {
    attemptId: string;
    status: "aprobado" | "rechazado" | "pendiente" | "error";
    externalId?: string | null;
    net?: number | null;
    reason?: string | null;
    raw?: Record<string, unknown> | null;
  },
) {
  const { data, error } = await admin.rpc("pago_attempt_resultado", {
    p_attempt_id: args.attemptId,
    p_estado: args.status,
    p_external_id: args.externalId ?? null,
    p_comision: null,
    p_comision_iva: null,
    p_neto: args.net ?? null,
    p_motivo: args.reason ?? null,
    p_raw: args.raw ?? null,
  });
  if (error) throw new Error(error.message ?? "No se pudo registrar el resultado del pago");
  const row = asRecord(data);
  if (row?.ok === false) throw new Error(String(row.motivo ?? "El resultado del pago fue rechazado"));
}

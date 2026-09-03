/**
 * Ejecuta o reconcilia el reintegro Mercado Pago de una devolución POS.
 *
 * El navegador sólo identifica organización y parte del reintegro. SQL deriva
 * monto, Order/Payment, transaction id y clave idempotente desde el ticket.
 * Un timeout nunca se interpreta como fracaso: se consulta al proveedor antes
 * de volver a enviar dinero.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { requireUser } from "../_shared/requireUser.ts";

type JsonRecord = Record<string, unknown>;
type RefundAction = "execute" | "reconcile";
type ApiMode = "orders" | "payments";

const MP_API = "https://api.mercadopago.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function amountText(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El reintegro server-side es inválido");
  return (Math.round(amount * 100) / 100).toFixed(2);
}

function refundRows(payload: unknown, mode: ApiMode): JsonRecord[] {
  if (mode === "payments") {
    if (Array.isArray(payload)) {
      return payload.map(asRecord).filter((row) => Object.keys(row).length > 0);
    }
    const record = asRecord(payload);
    const nested = record.refunds;
    if (Array.isArray(nested)) return nested.map(asRecord).filter((row) => Object.keys(row).length > 0);
    return record.id ? [record] : [];
  }
  const transactions = asRecord(asRecord(payload).transactions);
  const rows = transactions.refunds;
  return Array.isArray(rows)
    ? rows.map(asRecord).filter((row) => Object.keys(row).length > 0)
    : [];
}

function confirmedStatus(row: JsonRecord, mode: ApiMode) {
  const status = cleanText(row.status, 80)?.toLowerCase();
  return mode === "orders" ? status === "processed" : status === "approved";
}

function refundSnapshot(row: JsonRecord, mode: ApiMode): JsonRecord {
  return {
    source: mode === "orders" ? "mercadopago_orders_refund" : "mercadopago_payment_refund",
    id: cleanText(row.id, 180),
    status: cleanText(row.status, 80),
    amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
    transaction_id: cleanText(row.transaction_id, 180),
    payment_id: cleanText(row.payment_id, 180),
    reference_id: cleanText(row.reference_id, 180),
    date_created: cleanText(row.date_created, 80),
  };
}

function collectionSnapshot(rows: JsonRecord[], mode: ApiMode): JsonRecord {
  return {
    source: mode === "orders" ? "mercadopago_order_refund_list" : "mercadopago_payment_refund_list",
    refunds: rows.slice(0, 25).map((row) => refundSnapshot(row, mode)),
  };
}

function findConfirmedRefund({
  rows,
  mode,
  expectedId,
  amount,
  paymentId,
}: {
  rows: JsonRecord[];
  mode: ApiMode;
  expectedId: string | null;
  amount: number;
  paymentId: string | null;
}): { row: JsonRecord | null; ambiguous: boolean } {
  const compatible = rows.filter((row) => {
    if (!confirmedStatus(row, mode)) return false;
    const rowId = cleanText(row.id, 180);
    if (expectedId) return rowId === expectedId;
    if (Math.abs(Number(row.amount) - amount) >= 0.01) return false;
    if (mode !== "orders" || !paymentId) return true;
    return cleanText(row.transaction_id, 180) === paymentId;
  });
  return { row: compatible.length === 1 ? compatible[0] : null, ambiguous: compatible.length > 1 };
}

async function mpJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

function providerUrl(prepared: JsonRecord, action: RefundAction) {
  const mode = cleanText(prepared.api_mode, 20) as ApiMode | null;
  if (mode === "orders") {
    const orderId = cleanText(prepared.provider_order_id, 180);
    if (!orderId) throw new Error("La devolución no conserva la Order de Mercado Pago");
    return `${MP_API}/v1/orders/${encodeURIComponent(orderId)}${action === "execute" ? "/refund" : ""}`;
  }
  if (mode === "payments") {
    const paymentId = cleanText(prepared.provider_payment_id, 180);
    if (!paymentId) throw new Error("La devolución no conserva el Payment de Mercado Pago");
    return `${MP_API}/v1/payments/${encodeURIComponent(paymentId)}/refunds`;
  }
  throw new Error("La base no pudo decidir qué API de Mercado Pago corresponde");
}

function providerBody(prepared: JsonRecord): JsonRecord {
  if (prepared.is_total === true) return {};
  const amount = amountText(prepared.amount);
  if (prepared.api_mode === "orders") {
    const paymentId = cleanText(prepared.provider_payment_id, 180);
    if (!paymentId) throw new Error("El reintegro parcial no conserva la transacción de Mercado Pago");
    return { transactions: [{ id: paymentId, amount }] };
  }
  return { amount: Number(amount) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const orgId = cleanText(body.orgId, 80);
    const refundId = cleanText(body.refundId, 80);
    const action = (cleanText(body.action, 20) ?? "execute") as RefundAction;
    if (!orgId || !UUID_RE.test(orgId) || !refundId || !UUID_RE.test(refundId)) {
      return json({ error: "Organización o reintegro inválido" }, 400);
    }
    if (action !== "execute" && action !== "reconcile") {
      return json({ error: "Acción de reintegro inválida" }, 400);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const userClient = createClient(supabaseUrl, requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: canRefund, error: permissionError } = await userClient.rpc("has_permission", {
      p_org_id: orgId,
      p_module: "payments",
      p_action: "edit",
    });
    if (permissionError) {
      console.error("refund-pos-payment permission:", permissionError);
      return json({ error: "No se pudo verificar el permiso de reintegro" }, 500);
    }
    if (canRefund !== true) return json({ error: "No tenés permiso para gestionar reintegros" }, 403);

    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data, error: prepareError } = await admin.rpc("pos_mp_refund_prepare", {
      p_org_id: orgId,
      p_refund_id: refundId,
      p_requested_by: auth.user.id,
      p_increment_attempt: action === "execute",
    });
    if (prepareError) {
      console.error("pos_mp_refund_prepare:", prepareError);
      return json({ error: cleanText(prepareError.message, 500) ?? "No se pudo preparar el reintegro" }, 422);
    }
    const prepared = asRecord(data);
    if (prepared.already_completed === true) {
      return json({ ok: true, status: "completed", refundId, reused: true });
    }

    const credentials = await getMpCredentials(admin, orgId);
    if (!credentials) {
      await admin.rpc("pos_mp_refund_observe", {
        p_refund_id: refundId,
        p_provider_status: "not_connected",
        p_external_refund_id: null,
        p_failure_reason: "La cuenta de Mercado Pago no está conectada por OAuth",
        p_raw: { source: "gestiona", reason: "missing_credentials" },
      });
      return json({
        error: "Conectá Mercado Pago por OAuth desde Integraciones para ejecutar el reintegro.",
        code: "MP_NOT_CONNECTED",
        status: "pending_external",
        refundId,
      }, 422);
    }

    // Si otro proceso ya marcó el cobro como refunded, nunca se vuelve a
    // ordenar dinero: se fuerza consulta y conciliación.
    const effectiveAction: RefundAction = prepared.payment_status === "refunded"
      ? "reconcile"
      : action;
    const mode = prepared.api_mode as ApiMode;
    const url = providerUrl(prepared, effectiveAction);
    let provider: { response: Response; payload: unknown };
    try {
      provider = effectiveAction === "execute"
        ? await mpJson(url, credentials.accessToken, {
          method: "POST",
          headers: { "X-Idempotency-Key": String(prepared.client_key) },
          body: JSON.stringify(providerBody(prepared)),
        })
        : await mpJson(url, credentials.accessToken);
    } catch (error) {
      console.error("refund-pos-payment provider network:", error);
      await admin.rpc("pos_mp_refund_observe", {
        p_refund_id: refundId,
        p_provider_status: "network_unknown",
        p_external_refund_id: prepared.provider_refund_id ?? null,
        p_failure_reason: "Mercado Pago no respondió; el resultado necesita verificación",
        p_raw: { source: "mercadopago_refund", outcome: "network_unknown" },
      });
      return json({
        ok: true,
        status: "pending_external",
        refundId,
        message: "Mercado Pago no respondió. El reintegro sigue pendiente y puede verificarse sin duplicarlo.",
      }, 202);
    }

    if (!provider.response.ok) {
      const providerError = asRecord(provider.payload);
      const providerMessage = cleanText(providerError.message ?? providerError.error, 350)
        ?? `Mercado Pago respondió HTTP ${provider.response.status}`;
      const ambiguous = provider.response.status === 409 || provider.response.status >= 500;
      await admin.rpc("pos_mp_refund_observe", {
        p_refund_id: refundId,
        p_provider_status: `http_${provider.response.status}`,
        p_external_refund_id: prepared.provider_refund_id ?? null,
        p_failure_reason: ambiguous
          ? "Mercado Pago no confirmó el resultado; verificá el estado antes de reintentar"
          : providerMessage,
        p_raw: {
          source: "mercadopago_refund",
          http_status: provider.response.status,
          error: cleanText(providerError.error, 120),
          message: cleanText(providerError.message, 300),
        },
      });
      if (ambiguous) {
        return json({
          ok: true,
          status: "pending_external",
          refundId,
          message: "Mercado Pago dejó un resultado ambiguo. Usá Verificar estado antes de reintentar.",
        }, 202);
      }
      return json({ error: providerMessage, status: "pending_external", refundId }, 422);
    }

    const rows = refundRows(provider.payload, mode);
    const match = findConfirmedRefund({
      rows,
      mode,
      expectedId: cleanText(prepared.provider_refund_id, 180),
      amount: Number(prepared.amount),
      paymentId: cleanText(prepared.provider_payment_id, 180),
    });
    if (!match.row) {
      await admin.rpc("pos_mp_refund_observe", {
        p_refund_id: refundId,
        p_provider_status: match.ambiguous ? "ambiguous" : "processing",
        p_external_refund_id: prepared.provider_refund_id ?? null,
        p_failure_reason: match.ambiguous
          ? "Mercado Pago devolvió más de un reintegro compatible; requiere revisión"
          : null,
        p_raw: collectionSnapshot(rows, mode),
      });
      return json({
        ok: true,
        status: "pending_external",
        refundId,
        message: match.ambiguous
          ? "Hay más de un reintegro compatible; no se conciliará automáticamente."
          : "Mercado Pago recibió la operación, pero todavía no confirmó el reintegro.",
      }, 202);
    }

    const externalId = cleanText(match.row.id, 180);
    const snapshot = refundSnapshot(match.row, mode);
    const { error: observeError } = await admin.rpc("pos_mp_refund_observe", {
      p_refund_id: refundId,
      p_provider_status: cleanText(match.row.status, 80) ?? "confirmed",
      p_external_refund_id: externalId,
      p_failure_reason: null,
      p_raw: snapshot,
    });
    if (observeError) {
      console.error("pos_mp_refund_observe confirmed:", observeError);
      return json({
        ok: true,
        status: "pending_external",
        refundId,
        message: "Mercado Pago confirmó el reintegro; falta guardar su evidencia en Nerqia.",
      }, 202);
    }

    const { data: completed, error: completeError } = await admin.rpc("sales_return_refund_complete", {
      p_refund_id: refundId,
      p_external_reference: externalId ?? `mercadopago:${refundId}`,
      p_raw: snapshot,
    });
    if (completeError) {
      console.error("sales_return_refund_complete provider:", completeError);
      return json({
        ok: true,
        status: "pending_external",
        refundId,
        message: "Mercado Pago confirmó el dinero; falta terminar la conciliación contable.",
      }, 202);
    }

    return json({
      ok: true,
      status: "completed",
      refundId,
      returnStatus: asRecord(completed).return_status ?? null,
      externalRefundId: externalId,
    });
  } catch (error) {
    console.error("refund-pos-payment error:", error);
    return json({ error: "No se pudo operar el reintegro de Mercado Pago" }, 500);
  }
});

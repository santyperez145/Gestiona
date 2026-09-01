/**
 * Ejecuta un reintegro de MercadoPago para un RMA aprobado.
 *
 * La clave privada y el monto viven del lado servidor. El navegador sólo
 * identifica la solicitud; la base bloquea la orden, valida el saldo disponible
 * y conserva una clave estable que se repite ante cualquier retry.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function providerSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  return {
    id: cleanText(row.id, 120),
    status: cleanText(row.status, 80),
    amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
    payment_id: cleanText(row.payment_id, 120),
    date_created: cleanText(row.date_created, 80),
    source: "mercadopago_refund",
  };
}

function providerRefundRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  if (!value || typeof value !== "object") return [];
  const rows = (value as Record<string, unknown>).refunds;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [];
}

function refundCollectionSnapshot(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    source: "mercadopago_refund_list",
    refunds: rows.slice(0, 25).map(providerSnapshot),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const orgId = cleanText(body.orgId, 80);
    const returnRequestId = cleanText(body.returnRequestId, 80);
    const action = cleanText(body.action, 20) ?? "execute";
    if (!orgId || !returnRequestId) {
      return json({ error: "Faltan la organización o la solicitud de devolución" }, 400);
    }
    if (action !== "execute" && action !== "reconcile") {
      return json({ error: "Operación de reintegro inválida" }, 400);
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
      console.error("refund-store-payment permission:", permissionError);
      return json({ error: "No se pudo verificar el permiso de reintegro" }, 500);
    }
    if (canRefund !== true) {
      return json({ error: "No tenés permiso para gestionar reintegros" }, 403);
    }

    // La service role ejecuta la parte privada sólo después de que el cliente
    // autenticado pasó la matriz configurable de la organización.
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: prepared, error: prepareError } = action === "reconcile"
      ? await admin.rpc("pago_reintegro_estado", {
        p_org_id: orgId,
        p_return_request_id: returnRequestId,
      })
      : await admin.rpc("pago_reintegro_preparar", {
        p_org_id: orgId,
        p_return_request_id: returnRequestId,
        p_requested_by: auth.user.id,
      });
    if (prepareError) {
      console.error("pago_reintegro_preparar:", prepareError);
      return json({ error: cleanText(prepareError.message, 500) ?? "No se pudo preparar el reintegro" }, 422);
    }

    const refund = (prepared ?? {}) as Record<string, unknown>;
    if (refund.already_refunded === true) {
      return json({ ok: true, status: "refunded", reused: true, refundId: refund.refund_id });
    }
    if (action === "reconcile" && refund.status === "not_started") {
      return json({ ok: true, status: "not_started", refundId: null });
    }
    if (action === "reconcile" && refund.status === "refunded") {
      return json({ ok: true, status: "refunded", refundId: refund.refund_id, reused: true });
    }
    if (action === "reconcile" && refund.status === "failed") {
      return json({ ok: false, status: "failed", refundId: refund.refund_id, error: refund.failure_reason ?? "El reintegro falló" }, 422);
    }

    const actualOrgId = cleanText(refund.org_id, 80);
    const paymentId = cleanText(refund.payment_id, 120);
    const refundId = cleanText(refund.refund_id, 80);
    const clientKey = cleanText(refund.client_key, 200);
    const amount = Number(refund.amount);
    const isTotal = refund.is_total === true;
    if (actualOrgId !== orgId || !paymentId || !refundId || !clientKey || !Number.isFinite(amount) || amount <= 0) {
      console.error("refund-store-payment: preparación incompleta", { refundId, actualOrgId, orgId });
      return json({ error: "La preparación del reintegro devolvió datos incompletos" }, 500);
    }

    const credentials = await getMpCredentials(admin, actualOrgId);
    if (!credentials) {
      await admin.rpc("pago_reintegro_resultado", {
        p_refund_id: refundId,
        p_status: "failed",
        p_failure_reason: "La cuenta de MercadoPago no está conectada",
        p_raw: { source: "gestion", reason: "missing_credentials" },
      });
      return json({ error: "La cuenta de MercadoPago no está conectada" }, 422);
    }

    if (action === "reconcile") {
      let providerResponse: Response;
      let providerPayload: unknown;
      try {
        providerResponse = await fetch(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
          { headers: { Authorization: `Bearer ${credentials.accessToken}` } },
        );
        providerPayload = await providerResponse.json().catch(() => ({}));
      } catch (error) {
        console.error("refund-store-payment reconcile network:", error);
        return json({ ok: true, status: "processing", refundId, message: "MercadoPago no respondió; el reintegro sigue en verificación." }, 202);
      }

      if (!providerResponse.ok) {
        console.error("refund-store-payment reconcile provider:", providerResponse.status);
        return json({ ok: true, status: "processing", refundId, message: "No se pudo consultar MercadoPago; el reintegro sigue en verificación." }, 202);
      }

      const rows = providerRefundRows(providerPayload);
      const expectedExternalId = cleanText(refund.external_refund_id, 120);
      const candidates = rows.filter(row => {
        if (String(row.status ?? "").toLowerCase() !== "approved") return false;
        const rowId = cleanText(row.id, 120);
        if (expectedExternalId) return rowId === expectedExternalId;
        return Math.abs(Number(row.amount) - amount) < 0.01;
      });

      if (candidates.length !== 1) {
        await admin.rpc("pago_reintegro_observar", {
          p_refund_id: refundId,
          p_raw: refundCollectionSnapshot(rows),
        });
        return json({
          ok: true,
          status: "processing",
          refundId,
          message: candidates.length > 1
            ? "Hay más de un reintegro compatible en MercadoPago; requiere revisión."
            : "MercadoPago todavía no muestra un reintegro confirmado.",
        }, 202);
      }

      const confirmed = providerSnapshot(candidates[0]);
      const { data: settled, error: settleError } = await admin.rpc("pago_reintegro_resultado", {
        p_refund_id: refundId,
        p_status: "refunded",
        p_external_id: cleanText(candidates[0].id, 120),
        p_raw: confirmed,
      });
      if (settleError) {
        console.error("pago_reintegro_resultado reconcile:", settleError);
        return json({ ok: true, status: "processing", refundId, message: "El proveedor confirmó el reintegro; falta sincronizar Gestiona." }, 202);
      }
      return json({ ok: true, status: "refunded", refundId, orderPaymentStatus: (settled as Record<string, unknown> | null)?.order_payment_status ?? null });
    }

    const refundBody = isTotal ? {} : { amount };
    let providerResponse: Response;
    let providerPayload: unknown;
    try {
      providerResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": clientKey,
          },
          body: JSON.stringify(refundBody),
        },
      );
      providerPayload = await providerResponse.json().catch(() => ({}));
    } catch (error) {
      // Un timeout no demuestra que MercadoPago no ejecutó el reintegro. Se
      // deja `processing` y el retry usa exactamente la misma clave.
      console.error("refund-store-payment provider network:", error);
      return json({
        ok: true,
        status: "processing",
        refundId,
        message: "MercadoPago no respondió. El reintegro quedó en verificación; reintentá con la misma operación.",
      }, 202);
    }

    if (!providerResponse.ok) {
      const providerError = providerPayload as Record<string, unknown>;
      const detail = cleanText(providerError.message ?? providerError.error, 400)
        ?? `MercadoPago respondió HTTP ${providerResponse.status}`;
      const { error: resultError } = await admin.rpc("pago_reintegro_resultado", {
        p_refund_id: refundId,
        p_status: "failed",
        p_failure_reason: detail,
        p_raw: {
          source: "mercadopago_refund",
          http_status: providerResponse.status,
          error: cleanText(providerError.error, 120),
          message: cleanText(providerError.message, 300),
        },
      });
      if (resultError) console.error("pago_reintegro_resultado failed:", resultError);
      return json({ error: detail, refundId }, providerResponse.status === 409 ? 409 : 422);
    }

    const snapshot = providerSnapshot(providerPayload);
    const providerStatus = cleanText((providerPayload as Record<string, unknown>)?.status, 80)?.toLowerCase();
    if (providerStatus !== "approved") {
      await admin.rpc("pago_reintegro_observar", {
        p_refund_id: refundId,
        p_raw: snapshot,
      });
      return json({
        ok: true,
        status: "processing",
        refundId,
        message: "MercadoPago recibió la operación, pero todavía no confirmó el reintegro.",
      }, 202);
    }
    const externalRefundId = cleanText((providerPayload as Record<string, unknown>)?.id, 120);
    const { data: settled, error: settleError } = await admin.rpc("pago_reintegro_resultado", {
      p_refund_id: refundId,
      p_status: "refunded",
      p_external_id: externalRefundId,
      p_raw: snapshot,
    });
    if (settleError) {
      // El proveedor ya confirmó el dinero. No se marca failed: la misma clave
      // permite reconsultar/asentar sin crear un segundo reintegro.
      console.error("pago_reintegro_resultado success:", settleError);
      return json({
        ok: true,
        status: "processing",
        refundId,
        message: "MercadoPago confirmó el reintegro; falta terminar de sincronizar Gestiona.",
      }, 202);
    }

    return json({
      ok: true,
      status: "refunded",
      refundId,
      orderPaymentStatus: (settled as Record<string, unknown> | null)?.order_payment_status ?? null,
    });
  } catch (error) {
    console.error("refund-store-payment error:", error);
    return json({ error: "No se pudo ejecutar el reintegro" }, 500);
  }
});

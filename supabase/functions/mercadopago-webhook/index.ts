import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-client-event-sig",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Verificar firma de webhook de Mercado Pago
  const signature = req.headers.get("x-signature-256");
  const payload = await req.text();

  // Firme verificación: MP firma con sha256 del body + secreto
  const credentials = await getMpCredentials(
    createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    ),
    req.headers.get("x-org-id") ?? ""
  );
  if (!credentials) return json({ error: "Sin credenciales MP" }, 400);

  const secret = credentials.webhook_secret ?? "";
  if (secret) {
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("base64");
    const expectedSig = `sha256=${hmac}`;
    if (signature !== expectedSig) {
      console.error("Firma webhook MP inválida:", signature, "vs", expectedSig);
      return json({ error: "Firma de webhook inválida" }, 401);
    }
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  const data = await JSON.parse(payload).catch(() => ({}));
  const type = data?.type;
  const dataObj = data?.data ?? {};

  // Procesar tipos de webhook críticos
  switch (type) {
    case "payment": {
      const paymentId = dataObj.id;
      const paymentStatus = dataObj.payment_status;
      const mpCustomerId = dataObj?.payer?.id ?? null;
      const paymentMethod = dataObj.payment_method_id ?? null;
      const amount = dataObj.transaction_amount;
      const currency = dataObj.currency_id ?? "ARS";
      const orderId = dataObj.order_id ?? null;

      // Actualizar estado de venta local
      if (paymentId) {
        // Buscar venta por external_reference o crear registro
        await createClient(
          requireEnv("SUPABASE_URL"),
          requireEnv("SUPABASE_SERVICE_ROLE_KEY")
        ).from("sales").upsert({
          mp_payment_id: String(paymentId),
          org_id: req.headers.get("x-org-id") ?? "",
          mp_customer_id: mpCustomerId,
          payment_method: paymentMethod ?? "mercado_pago",
          payment_status: paymentStatus,
          total_ars: amount,
          currency,
          processed_at: new Date().toISOString(),
        }, { onConflict: "mp_payment_id" });
      }

      // Manejar auto-confirmación para stock/checkout
      if (paymentStatus === "approved" || paymentStatus === "collector_approval") {
        // Verificar si hay órdenes asociadas
        if (orderId) {
          await createClient(
            requireEnv("SUPABASE_URL"),
            requireEnv("SUPABASE_SERVICE_ROLE_KEY")
          ).from("orders").update({
            payment_status: paymentStatus,
            mp_payment_id: paymentId,
            updated_at: new Date().toISOString(),
          }).eq("mp_order_id", orderId);
        }
      }
      break;
    }

    case "subscription_preapproval": {
      const preapprovalId = dataObj.id;
      const subStatus = dataObj.status;
      const subscriptionId = dataObj?.subscription_id ?? null;

      // Actualizar preapproval local con estado MP
      await createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
      ).from("subscriptions").upsert({
        mp_preapproval_id: preapprovalId,
        org_id: req.headers.get("x-org-id" ?? ""),
        status: subStatus,
        mp_subscription_id: subscriptionId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "mp_preapproval_id" });

      // Notificar a organizador sobre cambio de estado
      console.log(`Webhook MP: subscription_preapproval - ${preapprovalId}: ${subStatus}`);
      break;
    }

    case "subscription_authorized_payment": {
      // Un pago fue autorizado dentro de una suscripción pre-approval existente
      const preapprovalId = dataObj.preapproval_id;
      const paymentId = dataObj.id;
      const amount = dataObj.transaction_amount;

      console.log(`Webhook MP: authorized payment - ${paymentId} para ${preapprovalId}: $${amount}`);

      // Actualizar última autorización
      await createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
      ).from("subscriptions").upsert({
        mp_preapproval_id: preapprovalId,
        org_id: req.headers.get("x-org-id") ?? "",
        last_authorized_payment: paymentId,
        last_authorized_amount: amount,
        updated_at: new Date().toISOString(),
      }, { onConflict: "mp_preapproval_id" });
      break;
    }

    case "order": {
      // Nueva orden completa creada vía Checkout API Orders
      const orderId = dataObj.id;
      const orderStatus = dataObj.status;
      const totalAmount = dataObj.total_amount;
      const currency = dataObj.currency_id ?? "ARS";
      // Extraer ítems para auditoría rápida
      const items = dataObj?.items ?? [];

      await createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
      ).from("orders").upsert({
        mp_order_id: orderId,
        org_id: req.headers.get("x-org-id") ?? "",
        status: orderStatus,
        total_ars: totalAmount,
        currency,
        items_json: JSON.stringify(items.map((it: any) => ({
          id: it.id,
          title: it.title,
          quantity: it.quantity,
          unit_price: it.unit_price,
        }))),
        updated_at: new Date().toISOString(),
      }, { onConflict: "mp_order_id" });

      console.log(`Webhook MP: order ${orderId} creado - ${orderStatus}: $${totalAmount}`);
      break;
    }

    case "refund": {
      const refundId = dataObj.id;
      const paymentId = dataObj.payment_id;
      const amount = dataObj.amount;
      const reason = dataObj?.reason ?? null;

      await createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
      ).from("refunds").upsert({
        mp_refund_id: refundId,
        org_id: req.headers.get("x-org-id") ?? "",
        mp_payment_id: paymentId ?? null,
        amount_ars: amount,
        currency: currency ?? "ARS",
        reason,
        processed_at: new Date().toISOString(),
      }, { onConflict: "mp_refund_id" });
      break;
    }

    case "chargeback": {
      const chargebackId = dataObj.id;
      const paymentId = dataObj.payment_id;
      const status = dataObj.status;

      await createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
      ).from("chargebacks").upsert({
        mp_chargeback_id: chargebackId,
        org_id: req.headers.get("x-org-id") ?? "",
        mp_payment_id: paymentId ?? null,
        status,
        recorded_at: new Date().toISOString(),
      }, { onConflict: "mp_chargeback_id" });

      // Marcar venta como disputada si existe
      if (paymentId) {
        await createClient(
          requireEnv("SUPABASE_URL"),
          requireEnv("SUPABASE_SERVICE_ROLE_KEY")
        ).from("sales").update({
          payment_status: "disputed",
          updated_at: new Date().toISOString(),
        }).eq("mp_payment_id", paymentId);
      }
      break;
    }

    case "installment": {
      // Actualización de cuota - útil para planes suscriptivos
      const preapprovalId = dataObj.preapproval_id ?? null;
      const paymentId = dataObj.payment_id ?? null;
      const installmentId = dataObj.installment_id ?? null;
      const amount = dataObj.amount ?? null;

      if (preapprovalId && paymentId) {
        await createClient(
          requireEnv("SUPABASE_URL"),
          requireEnv("SUPABASE_SERVICE_ROLE_KEY")
        ).from("subscriptions").upsert({
          mp_preapproval_id: preapprovalId,
          org_id: req.headers.get("x-org-id") ?? "",
          last_installment_payment: paymentId,
          last_installment_amount: amount,
          updated_at: new Date().toISOString(),
        }, { onConflict: "mp_preapproval_id" });
      }
      break;
    }

    default:
      console.log(`Webhook MP no procesado: ${type}`);
      break;
  }

  // Responder siempre 200 OK a MP (no reintentar)
  return new Response("ok", { status: 200, headers: corsHeaders });
});
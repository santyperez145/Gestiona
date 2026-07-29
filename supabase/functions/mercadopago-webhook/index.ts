// Handles Mercado Pago IPN/webhook notifications (payment.created, payment.updated).
// Verifies x-signature header, fetches payment details and updates payment_links + sales.
// Register at: MP Developers → Tus aplicaciones → Webhooks → URL de notificación
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Verify Mercado Pago webhook signature
// Header: x-signature = "ts=<epoch>,v1=<sha256hex>"
// Template: id:<payment_id>;request-id:<x-request-id>;ts:<epoch>
async function verifyMpSignature(
  paymentId: string,
  requestId: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(signature.split(",").map(p => p.split("=")));
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;

    const template = `id:${paymentId};request-id:${requestId};ts:${ts}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(template));
    const computed = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return computed === v1;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-signature, x-request-id",
      },
    });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ ok: false, reason: "invalid json" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // MP sends: { type: "payment", action: "payment.updated", data: { id: "..." } }
    const type: string = body.type || body.topic || "";
    const paymentId: string = String(body.data?.id || body.id || "");

    if (!paymentId || type !== "payment") {
      // Acknowledge non-payment notifications (subscriptions, etc.)
      return new Response(JSON.stringify({ ok: true, reason: `skipped type: ${type}` }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const signature = req.headers.get("x-signature") || "";
    const requestId = req.headers.get("x-request-id") || "";

    // We need to find the right org's MP token to verify and fetch the payment.
    // Strategy: use external_reference in URL query params or find by payment after fetch.
    // MP also sends ?id=<payment_id>&topic=payment in query string (IPN mode).
    const url = new URL(req.url);
    const orgIdFromQuery = url.searchParams.get("org_id") || "";

    // Verify MP signature — mandatory when MP_WEBHOOK_SECRET is configured
    const globalWebhookSecret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
    if (globalWebhookSecret) {
      if (!signature || !requestId) {
        console.warn(`Missing MP signature headers for payment ${paymentId}`);
        return new Response(JSON.stringify({ ok: false, reason: "missing signature headers" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }
      const valid = await verifyMpSignature(paymentId, requestId, signature, globalWebhookSecret);
      if (!valid) {
        console.warn(`Invalid MP signature for payment ${paymentId}`);
        return new Response(JSON.stringify({ ok: false, reason: "invalid signature" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Find the org — try query param first, then lookup by payment external_reference later
    let orgId = orgIdFromQuery;
    let mpAccessToken = "";

    if (orgId) {
      const { data: settings } = await admin
        .from("settings")
        .select("mp_access_token, mp_enabled")
        .eq("org_id", orgId)
        .maybeSingle();
      if (settings?.mp_enabled && settings?.mp_access_token) {
        mpAccessToken = settings.mp_access_token;
      }
    }

    // If no org from query, try to find by checking all orgs with MP enabled (fallback)
    if (!mpAccessToken && !orgId) {
      const { data: settingsList } = await admin
        .from("settings")
        .select("org_id, mp_access_token")
        .eq("mp_enabled", true)
        .not("mp_access_token", "is", null)
        .limit(50);

      // We'll try each token until we find the one that owns this payment
      for (const s of settingsList || []) {
        try {
          const testRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${s.mp_access_token}` },
          });
          if (testRes.ok) {
            orgId = s.org_id;
            mpAccessToken = s.mp_access_token;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!mpAccessToken) {
      console.warn(`No MP token found for payment ${paymentId}`);
      return new Response(JSON.stringify({ ok: true, reason: "no mp token" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch payment details from MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    });

    if (!mpRes.ok) {
      console.error(`MP payment fetch failed: ${mpRes.status}`);
      return new Response(JSON.stringify({ ok: false, reason: `mp api: ${mpRes.status}` }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const payment = await mpRes.json();
    const externalRef: string = payment.external_reference || "";
    const status: string = payment.status || ""; // approved, pending, rejected, cancelled, refunded
    const statusDetail: string = payment.status_detail || "";
    const paidAmount: number = Number(payment.transaction_amount) || 0;
    const payerEmail: string = payment.payer?.email || "";
    const paymentMethod: string = payment.payment_type_id || "mercado_pago";

    const isApproved = status === "approved";
    const isRejected = status === "rejected" || status === "cancelled";

    // ── Orden de la tienda online ──────────────────────────────────────────
    // `store-pay` marca sus preferencias con external_reference = "ecom:<uuid>".
    // El RPC descuenta stock, registra la venta y avisa al dueño, todo de forma
    // atómica e idempotente: MP reintenta sus webhooks.
    if (externalRef.startsWith("ecom:")) {
      const orderId = externalRef.slice(5);
      if (isApproved) {
        const { error: paidErr } = await admin.rpc("mark_store_order_paid", {
          p_order_id: orderId,
          p_payment_id: String(paymentId),
          p_method: "mercado_pago",
        });
        if (paidErr) console.error("mark_store_order_paid:", paidErr.message);
      } else if (isRejected) {
        await admin
          .from("ecommerce_orders")
          .update({ payment_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", orderId)
          .neq("payment_status", "paid");
      }

      console.log(`MP ecom order ${orderId}: ${status} (${statusDetail})`);
      return new Response(JSON.stringify({ ok: true, status, paymentId, scope: "ecommerce" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Update payment_links table ─────────────────────────────────────────────
    if (externalRef) {
      const linkStatus = isApproved ? "paid" : isRejected ? "rejected" : "pending";
      await admin
        .from("payment_links")
        .update({
          status: linkStatus,
          mp_payment_id: String(paymentId),
          paid_at: isApproved ? new Date().toISOString() : null,
        })
        .eq("org_id", orgId)
        .eq("external_ref", externalRef);

      // ── Update related sale if external_ref is a sale id ─────────────────
      if (isApproved) {
        // external_ref may be "sale:<uuid>" or just a uuid
        const saleId = externalRef.startsWith("sale:") ? externalRef.slice(5) : externalRef;
        const { error: saleErr } = await admin
          .from("sales")
          .update({ paid: true, payment_method: "mercado_pago" })
          .eq("org_id", orgId)
          .eq("id", saleId)
          .eq("paid", false);

        if (!saleErr) {
          // Notify the org owner
          const { data: membership } = await admin
            .from("memberships")
            .select("user_id")
            .eq("org_id", orgId)
            .in("role", ["owner", "admin"])
            .limit(1)
            .maybeSingle();

          if (membership?.user_id) {
            try {
              await admin.from("notifications").insert({
                user_id: membership.user_id,
                org_id: orgId,
                title: "Pago Mercado Pago confirmado",
                message: `Pago de $${paidAmount.toLocaleString("es-AR")} confirmado${payerEmail ? ` de ${payerEmail}` : ""} (${statusDetail || status})`,
                type: "mercado_pago",
              });
            } catch { /* silent */ }
          }
        }
      }
    }

    console.log(`MP payment ${paymentId}: ${status} (${statusDetail}) ref=${externalRef} org=${orgId}`);

    return new Response(JSON.stringify({ ok: true, status, paymentId }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mercadopago-webhook error:", e);
    // Always 200 to avoid MP flooding us with retries
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

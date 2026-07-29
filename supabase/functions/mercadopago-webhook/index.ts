// Handles Mercado Pago IPN/webhook notifications (payment.created, payment.updated).
// Verifies x-signature header, fetches payment details and updates payment_links + sales.
// Register at: MP Developers → Tus aplicaciones → Webhooks → URL de notificación
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getMpCredentials } from "../_shared/mpToken.ts";

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
 * Guarda el cobro con el desglose completo. Es idempotente por
 * (provider, external_id): MercadoPago reintenta el mismo webhook varias veces
 * y no podemos contar la misma comisión dos veces.
 *
 * Espeja `src/lib/paymentFees.ts` — si cambia la fórmula, cambian los dos.
 */
async function recordPaymentTransaction(
  admin: ReturnType<typeof createClient>,
  args: {
    orgId: string;
    paymentId: string;
    payment: any;
    status: string;
    gross: number;
    externalRef: string;
  },
) {
  const { orgId, paymentId, payment, status, gross, externalRef } = args;
  if (!orgId || gross <= 0) return;

  try {
    const method = mapMethod(payment.payment_type_id || "");
    const installments = Number(payment.installments) || 0;
    const currency = payment.currency_id || "ARS";

    // 1. Arancel: preferimos lo que MP dice que cobró de verdad
    const mpFee = (payment.fee_details || [])
      .filter((f: any) => f.type === "mercadopago_fee")
      .reduce((sum: number, f: any) => sum + (Number(f.amount) || 0), 0);

    const { data: feeRows } = await admin
      .from("payment_provider_fees")
      .select("*")
      .eq("provider", "mercadopago")
      .eq("currency", currency)
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false });

    const schedule = (feeRows || []) as any[];
    const feeRow =
      schedule.find((f) => f.method === method && f.installments === installments) ||
      schedule.find((f) => f.method === method && f.installments === 0) ||
      schedule.find((f) => f.method === "default") ||
      null;

    const providerFee = mpFee > 0
      ? round2(mpFee)
      : feeRow
        ? round2(gross * (Number(feeRow.percent_fee) || 0) / 100 + (Number(feeRow.fixed_fee) || 0))
        : 0;
    const providerFeeIva = round2(providerFee * (Number(feeRow?.iva_on_fee_pct) || 0) / 100);

    // 2. Comisión de plataforma: regla más específica (org > plan > default)
    const { data: org } = await admin
      .from("organizations").select("plan_id").eq("id", orgId).maybeSingle();
    const planId = (org as any)?.plan_id || null;

    const { data: ruleRows } = await admin
      .from("platform_commission_rules")
      .select("*")
      .eq("is_active", true);

    const channel = externalRef.startsWith("order:") ? "online" : "pos";
    const candidates = ((ruleRows || []) as any[]).filter((r) => {
      if (r.applies_to !== "all" && r.applies_to !== channel) return false;
      if (r.org_id && r.org_id !== orgId) return false;
      if (r.plan_id && r.plan_id !== planId) return false;
      return true;
    });
    const score = (r: any) =>
      (r.org_id ? 4 : 0) + (r.plan_id ? 2 : 0) + (r.applies_to !== "all" ? 1 : 0);
    const rule = candidates.length
      ? candidates.reduce((best, r) => (score(r) > score(best) ? r : best), candidates[0])
      : null;

    let platformFee = 0;
    if (rule) {
      platformFee = gross * (Number(rule.percent) || 0) / 100 + (Number(rule.fixed) || 0);
      if (rule.max_per_transaction != null) {
        platformFee = Math.min(platformFee, Number(rule.max_per_transaction));
      }
      if (rule.min_per_transaction) {
        platformFee = Math.max(platformFee, Number(rule.min_per_transaction));
      }
      platformFee = round2(Math.min(platformFee, gross));
    }

    const net = round2(Math.max(0, gross - providerFee - providerFeeIva - platformFee));

    const releaseDays = Number(feeRow?.release_days) || 0;
    const expectedRelease = new Date();
    expectedRelease.setDate(expectedRelease.getDate() + releaseDays);

    // `source_id` sólo si el external_ref trae un uuid identificable
    const refId = externalRef.includes(":") ? externalRef.split(":")[1] : externalRef;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refId);

    await admin.from("payment_transactions").upsert({
      org_id: orgId,
      source: externalRef.startsWith("order:") ? "ecommerce" : "payment_link",
      source_id: isUuid ? refId : null,
      provider: "mercadopago",
      method,
      installments,
      gross_amount: round2(gross),
      provider_fee: providerFee,
      provider_fee_iva: providerFeeIva,
      platform_fee: platformFee,
      net_amount: net,
      currency,
      status: mapStatus(status),
      external_id: paymentId,
      expected_release_at: expectedRelease.toISOString().slice(0, 10),
      released_at: status === "approved" && releaseDays === 0 ? new Date().toISOString() : null,
      raw: {
        status_detail: payment.status_detail,
        payment_type_id: payment.payment_type_id,
        fee_details: payment.fee_details,
        external_reference: externalRef,
      },
    }, { onConflict: "provider,external_id" });
  } catch (e) {
    // No romper el webhook por esto: el pago ya está confirmado y MP no debe
    // reintentar. Queda en logs para reconciliar después.
    console.error(`recordPaymentTransaction falló para ${paymentId}:`, e);
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
      // Resuelve por la conexión OAuth y cae al token pegado a mano si el
      // comercio todavía no migró.
      const creds = await getMpCredentials(admin, orgId);
      if (creds) mpAccessToken = creds.accessToken;
    }

    // Sin org en la query, se prueban las cuentas conectadas hasta dar con la
    // dueña del pago. Se miran primero las conexiones OAuth y después los
    // tokens pegados a mano: con OAuth, settings.mp_access_token queda vacío y
    // este camino se habría quedado ciego.
    if (!mpAccessToken && !orgId) {
      const [{ data: conns }, { data: settingsList }] = await Promise.all([
        admin.from("payment_connections")
          .select("org_id, access_token")
          .eq("provider", "mercadopago")
          .not("access_token", "is", null)
          .limit(50),
        admin.from("settings")
          .select("org_id, mp_access_token")
          .eq("mp_enabled", true)
          .not("mp_access_token", "is", null)
          .limit(50),
      ]);

      const candidatos = [
        ...(conns ?? []).map((c: any) => ({ org_id: c.org_id, token: c.access_token })),
        ...(settingsList ?? []).map((s: any) => ({ org_id: s.org_id, token: s.mp_access_token })),
      ];

      for (const c of candidatos) {
        try {
          const testRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${c.token}` },
          });
          if (testRes.ok) {
            orgId = c.org_id;
            mpAccessToken = c.token;
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

        // Confirmación por email, best-effort: el cobro ya se registró y un
        // fallo de envío no debe hacer que MP reintente el webhook.
        if (!paidErr) {
          try {
            const { data: ord } = await admin
              .from("ecommerce_orders")
              .select("order_number, ecommerce_stores(slug)")
              .eq("id", orderId)
              .maybeSingle();
            const slug = (ord as any)?.ecommerce_stores?.slug;
            if (slug && ord?.order_number) {
              await admin.functions.invoke("store-order-email", {
                body: {
                  slug,
                  orderNumber: ord.order_number,
                  baseUrl: Deno.env.get("PUBLIC_BASE_URL") ?? "",
                },
              });
            }
          } catch (e) {
            console.error("store-order-email:", e);
          }
        }
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

    // ── Registrar el cobro con su desglose de comisiones ───────────────────
    // Un cobro no es sólo "pagó / no pagó": hay que saber cuánto se lleva el
    // procesador y cuánto la plataforma, si no la tienda no sabe qué le queda y
    // la plataforma no sabe qué facturó.
    await recordPaymentTransaction(admin, {
      orgId,
      paymentId: String(paymentId),
      payment,
      status,
      gross: paidAmount,
      externalRef,
    });

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

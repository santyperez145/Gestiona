// Handles Mercado Pago IPN/webhook notifications (payment.created, payment.updated).
// Verifies x-signature header, fetches payment details and updates payment_links + sales.
// Register at: MP Developers → Tus aplicaciones → Webhooks → URL de notificación
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { recordPaymentTransaction } from "../_shared/paymentSettlement.ts";
import { providerAttemptState, recordPaymentAttempt } from "../_shared/paymentOrchestrator.ts";

/**
 * Verifica la firma del webhook de MercadoPago.
 *
 * Header: `x-signature: ts=<epoch>,v1=<sha256hex>`
 *
 * El manifiesto que MP firma lleva **punto y coma final**:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<epoch>;
 *
 * Acá se armaba sin ese último `;`. Un byte de diferencia da otro HMAC, así
 * que **toda** notificación daba firma inválida y se respondía 401. Resultado:
 * una compra real quedaba pagada y acreditada en MercadoPago y la orden se
 * quedaba en "esperando el pago" para siempre, sin venta, sin descuento de
 * stock y sin aparecer en los tableros.
 *
 * Se prueban las dos formas porque la documentación de MP cambió de redacción
 * más de una vez y el costo de aceptar ambas es un HMAC más. Lo que no se
 * afloja es la exigencia de firma: sin ella, cualquiera podría marcar pedidos
 * como pagados.
 */
async function verifyMpSignature(
  paymentId: string,
  requestId: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    // `split("=")` parte de más si el valor trae "="; se corta en el primero.
    // Y se recorta: MP a veces manda "ts=1, v1=abc" con espacio.
    const parts: Record<string, string> = {};
    for (const trozo of signature.split(",")) {
      const i = trozo.indexOf("=");
      if (i > 0) parts[trozo.slice(0, i).trim()] = trozo.slice(i + 1).trim();
    }
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );

    const base = `id:${paymentId};request-id:${requestId};ts:${ts}`;
    for (const template of [`${base};`, base]) {
      const buf = await crypto.subtle.sign("HMAC", key, enc.encode(template));
      const computed = Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      if (computed === v1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function settleOrchestratedPayment(
  admin: any,
  orgId: string,
  orderId: string,
  status: string,
  paymentId: string,
  payment: Record<string, unknown>,
) {
  if (!orgId || !orderId || !paymentId) return;
  const orchestrationState = providerAttemptState(status);

  const { data: intents, error: intentError } = await admin
    .from("payment_intents")
    .select("id, estado, created_at")
    .eq("org_id", orgId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (intentError) {
    console.error("payment_intents webhook lookup:", intentError);
    return;
  }

  const intent = (intents ?? []).find((row: { estado?: string }) =>
    ["pendiente", "procesando", "acreditado"].includes(String(row.estado))) ?? intents?.[0];
  if (!intent?.id) return;

  const { data: attempts, error: attemptError } = await admin
    .from("payment_attempts")
    .select("id, estado, external_id, nro")
    .eq("intent_id", intent.id)
    .eq("provider", "mercadopago")
    .order("nro", { ascending: false })
    .limit(1);
  if (attemptError) {
    console.error("payment_attempts webhook lookup:", attemptError);
    return;
  }

  const attempt = attempts?.[0];
  if (!attempt?.id) return;

  try {
    await recordPaymentAttempt(admin, {
      attemptId: attempt.id,
      status: orchestrationState,
      externalId: paymentId,
      net: Number.isFinite(Number(payment.net_received_amount))
        ? Number(payment.net_received_amount)
        : null,
      reason: typeof payment.status_detail === "string" ? payment.status_detail : null,
      raw: {
        kind: "webhook",
        status,
        status_detail: payment.status_detail,
        payment_type_id: payment.payment_type_id,
        installments: payment.installments,
      },
    });
  } catch (error) {
    // La liquidación de la orden continúa por sus RPC idempotentes, pero el
    // fallo del contrato común queda visible para el panel de operación.
    console.error("pago_attempt_resultado webhook:", error);
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

    // ── Suscripciones al SaaS ────────────────────────────────────────────
    //
    // MercadoPago manda dos temas distintos y confundirlos es el error caro:
    //
    //   subscription_preapproval          cambió el ESTADO de la suscripción
    //   subscription_authorized_payment   se COBRÓ un período
    //
    // El primero no es plata. Extender el período con él daría acceso gratis.
    //
    // ⚠️ Estas notificaciones las cobra la cuenta de **la plataforma**, así que
    // el token sale de `MP_PLATFORM_ACCESS_TOKEN` y no de `payment_connections`
    // — el comercio no se cobra a sí mismo.
    if (type === "subscription_preapproval" || type === "subscription_authorized_payment") {
      const suscId = String(body.data?.id || body.id || "");
      const platformToken = Deno.env.get("MP_PLATFORM_ACCESS_TOKEN");

      if (!suscId || !platformToken) {
        // Sin token no se puede consultar. Se responde 200 igual: un 500 hace
        // que MercadoPago reintente para siempre algo que no va a mejorar solo.
        console.error(`Webhook de suscripción sin ${!suscId ? "id" : "MP_PLATFORM_ACCESS_TOKEN"}`);
        return new Response(JSON.stringify({ ok: true, reason: "sin configurar" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const ruta = type === "subscription_preapproval"
        ? `https://api.mercadopago.com/preapproval/${suscId}`
        : `https://api.mercadopago.com/authorized_payments/${suscId}`;

      const rsp = await fetch(ruta, {
        headers: { Authorization: `Bearer ${platformToken}` },
      });

      if (!rsp.ok) {
        console.error(`No se pudo leer ${type} ${suscId}: ${rsp.status}`);
        // 200 a propósito: reintentar no arregla un 404 de MercadoPago.
        return new Response(JSON.stringify({ ok: true, reason: `mp ${rsp.status}` }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const dato = await rsp.json();

      if (type === "subscription_preapproval") {
        const { data, error } = await admin.rpc("suscripcion_actualizar_estado", {
          p_preapproval: String(dato.id),
          p_estado_mp: String(dato.status ?? ""),
        });
        if (error) console.error("suscripcion_actualizar_estado", error);
        return new Response(JSON.stringify({ ok: true, resultado: data }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Se cobró un período. `preapproval_id` ata este pago con la suscripción.
      const { data, error } = await admin.rpc("suscripcion_registrar_pago", {
        p_preapproval: String(dato.preapproval_id ?? ""),
        p_payment_id: String(dato.payment?.id ?? dato.id ?? ""),
        p_monto: Number(dato.transaction_amount ?? 0),
        p_estado: String(dato.payment?.status ?? dato.status ?? "pending"),
        p_moneda: String(dato.currency_id ?? "ARS"),
      });
      if (error) console.error("suscripcion_registrar_pago", error);

      return new Response(JSON.stringify({ ok: true, resultado: data }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!paymentId || type !== "payment") {
      // Acknowledge non-payment notifications
      return new Response(JSON.stringify({ ok: true, reason: `skipped type: ${type}` }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const signature = req.headers.get("x-signature") || "";
    const requestId = req.headers.get("x-request-id") || "";

    // MP firma el `data.id` de la query string cuando la notificación llega
    // por ahí. Suele coincidir con el del cuerpo, pero cuando no, la firma se
    // valida contra el de la URL.
    const signedId = new URL(req.url).searchParams.get("data.id") || paymentId;

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
      const valid = await verifyMpSignature(signedId, requestId, signature, globalWebhookSecret);
      if (!valid) {
        // Sin filtrar el secreto: alcanza con saber qué se firmó para
        // diagnosticar, y este log es lo único que había cuando una compra
        // real quedó colgada.
        console.warn(
          `Invalid MP signature. payment=${paymentId} signedId=${signedId} requestId=${requestId ? "presente" : "AUSENTE"}`,
        );
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
    const isReversed = status === "refunded" || status === "charged_back";

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
      } else if (isReversed) {
        // Una devolución o contracargo llega después de que la orden ya fue
        // acreditada. No basta con anotarlo en la liquidación: la operación no
        // puede seguir mostrando un pedido despachable ni un botón de reintento.
        const { error: reversalErr } = await admin.rpc("handle_store_order_payment_reversal", {
          p_order_id: orderId,
          p_payment_id: String(paymentId),
          p_status: status,
          p_detail: statusDetail,
        });
        if (reversalErr) console.error("handle_store_order_payment_reversal:", reversalErr.message);
      }

      // El webhook es la autoridad eventual del proveedor. El Brick registra
      // el resultado inmediato, pero este camino reconcilia también la
      // preferencia externa y los pagos que llegan después del redirect.
      if (!isReversed) {
        await settleOrchestratedPayment(
          admin,
          orgId,
          orderId,
          status,
          String(paymentId),
          payment,
        );
      }

      // La liquidación va ANTES del return, no al final del handler.
      //
      // Esta rama salía temprano y se salteaba el registro del cobro, así que
      // justo el canal que cobra comisión de plataforma era el único que no la
      // anotaba: MercadoPago descontaba el `application_fee` y en la base no
      // quedaba rastro. La primera compra real lo dejó a la vista —dos ventas
      // acreditadas y `payment_transactions` vacía.
      //
      // El RPC es idempotente por (provider, external_id), así que los
      // reintentos de MP no duplican nada.
      await recordPaymentTransaction(admin, {
        orgId,
        paymentId: String(paymentId),
        payment,
        status,
        gross: paidAmount,
        externalRef,
      });

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

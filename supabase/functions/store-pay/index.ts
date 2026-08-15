/**
 * store-pay — inicia y procesa los cobros de una orden pública de tienda.
 *
 * El navegador sólo identifica la orden y, para Checkout Bricks, entrega un
 * token efímero de tarjeta. El total, la comisión, el mail del pagador y la
 * referencia de la orden se reconstruyen acá desde la base: nunca se aceptan
 * precios, productos ni credenciales desde una superficie anónima.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { recordPaymentTransaction } from "../_shared/paymentSettlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type StoreOrderContext = {
  store: { id: string; org_id: string; name: string; slug: string; is_active: boolean };
  order: {
    id: string;
    order_number: string;
    total: number;
    items: unknown;
    customer_name: string;
    customer_email: string;
    payment_status: string;
  };
};

function text(value: unknown, maxLength = 250): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function safeReturnBase(value: unknown): string | null {
  const raw = text(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

async function getStoreOrder(
  admin: any,
  slugInput: unknown,
  orderNumberInput: unknown,
): Promise<{ context?: StoreOrderContext; response?: Response }> {
  const slug = text(slugInput, 120);
  const orderNumber = text(orderNumberInput, 120);
  if (!slug || !orderNumber) {
    return { response: json({ error: "slug y orderNumber son requeridos" }, 400) };
  }

  const { data: store } = await admin
    .from("ecommerce_stores")
    .select("id, org_id, name, slug, is_active")
    .ilike("slug", slug)
    .maybeSingle();
  if (!store?.is_active) return { response: json({ error: "Tienda no encontrada" }, 404) };

  const { data: order } = await admin
    .from("ecommerce_orders")
    .select("id, order_number, total, items, customer_name, customer_email, payment_status")
    .eq("store_id", store.id)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (!order) return { response: json({ error: "Pedido no encontrado" }, 404) };
  if (order.payment_status === "paid") {
    return { response: json({ error: "Este pedido ya está pago" }, 409) };
  }
  if (!["pending", "failed"].includes(order.payment_status)) {
    // Una devolución o contracargo pertenece al cobro anterior. Reusar la
    // orden para otro intento perdería la trazabilidad de ambos hechos.
    return { response: json({ error: "Este pedido no admite otro pago. Creá un pedido nuevo para volver a cobrar." }, 409) };
  }

  const total = Number(order.total);
  if (!Number.isFinite(total) || total <= 0) {
    console.error("store-pay: total inválido", { orderId: order.id, total: order.total });
    return { response: json({ error: "El total del pedido no es válido" }, 422) };
  }

  return { context: { store, order: { ...order, total } } };
}

async function marketplaceCommission(admin: any, orgId: string, total: number, source: string) {
  try {
    const { data: fee } = await admin.rpc("platform_commission_amount", {
      p_org_id: orgId,
      p_gross: total,
      p_channel: "online",
    });
    return Number(fee) || 0;
  } catch (e) {
    // La comisión se reconcilia, pero no puede impedir que un comercio cobre.
    console.error(`platform_commission_amount (${source}):`, e);
    return 0;
  }
}

function preferenceItems(items: unknown, orderNumber: string, total: number) {
  const mapped = (Array.isArray(items) ? items : []).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const quantity = Number(row.quantity) || 1;
    const unitPrice = Number(row.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{
      title: String(row.name ?? "Producto").slice(0, 250),
      quantity,
      unit_price: unitPrice,
      currency_id: "ARS",
    }];
  });

  return mapped.length ? mapped : [{
    title: `Pedido ${orderNumber}`,
    quantity: 1,
    unit_price: total,
    currency_id: "ARS",
  }];
}

async function createRedirectPreference(
  admin: any,
  context: StoreOrderContext,
  returnUrl: unknown,
  supabaseUrl: string,
) {
  const { store, order } = context;
  const creds = await getMpCredentials(admin, store.org_id);
  if (!creds) {
    return json({
      error: "Esta tienda todavía no tiene el pago online habilitado. Coordiná con el vendedor por los otros medios.",
    }, 422);
  }

  // `marketplace_fee` sólo existe para una cuenta conectada por OAuth. Con un
  // token heredado MercadoPago rechaza la preferencia, por eso el checkout
  // externo conserva compatibilidad y prioriza que el comercio pueda cobrar.
  const marketplaceFee = creds.source === "oauth"
    ? await marketplaceCommission(admin, store.org_id, order.total, "preference")
    : 0;
  const base = safeReturnBase(returnUrl) ?? safeReturnBase(Deno.env.get("PUBLIC_BASE_URL"));
  const backUrl = base
    ? `${base}/tienda/${encodeURIComponent(store.slug)}/orden/${encodeURIComponent(order.order_number)}`
    : null;

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: preferenceItems(order.items, order.order_number, order.total),
      ...(marketplaceFee > 0 ? { marketplace_fee: marketplaceFee } : {}),
      payer: { name: order.customer_name, email: order.customer_email },
      external_reference: `ecom:${order.id}`,
      ...(backUrl ? {
        back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
        auto_return: "approved",
      } : {}),
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?org_id=${store.org_id}`,
      statement_descriptor: String(store.name).slice(0, 22),
    }),
  });

  const mp = await mpRes.json().catch(() => null) as Record<string, unknown> | null;
  const initPoint = text(mp?.init_point, 2_000);
  if (!mpRes.ok || !initPoint) {
    console.error("MP preference error:", mpRes.status, mp);
    return json({ error: text(mp?.message) ?? "No se pudo generar el link de pago" }, 502);
  }

  return json({ url: initPoint, preferenceId: text(mp?.id, 250) });
}

async function checkoutBrickConfig(admin: any, context: StoreOrderContext) {
  const { store, order } = context;
  const creds = await getMpCredentials(admin, store.org_id);
  if (!creds || creds.source !== "oauth") {
    // No se intenta adivinar una public key para tokens legados. El redirect
    // sigue siendo funcional y no degrada la seguridad de cuentas existentes.
    return json({ error: "El pago con tarjeta todavía no está disponible para esta tienda." }, 422);
  }

  const { data: connection } = await admin
    .from("payment_connections")
    .select("public_key")
    .eq("org_id", store.org_id)
    .eq("provider", "mercadopago")
    .maybeSingle();
  const publicKey = text(connection?.public_key, 250);
  if (!publicKey) {
    return json({ error: "La conexión de MercadoPago necesita renovarse para habilitar tarjetas." }, 422);
  }

  // La clave pública y el importe ya eran necesarios para tokenizar una tarjeta
  // en el navegador. No se devuelve email, productos ni ningún secreto.
  return json({ publicKey, amount: order.total });
}

function brickPaymentInput(body: Record<string, unknown>) {
  const formData = body.formData;
  if (typeof formData !== "object" || formData === null) return null;
  const form = formData as Record<string, unknown>;
  const token = text(form.token, 1_000);
  const paymentMethodId = text(form.payment_method_id, 80);
  const issuerId = text(form.issuer_id, 80);
  const attemptKey = text(body.attemptKey, 80);
  const installments = Number(form.installments);

  if (!token || !paymentMethodId || !/^[a-zA-Z0-9_-]+$/.test(paymentMethodId)) return null;
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) return null;
  if (!attemptKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptKey)) return null;
  if (issuerId && !/^[a-zA-Z0-9_-]+$/.test(issuerId)) return null;

  return { token, paymentMethodId, issuerId, installments, attemptKey };
}

async function notifyPaidStoreOrder(admin: any, context: StoreOrderContext) {
  try {
    await admin.functions.invoke("store-order-email", {
      body: {
        slug: context.store.slug,
        orderNumber: context.order.order_number,
        baseUrl: Deno.env.get("PUBLIC_BASE_URL") ?? "",
      },
    });
  } catch (e) {
    // El cobro y la venta ya fueron registrados; el email es recuperable.
    console.error("store-order-email:", e);
  }
}

async function processBrickPayment(
  admin: any,
  context: StoreOrderContext,
  body: Record<string, unknown>,
  supabaseUrl: string,
) {
  const input = brickPaymentInput(body);
  if (!input) return json({ error: "Los datos de la tarjeta no son válidos." }, 400);

  const { store, order } = context;
  const creds = await getMpCredentials(admin, store.org_id);
  // El Brick sólo se configura para OAuth. Revalidarlo al cobrar evita que una
  // conexión revocada quede aceptando tokens con otro camino de credenciales.
  if (!creds || creds.source !== "oauth") {
    return json({ error: "La conexión de MercadoPago ya no está disponible." }, 422);
  }

  const applicationFee = await marketplaceCommission(admin, store.org_id, order.total, "brick");
  const externalReference = `ecom:${order.id}`;
  const paymentRes = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      // Si se corta la red, reintentar el mismo submit no puede cobrar dos veces.
      "X-Idempotency-Key": input.attemptKey,
    },
    body: JSON.stringify({
      // Nunca usar formData.transaction_amount: el monto autoritativo es la
      // orden creada por el RPC, que ya validó stock, cupón, envío e IVA.
      transaction_amount: order.total,
      token: input.token,
      installments: input.installments,
      payment_method_id: input.paymentMethodId,
      ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
      payer: { email: order.customer_email },
      description: `Pedido ${order.order_number} — ${String(store.name).slice(0, 120)}`,
      external_reference: externalReference,
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?org_id=${store.org_id}`,
      // A diferencia de `marketplace_fee` (preferencias), pagos directos usan
      // `application_fee`: MP separa la comisión en la misma acreditación.
      ...(applicationFee > 0 ? { application_fee: applicationFee } : {}),
    }),
  });

  const payment = await paymentRes.json().catch(() => null) as Record<string, unknown> | null;
  const paymentId = text(payment?.id, 120);
  if (!paymentRes.ok || !paymentId) {
    console.error("MP Brick payment error:", paymentRes.status, payment);
    return json({ error: text(payment?.message) ?? "No se pudo procesar la tarjeta." }, 502);
  }

  // Aunque acabamos de enviar estos campos, se verifican otra vez sobre la
  // respuesta del proveedor antes de tocar stock o ventas.
  const providerAmount = Number(payment?.transaction_amount);
  if (payment?.external_reference !== externalReference ||
      !Number.isFinite(providerAmount) || Math.abs(providerAmount - order.total) > 0.01 ||
      String(payment?.currency_id ?? "ARS") !== "ARS") {
    console.error("MP Brick payment mismatch:", { orderId: order.id, paymentId });
    return json({ error: "No pudimos validar el cobro. Revisá el estado del pedido antes de reintentar." }, 502);
  }

  const status = text(payment.status, 80) ?? "pending";
  if (status === "approved") {
    const { error: paidError } = await admin.rpc("mark_store_order_paid", {
      p_order_id: order.id,
      p_payment_id: paymentId,
      p_method: "mercado_pago",
    });
    if (paidError) console.error("mark_store_order_paid (brick):", paidError);
    else await notifyPaidStoreOrder(admin, context);
  } else if (status === "rejected" || status === "cancelled") {
    await admin
      .from("ecommerce_orders")
      .update({ payment_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .neq("payment_status", "paid");
  }

  await recordPaymentTransaction(admin, {
    orgId: store.org_id,
    paymentId,
    payment,
    status,
    gross: providerAmount,
    externalRef: externalReference,
  });

  // El webhook conserva la reconciliación asíncrona y es idempotente. Esta
  // respuesta sólo mejora la inmediatez que espera quien pagó en la misma web.
  return json({ status, paymentId });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null) return json({ error: "Body inválido" }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Body inválido" }, 400);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey);
    const result = await getStoreOrder(admin, body.slug, body.orderNumber);
    if (result.response) return result.response;
    const context = result.context!;

    const action = text(body.action, 60) ?? "redirect";
    if (action === "brick-config") return await checkoutBrickConfig(admin, context);
    if (action === "brick-payment") return await processBrickPayment(admin, context, body, supabaseUrl);
    if (action === "redirect") return await createRedirectPreference(admin, context, body.returnUrl, supabaseUrl);
    return json({ error: "Acción de pago no reconocida" }, 400);
  } catch (e) {
    console.error("store-pay error:", e);
    return json({ error: "No se pudo iniciar el pago online." }, 500);
  }
});

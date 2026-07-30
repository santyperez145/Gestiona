/**
 * store-pay — genera el link de pago de MercadoPago para una orden de la
 * tienda online.
 *
 * A diferencia de `mercadopago-link`, esta función es PÚBLICA: la llama un
 * comprador anónimo desde la vidriera. Por eso no acepta montos del cliente —
 * relee la orden de la base y cobra ese total. Si tomara el precio del body,
 * cualquiera pagaría $1 por lo que quiera.
 *
 * Devuelve `init_point` para redirigir al checkout de MercadoPago.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const { slug, orderNumber, returnUrl } = await req.json();
    if (!slug || !orderNumber) return json({ error: "slug y orderNumber son requeridos" }, 400);

    // La tienda debe existir y estar activa.
    const { data: store } = await admin
      .from("ecommerce_stores")
      .select("id, org_id, name, slug, is_active")
      .ilike("slug", slug)
      .maybeSingle();
    if (!store?.is_active) return json({ error: "Tienda no encontrada" }, 404);

    // El monto sale de la orden guardada, nunca del navegador.
    const { data: order } = await admin
      .from("ecommerce_orders")
      .select("id, order_number, total, items, customer_name, customer_email, payment_status")
      .eq("store_id", store.id)
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (!order) return json({ error: "Pedido no encontrado" }, 404);
    if (order.payment_status === "paid") return json({ error: "Este pedido ya está pago" }, 409);

    // El token sale de la conexión OAuth del comercio; si todavía usa el
    // token pegado a mano, también funciona.
    const creds = await getMpCredentials(admin, store.org_id);
    if (!creds) {
      return json({
        error: "Esta tienda todavía no tiene el pago online habilitado. " +
               "Coordiná con el vendedor por los otros medios.",
      }, 422);
    }

    const base = (returnUrl || "").replace(/\/+$/, "");
    const backUrl = `${base}/tienda/${store.slug}/orden/${order.order_number}`;

    const items = (order.items as any[] ?? []).map(i => ({
      title: String(i.name ?? "Producto").slice(0, 250),
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      currency_id: "ARS",
    }));

    // ── Comisión de la plataforma ────────────────────────────────────────
    //
    // `marketplace_fee` es lo que hace que la comisión se COBRE y no sólo se
    // anote: MercadoPago la separa al acreditar y la manda a la cuenta de la
    // aplicación. Sin esto, `payment_transactions` registraba una comisión que
    // nunca salía de la cuenta del comercio.
    //
    // Sólo aplica con credenciales OAuth: ahí existe la relación marketplace
    // entre la app y el vendedor. Con un token pegado a mano no hay tal
    // relación y MercadoPago rechaza la preferencia, así que se omite — mejor
    // cobrar sin comisión que no poder cobrar.
    let marketplaceFee = 0;
    if (creds.source === "oauth") {
      try {
        const { data: fee } = await admin.rpc("platform_commission_amount", {
          p_org_id: store.org_id,
          p_gross: Number(order.total),
          p_channel: "online",
        });
        marketplaceFee = Number(fee) || 0;
      } catch (e) {
        // Una falla acá no puede frenar la venta: se cobra sin comisión y queda
        // el registro para reconciliar.
        console.error("platform_commission_amount:", e);
      }
    }

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: items.length ? items : [{
          title: `Pedido ${order.order_number}`,
          quantity: 1,
          unit_price: Number(order.total),
          currency_id: "ARS",
        }],
        ...(marketplaceFee > 0 ? { marketplace_fee: marketplaceFee } : {}),
        payer: { name: order.customer_name, email: order.customer_email },
        // El prefijo `ecom:` le dice al webhook que esto es una orden de la
        // tienda y no un link de pago suelto.
        external_reference: `ecom:${order.id}`,
        back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
        auto_return: "approved",
        notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?org_id=${store.org_id}`,
        statement_descriptor: String(store.name).slice(0, 22),
      }),
    });

    const mp = await mpRes.json().catch(() => null);
    if (!mpRes.ok || !mp?.init_point) {
      console.error("MP preference error:", mpRes.status, mp);
      return json({ error: mp?.message ?? "No se pudo generar el link de pago" }, 502);
    }

    return json({ url: mp.init_point, preferenceId: mp.id });
  } catch (e) {
    console.error("store-pay error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// Receives real-time events from Tiendanube (orders/created, orders/paid, products/updated).
// Must be registered in the Tiendanube API as a webhook URL.
// URL: https://<project>.supabase.co/functions/v1/tiendanube-webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-linked-store",
};

function pickText(val: Record<string, string> | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.es || val.pt || val.en || Object.values(val)[0] || "";
}

async function tiendanubeGet(path: string, accessToken: string, storeId: string) {
  const res = await fetch(`https://api.tiendanube.com/v1/${storeId}${path}`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": "Gestiona (soporte@gestiona.app)",
    },
  });
  if (!res.ok) throw new Error(`Tiendanube API ${path}: ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    // Tiendanube sends: { store_id, event, id }
    // event is like "orders/created", "orders/paid", "products/updated"
    const { store_id: storeId, event, id: resourceId } = body;

    if (!storeId || !event || !resourceId) {
      return new Response(JSON.stringify({ ok: false, reason: "missing fields" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Find the connected org for this store
    const { data: conn } = await admin
      .from("tiendanube_connections")
      .select("*")
      .eq("store_id", String(storeId))
      .maybeSingle();

    if (!conn) {
      // Unknown store — acknowledge to avoid retries
      return new Response(JSON.stringify({ ok: true, reason: "store not connected" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const orgId = conn.org_id;

    // Get owner user_id
    const { data: membership } = await admin
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    const ownerUserId = membership?.user_id;

    // ── Handle order events ──────────────────────────────────────────────────
    if (event === "orders/created" || event === "orders/paid" || event === "orders/fulfilled") {
      const order = await tiendanubeGet(`/orders/${resourceId}`, conn.access_token, conn.store_id);
      if (order.status === "cancelled") {
        return new Response(JSON.stringify({ ok: true, reason: "cancelled order skipped" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const customerName =
        order.contact_name ||
        [order.customer?.name, order.customer?.last_name].filter(Boolean).join(" ") ||
        "Cliente Tiendanube";
      const orderDate = order.created_at || new Date().toISOString();
      const isPaid = order.payment_status === "paid" || event === "orders/paid";
      const tnPayment = (order.payment_details?.method || "").toLowerCase();
      const paymentMethod = tnPayment.includes("mercado") ? "mercado_pago"
        : tnPayment.includes("transfer") ? "transferencia"
        : "tiendanube";

      let imported = 0;
      for (const item of order.products || []) {
        const externalId = `${order.id}-${item.variant_id || item.product_id}`;
        const { data: existing } = await admin
          .from("sales")
          .select("id, paid")
          .eq("org_id", orgId)
          .eq("tiendanube_order_id", externalId)
          .maybeSingle();

        if (existing) {
          // Update paid status if order was just paid
          if (isPaid && !existing.paid) {
            await admin.from("sales").update({ paid: true }).eq("id", existing.id);
          }
          continue;
        }

        const { data: localProduct } = await admin
          .from("products")
          .select("id")
          .eq("org_id", orgId)
          .eq("tiendanube_id", String(item.product_id))
          .maybeSingle();

        const qty = Number(item.quantity) || 1;
        const unitPrice = Number(item.price) || 0;

        await admin.from("sales").insert({
          org_id: orgId,
          user_id: ownerUserId,
          product_id: localProduct?.id || null,
          product_name: pickText(item.name) || "Producto",
          quantity: qty,
          unit_price_ars: unitPrice,
          total_ars: unitPrice * qty,
          discount_applied: false,
          cost_per_unit_usd: 0,
          profit_ars: 0,
          profit_usd: 0,
          customer_name: customerName,
          date: orderDate,
          paid: isPaid,
          payment_method: paymentMethod,
          tiendanube_order_id: externalId,
        });
        imported++;
      }

      // Insert in-app notification
      if (imported > 0) {
        await admin.from("notifications").insert({
          user_id: ownerUserId,
          title: "Nuevo pedido Tiendanube",
          message: `Pedido #${order.number || resourceId} de ${customerName} — ${order.products?.length || 0} producto(s)`,
          type: "tiendanube",
        }).catch(() => {});
      }
    }

    // ── Handle product update events ────────────────────────────────────────
    if (event === "products/updated" || event === "products/created") {
      const p = await tiendanubeGet(`/products/${resourceId}`, conn.access_token, conn.store_id);
      const variants: any[] = p.variants || [];
      const totalStock = variants.reduce((s: number, v: any) => s + (Number(v.stock) || 0), 0);
      const basePrice = variants[0]?.price ? Number(variants[0].price) : 0;

      await admin.from("products").upsert({
        org_id: orgId,
        user_id: ownerUserId,
        name: pickText(p.name) || "Sin nombre",
        brand: p.brand || "",
        category: "otro",
        sale_price_ars: basePrice,
        cost_price_usd: 0,
        stock: totalStock,
        sku: variants[0]?.sku || "",
        tiendanube_id: String(p.id),
      }, { onConflict: "org_id,tiendanube_id", ignoreDuplicates: false });
    }

    // Update last activity timestamp
    await admin
      .from("tiendanube_connections")
      .update({ last_sync_orders_at: new Date().toISOString() })
      .eq("id", conn.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tiendanube-webhook error:", e);
    // Always return 200 to Tiendanube to avoid retries on our processing errors
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

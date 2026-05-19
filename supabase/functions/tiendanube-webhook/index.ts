// Receives real-time events from Tiendanube (orders/created, orders/paid, products/updated).
// Security: verifies X-Hub-Signature (HMAC-SHA256) against the app client secret.
// URL: https://<project>.supabase.co/functions/v1/tiendanube-webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

function pickText(val: Record<string, string> | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.es || val.pt || val.en || Object.values(val)[0] || "";
}

// Verify HMAC-SHA256 signature sent by Tiendanube as X-Hub-Signature header
async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    // Header format: "sha256=<hex>"
    const hex = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const sigBytes = Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(rawBody));
  } catch {
    return false;
  }
}

async function tiendanubeGet(path: string, accessToken: string, storeId: string, attempt = 0): Promise<any> {
  const res = await fetch(`https://api.tiendanube.com/v1/${storeId}${path}`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": "Gestiona (soporte@gestiona.app)",
    },
  });

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= 3) throw new Error(`TN API ${path}: ${res.status} after ${attempt + 1} tries`);
    const wait = Math.min(1000 * 2 ** attempt, 20000);
    await new Promise(r => setTimeout(r, wait));
    return tiendanubeGet(path, accessToken, storeId, attempt + 1);
  }

  if (!res.ok) throw new Error(`Tiendanube API ${path}: ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-hub-signature, x-linkedstore",
      },
    });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Read raw body for HMAC verification before parsing
    const rawBody = await req.text();

    // X-Linkedstore identifies the originating store (more reliable than body field)
    const storeIdHeader = req.headers.get("x-linkedstore") || req.headers.get("X-Linkedstore");
    const signature = req.headers.get("x-hub-signature") || req.headers.get("X-Hub-Signature");

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ ok: false, reason: "invalid json" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const storeId = String(storeIdHeader || body.store_id || "");
    const event: string = body.event || "";
    const resourceId: string | number = body.id || "";

    if (!storeId || !event || !resourceId) {
      return new Response(JSON.stringify({ ok: false, reason: "missing fields" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Find connection — also fetches client_secret for signature verification
    const { data: conn } = await admin
      .from("tiendanube_connections")
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();

    if (!conn) {
      // Unknown store — acknowledge to stop Tiendanube retries
      return new Response(JSON.stringify({ ok: true, reason: "store not connected" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify HMAC signature — mandatory when client_secret is configured
    const clientSecret = conn.client_secret || Deno.env.get("TIENDANUBE_CLIENT_SECRET") || "";
    if (clientSecret) {
      if (!signature) {
        console.warn(`Missing webhook signature for store ${storeId}`);
        return new Response(JSON.stringify({ ok: false, reason: "missing signature" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }
      const valid = await verifySignature(rawBody, signature, clientSecret);
      if (!valid) {
        console.warn(`Invalid webhook signature for store ${storeId}`);
        return new Response(JSON.stringify({ ok: false, reason: "invalid signature" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }
    }

    const orgId = conn.org_id;

    const { data: membership } = await admin
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    const ownerUserId = membership?.user_id;

    // ── Order events ──────────────────────────────────────────────────────────
    if (event === "orders/created" || event === "orders/paid" || event === "orders/fulfilled") {
      const order = await tiendanubeGet(`/orders/${resourceId}`, conn.access_token, conn.store_id);

      if (order.status === "cancelled") {
        // Mark any existing sales from this order as cancelled/refunded
        await admin.from("sales")
          .update({ paid: false })
          .eq("org_id", orgId)
          .like("tiendanube_order_id", `${order.id}-%`);

        return new Response(JSON.stringify({ ok: true, reason: "cancelled" }), {
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
        : tnPayment.includes("credit") || tnPayment.includes("credito") ? "credito"
        : tnPayment.includes("debit") || tnPayment.includes("debito") ? "debito"
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
          if (isPaid && !existing.paid) {
            await admin.from("sales")
              .update({ paid: true, payment_method: paymentMethod })
              .eq("id", existing.id);
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

      if (imported > 0) {
        try {
          await admin.from("notifications").insert({
            user_id: ownerUserId,
            org_id: orgId,
            title: "Nuevo pedido Tiendanube",
            message: `Pedido #${order.number || resourceId} de ${customerName} — ${order.products?.length || 0} producto(s)`,
            type: "tiendanube",
          });
        } catch { /* silent */ }
      }
    }

    // ── Product events ────────────────────────────────────────────────────────
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

    // ── Product deleted ───────────────────────────────────────────────────────
    if (event === "products/deleted") {
      // Soft-delete: mark stock as 0 rather than deleting (preserves sales history)
      await admin.from("products")
        .update({ stock: 0, active: false })
        .eq("org_id", orgId)
        .eq("tiendanube_id", String(resourceId));
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tiendanube-webhook error:", e);
    // Return 200 to prevent Tiendanube from flooding us with retries on logic errors
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

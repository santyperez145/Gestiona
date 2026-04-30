// Sync products and/or orders from a connected Tiendanube store into Gestiona.
// Products: upserts by tiendanube_id, syncs variants to product_variants table.
// Orders: imports as sales records, deduplicates by tiendanube_order_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pickText(val: Record<string, string> | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.es || val.pt || val.en || Object.values(val)[0] || "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

async function getAllPages(path: string, accessToken: string, storeId: string): Promise<any[]> {
  const results: any[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await tiendanubeGet(`${path}${sep}per_page=200&page=${page}`, accessToken, storeId);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 200) break;
    page++;
  }
  return results;
}

function mapCategory(categories: any[]): string {
  if (!categories?.length) return "otro";
  const name = pickText(categories[0]?.name || "").toLowerCase();
  if (name.includes("perfum") || name.includes("fragran")) return "perfume_diseñador";
  if (name.includes("arab") || name.includes("oud")) return "perfume_arabe";
  if (name.includes("vaper") || name.includes("vaporizador") || name.includes("e-liquid")) return "vaper";
  if (name.includes("accesorio")) return "accesorio";
  if (name.includes("ropa") || name.includes("talle") || name.includes("indumentaria")) return "ropa";
  return "otro";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orgId, syncType = "all" } = await req.json();
    if (!orgId) {
      return new Response(JSON.stringify({ error: "orgId requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: conn, error: connErr } = await admin
      .from("tiendanube_connections")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();

    if (connErr) throw connErr;
    if (!conn) {
      return new Response(JSON.stringify({ error: "No hay conexión activa con Tiendanube" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    const ownerUserId = membership?.user_id || userId;

    const result: Record<string, number> = {
      productsUpserted: 0,
      variantsUpserted: 0,
      ordersImported: 0,
    };

    // ── Sync Products ──────────────────────────────────────────────────────────
    if (syncType === "products" || syncType === "all") {
      const tnProducts = await getAllPages("/products", conn.access_token, conn.store_id);

      for (const p of tnProducts) {
        const name = pickText(p.name) || "Sin nombre";
        const description = stripHtml(pickText(p.description || ""));
        const brand = p.brand || "";
        const tags = typeof p.tags === "string" ? p.tags : "";
        const imageUrl = p.images?.[0]?.src || null;
        const category = mapCategory(p.categories || []);
        const published = p.published !== false;

        const variants: any[] = p.variants || [];
        // Determine if this product has real variant properties
        const hasRealVariants = variants.some(v => v.values && v.values.length > 0);

        // Total stock across all variants
        const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
        // Base price from first variant
        const basePrice = variants[0]?.price ? Number(variants[0].price) : 0;
        const baseCost = variants[0]?.cost ? Number(variants[0].cost) : 0;
        const baseSku = variants[0]?.sku || p.handle?.es || p.handle?.pt || "";
        const baseBarcode = variants[0]?.barcode || "";

        // Upsert product
        const { data: upserted, error: upsertErr } = await admin
          .from("products")
          .upsert({
            org_id: orgId,
            user_id: ownerUserId,
            name,
            brand,
            category,
            description,
            sale_price_ars: basePrice,
            cost_price_usd: 0,
            stock: hasRealVariants ? 0 : totalStock, // variants manage stock if they exist
            sku: baseSku,
            barcode: baseBarcode,
            image_url: imageUrl,
            tiendanube_id: String(p.id),
          }, {
            onConflict: "org_id,tiendanube_id",
            ignoreDuplicates: false,
          })
          .select("id")
          .maybeSingle();

        if (upsertErr) {
          console.error("Product upsert error:", upsertErr.message, name);
          continue;
        }

        result.productsUpserted++;
        const productId = upserted?.id;
        if (!productId) continue;

        // Upsert variants if the product has real variant properties
        if (hasRealVariants) {
          const attrNames: string[] = (p.attributes || []).map((a: any) => pickText(a).toLowerCase());

          for (const v of variants) {
            if (!v.values || v.values.length === 0) continue;

            const variantLabel = v.values.map((val: any) => pickText(val)).filter(Boolean).join(" / ");
            if (!variantLabel) continue;

            const variantType = attrNames[0] || "variante";
            const variantPrice = v.price ? Number(v.price) : null;
            const variantStock = Number(v.stock) || 0;
            const variantSku = v.sku || "";
            const variantBarcode = v.barcode || "";

            const { error: varErr } = await admin
              .from("product_variants")
              .upsert({
                product_id: productId,
                user_id: ownerUserId,
                variant_name: variantLabel,
                variant_type: variantType,
                price_override: variantPrice !== basePrice ? variantPrice : null,
                stock: variantStock,
                sku: variantSku || null,
                barcode: variantBarcode || null,
                active: true,
              }, {
                onConflict: "product_id,variant_name",
                ignoreDuplicates: false,
              });

            if (!varErr) result.variantsUpserted++;
          }

          // Update product stock = sum of all variant stocks
          await admin
            .from("products")
            .update({ stock: totalStock })
            .eq("id", productId);
        }
      }

      await admin
        .from("tiendanube_connections")
        .update({ last_sync_products_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    // ── Sync Orders ────────────────────────────────────────────────────────────
    if (syncType === "orders" || syncType === "all") {
      const sinceParam = conn.last_sync_orders_at
        ? `?updated_at_min=${encodeURIComponent(conn.last_sync_orders_at)}&status=paid,pending`
        : "?status=paid,pending";
      const tnOrders = await getAllPages(`/orders${sinceParam}`, conn.access_token, conn.store_id);

      for (const order of tnOrders) {
        if (order.status === "cancelled") continue;

        const customerName =
          order.contact_name ||
          [order.customer?.name, order.customer?.last_name].filter(Boolean).join(" ") ||
          "Cliente Tiendanube";
        const orderDate = order.created_at || new Date().toISOString();
        const isPaid = order.payment_status === "paid";

        // Map Tiendanube payment method to Gestiona's enum
        const tnPayment = (order.payment_details?.method || "").toLowerCase();
        const paymentMethod = tnPayment.includes("mercado") ? "mercado_pago"
          : tnPayment.includes("transfer") ? "transferencia"
          : tnPayment.includes("credit") || tnPayment.includes("credito") ? "credito"
          : tnPayment.includes("debit") || tnPayment.includes("debito") ? "debito"
          : "tiendanube";

        for (const item of order.products || []) {
          const externalId = `${order.id}-${item.variant_id || item.product_id}`;

          const { data: existing } = await admin
            .from("sales")
            .select("id")
            .eq("org_id", orgId)
            .eq("tiendanube_order_id", externalId)
            .maybeSingle();
          if (existing) continue;

          const productName = pickText(item.name) || "Producto";
          const qty = Number(item.quantity) || 1;
          const unitPrice = Number(item.price) || 0;
          const total = unitPrice * qty;

          // Try to find matching local product by tiendanube_id
          const { data: localProduct } = await admin
            .from("products")
            .select("id")
            .eq("org_id", orgId)
            .eq("tiendanube_id", String(item.product_id))
            .maybeSingle();

          await admin.from("sales").insert({
            org_id: orgId,
            user_id: ownerUserId,
            product_id: localProduct?.id || null,
            product_name: productName,
            quantity: qty,
            unit_price_ars: unitPrice,
            total_ars: total,
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

          result.ordersImported++;
        }
      }

      await admin
        .from("tiendanube_connections")
        .update({ last_sync_orders_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tiendanube-sync error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

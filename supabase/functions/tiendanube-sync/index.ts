// Sync products and/or orders from a connected Tiendanube store into Gestiona.
// v2: adds retry/backoff on 429, per-item error logging, idempotent upserts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickText(val: Record<string, string> | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.es || val.pt || val.en || Object.values(val)[0] || "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch with automatic retry on 429 and 5xx (max 3 attempts, exponential backoff)
async function tiendanubeGet(
  path: string,
  accessToken: string,
  storeId: string,
  attempt = 0,
): Promise<any> {
  const res = await fetch(`https://api.tiendanube.com/v1/${storeId}${path}`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": "Gestiona (soporte@gestiona.app)",
    },
  });

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= 3) throw new Error(`Tiendanube API ${path}: ${res.status} after ${attempt + 1} attempts`);
    const retryAfter = Number(res.headers.get("Retry-After") || "0");
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 30000);
    console.warn(`TN rate limit / error on ${path}, waiting ${waitMs}ms (attempt ${attempt + 1})`);
    await sleep(waitMs);
    return tiendanubeGet(path, accessToken, storeId, attempt + 1);
  }

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
    await sleep(200); // be polite to the API
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

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const syncStart = Date.now();
  const errors: string[] = [];

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

    // Verify user is admin of this org
    const { data: membership } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    const ownerUserId = membership?.user_id || userId;

    const result = {
      productsUpserted: 0,
      variantsUpserted: 0,
      ordersImported: 0,
      ordersUpdated: 0,
      errors: 0,
      durationMs: 0,
    };

    // ── Sync Products ──────────────────────────────────────────────────────────
    if (syncType === "products" || syncType === "all") {
      let tnProducts: any[] = [];
      try {
        tnProducts = await getAllPages("/products", conn.access_token, conn.store_id);
      } catch (e: any) {
        errors.push(`Fetch products failed: ${e.message}`);
        result.errors++;
      }

      for (const p of tnProducts) {
        try {
          const name = pickText(p.name) || "Sin nombre";
          const description = stripHtml(pickText(p.description || ""));
          const brand = p.brand || "";
          const imageUrl = p.images?.[0]?.src || null;
          const category = mapCategory(p.categories || []);
          const variants: any[] = p.variants || [];
          const hasRealVariants = variants.some(v => v.values && v.values.length > 0);
          const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
          const basePrice = variants[0]?.price ? Number(variants[0].price) : 0;
          const baseSku = variants[0]?.sku || p.handle?.es || p.handle?.pt || "";
          const baseBarcode = variants[0]?.barcode || "";

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
              stock: hasRealVariants ? 0 : totalStock,
              sku: baseSku,
              barcode: baseBarcode,
              image_url: imageUrl,
              tiendanube_id: String(p.id),
            }, { onConflict: "org_id,tiendanube_id", ignoreDuplicates: false })
            .select("id")
            .maybeSingle();

          if (upsertErr) {
            errors.push(`Product "${name}": ${upsertErr.message}`);
            result.errors++;
            continue;
          }

          result.productsUpserted++;
          const productId = upserted?.id;
          if (!productId || !hasRealVariants) continue;

          const attrNames: string[] = (p.attributes || []).map((a: any) => pickText(a).toLowerCase());

          for (const v of variants) {
            if (!v.values || v.values.length === 0) continue;
            const variantLabel = v.values.map((val: any) => pickText(val)).filter(Boolean).join(" / ");
            if (!variantLabel) continue;

            const { error: varErr } = await admin
              .from("product_variants")
              .upsert({
                product_id: productId,
                org_id: orgId,
                user_id: ownerUserId,
                variant_name: variantLabel,
                variant_type: attrNames[0] || "variante",
                price_override: v.price && Number(v.price) !== basePrice ? Number(v.price) : null,
                stock: Number(v.stock) || 0,
                sku: v.sku || null,
                barcode: v.barcode || null,
                active: true,
              }, { onConflict: "product_id,variant_name", ignoreDuplicates: false });

            if (!varErr) result.variantsUpserted++;
          }

          // Sync parent stock = sum of variants
          if (hasRealVariants) {
            await admin.from("products").update({ stock: totalStock }).eq("id", productId);
          }
        } catch (e: any) {
          errors.push(`Product ${p.id}: ${e.message}`);
          result.errors++;
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

      let tnOrders: any[] = [];
      try {
        tnOrders = await getAllPages(`/orders${sinceParam}`, conn.access_token, conn.store_id);
      } catch (e: any) {
        errors.push(`Fetch orders failed: ${e.message}`);
        result.errors++;
      }

      for (const order of tnOrders) {
        try {
          if (order.status === "cancelled") continue;

          const customerName =
            order.contact_name ||
            [order.customer?.name, order.customer?.last_name].filter(Boolean).join(" ") ||
            "Cliente Tiendanube";
          const orderDate = order.created_at || new Date().toISOString();
          const isPaid = order.payment_status === "paid";
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
              .select("id, paid")
              .eq("org_id", orgId)
              .eq("tiendanube_order_id", externalId)
              .maybeSingle();

            if (existing) {
              // Update paid status if order was just paid
              if (isPaid && !existing.paid) {
                await admin.from("sales").update({ paid: true, payment_method: paymentMethod }).eq("id", existing.id);
                result.ordersUpdated++;
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

            const { error: insertErr } = await admin.from("sales").insert({
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

            if (insertErr) {
              errors.push(`Order ${externalId}: ${insertErr.message}`);
              result.errors++;
            } else {
              result.ordersImported++;
            }
          }
        } catch (e: any) {
          errors.push(`Order ${order.id}: ${e.message}`);
          result.errors++;
        }
      }

      await admin
        .from("tiendanube_connections")
        .update({ last_sync_orders_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    result.durationMs = Date.now() - syncStart;

    const hasErrors = result.errors > 0;

    // Write to integration_logs for health check panel
    await admin.from("integration_logs" as any).insert({
      org_id: orgId,
      integration: "tiendanube",
      event: "sync",
      status: hasErrors ? "warning" : "ok",
      message: hasErrors
        ? `${result.errors} error(es): ${errors.slice(0, 2).join("; ")}`
        : `OK — ${result.productsUpserted} productos, ${result.ordersImported} pedidos`,
      metadata: result,
      duration_ms: result.durationMs,
    }).catch(() => {});

    // In-app notification on errors
    if (hasErrors) {
      await admin.from("notifications").insert({
        user_id: ownerUserId,
        org_id: orgId,
        title: "Sync Tiendanube con errores",
        message: `${result.errors} error(es) durante la sincronización. Productos: ${result.productsUpserted}, Pedidos: ${result.ordersImported}`,
        type: "warning",
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, ...result, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("tiendanube-sync error:", e);
    // Log critical error
    if (errors.length === 0) {
      // try to get orgId from body for logging
      try {
        await admin.from("integration_logs" as any).insert({
          integration: "tiendanube",
          event: "sync",
          status: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        }).catch(() => {});
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", errors }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

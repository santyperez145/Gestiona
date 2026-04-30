// Tiendanube Export Edge Function
// Sync products from this org to a Tiendanube store via REST API.
// Docs: https://tiendanube.github.io/api-documentation/resources/product
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TN_API = "https://api.tiendanube.com/v1";

function categoryToHandle(cat: string): string {
  return cat?.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "general";
}

function buildPrice(p: any, mode: string, markup: number): { price: string; promo?: string } {
  const base = mode === "discount_price_ars" && p.discount_price_ars
    ? Number(p.discount_price_ars)
    : Number(p.sale_price_ars);
  const finalPrice = Math.round(base * (1 + (markup || 0) / 100));
  const promo = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars
    ? Math.round(Number(p.discount_price_ars) * (1 + (markup || 0) / 100)).toString()
    : undefined;
  return { price: finalPrice.toString(), promo };
}

async function tnRequest(storeId: string, token: string, path: string, method = "GET", body?: any) {
  const res = await fetch(`${TN_API}/${storeId}${path}`, {
    method,
    headers: {
      "Authentication": `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ExentryImports (admin@exentry.app)",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep as text */ }
  if (!res.ok) {
    const msg = json?.message || json?.description || text || `HTTP ${res.status}`;
    throw new Error(`Tiendanube ${method} ${path} failed [${res.status}]: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

function buildProductPayload(p: any, integration: any) {
  const { price, promo } = buildPrice(p, integration.price_mode, Number(integration.markup_percent));
  const desc = [
    p.description || "",
    p.brand ? `<p><strong>Marca:</strong> ${p.brand}</p>` : "",
    p.content_ml ? `<p><strong>Contenido:</strong> ${p.content_ml} ml</p>` : "",
  ].filter(Boolean).join("\n");

  const payload: any = {
    name: { es: p.name?.toUpperCase() || "PRODUCTO" },
    description: { es: desc },
    handle: { es: categoryToHandle(p.name) + "-" + (p.id?.slice?.(0, 6) || "") },
    published: integration.publish_status !== "draft",
    free_shipping: false,
    variants: [
      {
        price,
        promotional_price: promo || null,
        stock_management: !!integration.sync_stock,
        stock: integration.sync_stock ? Math.max(0, Number(p.stock || 0)) : null,
        sku: p.id?.slice?.(0, 12) || null,
        weight: "0.300",
      },
    ],
    tags: [p.brand, p.category, p.gender].filter(Boolean).join(","),
    seo_title: { es: `${p.name} ${p.brand}` },
    seo_description: { es: (p.description || `${p.name} - ${p.brand}`).slice(0, 160) },
  };

  if (integration.sync_images) {
    const imgs: string[] = [];
    if (Array.isArray(p.image_urls)) {
      for (const u of p.image_urls) if (u && typeof u === "string") imgs.push(u);
    }
    if (imgs.length === 0 && p.image_url) imgs.push(p.image_url);
    // limpio + valido https + dedup conservando orden
    const seen = new Set<string>();
    const unique = imgs
      .map((u) => String(u).trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
    if (unique.length > 0) {
      payload.images = unique.map((src, i) => ({ src, position: i + 1 }));
    }
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Falta autenticación");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) throw new Error("Usuario no autenticado");

    const { org_id, product_ids, action = "sync" } = await req.json();
    if (!org_id) throw new Error("org_id requerido");

    // Verify user is admin of org
    const { data: membership } = await supabase
      .from("memberships").select("role").eq("org_id", org_id).eq("user_id", user.id).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Sin permisos en esta organización");
    }

    const { data: integration } = await supabase
      .from("tiendanube_integrations").select("*").eq("org_id", org_id).maybeSingle();
    if (!integration) throw new Error("Tiendanube no está conectado en esta organización");

    if (action === "test") {
      const store = await tnRequest(integration.store_id, integration.access_token, "/store");
      return new Response(JSON.stringify({ success: true, store }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sync products
    let query = supabase.from("products").select("*").eq("org_id", org_id);
    if (Array.isArray(product_ids) && product_ids.length > 0) {
      query = query.in("id", product_ids);
    }
    const { data: products, error: pErr } = await query;
    if (pErr) throw pErr;
    if (!products?.length) throw new Error("No hay productos para exportar");

    const results: any[] = [];
    for (const p of products) {
      try {
        const payload = buildProductPayload(p, integration);
        let tnId = p.tiendanube_product_id;
        let tnRes;
        if (tnId) {
          tnRes = await tnRequest(integration.store_id, integration.access_token, `/products/${tnId}`, "PUT", payload);
        } else {
          tnRes = await tnRequest(integration.store_id, integration.access_token, "/products", "POST", payload);
          tnId = tnRes?.id?.toString();
          if (tnId) {
            await supabase.from("products").update({ tiendanube_product_id: tnId }).eq("id", p.id);
          }
        }
        await supabase.from("tiendanube_sync_log").insert({
          org_id, user_id: user.id, product_id: p.id, product_name: p.name,
          action: tnId && p.tiendanube_product_id ? "update" : "create",
          status: "success", tiendanube_product_id: tnId,
        });
        results.push({ id: p.id, name: p.name, status: "success", tn_id: tnId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase.from("tiendanube_sync_log").insert({
          org_id, user_id: user.id, product_id: p.id, product_name: p.name,
          action: "sync", status: "error", error_message: msg,
        });
        results.push({ id: p.id, name: p.name, status: "error", error: msg });
      }
    }

    await supabase.from("tiendanube_integrations").update({ last_sync_at: new Date().toISOString() }).eq("org_id", org_id);

    const ok = results.filter(r => r.status === "success").length;
    const fail = results.filter(r => r.status === "error").length;
    return new Response(JSON.stringify({ success: true, total: results.length, ok, fail, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("tiendanube-export error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
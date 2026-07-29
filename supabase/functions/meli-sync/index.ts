/**
 * meli-sync — publica productos en MercadoLibre y trae las órdenes.
 *
 * Acciones (campo `action`):
 *   publish      → publica un producto y guarda el vínculo en meli_listings
 *   sync-stock   → empuja stock y precio de todas las publicaciones activas
 *   pull-orders  → baja las órdenes nuevas a meli_orders
 *
 * El token se lee de `meli_connections` con service_role y se renueva solo si
 * está por vencer: MercadoLibre expira el access_token a las 6 horas, así que
 * el cron de stock lo renovaría constantemente si no se contemplara.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const API = "https://api.mercadolibre.com";

/**
 * MercadoLibre Argentina no permite vender cigarrillos electrónicos: ANMAT los
 * tiene prohibidos (Disp. 3226/2011) y la publicación se da de baja. Se corta
 * acá para no ganarse una sanción en la cuenta.
 */
const CATEGORIAS_PROHIBIDAS = ["vaper"];

interface Connection {
  org_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  site_id: string;
}

/** Devuelve un token vigente, renovándolo si le quedan menos de 10 minutos. */
async function getToken(admin: any, orgId: string): Promise<Connection> {
  const { data: conn } = await admin
    .from("meli_connections")
    .select("org_id, access_token, refresh_token, expires_at, site_id")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!conn?.access_token) throw new Error("La organización no está conectada a MercadoLibre");

  const msLeft = new Date(conn.expires_at).getTime() - Date.now();
  if (msLeft > 10 * 60 * 1000) return conn;

  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requireEnv("MELI_CLIENT_ID"),
      client_secret: requireEnv("MELI_CLIENT_SECRET"),
      refresh_token: conn.refresh_token,
    }),
  });
  const tok = await res.json().catch(() => null);
  if (!res.ok || !tok?.access_token) {
    throw new Error("No se pudo renovar el token de MercadoLibre — reconectá la cuenta");
  }

  const updated = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from("meli_connections").update(updated).eq("org_id", orgId);
  return { ...conn, ...updated };
}

const meli = (token: string, path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userRes } = await asUser.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "No autenticado" }, 401);

    const { action, orgId, productId, categoryId, listingType } = await req.json();
    if (!orgId) return json({ error: "orgId es requerido" }, 400);

    const { data: membership } = await asUser
      .from("memberships").select("role")
      .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Necesitás ser administrador de esta organización" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const conn = await getToken(admin, orgId);

    // ── publish ───────────────────────────────────────────────────────────
    if (action === "publish") {
      if (!productId) return json({ error: "productId es requerido" }, 400);

      const { data: p } = await admin
        .from("products")
        .select("id, name, brand, category, description, sale_price_ars, discount_price_ars, stock, image_url, image_urls")
        .eq("id", productId).eq("org_id", orgId).maybeSingle();
      if (!p) return json({ error: "Producto no encontrado" }, 404);

      if (CATEGORIAS_PROHIBIDAS.includes(String(p.category))) {
        return json({
          error: "MercadoLibre Argentina no permite publicar vapers (ANMAT los tiene prohibidos). " +
                 "Publicar uno puede costarte una sanción en la cuenta.",
        }, 422);
      }
      if (!p.stock || p.stock < 1) return json({ error: "El producto no tiene stock" }, 422);
      if (!categoryId) return json({ error: "Falta elegir la categoría de MercadoLibre" }, 400);

      const price = Number(p.discount_price_ars ?? p.sale_price_ars) || 0;
      if (price <= 0) return json({ error: "El producto no tiene precio" }, 422);

      const pictures = [p.image_url, ...(p.image_urls ?? [])]
        .filter(Boolean).slice(0, 10).map((source: string) => ({ source }));

      const res = await meli(conn.access_token, "/items", {
        method: "POST",
        body: JSON.stringify({
          title: String(p.name).slice(0, 60),
          category_id: categoryId,
          price,
          currency_id: "ARS",
          available_quantity: p.stock,
          buying_mode: "buy_it_now",
          condition: "new",
          listing_type_id: listingType ?? "gold_special",
          pictures,
          attributes: p.brand ? [{ id: "BRAND", value_name: p.brand }] : [],
        }),
      });
      const item = await res.json().catch(() => null);

      if (!res.ok || !item?.id) {
        const msg = item?.message ?? item?.error ?? `HTTP ${res.status}`;
        const cause = item?.cause?.map((c: any) => c.message).join("; ");
        return json({ error: cause ? `${msg}: ${cause}` : String(msg) }, 400);
      }

      await admin.from("meli_listings").upsert({
        org_id: orgId,
        product_id: productId,
        meli_item_id: item.id,
        permalink: item.permalink ?? null,
        status: item.status ?? "active",
        listing_type: item.listing_type_id ?? null,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id,product_id" });

      return json({ ok: true, item_id: item.id, permalink: item.permalink });
    }

    // ── sync-stock ────────────────────────────────────────────────────────
    if (action === "sync-stock") {
      const { data: listings } = await admin
        .from("meli_listings")
        .select("id, product_id, meli_item_id")
        .eq("org_id", orgId).eq("status", "active");

      let ok = 0;
      const errores: { item: string; error: string }[] = [];

      for (const l of listings ?? []) {
        const { data: p } = await admin
          .from("products")
          .select("stock, sale_price_ars, discount_price_ars")
          .eq("id", l.product_id).maybeSingle();
        if (!p) continue;

        const price = Number(p.discount_price_ars ?? p.sale_price_ars) || 0;
        const res = await meli(conn.access_token, `/items/${l.meli_item_id}`, {
          method: "PUT",
          body: JSON.stringify({ available_quantity: Math.max(0, p.stock ?? 0), price }),
        });

        if (res.ok) {
          ok++;
          await admin.from("meli_listings")
            .update({ last_synced_at: new Date().toISOString(), last_error: null })
            .eq("id", l.id);
        } else {
          const body = await res.json().catch(() => null);
          const msg = String(body?.message ?? `HTTP ${res.status}`).slice(0, 300);
          errores.push({ item: l.meli_item_id, error: msg });
          await admin.from("meli_listings").update({ last_error: msg }).eq("id", l.id);
        }
      }

      return json({ ok: true, sincronizadas: ok, errores });
    }

    // ── pull-orders ───────────────────────────────────────────────────────
    if (action === "pull-orders") {
      const { data: conn2 } = await admin
        .from("meli_connections").select("meli_user_id").eq("org_id", orgId).maybeSingle();
      if (!conn2?.meli_user_id) return json({ error: "Conexión incompleta" }, 400);

      const res = await meli(
        conn.access_token,
        `/orders/search?seller=${conn2.meli_user_id}&sort=date_desc&limit=50`,
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) return json({ error: body?.message ?? `HTTP ${res.status}` }, 400);

      const rows = (body?.results ?? []).map((o: any) => ({
        org_id: orgId,
        meli_order_id: o.id,
        status: o.status ?? null,
        buyer_nickname: o.buyer?.nickname ?? null,
        total_ars: o.total_amount ?? null,
        items: (o.order_items ?? []).map((i: any) => ({
          title: i.item?.title,
          item_id: i.item?.id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
        date_created: o.date_created ?? null,
        raw: o,
      }));

      if (rows.length) {
        // ignoreDuplicates: una orden ya bajada no se pisa (podría estar
        // importada como venta y no queremos perder ese vínculo).
        await admin.from("meli_orders").upsert(rows, {
          onConflict: "org_id,meli_order_id",
          ignoreDuplicates: true,
        });
      }

      return json({ ok: true, ordenes: rows.length });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/**
 * meli-sync — publica productos en MercadoLibre y trae las órdenes.
 *
 * Acciones (campo `action`):
 *   predict-category → propone hasta tres categorías para un producto guardado
 *   publish      → publica un producto y guarda el vínculo en meli_listings
 *   sync-stock   → empuja stock y precio de todas las publicaciones activas
 *   pull-orders  → baja órdenes y el costo final de envío a cargo del vendedor
 *   import-order → convierte una orden paid ya bajada en ventas del Core
 *   cron-sync    → sincroniza todas las organizaciones conectadas (sólo cron)
 *
 * El token se lee de `meli_connections` con service_role y se renueva solo si
 * está por vencer: MercadoLibre expira el access_token a las 6 horas, así que
 * el cron de stock lo renovaría constantemente si no se contemplara.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  const { error: updateError } = await admin.from("meli_connections").update(updated).eq("org_id", orgId);
  if (updateError) throw new Error(updateError.message);
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

/**
 * En /shipments/{id}/costs, `senders[].cost` es el cargo final al vendedor.
 * No se usa receiver.cost: ese es el flete que afrontó el comprador y no mide
 * el margen del comercio. Un cero explícito es válido; una respuesta sin el
 * vendedor o sin importe se reporta, nunca se convierte en cero.
 */
function sellerShippingCost(costs: any, sellerId: number): number {
  const senders = Array.isArray(costs?.senders) ? costs.senders : [];
  const sender = senders.find((entry: any) => String(entry?.user_id) === String(sellerId));
  if (!sender) throw new Error("MercadoLibre no informó el costo de envío para este vendedor");

  const cost = Number(sender.cost);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("MercadoLibre informó un costo de envío inválido");
  }
  return cost;
}

type SyncError = { item: string; error: string };

/** Sincroniza las publicaciones de una organización sin ocultar stock negativo. */
async function syncMeliStock(admin: any, orgId: string, token: string) {
  const { data: listings, error: listingsError } = await admin
    .from("meli_listings")
    .select("id, product_id, meli_item_id")
    .eq("org_id", orgId).eq("status", "active");
  if (listingsError) throw new Error(listingsError.message);

  let sincronizadas = 0;
  const errores: SyncError[] = [];

  for (const listing of listings ?? []) {
    const { data: product, error: productError } = await admin
      .from("products")
      .select("stock, sale_price_ars, discount_price_ars")
      .eq("id", listing.product_id).maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) continue;

    // Un negativo es una inconsistencia para revisar, no un cero que haya que
    // inventar en MercadoLibre. El listado conserva el error hasta corregir el
    // Kardex y evita seguir vendiendo una cantidad falsa.
    if (Number(product.stock ?? 0) < 0) {
      const message = "Stock negativo en Gestiona: corregilo desde Kardex antes de sincronizar MercadoLibre";
      errores.push({ item: listing.meli_item_id, error: message });
      const { error: updateError } = await admin.from("meli_listings")
        .update({ last_error: message }).eq("id", listing.id);
      if (updateError) throw new Error(updateError.message);
      continue;
    }

    const price = Number(product.discount_price_ars ?? product.sale_price_ars) || 0;
    const res = await meli(token, `/items/${listing.meli_item_id}`, {
      method: "PUT",
      body: JSON.stringify({ available_quantity: Number(product.stock ?? 0), price }),
    });

    if (res.ok) {
      sincronizadas++;
      const { error: updateError } = await admin.from("meli_listings")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", listing.id);
      if (updateError) throw new Error(updateError.message);
    } else {
      const body = await res.json().catch(() => null);
      const message = String(body?.message ?? `HTTP ${res.status}`).slice(0, 300);
      errores.push({ item: listing.meli_item_id, error: message });
      const { error: updateError } = await admin.from("meli_listings")
        .update({ last_error: message }).eq("id", listing.id);
      if (updateError) throw new Error(updateError.message);
    }
  }

  return { sincronizadas, errores };
}

/** Baja órdenes sin tocar vínculos importados y concilia el envío por shipment. */
async function pullMeliOrders(admin: any, orgId: string, token: string) {
  const { data: connection, error: connectionError } = await admin
    .from("meli_connections").select("meli_user_id").eq("org_id", orgId).maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connection?.meli_user_id) throw new Error("Conexión incompleta");

  const res = await meli(token, `/orders/search?seller=${connection.meli_user_id}&sort=date_desc&limit=50`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);

  const rows = (body?.results ?? []).map((order: any) => ({
    org_id: orgId,
    meli_order_id: order.id,
    status: order.status ?? null,
    buyer_nickname: order.buyer?.nickname ?? null,
    total_ars: order.total_amount ?? null,
    items: (order.order_items ?? []).map((item: any) => ({
      title: item.item?.title,
      item_id: item.item?.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      // Es la comisión real informada por MercadoLibre, que la importación usa
      // para el margen del canal. No se estima desde una tabla de tarifas.
      sale_fee: item.sale_fee ?? null,
    })),
    // El id permite pedir el costo real por separado. No viene en la línea de
    // /orders, y la ausencia queda como NULL hasta que ML lo cree/informe.
    shipment_id: order.shipping?.id != null ? String(order.shipping.id) : null,
    shipping_cost_currency: typeof order.currency_id === "string" ? order.currency_id : null,
    date_created: order.date_created ?? null,
    raw: order,
  }));

  if (rows.length) {
    // Una orden descargada como pending tiene que pasar a paid cuando ML la
    // acredita. No se mandan imported_at ni sale_id, así que esos vínculos de
    // Core se preservan mientras se actualiza el estado remoto.
    const { error: upsertError } = await admin.from("meli_orders").upsert(rows, {
      onConflict: "org_id,meli_order_id",
    });
    if (upsertError) throw new Error(upsertError.message);
  }

  const errors: SyncError[] = [];
  let costosEnvio = 0;
  let enviosPendientes = 0;

  if (rows.length) {
    const orderIds = rows.map((row: { meli_order_id: number }) => row.meli_order_id);
    const { data: storedOrders, error: storedOrdersError } = await admin
      .from("meli_orders")
      .select("id, meli_order_id, shipment_id, status, seller_shipping_cost_ars")
      .eq("org_id", orgId)
      .in("meli_order_id", orderIds);
    if (storedOrdersError) throw new Error(storedOrdersError.message);

    for (const order of storedOrders ?? []) {
      if (String(order.status ?? "").toLowerCase() !== "paid") continue;
      // `0` ya es un costo confirmado (ML no le cobró envío al vendedor), por
      // lo que sólo NULL vuelve a consultar. Así el cron no gasta cuota cada
      // 15 minutos sobre los mismos 50 pedidos ya conciliados.
      if (order.seller_shipping_cost_ars !== null && order.seller_shipping_cost_ars !== undefined) continue;
      if (!order.shipment_id) {
        // Envíos personalizados o una orden recién creada pueden no tener id
        // todavía. No es costo cero ni un error de la orden.
        enviosPendientes++;
        continue;
      }

      try {
        const shippingResponse = await meli(
          token,
          `/shipments/${encodeURIComponent(String(order.shipment_id))}/costs`,
          { headers: { "x-format-new": "true" } },
        );
        const shippingBody = await shippingResponse.json().catch(() => null);
        if (!shippingResponse.ok) {
          throw new Error(shippingBody?.message ?? `HTTP ${shippingResponse.status}`);
        }

        const cost = sellerShippingCost(shippingBody, Number(connection.meli_user_id));
        const { error: applyError } = await admin.rpc("apply_meli_shipping_cost", {
          p_org_id: orgId,
          p_meli_order_id: order.id,
          p_seller_shipping_cost_ars: cost,
        });
        if (applyError) throw new Error(applyError.message);

        const { error: clearError } = await admin
          .from("meli_orders")
          .update({ shipping_cost_error: null, shipping_cost_updated_at: new Date().toISOString() })
          .eq("id", order.id);
        if (clearError) throw new Error(clearError.message);
        costosEnvio++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido al consultar el envío";
        const { error: recordError } = await admin
          .from("meli_orders")
          .update({ shipping_cost_error: message.slice(0, 500) })
          .eq("id", order.id);
        if (recordError) throw new Error(`${message}; tampoco se pudo registrar: ${recordError.message}`);
        errors.push({ item: String(order.meli_order_id), error: message });
      }
    }
  }

  return { ordenes: rows.length, costos_envio: costosEnvio, envios_pendientes: enviosPendientes, errores_envio: errors };
}

function sameSecret(received: string | null, expected: string) {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const body = await req.json();
    const { action, orgId, productId, categoryId, listingType, meliOrderId } = body;
    const admin = createClient(supabaseUrl, serviceKey);

    // El cron no tiene un usuario humano. Se protege con un secreto distinto de
    // la anon key pública: el job lo lee desde Vault y la Function desde sus
    // secretos de entorno. Así una llamada copiada desde el navegador no puede
    // forzar sincronizaciones ni gastar cuota de la API de MercadoLibre.
    if (action === "cron-sync") {
      const expectedSecret = requireEnv("MELI_CRON_SECRET");
      if (!sameSecret(req.headers.get("x-meli-cron-secret"), expectedSecret)) {
        return json({ error: "Cron no autorizado" }, 401);
      }

      const { data: connections, error: connectionsError } = await admin
        .from("meli_connections").select("org_id").not("access_token", "is", null);
      if (connectionsError) throw new Error(connectionsError.message);

      let stock = 0;
      let orders = 0;
      const errors: { org_id: string; error: string }[] = [];
      const failedOrgIds = new Set<string>();
      for (const connection of connections ?? []) {
        try {
          const connectionWithToken = await getToken(admin, connection.org_id);
          const stockResult = await syncMeliStock(admin, connection.org_id, connectionWithToken.access_token);
          const ordersResult = await pullMeliOrders(admin, connection.org_id, connectionWithToken.access_token);
          stock += stockResult.sincronizadas;
          orders += ordersResult.ordenes;
          const shippingErrors = ordersResult.errores_envio ?? [];
          const lastError = stockResult.errores[0]?.error ?? shippingErrors[0]?.error ?? null;
          errors.push(...stockResult.errores.map(error => ({ org_id: connection.org_id, error: error.error })));
          errors.push(...shippingErrors.map(error => ({ org_id: connection.org_id, error: error.error })));
          if (stockResult.errores.length || shippingErrors.length) failedOrgIds.add(connection.org_id);
          const { error: statusError } = await admin.from("meli_connections")
            .update({ last_error: lastError, updated_at: new Date().toISOString() })
            .eq("org_id", connection.org_id);
          if (statusError) throw new Error(statusError.message);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error desconocido";
          errors.push({ org_id: connection.org_id, error: message });
          failedOrgIds.add(connection.org_id);
          await admin.from("meli_connections")
            .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
            .eq("org_id", connection.org_id);
        }
      }

      return json(
        { ok: errors.length < (connections?.length ?? 0) || !connections?.length, organizaciones: connections?.length ?? 0, stock, ordenes: orders, errores: errors },
        failedOrgIds.size === (connections?.length ?? 0) && failedOrgIds.size > 0 ? 500 : 200,
      );
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userRes } = await asUser.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "No autenticado" }, 401);

    if (!orgId) return json({ error: "orgId es requerido" }, 400);

    const { data: membership } = await asUser
      .from("memberships").select("role")
      .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Necesitás ser administrador de esta organización" }, 403);
    }

    // Importar no llama a MercadoLibre: trabaja sobre la orden inmutable que
    // ya se descargó. Por eso sigue funcionando si el token venció o la cuenta
    // se desconectó después de traerla; exigirle OAuth acá dejaría ventas
    // cobradas fuera del stock único por un problema ajeno al pedido.
    if (action === "import-order") {
      if (!meliOrderId) return json({ error: "meliOrderId es requerido" }, 400);

      const { data, error } = await admin.rpc("import_meli_order_as_sales", {
        p_org_id: orgId,
        p_meli_order_id: meliOrderId,
        p_actor_id: userId,
      });
      if (error) return json({ error: error.message }, 400);

      return json({ ok: true, ...(data ?? {}) });
    }

    const conn = await getToken(admin, orgId);

    // El título se lee de la ficha persistida. El navegador sólo confirma una
    // de las categorías sugeridas: nunca puede inventar el producto ni sus
    // valores económicos al publicar.
    if (action === "predict-category" || action === "publish") {
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

      // ── predict-category ───────────────────────────────────────────────
      // MercadoLibre recomienda mostrar varias opciones, no publicar de forma
      // automática con la primera predicción. El cliente presenta estas tres y
      // el dueño/admin confirma la elegida en una segunda acción.
      if (action === "predict-category") {
        const title = [p.brand, p.name].filter(Boolean).join(" ").trim();
        const res = await meli(
          conn.access_token,
          `/sites/${encodeURIComponent(conn.site_id || "MLA")}/domain_discovery/search?limit=3&q=${encodeURIComponent(title)}`,
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          return json({ error: body?.message ?? body?.error ?? `HTTP ${res.status}` }, 400);
        }

        const categories = (Array.isArray(body) ? body : [])
          .map((candidate: any) => ({
            id: typeof candidate?.category_id === "string" ? candidate.category_id : "",
            name: typeof candidate?.category_name === "string" ? candidate.category_name : "",
            domain: typeof candidate?.domain_name === "string" ? candidate.domain_name : null,
          }))
          .filter((candidate: { id: string; name: string }) => candidate.id && candidate.name);

        if (!categories.length) {
          return json({ error: "MercadoLibre no sugirió una categoría para este producto. Probá completar mejor el nombre." }, 422);
        }
        return json({ ok: true, categories });
      }

      // ── publish ─────────────────────────────────────────────────────────
      if (!p.stock || p.stock < 1) return json({ error: "El producto no tiene stock" }, 422);
      if (!categoryId) return json({ error: "Falta elegir la categoría de MercadoLibre" }, 400);

      // Antes el upsert evitaba duplicar la fila local pero llegaba después del
      // POST a MercadoLibre: dos clics podían crear dos publicaciones reales.
      // Se consulta primero y la segunda llamada devuelve el vínculo existente.
      const { data: existingListing, error: existingListingError } = await admin
        .from("meli_listings")
        .select("meli_item_id, permalink, status")
        .eq("org_id", orgId)
        .eq("product_id", productId)
        .maybeSingle();
      if (existingListingError) return json({ error: existingListingError.message }, 500);
      if (existingListing) {
        return json({
          ok: true,
          already_published: true,
          item_id: existingListing.meli_item_id,
          permalink: existingListing.permalink,
          status: existingListing.status,
        });
      }

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

      const { error: listingError } = await admin.from("meli_listings").upsert({
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
      if (listingError) {
        // La publicación ya existe afuera. Informarlo explícitamente para que
        // soporte la vincule antes de que alguien vuelva a presionar publicar.
        return json({
          error: `MercadoLibre creó ${item.id}, pero no se pudo guardar el vínculo interno: ${listingError.message}`,
          item_id: item.id,
          permalink: item.permalink ?? null,
        }, 500);
      }

      return json({ ok: true, item_id: item.id, permalink: item.permalink });
    }

    // ── sync-stock ────────────────────────────────────────────────────────
    if (action === "sync-stock") {
      return json({ ok: true, ...(await syncMeliStock(admin, orgId, conn.access_token)) });
    }

    // ── pull-orders ───────────────────────────────────────────────────────
    if (action === "pull-orders") {
      return json({ ok: true, ...(await pullMeliOrders(admin, orgId, conn.access_token)) });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

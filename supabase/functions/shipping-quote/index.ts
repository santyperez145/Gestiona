// Cotización de envíos para el checkout de la tienda online.
//
// Es un endpoint PÚBLICO: lo llama el comprador anónimo desde el storefront.
// Por eso nunca recibe org_id del cliente — se resuelve por el slug de la
// tienda — y nunca devuelve credenciales del transportista.
//
// Dos caminos por transportista, según `shipping_carriers.mode`:
//   'table' → usa el tarifario del comercio (misma lógica pura que el front)
//   'api'   → cotiza en vivo contra Correo Argentino / Andreani
//
// Si la API del correo falla o tarda, se cae al tarifario. Un checkout que no
// puede cotizar es una venta perdida; una tarifa aproximada no lo es.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Timeout duro para no colgar el checkout esperando al correo. */
const CARRIER_TIMEOUT_MS = 6000;

const CARRIER_LABEL: Record<string, string> = {
  correo_argentino: "Correo Argentino",
  andreani: "Andreani",
  oca: "OCA",
  propio: "Envío propio",
  retiro: "Retiro en tienda",
};
const SERVICE_LABEL: Record<string, string> = {
  domicilio: "A domicilio",
  sucursal: "Retiro en sucursal",
  express: "Express",
  prioritario: "Prioritario",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Rate {
  id: string;
  zone_id: string;
  carrier: string;
  service: string;
  min_weight_kg: number;
  max_weight_kg: number | null;
  price: number;
  price_per_extra_kg: number;
  delivery_days_min: number | null;
  delivery_days_max: number | null;
  free_above: number | null;
  is_active: boolean;
}

interface CarrierRow {
  carrier: string;
  is_enabled: boolean;
  mode: string;
  credentials: Record<string, string>;
  markup_pct: number;
  markup_fixed: number;
  default_origin: Record<string, string>;
}

// ── Tarifario propio (espejo de src/lib/shippingCalc.ts) ────────────────────

function pickBracket(rates: Rate[], weightKg: number): Rate | null {
  const active = rates.filter((r) => r.is_active !== false);
  if (active.length === 0) return null;
  const exact = active.find((r) =>
    weightKg >= r.min_weight_kg &&
    (r.max_weight_kg == null || weightKg < r.max_weight_kg)
  );
  if (exact) return exact;
  return active.reduce(
    (best, r) => (r.max_weight_kg ?? Infinity) > (best.max_weight_kg ?? Infinity) ? r : best,
    active[0],
  );
}

function priceForWeight(rate: Rate, weightKg: number): number {
  if (rate.max_weight_kg == null || weightKg <= rate.max_weight_kg) return round2(rate.price);
  const extraKg = Math.ceil(weightKg - rate.max_weight_kg);
  return round2(rate.price + extraKg * (rate.price_per_extra_kg || 0));
}

const applyMarkup = (price: number, c?: CarrierRow) =>
  round2(price * (1 + (c?.markup_pct || 0) / 100) + (c?.markup_fixed || 0));

// ── Correo Argentino (Mi Correo / Paq.ar) ───────────────────────────────────
// Login con usuario/clave del contrato → token; después consulta de tarifas.
// Docs del contrato del comercio; los nombres de campo pueden variar según la
// versión de API que le habiliten, así que todo error cae al tarifario.

async function quoteCorreoArgentino(
  cfg: CarrierRow,
  destPostalCode: string,
  weightKg: number,
  declaredValue: number,
): Promise<Array<{ service: string; price: number }>> {
  const { user, password, customer_id } = cfg.credentials || {};
  const originPostalCode = cfg.default_origin?.postal_code;
  if (!user || !password || !customer_id || !originPostalCode) {
    throw new Error("Credenciales de Correo Argentino incompletas");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CARRIER_TIMEOUT_MS);
  try {
    const loginRes = await fetch("https://api.correoargentino.com.ar/micorreo/v1/login", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${user}:${password}`)}`,
      },
    });
    if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
    const { token } = await loginRes.json();
    if (!token) throw new Error("login sin token");

    const ratesRes = await fetch("https://api.correoargentino.com.ar/micorreo/v1/rates", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customerId: customer_id,
        postalCodeOrigin: originPostalCode,
        postalCodeDestination: destPostalCode,
        declaredValue: Math.round(declaredValue),
        dimensions: {
          weight: Math.max(1, Math.round(weightKg * 1000)), // gramos
          height: 20, width: 20, length: 20,                 // cm, estimado
        },
      }),
    });
    if (!ratesRes.ok) throw new Error(`rates ${ratesRes.status}`);
    const data = await ratesRes.json();

    // `rates: [{ deliveredType: 'D' | 'S', price }]` — D = domicilio, S = sucursal
    const out: Array<{ service: string; price: number }> = [];
    for (const r of data?.rates || []) {
      const price = Number(r.price);
      if (!Number.isFinite(price)) continue;
      out.push({
        service: r.deliveredType === "S" ? "sucursal" : "domicilio",
        price,
      });
    }
    if (out.length === 0) throw new Error("sin tarifas en la respuesta");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ── Andreani ────────────────────────────────────────────────────────────────
// Auth: /login con usuario/clave del contrato → x-authorization-token.
// Tarifas: /v1/tarifas con contrato + CP destino + bulto.

async function quoteAndreani(
  cfg: CarrierRow,
  destPostalCode: string,
  weightKg: number,
  declaredValue: number,
): Promise<Array<{ service: string; price: number }>> {
  const { user, password, contract, client_code } = cfg.credentials || {};
  const originPostalCode = cfg.default_origin?.postal_code;
  if (!user || !password || !contract || !originPostalCode) {
    throw new Error("Credenciales de Andreani incompletas");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CARRIER_TIMEOUT_MS);
  try {
    const loginRes = await fetch("https://apis.andreani.com/login", {
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
    });
    if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
    const token = loginRes.headers.get("x-authorization-token") ||
      (await loginRes.json().catch(() => ({})))?.token;
    if (!token) throw new Error("login sin token");

    const params = new URLSearchParams({
      cpDestino: destPostalCode,
      contrato: contract,
      cliente: client_code || "",
      sucursalOrigen: originPostalCode,
      "bultos[0][valorDeclarado]": String(Math.round(declaredValue)),
      "bultos[0][kilos]": String(Math.max(0.1, weightKg)),
      "bultos[0][volumen]": String(20 * 20 * 20), // cm³, estimado
    });

    const res = await fetch(`https://apis.andreani.com/v1/tarifas?${params}`, {
      signal: ctrl.signal,
      headers: { "x-authorization-token": token },
    });
    if (!res.ok) throw new Error(`tarifas ${res.status}`);
    const data = await res.json();

    const price = Number(
      data?.tarifaConIva?.total ?? data?.tarifaSinIva?.total ?? data?.total,
    );
    if (!Number.isFinite(price)) throw new Error("sin tarifa en la respuesta");
    return [{ service: "domicilio", price }];
  } finally {
    clearTimeout(timer);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { storeSlug, provinceCode, postalCode, items, subtotal } = await req.json();

    if (!storeSlug || !provinceCode) {
      return json({ error: "storeSlug y provinceCode son requeridos" }, 400);
    }
    if (!Array.isArray(items)) {
      return json({ error: "items debe ser un array" }, 400);
    }

    const admin = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    // El slug es la única entrada de confianza para resolver el tenant
    const { data: store } = await admin
      .from("ecommerce_stores")
      .select(
        "id, org_id, is_active, shipping_mode, shipping_cost, free_shipping_above, " +
          "pickup_enabled, pickup_address, pickup_instructions, default_item_weight_kg",
      )
      .eq("slug", storeSlug)
      .maybeSingle();

    if (!store || !store.is_active) return json({ error: "Tienda no encontrada" }, 404);

    const options: Array<Record<string, unknown>> = [];

    if (store.pickup_enabled) {
      options.push({
        id: "retiro", carrier: "retiro", service: "sucursal",
        label: "Retiro en tienda", price: 0, isFree: true, freeReason: "pickup",
        deliveryDaysMin: 0, deliveryDaysMax: 0, zoneId: null,
        address: store.pickup_address, instructions: store.pickup_instructions,
      });
    }

    if (store.shipping_mode === "free") {
      options.push({
        id: "gratis", carrier: "propio", service: "domicilio",
        label: "Envío gratis", price: 0, isFree: true, freeReason: "store_policy",
        deliveryDaysMin: null, deliveryDaysMax: null, zoneId: null,
      });
      return json({ ok: true, options, zone: null, unavailableReason: null });
    }

    if (store.shipping_mode === "flat") {
      const threshold = store.free_shipping_above;
      const free = threshold != null && threshold > 0 && Number(subtotal || 0) >= threshold;
      options.push({
        id: "flat", carrier: "propio", service: "domicilio",
        label: "Envío a domicilio",
        price: free ? 0 : round2(Number(store.shipping_cost || 0)),
        isFree: free, freeReason: free ? "threshold" : undefined,
        deliveryDaysMin: null, deliveryDaysMax: null, zoneId: null,
      });
      return json({ ok: true, options, zone: null, unavailableReason: null });
    }

    // ── Modo zonas ──────────────────────────────────────────────────────
    const defaultWeight = Number(store.default_item_weight_kg ?? 0.5);
    const weightKg = Math.round(
      (items as Array<{ qty?: number; weight_kg?: number | null }>).reduce((sum, it) => {
        const w = !it.weight_kg || it.weight_kg <= 0 ? defaultWeight : it.weight_kg;
        return sum + w * Math.max(0, Number(it.qty || 0));
      }, 0) * 1000,
    ) / 1000;

    const [{ data: zones }, { data: carriers }] = await Promise.all([
      admin.from("shipping_zones").select("id, name, provinces, is_active")
        .eq("org_id", store.org_id).eq("is_active", true),
      admin.from("shipping_carriers").select("*").eq("org_id", store.org_id),
    ]);

    const zone = (zones || []).find((z: { provinces: string[] }) =>
      z.provinces?.includes(provinceCode)
    );
    if (!zone) {
      return json({
        ok: true, options, zone: null,
        unavailableReason: options.length > 0
          ? "No hacemos envíos a esa provincia, pero podés retirar en la tienda."
          : "Todavía no hacemos envíos a esa provincia.",
      });
    }

    const { data: rates } = await admin
      .from("shipping_rates").select("*")
      .eq("zone_id", zone.id).eq("is_active", true);

    const carrierByCode = new Map<string, CarrierRow>(
      ((carriers || []) as CarrierRow[]).map((c) => [c.carrier, c]),
    );
    const rateList = (rates || []) as Rate[];
    const subtotalNum = Number(subtotal || 0);

    /** Registra una opción aplicando el umbral de envío gratis. */
    const push = (
      carrier: string, service: string, rawPrice: number,
      daysMin: number | null, daysMax: number | null, freeAbove: number | null,
      source: "api" | "table",
    ) => {
      const threshold = freeAbove ?? store.free_shipping_above ?? null;
      const free = threshold != null && threshold > 0 && subtotalNum >= threshold;
      options.push({
        id: `${carrier}:${service}`,
        carrier, service,
        label: `${CARRIER_LABEL[carrier] || carrier} · ${SERVICE_LABEL[service] || service}`,
        price: free ? 0 : round2(rawPrice),
        isFree: free, freeReason: free ? "threshold" : undefined,
        deliveryDaysMin: daysMin, deliveryDaysMax: daysMax,
        zoneId: zone.id, source,
      });
    };

    // Transportistas que cotizan en vivo
    const apiCarriers = ((carriers || []) as CarrierRow[]).filter(
      (c) => c.is_enabled && c.mode === "api",
    );
    const quotedLive = new Set<string>();

    for (const cfg of apiCarriers) {
      if (!postalCode) continue; // sin CP no se puede cotizar en vivo
      try {
        const quotes = cfg.carrier === "andreani"
          ? await quoteAndreani(cfg, String(postalCode), weightKg, subtotalNum)
          : cfg.carrier === "correo_argentino"
          ? await quoteCorreoArgentino(cfg, String(postalCode), weightKg, subtotalNum)
          : [];
        if (quotes.length === 0) continue;
        for (const q of quotes) {
          push(cfg.carrier, q.service, applyMarkup(q.price, cfg), null, null, null, "api");
        }
        quotedLive.add(cfg.carrier);
      } catch (e) {
        // Fallback silencioso al tarifario: el checkout tiene que seguir andando
        console.warn(`shipping-quote: ${cfg.carrier} API falló, uso tarifario`, e);
      }
    }

    // Tarifario propio para el resto
    const groups = new Map<string, Rate[]>();
    for (const r of rateList) {
      const cfg = carrierByCode.get(r.carrier);
      if (cfg && cfg.is_enabled === false) continue;
      if (quotedLive.has(r.carrier)) continue; // ya cotizó en vivo
      const key = `${r.carrier}:${r.service}`;
      const list = groups.get(key);
      if (list) list.push(r); else groups.set(key, [r]);
    }

    for (const groupRates of groups.values()) {
      const rate = pickBracket(groupRates, weightKg);
      if (!rate) continue;
      const cfg = carrierByCode.get(rate.carrier);
      push(
        rate.carrier, rate.service,
        applyMarkup(priceForWeight(rate, weightKg), cfg),
        rate.delivery_days_min, rate.delivery_days_max, rate.free_above,
        "table",
      );
    }

    const shipped = options.filter((o) => o.carrier !== "retiro");
    if (shipped.length === 0) {
      return json({
        ok: true, options, zone: { id: zone.id, name: zone.name },
        unavailableReason: options.length > 0
          ? `Todavía no cargamos tarifas para ${zone.name}, pero podés retirar en la tienda.`
          : `Todavía no cargamos tarifas para ${zone.name}.`,
      });
    }

    options.sort((a, b) => {
      if (a.carrier === "retiro") return -1;
      if (b.carrier === "retiro") return 1;
      return (a.price as number) - (b.price as number);
    });

    return json({
      ok: true,
      options,
      zone: { id: zone.id, name: zone.name },
      weightKg,
      unavailableReason: null,
    });
  } catch (e) {
    console.error("shipping-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Error cotizando el envío" }, 500);
  }
});

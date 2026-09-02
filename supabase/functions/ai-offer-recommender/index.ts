/**
 * Recomendador de ofertas: Anthropic cuando hay clave y plan; si no, motor
 * propio (mismas reglas que `src/lib/offerRules.ts`). Siempre persiste en
 * `ai_offer_recommendations` para que Aplicar escriba precio de verdad.
 */
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio, registrarConsumoIA } from "../_shared/entitlements.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sale_price_ars: number;
  discount_price_ars: number | null;
  profit_per_unit_ars: number | null;
};

type Analytics = ProductRow & {
  units_sold_90d: number;
  days_since_last_sale: number | null;
  is_overstock: boolean;
  is_dormido: boolean;
};

type OfferOut = {
  product_id: string;
  product_name: string;
  tipo: string;
  razon: string;
  descuento_sugerido_percent: number;
  precio_sugerido_ars: number;
  duracion_horas: number;
  margen_resultante_percent: number;
  probabilidad_venta: string;
  canal_recomendado: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function margenPct(p: Analytics, precio: number): number {
  const profit = Number(p.profit_per_unit_ars ?? 0);
  const list = Number(p.sale_price_ars) || 0;
  if (list <= 0 || precio <= 0 || profit <= 0) return 0;
  const costImplied = list - profit;
  return Math.round(((precio - costImplied) / precio) * 100);
}

/** Espejo de `proposeOffersFromRules` (src/lib/offerRules.ts). */
function proposeFromRules(
  products: Analytics[],
  settings: {
    stock_dormido_days: number;
    max_overstock_units: number;
    max_ai_discount_percent: number;
    margin_alert_percent: number;
  },
  limit = 6,
): OfferOut[] {
  const { stock_dormido_days: dormidoDays, max_overstock_units: maxOverstock,
    max_ai_discount_percent: maxDiscount, margin_alert_percent: marginFloor } = settings;

  const scored = products
    .filter((p) => Number(p.stock) > 0 && Number(p.sale_price_ars) > 0)
    .filter((p) => !p.discount_price_ars || Number(p.discount_price_ars) <= 0)
    .map((p) => {
      const days = p.days_since_last_sale;
      const isDormido = days == null || days > dormidoDays;
      const isOverstock = Number(p.stock) > maxOverstock;
      const sold = Number(p.units_sold_90d ?? 0);
      const list = Number(p.sale_price_ars);
      const margenLista = margenPct(p, list);

      let tipo = "destacado";
      let discount = 10;
      let probabilidad = "media";
      let canal = "catalogo_destacado";
      let score = 0;
      const razones: string[] = [];

      if (isOverstock && isDormido) {
        tipo = "liquidacion";
        discount = clamp(Math.round(18 + Math.min(12, Number(p.stock) / 2)), 15, maxDiscount);
        probabilidad = "alta";
        canal = "whatsapp_status";
        score += 100;
        razones.push(`stock ${p.stock} y ${days == null ? "sin ventas" : `${days} días sin venta`}`);
      } else if (isDormido) {
        tipo = "flash";
        discount = clamp(15, 10, maxDiscount);
        probabilidad = sold > 0 ? "media" : "baja";
        canal = "instagram_story";
        score += 70;
        razones.push(days == null ? "sin ventas recientes" : `${days} días sin venta`);
      } else if (isOverstock) {
        tipo = "mayorista";
        discount = clamp(12, 8, maxDiscount);
        probabilidad = "media";
        canal = "email_vip";
        score += 55;
        razones.push(`sobrestock (${p.stock} u.)`);
      } else if (margenLista >= marginFloor + 15 && sold >= 3) {
        tipo = "destacado";
        discount = clamp(8, 5, Math.min(15, maxDiscount));
        probabilidad = "alta";
        canal = "catalogo_destacado";
        score += 40;
        razones.push(`margen ${margenLista}% y ${sold} u. en 90 días`);
      } else {
        return null;
      }

      let precio = Math.round(list * (1 - discount / 100));
      let margenRes = margenPct(p, precio);
      while (margenRes > 0 && margenRes < marginFloor && discount > 5) {
        discount -= 1;
        precio = Math.round(list * (1 - discount / 100));
        margenRes = margenPct(p, precio);
      }
      if (margenRes > 0 && margenRes < marginFloor) return null;
      score += Math.min(20, Number(p.stock));

      return {
        score,
        offer: {
          product_id: p.id,
          product_name: p.name,
          tipo,
          razon: razones.join("; "),
          descuento_sugerido_percent: discount,
          precio_sugerido_ars: precio,
          duracion_horas: tipo === "flash" ? 48 : tipo === "liquidacion" ? 168 : 72,
          margen_resultante_percent: margenRes,
          probabilidad_venta: probabilidad,
          canal_recomendado: canal,
        } satisfies OfferOut,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.offer);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "ai-offer-recommender", { max: 15, windowMs: 60_000 })) {
    return rateLimitResponse();
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const { org_id } = await req.json();
    if (!org_id) {
      return new Response(JSON.stringify({ error: "org_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sinPlan = await exigirBeneficio(req, org_id, "ia", corsHeaders);
    if (sinPlan) return sinPlan;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: mem } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!mem || !["owner", "admin"].includes(mem.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [settingsR, productsR, salesR] = await Promise.all([
      admin.from("settings").select("*").eq("org_id", org_id).maybeSingle(),
      admin.from("products").select(
        "id,name,brand,stock,sale_price_ars,discount_price_ars,profit_per_unit_ars",
      ).eq("org_id", org_id),
      admin.from("sales").select("product_id,quantity,date")
        .eq("org_id", org_id)
        .gte("date", new Date(Date.now() - 90 * 86400000).toISOString()),
    ]);

    const settings = settingsR.data || {};
    const products = (productsR.data || []) as ProductRow[];
    const sales = salesR.data || [];

    const stockDormidoDays = settings.stock_dormido_days ?? 30;
    const maxOverstock = settings.max_overstock_units ?? 10;
    const maxAiDiscount = settings.max_ai_discount_percent ?? 35;
    const marginAlert = settings.margin_alert_percent ?? 30;
    const aiTone = settings.ai_tone || "profesional rioplatense argentino";
    const businessName = settings.business_name || "el negocio";

    const now = Date.now();
    const analytics: Analytics[] = products.map((p) => {
      const productSales = sales.filter((s: { product_id: string }) => s.product_id === p.id);
      const unitsSold90d = productSales.reduce(
        (acc: number, s: { quantity?: number }) => acc + (s.quantity || 0),
        0,
      );
      const lastSale = productSales.length > 0
        ? Math.max(...productSales.map((s: { date: string }) => new Date(s.date).getTime()))
        : null;
      const daysSinceLastSale = lastSale != null
        ? Math.floor((now - lastSale) / 86400000)
        : null;
      return {
        ...p,
        sale_price_ars: Number(p.sale_price_ars),
        units_sold_90d: unitsSold90d,
        days_since_last_sale: daysSinceLastSale,
        is_overstock: p.stock > maxOverstock,
        is_dormido: daysSinceLastSale == null || daysSinceLastSale > stockDormidoDays,
      };
    });

    const candidateProducts = analytics
      .filter((p) => p.stock > 0)
      .sort((a, b) => (b.is_overstock ? 1 : 0) - (a.is_overstock ? 1 : 0))
      .slice(0, 25);

    const ruleSettings = {
      stock_dormido_days: stockDormidoDays,
      max_overstock_units: maxOverstock,
      max_ai_discount_percent: maxAiDiscount,
      margin_alert_percent: marginAlert,
    };

    let ofertas: OfferOut[] = [];
    let source: "ai" | "rules" = "rules";
    let notice: string | undefined;

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (apiKey && candidateProducts.length > 0) {
      try {
        const client = new Anthropic({ apiKey });
        const systemPrompt = `Sos un experto en estrategia comercial para "${businessName}", tono ${aiTone}.
REGLAS: solo JSON vía herramienta; descuento máx ${maxAiDiscount}%; margen mín post-descuento ${marginAlert}%;
stock dormido > ${stockDormidoDays}d; sobrestock > ${maxOverstock}u; solo stock > 0;
tipos: liquidacion|flash|destacado|mayorista; canal: instagram_story|whatsapp_status|catalogo_destacado|email_vip;
probabilidad: alta|media|baja. No inventes datos.`;

        const message = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          temperature: 0.4,
          system: systemPrompt,
          tools: [{
            name: "submit_recommendations",
            description: "Recomendaciones de oferta",
            input_schema: {
              type: "object",
              properties: {
                ofertas: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      product_id: { type: "string" },
                      product_name: { type: "string" },
                      tipo: { type: "string" },
                      razon: { type: "string" },
                      descuento_sugerido_percent: { type: "number" },
                      precio_sugerido_ars: { type: "number" },
                      duracion_horas: { type: "number" },
                      margen_resultante_percent: { type: "number" },
                      probabilidad_venta: { type: "string" },
                      canal_recomendado: { type: "string" },
                    },
                    required: [
                      "product_id", "tipo", "razon", "descuento_sugerido_percent",
                      "probabilidad_venta", "canal_recomendado",
                    ],
                  },
                },
              },
              required: ["ofertas"],
            },
          }],
          tool_choice: { type: "tool", name: "submit_recommendations" },
          messages: [{
            role: "user",
            content: `Analizá y proponé 3–8 ofertas.\n${JSON.stringify(candidateProducts)}`,
          }],
        });

        await registrarConsumoIA({
          orgId: org_id,
          userId: auth.user.id,
          model: message.model,
          input: message.usage?.input_tokens,
          output: message.usage?.output_tokens,
        });

        const toolBlock = message.content.find((b) => b.type === "tool_use") as
          | { type: "tool_use"; input?: { ofertas?: OfferOut[] } }
          | undefined;
        const fromAi = toolBlock?.input?.ofertas ?? [];
        if (fromAi.length > 0) {
          ofertas = fromAi;
          source = "ai";
        }
      } catch (e) {
        console.error("ai-offer-recommender Anthropic fallback:", e);
        notice = "La IA no respondió; usamos reglas del catálogo.";
      }
    } else if (!apiKey) {
      notice = "Sin clave de IA: propuestas por reglas del catálogo (stock, dormidos, margen).";
    }

    if (ofertas.length === 0) {
      ofertas = proposeFromRules(candidateProducts, ruleSettings);
      source = "rules";
      if (!notice) notice = "Propuestas por reglas del Business Graph.";
    }

    const ids = new Set(products.map((p) => p.id));
    ofertas = ofertas.filter((o) => ids.has(o.product_id));

    const recsToInsert = ofertas.map((o) => ({
      org_id,
      user_id: auth.user.id,
      product_id: o.product_id,
      offer_type: o.tipo,
      reason: o.razon,
      suggested_discount_percent: o.descuento_sugerido_percent,
      suggested_price_ars: o.precio_sugerido_ars,
      duration_hours: o.duracion_horas ?? 72,
      resulting_margin_percent: o.margen_resultante_percent,
      probability: o.probabilidad_venta,
      recommended_channel: o.canal_recomendado,
      payload: { ...o, source },
    }));

    if (recsToInsert.length > 0) {
      const { data: persisted, error: persistError } = await admin
        .from("ai_offer_recommendations")
        .insert(recsToInsert)
        .select("id");
      if (persistError) throw persistError;
      ofertas = ofertas.map((offer, index) => ({
        ...offer,
        _id: persisted?.[index]?.id ?? null,
      })) as OfferOut[];
    }

    return new Response(JSON.stringify({
      ofertas,
      combos: [],
      alertas: [],
      source,
      notice,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-offer-recommender error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

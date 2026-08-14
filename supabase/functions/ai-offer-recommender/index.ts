import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "ai-offer-recommender", { max: 15, windowMs: 60_000 })) return rateLimitResponse();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await sb.auth.getUser();
    const user = userRes?.user;
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { org_id } = await req.json();
    if (!org_id) {
      return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify membership
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: mem } = await admin.from('memberships').select('role').eq('org_id', org_id).eq('user_id', user.id).maybeSingle();
    if (!mem || !['owner', 'admin'].includes(mem.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }

    // Fetch ALL real data — no hardcoding
    const [settingsR, productsR, salesR, purchasesR, brandKnowR] = await Promise.all([
      admin.from('settings').select('*').eq('org_id', org_id).maybeSingle(),
      admin.from('products').select('id,name,brand,stock,cost_usd,sale_price_ars,discount_price_ars,profit_per_unit_ars,total_sold,created_at,featured,offer_expires_at').eq('org_id', org_id),
      admin.from('sales').select('product_id,product_name,quantity,total_ars,date').eq('org_id', org_id).gte('date', new Date(Date.now() - 90 * 86400000).toISOString()),
      admin.from('purchases').select('product_id,quantity,date').eq('org_id', org_id).gte('date', new Date(Date.now() - 60 * 86400000).toISOString()),
      admin.from('brand_knowledge').select('brand,notes_typical,clone_of').or(`org_id.eq.${org_id},org_id.is.null`),
    ]);

    const settings = settingsR.data || {};
    const products = productsR.data || [];
    const sales = salesR.data || [];
    const brandKnow = brandKnowR.data || [];

    // Compute per-product analytics (real, no magic numbers)
    const stockDormidoDays = settings.stock_dormido_days ?? 30;
    const maxOverstock = settings.max_overstock_units ?? 10;
    const maxAiDiscount = settings.max_ai_discount_percent ?? 35;
    const marginAlert = settings.margin_alert_percent ?? 30;
    const aiTone = settings.ai_tone || 'profesional rioplatense argentino';
    const businessName = settings.business_name || 'el negocio';

    const now = Date.now();
    const productAnalytics = products.map((p: any) => {
      const productSales = sales.filter((s: any) => s.product_id === p.id);
      const unitsSold90d = productSales.reduce((acc: number, s: any) => acc + (s.quantity || 0), 0);
      const lastSale = productSales.length > 0
        ? Math.max(...productSales.map((s: any) => new Date(s.date).getTime()))
        : null;
      const daysSinceLastSale = lastSale ? Math.floor((now - lastSale) / 86400000) : null;
      const velocityPerWeek = unitsSold90d / (90 / 7);
      const margenPct = p.sale_price_ars > 0
        ? ((p.profit_per_unit_ars / p.sale_price_ars) * 100)
        : 0;
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        stock: p.stock,
        sale_price_ars: Number(p.sale_price_ars),
        margen_pct: Math.round(margenPct),
        units_sold_90d: unitsSold90d,
        velocity_per_week: Number(velocityPerWeek.toFixed(2)),
        days_since_last_sale: daysSinceLastSale,
        is_overstock: p.stock > maxOverstock,
        is_dormido: !daysSinceLastSale || daysSinceLastSale > stockDormidoDays,
        currently_on_offer: !!p.discount_price_ars,
      };
    });

    // Co-occurrence simple para combos (productos vendidos en mismo día / cliente)
    const candidateProducts = productAnalytics
      .filter(p => p.stock > 0)
      .sort((a, b) => (b.is_overstock ? 1 : 0) - (a.is_overstock ? 1 : 0))
      .slice(0, 25);

    const systemPrompt = `Sos un experto en estrategia comercial para "${businessName}", un negocio con tono ${aiTone}.

REGLAS DURAS:
- Solo respondés con JSON válido vía la herramienta provista. Cero texto suelto.
- Descuento máximo permitido: ${maxAiDiscount}% (NUNCA sugieras más).
- Margen mínimo aceptable post-descuento: ${marginAlert}%.
- Considerá stock dormido: > ${stockDormidoDays} días sin venta.
- Considerá sobrestock: > ${maxOverstock} unidades.
- Solo recomendá productos con stock > 0.
- Justificá cada oferta con datos REALES del producto (no inventes).
- Priorizá: 1) productos con sobrestock + dormidos, 2) margen alto que pueden bajar precio, 3) hits con velocidad alta para destacar.
- Tipo de oferta debe ser uno de: liquidacion, flash, destacado, mayorista, pack_decants, combo.
- Canal recomendado uno de: instagram_story, whatsapp_status, catalogo_destacado, email_vip.
- Probabilidad: alta | media | baja basada en velocity histórica.

CONOCIMIENTO DE MARCAS DISPONIBLES:
${brandKnow.slice(0, 30).map((b: any) => `- ${b.brand}${b.clone_of ? ` (clon de ${b.clone_of})` : ''}: ${b.notes_typical || ''}`).join('\n')}`;

    const userPrompt = `Analizá estos productos y devolvé recomendaciones de ofertas concretas.\n\nPRODUCTOS (top ${candidateProducts.length} candidatos):\n${JSON.stringify(candidateProducts, null, 2)}\n\nGenerá entre 3 y 8 ofertas individuales y entre 0 y 3 combos. Si no hay datos suficientes para una recomendación, no la inventes.`;

    const tool = {
      type: 'function',
      function: {
        name: 'submit_recommendations',
        description: 'Recomendaciones estructuradas',
        parameters: {
          type: 'object',
          properties: {
            ofertas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'string' },
                  product_name: { type: 'string' },
                  tipo: { type: 'string', enum: ['liquidacion', 'flash', 'destacado', 'mayorista', 'pack_decants'] },
                  razon: { type: 'string' },
                  descuento_sugerido_percent: { type: 'number' },
                  precio_sugerido_ars: { type: 'number' },
                  duracion_horas: { type: 'number' },
                  margen_resultante_percent: { type: 'number' },
                  probabilidad_venta: { type: 'string', enum: ['alta', 'media', 'baja'] },
                  canal_recomendado: { type: 'string', enum: ['instagram_story', 'whatsapp_status', 'catalogo_destacado', 'email_vip'] },
                },
                required: ['product_id', 'tipo', 'razon', 'descuento_sugerido_percent', 'probabilidad_venta', 'canal_recomendado'],
              },
            },
            combos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_ids: { type: 'array', items: { type: 'string' } },
                  nombre: { type: 'string' },
                  razon: { type: 'string' },
                  precio_combo_ars: { type: 'number' },
                  ahorro_ars: { type: 'number' },
                },
                required: ['product_ids', 'nombre', 'razon', 'precio_combo_ars'],
              },
            },
            alertas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tipo: { type: 'string', enum: ['sobrestock', 'stock_dormido', 'margen_bajo'] },
                  product_id: { type: 'string' },
                  accion: { type: 'string' },
                },
                required: ['tipo', 'product_id', 'accion'],
              },
            },
          },
          required: ['ofertas'],
        },
      },
    };

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'submit_recommendations' } },
      }),
    });

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'Rate limit. Probá en 1 minuto.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'Sin créditos de IA. Recargá en Workspace > Usage.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'AI error', detail: errTxt }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : { ofertas: [] };

    // Persist for history
    const recsToInsert = (args.ofertas || []).map((o: any) => ({
      org_id, user_id: user.id, product_id: o.product_id, offer_type: o.tipo,
      reason: o.razon, suggested_discount_percent: o.descuento_sugerido_percent,
      suggested_price_ars: o.precio_sugerido_ars, duration_hours: o.duracion_horas,
      resulting_margin_percent: o.margen_resultante_percent, probability: o.probabilidad_venta,
      recommended_channel: o.canal_recomendado, payload: o,
    }));
    if (recsToInsert.length > 0) {
      const { data: persistedRecommendations, error: persistError } = await admin
        .from('ai_offer_recommendations')
        .insert(recsToInsert)
        .select('id');
      if (persistError) throw persistError;

      // La interfaz necesita el id persistido para pedir al RPC que aplique la
      // oferta. Nunca recibe permiso para escribir el precio por su cuenta.
      args.ofertas = (args.ofertas || []).map((offer: any, index: number) => ({
        ...offer,
        _id: persistedRecommendations?.[index]?.id ?? null,
      }));
    }

    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

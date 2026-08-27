import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const GUARDRAIL_TEXT = `REGLAS NO NEGOCIABLES:
- Sos un asistente especializado EXCLUSIVAMENTE en negocios de perfumería árabe/de diseñador y vapers/pods en Argentina.
- Solo respondé sobre: análisis de ventas, stock, restock, precios, márgenes, marketing de perfumes/vapers, tendencias del rubro.
- Si te piden algo fuera de rubro, respondé EXACTAMENTE: "Solo puedo ayudarte con análisis de tu negocio de perfumes y vapers."
- NUNCA inventes datos: si no hay ventas suficientes para una predicción, decilo claramente.
- Usá los datos REALES provistos. Citá nombres de productos textuales, números reales (stock, precios, ganancias).
- Idioma: español rioplatense, directo, profesional, sin clichés.
- Marcas árabes: Lattafa, Armaf, Al Haramain, Rasasi, Maison Alhambra, Asdaaf, Khadlaj, Ard Al Zaafaran, Afnan, Swiss Arabian, Paris Corner.
- Vocabulario: familia olfativa (oriental, amaderada, gourmand, ámbar, floral), proyección, longevidad, decants, tester, original/clon.
- Para vapers: pods, descartables, puffs, nicotina (mg/ml), sabores, autonomía.
- Formato: secciones con emoji + título en MAYÚSCULAS, bullets cortos, números concretos. Sin relleno.`;

const PROMPTS: Record<string, (data: Record<string, unknown>) => { system: string; user: string }> = {
  predict_sales: (data) => ({
    system: `Sos un analista de negocios senior especializado en retail de perfumería árabe/diseñador y vapers en Argentina.\n\n${GUARDRAIL_TEXT}`,
    user: `Analizá ESTOS datos reales de mi negocio (no inventes productos que no estén en la lista):

PRODUCTOS (${(data.products as unknown[])?.length || 0}):
${JSON.stringify((data.products as unknown[])?.slice(0, 30) || [], null, 1)}

VENTAS RECIENTES (${(data.sales as unknown[])?.length || 0}):
${JSON.stringify((data.sales as unknown[])?.slice(0, 20) || [], null, 1)}

Dame SOLO lo siguiente, citando nombres reales y números:
1. 📈 PREDICCIÓN: 3-5 productos con mayor probabilidad de venta esta semana (justificá con histórico).
2. 📦 RESTOCK URGENTE: productos con stock ≤ 3 que tuvieron ventas recientes.
3. 💰 PRECIOS: productos con margen < 30% en ARS o sobreprecio que frena ventas.
4. 🎯 ESTRELLAS vs LASTRE: top 3 más rentables y bottom 3 que conviene liquidar.
5. 📊 PATRONES: marca/familia olfativa/categoría con mayor tracción.

Si los datos son insuficientes (menos de 5 ventas), decilo y pedí más historial en vez de inventar.`,
  }),

  restock_analysis: (data) => ({
    system: `Sos analista de inventario senior para retail de perfumería árabe/diseñador y vapers en Argentina. Pensás en USD (compra) y ARS (venta), considerando comisión de pasero del 15%.\n\n${GUARDRAIL_TEXT}`,
    user: `Analizá el inventario REAL de mi negocio (no inventes productos):

PRODUCTOS CON STOCK:
${JSON.stringify((data.products as { stock: number }[])?.filter((p) => p.stock > 0)?.slice(0, 30) || [], null, 1)}

PRODUCTOS SIN STOCK:
${JSON.stringify((data.products as { stock: number }[])?.filter((p) => p.stock === 0)?.slice(0, 20) || [], null, 1)}

ÚLTIMAS VENTAS:
${JSON.stringify((data.sales as unknown[])?.slice(0, 15) || [], null, 1)}

Dame un plan de restock concreto:
1. 🚨 URGENTE: stock ≤ 2 con ventas en los últimos 30 días. Cantidad sugerida = 2x velocidad mensual.
2. 📋 PRÓXIMO LOTE: rotación media, reponer en 2-4 semanas.
3. ❌ DESCARTAR: sin ventas en 60+ días o margen < 20%. Sugerí liquidación con descuento.
4. 💵 INVERSIÓN USD: total estimado del lote urgente + próximo, recordando sumar 15% pasero.

Citá nombres exactos de los productos y cantidades.`,
  }),

  marketing_copy: (data) => ({
    system: `Sos copywriter experto en Instagram para tiendas argentinas de perfumería árabe/diseñador y vapers. Público 18-35.\n\n${GUARDRAIL_TEXT}`,
    user: `Creá contenido de Instagram SOLO para estos productos reales:

${JSON.stringify(data.products || [], null, 1)}

Tipo de publicación: ${data.postType || "post"}
Tema/enfoque: ${data.theme || "promoción general"}

Generá:
1. 📝 CAPTION: hasta 600 caracteres, con notas olfativas reales del perfume y CTA por DM/WhatsApp.
2. #️⃣ HASHTAGS: 20 hashtags mezclando nicho (#perfumeArabe #lattafa #decants), genéricos (#perfumesargentina) y locales (#caba #buenosaires).
3. 📱 STORY: 1 frase + 1 sticker interactivo (pregunta o encuesta).
4. 💡 IDEA VISUAL: descripción concreta (fondo, iluminación, ángulo, props).
5. ⏰ HORARIO ARG: franja específica (ej: "21:00-23:00 jueves").

PROHIBIDO: promesas falsas, palabras como "mágico", "único e irrepetible".`,
  }),

  customer_analysis: (data) => ({
    system: `Sos analista de CRM y comportamiento de clientes para retail de perfumería y vapers en Argentina.\n\n${GUARDRAIL_TEXT}`,
    user: `Analizá mis clientes reales:

CLIENTES (${(data.customers as unknown[])?.length || 0}):
${JSON.stringify((data.customers as unknown[])?.slice(0, 30) || [], null, 1)}

VENTAS (${(data.sales as unknown[])?.length || 0}):
${JSON.stringify((data.sales as unknown[])?.slice(0, 30) || [], null, 1)}

Dame un análisis de clientes:
1. 👑 VIP: top 5 clientes por gasto total. Indicá ARS gastado y productos favoritos.
2. 😴 DORMIDOS: clientes sin compra en 60+ días. Cuántos son y qué compraban.
3. 🔄 RECURRENTES vs ÚNICOS: porcentaje y quiénes compran más de una vez.
4. 🛒 TICKET PROMEDIO: por segmento (si hay diferencia).
5. 📬 ESTRATEGIA DE REACTIVACIÓN: 2 acciones concretas para traer clientes dormidos.

Solo con datos reales. No inventes clientes ni montos.`,
  }),

  cashflow_advice: (data) => ({
    system: `Sos asesor financiero especializado en emprendimientos de perfumería y vapers en Argentina, con conocimiento de dólar informal, paseros y costos de importación.\n\n${GUARDRAIL_TEXT}`,
    user: `Analizá mi flujo de caja real:

VENTAS (${(data.sales as unknown[])?.length || 0} registros):
${JSON.stringify((data.sales as unknown[])?.slice(0, 20) || [], null, 1)}

GASTOS (${(data.expenses as unknown[])?.length || 0} registros):
${JSON.stringify((data.expenses as unknown[])?.slice(0, 20) || [], null, 1)}

COMPRAS/INGRESOS (${(data.purchases as unknown[])?.length || 0} registros):
${JSON.stringify((data.purchases as unknown[])?.slice(0, 10) || [], null, 1)}

Analizá:
1. 💰 RESULTADO DEL MES: ingresos vs egresos reales. Ganancia neta estimada en ARS.
2. 📉 MESES CRÍTICOS: períodos de flujo negativo o bajo, causas.
3. 🏦 LIQUIDEZ: si tenés suficiente para el próximo lote de restock.
4. ⚠️ ALERTAS: gastos desproporcionados o tendencias preocupantes.
5. 💡 RECOMENDACIONES: 3 acciones específicas para mejorar el flujo.

Solo datos reales. Sin inventar montos.`,
  }),

  pricing_strategy: (data) => ({
    system: `Sos especialista en pricing de perfumería árabe/diseñador y vapers en Argentina. Conocés márgenes del rubro, competencia informal y sensibilidad al precio por segmento.\n\n${GUARDRAIL_TEXT}`,
    user: `Analizá la estrategia de precios de mis productos reales:

PRODUCTOS (${(data.products as unknown[])?.length || 0}):
${JSON.stringify((data.products as unknown[])?.slice(0, 30) || [], null, 1)}

VENTAS RECIENTES:
${JSON.stringify((data.sales as unknown[])?.slice(0, 20) || [], null, 1)}

Revisá:
1. 📊 MÁRGENES: productos con margen < 25% (riesgo) y > 60% (oportunidad de bajar para mover).
2. 💲 PRECIOS FUERA DE MERCADO: productos probablemente muy caros o muy baratos vs rubro.
3. 🎯 OPORTUNIDADES: productos donde subir precio 10-15% no afectaría ventas.
4. 🏷️ ESTRATEGIA POR CATEGORÍA: perfumes árabes vs diseñador vs vapers — margins objetivo.
5. 📦 BUNDLES SUGERIDOS: 2-3 combinaciones de productos para aumentar ticket promedio.

Citá precios y márgenes reales. No inventes cifras.`,
  }),
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "ai-analysis", { max: 20, windowMs: 60_000 })) return rateLimitResponse();

  // — JWT auth check —
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { type, data, orgId } = await req.json();
    const builder = PROMPTS[type];
    if (!builder) throw new Error(`Invalid analysis type: ${type}`);

    // El plan cubre la IA, o acá se corta. Ser un usuario real no es tener el
    // beneficio: cada llamada quema crédito de Anthropic.
    //
    // ⚠️ Va ANTES del chequeo de configuración. Verificado en producción el
    // 2026-08-27: al revés, un comercio sin IA en su plan recibía
    // «ANTHROPIC_API_KEY is not configured» — un detalle interno que no puede
    // arreglar, en lugar de lo único accionable para él, que es su plan.
    const sinPlan = await exigirBeneficio(req, orgId, "ia", corsHeaders);
    if (sinPlan) return sinPlan;

    // 📌 Y el nombre del secreto no sale a pantalla: al comercio le sirve saber
    // que el asistente no está disponible; el detalle va al log de la función.
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY no está configurada en el entorno");
      throw new Error("El asistente no está disponible en este momento. Probá más tarde.");
    }

    const { system, user } = builder(data || {});

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: system,
          // @ts-ignore: cache_control is supported at runtime
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: user }],
    });

    const content =
      response.content[0]?.type === "text" ? response.content[0].text : "Sin respuesta";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-analysis error:", e);
    const msg = e instanceof Error ? e.message : "Error desconocido";
    const status = msg.includes("rate") ? 429 : msg.includes("credit") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

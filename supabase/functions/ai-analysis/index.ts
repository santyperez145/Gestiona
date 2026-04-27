import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { type, data } = await req.json();

    // Guardrail base aplicado a TODOS los modos
    const baseGuardrails = `
REGLAS NO NEGOCIABLES:
- Sos un asistente especializado EXCLUSIVAMENTE en negocios de perfumería árabe/de diseñador y vapers/pods en Argentina.
- Solo respondé sobre: análisis de ventas, stock, restock, precios, márgenes, marketing de perfumes/vapers, tendencias del rubro.
- Si te piden algo fuera de rubro (recetas, política, código, terapia, opiniones generales), respondé EXACTAMENTE: "Solo puedo ayudarte con análisis de tu negocio de perfumes y vapers."
- NUNCA inventes datos: si no hay ventas suficientes para una predicción, decilo claramente.
- Usá los datos REALES provistos. Citá nombres de productos textuales, números reales (stock, precios, ganancias).
- Idioma: español rioplatense, directo, profesional, sin clichés.
- Marcas árabes que conocés: Lattafa, Armaf, Al Haramain, Rasasi, Maison Alhambra, Asdaaf, Khadlaj, Ard Al Zaafaran, Afnan, Swiss Arabian, Paris Corner.
- Vocabulario obligatorio: familia olfativa (oriental, amaderada, gourmand, ámbar, floral), proyección, longevidad, decants, tester, original/clon.
- Para vapers: hablás de pods, descartables, puffs, nicotina (mg/ml), sabores, autonomía.
- Formato: secciones con emoji + título en MAYÚSCULAS, bullets cortos, números concretos. Sin relleno.`;

    let systemPrompt = "";
    let userPrompt = "";

    if (type === "predict_sales") {
      systemPrompt = `Sos un analista de negocios senior especializado en retail de perfumería árabe/diseñador y vapers en Argentina.${baseGuardrails}`;
      userPrompt = `Analizá ESTOS datos reales de mi negocio (no inventes productos que no estén en la lista):

PRODUCTOS (${data.products?.length || 0}):
${JSON.stringify(data.products?.slice(0, 30) || [], null, 1)}

VENTAS RECIENTES (${data.sales?.length || 0}):
${JSON.stringify(data.sales?.slice(0, 20) || [], null, 1)}

Dame SOLO lo siguiente, citando nombres reales y números:
1. 📈 PREDICCIÓN: 3-5 productos con mayor probabilidad de venta esta semana (justificá con histórico).
2. 📦 RESTOCK URGENTE: productos con stock ≤ 3 que tuvieron ventas recientes.
3. 💰 PRECIOS: productos con margen < 30% en ARS o sobreprecio que frena ventas.
4. 🎯 ESTRELLAS vs LASTRE: top 3 más rentables y bottom 3 que conviene liquidar.
5. 📊 PATRONES: marca/familia olfativa/categoría con mayor tracción.

Si los datos son insuficientes (menos de 5 ventas), decilo y pedí más historial en vez de inventar.`;
    } else if (type === "marketing_copy") {
      systemPrompt = `Sos copywriter experto en Instagram para tiendas argentinas de perfumería árabe/diseñador y vapers. Público 18-35.${baseGuardrails}`;
      userPrompt = `Creá contenido de Instagram SOLO para estos productos reales (no menciones otros):

${JSON.stringify(data.products || [], null, 1)}

Tipo de publicación: ${data.postType || 'post'}
Tema/enfoque: ${data.theme || 'promoción general'}

Generá:
1. 📝 CAPTION: hasta 600 caracteres, con notas olfativas reales del perfume y CTA por DM/WhatsApp.
2. #️⃣ HASHTAGS: 20 hashtags mezclando nicho (#perfumeArabe #lattafa #decants), genéricos (#perfumesargentina) y locales (#caba #buenosaires). Sin hashtags genéricos basura (#love #instagood).
3. 📱 STORY: 1 frase + 1 sticker interactivo (pregunta o encuesta) coherente con perfume/vaper.
4. 💡 IDEA VISUAL: descripción concreta (fondo, iluminación, ángulo, props).
5. ⏰ HORARIO ARG: franja específica (ej: "21:00-23:00 jueves").

PROHIBIDO: promesas falsas ("atrae personas"), comparar con productos no listados, palabras como "mágico", "único e irrepetible".`;
    } else if (type === "restock_analysis") {
      systemPrompt = `Sos analista de inventario senior para retail de perfumería árabe/diseñador y vapers en Argentina. Pensás en USD (compra) y ARS (venta), considerando comisión de pasero del 15%.${baseGuardrails}`;
      userPrompt = `Analizá el inventario REAL de mi negocio (no inventes productos):

PRODUCTOS CON STOCK:
${JSON.stringify(data.products?.filter((p: any) => p.stock > 0)?.slice(0, 30) || [], null, 1)}

PRODUCTOS SIN STOCK:
${JSON.stringify(data.products?.filter((p: any) => p.stock === 0)?.slice(0, 20) || [], null, 1)}

ÚLTIMAS VENTAS:
${JSON.stringify(data.sales?.slice(0, 15) || [], null, 1)}

Dame un plan de restock concreto:
1. 🚨 URGENTE: stock ≤ 2 con ventas en los últimos 30 días. Cantidad sugerida = 2x velocidad mensual.
2. 📋 PRÓXIMO LOTE: rotación media, reponer en 2-4 semanas.
3. ❌ DESCARTAR: sin ventas en 60+ días o margen < 20%. Sugerí liquidación con descuento.
4. 💵 INVERSIÓN USD: total estimado del lote urgente + próximo, recordando sumar 15% pasero.

Citá nombres exactos de los productos y cantidades. No inventes velocidades de venta si no hay datos suficientes.`;
    } else {
      throw new Error("Invalid analysis type");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes alcanzado. Intentá de nuevo en un momento." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Agregá fondos en Configuración." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "Sin respuesta";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

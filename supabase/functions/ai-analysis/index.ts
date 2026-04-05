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

    let systemPrompt = "";
    let userPrompt = "";

    if (type === "predict_sales") {
      systemPrompt = `Sos un analista de negocios experto en retail de perfumes y vapers en Argentina. 
Analizás datos de ventas y das predicciones claras y accionables en español rioplatense.
Respondé siempre en formato estructurado con secciones claras usando emojis.`;
      userPrompt = `Analizá estos datos de ventas y productos de mi negocio de perfumes árabes y vapers:

PRODUCTOS (${data.products?.length || 0}):
${JSON.stringify(data.products?.slice(0, 30) || [], null, 1)}

VENTAS RECIENTES (${data.sales?.length || 0}):
${JSON.stringify(data.sales?.slice(0, 20) || [], null, 1)}

Dame:
1. 📈 PREDICCIÓN DE VENTAS: Qué productos se van a vender más esta semana/mes
2. 📦 RESTOCK URGENTE: Qué productos necesito reponer ya (stock bajo + alta demanda)
3. 💰 OPTIMIZACIÓN DE PRECIOS: Sugerencias para ajustar precios y maximizar ganancia
4. 🎯 PRODUCTOS ESTRELLA: Los más rentables vs los que debería dejar de comprar
5. 📊 TENDENCIAS: Patrones que detectás en las ventas`;
    } else if (type === "marketing_copy") {
      systemPrompt = `Sos un experto en marketing digital y copywriting para Instagram, especializado en perfumes y vapers.
Creás contenido viral, atractivo y enfocado en el público joven argentino (18-35 años).
Usás español rioplatense informal pero profesional. Incluí emojis relevantes.`;
      userPrompt = `Creá contenido de marketing para Instagram sobre estos productos:

${JSON.stringify(data.products || [], null, 1)}

Tipo de publicación: ${data.postType || 'post'}
Tema/enfoque: ${data.theme || 'promoción general'}

Generá:
1. 📝 CAPTION: Texto principal para el post (máx 2200 caracteres, con CTA claro)
2. #️⃣ HASHTAGS: 20-30 hashtags relevantes separados por espacios
3. 📱 HISTORIA: Texto corto para story (con encuesta/pregunta interactiva)
4. 💡 IDEA VISUAL: Descripción de la imagen/video ideal para acompañar
5. ⏰ MEJOR HORARIO: Sugerencia de horario para publicar en Argentina`;
    } else if (type === "restock_analysis") {
      systemPrompt = `Sos un analista de inventario experto en retail. Analizás datos de stock y ventas para sugerir reposiciones inteligentes. Respondé en español rioplatense.`;
      userPrompt = `Analizá el inventario de mi negocio de perfumes y vapers:

PRODUCTOS CON STOCK:
${JSON.stringify(data.products?.filter((p: any) => p.stock > 0)?.slice(0, 30) || [], null, 1)}

PRODUCTOS SIN STOCK:
${JSON.stringify(data.products?.filter((p: any) => p.stock === 0)?.slice(0, 20) || [], null, 1)}

ÚLTIMAS VENTAS:
${JSON.stringify(data.sales?.slice(0, 15) || [], null, 1)}

Dame un plan de restock con:
1. 🚨 URGENTE: Productos a reponer inmediatamente
2. 📋 PLANIFICADO: Productos a pedir en el próximo lote
3. ❌ NO REPONER: Productos que no vale la pena reponer
4. 💵 INVERSIÓN ESTIMADA: Cuánto necesito en USD para el próximo lote`;
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

// Sales prediction edge function — uses Lovable AI Gateway (no extra API key required).
// Receives historical sales and returns a 30-day projection with confidence interval and insights.
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sales } = await req.json();
    if (!Array.isArray(sales) || sales.length < 5) {
      return new Response(JSON.stringify({ error: "Necesitas al menos 5 ventas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const summary = {
      totalSales: sales.length,
      totalRevenue: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0),
      avgPerSale: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0) / sales.length,
      first: sales[0]?.date, last: sales[sales.length - 1]?.date,
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Eres un analista de ventas para un comercio de perfumes y vapers en Argentina. Responde solo con la herramienta proporcionada." },
          { role: "user", content: `Historial reciente: ${JSON.stringify(summary)}. Total ventas individuales: ${sales.length}. Estima la facturación proyectada en los próximos 30 días en pesos argentinos (ARS), nivel de confianza (% entre 50-95), tendencia general, y 3 insights breves accionables en español. Considera estacionalidad y crecimiento histórico.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_prediction",
              description: "Devolver predicción estructurada",
              parameters: {
                type: "object",
                properties: {
                  projectedRevenue: { type: "number", description: "Facturación proyectada en ARS para próximos 30 días" },
                  confidencePercent: { type: "number", description: "Confianza 50-95" },
                  trend: { type: "string", enum: ["up", "down", "stable"] },
                  insights: { type: "array", items: { type: "string" }, description: "3 insights cortos" },
                },
                required: ["projectedRevenue", "confidencePercent", "trend", "insights"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_prediction" } },
      }),
    });

    if (response.status === 429) return new Response(JSON.stringify({ error: "Límite de uso alcanzado, intenta más tarde" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (response.status === 402) return new Response(JSON.stringify({ error: "Créditos agotados — agregá fondos en Settings → Workspace → Usage" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      throw new Error("Error del gateway IA");
    }
    const data = await response.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("Sin respuesta estructurada");
    const args = JSON.parse(tc.function.arguments);
    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("predict-sales error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

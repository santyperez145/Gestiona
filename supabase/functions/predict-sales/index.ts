import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "predict-sales", { max: 10, windowMs: 60_000 })) return rateLimitResponse();

  try {
    const { sales } = await req.json();
    if (!Array.isArray(sales) || sales.length < 5) {
      return new Response(JSON.stringify({ error: "Necesitas al menos 5 ventas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary = {
      totalSales: sales.length,
      totalRevenue: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0),
      avgPerSale: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0) / sales.length,
      first: sales[0]?.date,
      last: sales[sales.length - 1]?.date,
    };

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "Eres un analista de ventas para un comercio de perfumes y vapers en Argentina. Usa siempre la herramienta proporcionada para devolver tu análisis estructurado.",
      messages: [{
        role: "user",
        content: `Historial reciente: ${JSON.stringify(summary)}. Total ventas individuales: ${sales.length}. Estima la facturación proyectada en los próximos 30 días en pesos argentinos (ARS), nivel de confianza (% entre 50-95), tendencia general, y 3 insights breves accionables en español. Considera estacionalidad y crecimiento histórico.`,
      }],
      tools: [{
        name: "submit_prediction",
        description: "Devolver predicción estructurada",
        input_schema: {
          type: "object",
          properties: {
            projectedRevenue: { type: "number", description: "Facturación proyectada en ARS para próximos 30 días" },
            confidencePercent: { type: "number", description: "Confianza 50-95" },
            trend: { type: "string", enum: ["up", "down", "stable"] },
            insights: { type: "array", items: { type: "string" }, description: "3 insights cortos" },
          },
          required: ["projectedRevenue", "confidencePercent", "trend", "insights"],
        },
      }],
      tool_choice: { type: "tool", name: "submit_prediction" },
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Sin respuesta estructurada");

    return new Response(JSON.stringify(toolUse.input), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-sales error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

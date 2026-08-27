import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio } from "../_shared/entitlements.ts";
import { leerPerfilDelComercio, personaDe } from "../_shared/perfilDelComercio.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SaleInput = { date?: string; total?: number; product?: string };

type Prediction = {
  projectedRevenue: number;
  confidencePercent: number;
  trend: "up" | "down" | "stable";
  insights: string[];
  source: "ai" | "statistical";
  notice?: string;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Keeps the dashboard useful when the optional Anthropic secret is absent or unavailable. */
function buildStatisticalPrediction(sales: SaleInput[], notice: string): Prediction {
  const normalized = sales
    .map((sale) => ({
      date: sale.date ? new Date(sale.date).getTime() : Number.NaN,
      total: Number(sale.total ?? 0),
    }))
    .filter((sale) => Number.isFinite(sale.date) && Number.isFinite(sale.total) && sale.total >= 0)
    .sort((a, b) => a.date - b.date);

  const totalRevenue = normalized.reduce((sum, sale) => sum + sale.total, 0);
  const firstDate = normalized[0]?.date ?? Date.now();
  const lastDate = normalized[normalized.length - 1]?.date ?? firstDate;
  const spanDays = Math.max(1, Math.ceil((lastDate - firstDate) / 86_400_000) + 1);
  const averageDailyRevenue = totalRevenue / Math.min(90, spanDays);
  const midpoint = Math.max(1, Math.floor(normalized.length / 2));
  const firstHalfRevenue = normalized.slice(0, midpoint).reduce((sum, sale) => sum + sale.total, 0);
  const secondHalfRevenue = normalized.slice(midpoint).reduce((sum, sale) => sum + sale.total, 0);
  const trendRatio = firstHalfRevenue > 0 ? secondHalfRevenue / firstHalfRevenue : secondHalfRevenue > 0 ? 1.15 : 1;
  const trend = trendRatio > 1.08 ? "up" : trendRatio < 0.92 ? "down" : "stable";
  const trendFactor = Math.min(1.2, Math.max(0.8, 1 + (trendRatio - 1) * 0.25));
  const projectedRevenue = Math.max(0, Math.round(averageDailyRevenue * 30 * trendFactor));
  const confidencePercent = Math.min(88, Math.max(55, 55 + Math.min(20, normalized.length) + Math.min(13, Math.floor(spanDays / 10))));
  const averageTicket = normalized.length ? totalRevenue / normalized.length : 0;

  return {
    projectedRevenue,
    confidencePercent,
    trend,
    source: "statistical",
    notice,
    insights: [
      `Promedio reciente: ${Math.round(averageDailyRevenue).toLocaleString("es-AR")} ARS por día.`,
      `Ticket promedio observado: ${Math.round(averageTicket).toLocaleString("es-AR")} ARS en ${normalized.length} ventas.`,
      trend === "up"
        ? "La segunda mitad del período supera a la primera: revisá stock de los productos más vendidos."
        : trend === "down"
          ? "La segunda mitad del período pierde ritmo: conviene activar seguimiento de clientes y promociones."
          : "El ritmo se mantiene estable: priorizá disponibilidad y margen de los productos principales.",
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "predict-sales", { max: 10, windowMs: 60_000 })) return rateLimitResponse();

  // El rate limit acota el daño pero no impide el abuso: la clave anónima es un
  // JWT válido y pública, así que sin usuario real cualquiera puede gastar
  // crédito de Anthropic hasta el tope, una y otra vez.
  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const { sales, orgId } = await req.json();
    if (!Array.isArray(sales) || sales.length < 5) {
      return response({ error: "Necesitas al menos 5 ventas" }, 400);
    }

    // El plan cubre la IA, o acá se corta. Ser un usuario real no es tener el
    // beneficio: cada llamada quema crédito de Anthropic.
    const sinPlan = await exigirBeneficio(req, orgId, "ia", corsHeaders);
    if (sinPlan) return sinPlan;

    const summary = {
      totalSales: sales.length,
      totalRevenue: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0),
      avgPerSale: sales.reduce((a: number, b: any) => a + Number(b.total || 0), 0) / sales.length,
      first: sales[0]?.date,
      last: sales[sales.length - 1]?.date,
    };
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return response(buildStatisticalPrediction(
        sales,
        "IA no configurada: se muestra una estimación estadística basada en tus ventas.",
      ));
    }

    // El rubro sale de `settings.industry_code`, no del prompt. Va acá y no
    // antes: si falta la API key la función devuelve la estimación
    // estadística y no hace falta ni esta consulta.
    const perfil = await leerPerfilDelComercio(req, orgId);

    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: `${personaDe("un analista de ventas", perfil)} Usá siempre la herramienta proporcionada para devolver tu análisis estructurado.`,
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

      return response({ ...(toolUse.input as Omit<Prediction, "source">), source: "ai" });
    } catch (error) {
      console.error("predict-sales provider fallback", error instanceof Error ? error.message : "unknown error");
      return response(buildStatisticalPrediction(
        sales,
        "La IA no respondió: se muestra una estimación estadística basada en tus ventas.",
      ));
    }
  } catch (e) {
    console.error("predict-sales error", e);
    return response({ error: e instanceof Error ? e.message : "No se pudo generar la predicción" }, 500);
  }
});

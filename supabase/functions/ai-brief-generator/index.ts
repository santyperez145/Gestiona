/**
 * AI Brief Generator — briefs de campaña estructurados con Anthropic.
 *
 * POST body: { orgId, productName, objective, budgetARS, channel, influencerTier }
 *
 * Nota de innovación (README): transforma datos declarados por el comercio en un
 * brief accionable y validado: creatividad, KPIs, asignación presupuestaria y
 * perfiles de creadores por tier. `suggestedCreators` contiene arquetipos y
 * recomendaciones, no identidades inventadas; CPM y alcance son estimaciones de
 * planificación generadas para los datos de entrada, no resultados garantizados.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { requireUser } from "../_shared/requireUser.ts";
import { exigirBeneficio, registrarConsumoIA } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CampaignBriefRequest {
  orgId?: unknown;
  productName?: unknown;
  objective?: unknown;
  budgetARS?: unknown;
  channel?: unknown;
  influencerTier?: unknown;
}

interface KpiTarget {
  metric: string;
  target: string;
  timeframe: string;
}

interface BudgetAllocation {
  category: string;
  amountARS: number;
  percentage: number;
  rationale: string;
}

interface SuggestedCreator {
  tier: string;
  creatorProfile: string;
  recommendedCount: number;
  audienceFit: string;
  rationale: string;
}

interface CampaignBrief {
  campaignTitle: string;
  targetAudience: string;
  scriptHook: string;
  cta: string;
  kpiTargets: KpiTarget[];
  budgetAllocation: BudgetAllocation[];
}

interface AnthropicBriefOutput {
  brief: CampaignBrief;
  suggestedCreators: SuggestedCreator[];
  estimatedCPM: number;
  estimatedReach: number;
}

const campaignBriefTool = {
  name: "emit_campaign_brief",
  description: "Brief estructurado de campaña basado únicamente en los datos declarados",
  input_schema: {
    type: "object",
    properties: {
      brief: {
        type: "object",
        properties: {
          campaignTitle: { type: "string" },
          targetAudience: { type: "string" },
          scriptHook: { type: "string" },
          cta: { type: "string" },
          kpiTargets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metric: { type: "string" },
                target: { type: "string" },
                timeframe: { type: "string" },
              },
              required: ["metric", "target", "timeframe"],
            },
          },
          budgetAllocation: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                amountARS: { type: "number" },
                percentage: { type: "number" },
                rationale: { type: "string" },
              },
              required: ["category", "amountARS", "percentage", "rationale"],
            },
          },
        },
        required: [
          "campaignTitle",
          "targetAudience",
          "scriptHook",
          "cta",
          "kpiTargets",
          "budgetAllocation",
        ],
      },
      suggestedCreators: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tier: { type: "string" },
            creatorProfile: { type: "string" },
            recommendedCount: { type: "number" },
            audienceFit: { type: "string" },
            rationale: { type: "string" },
          },
          required: [
            "tier",
            "creatorProfile",
            "recommendedCount",
            "audienceFit",
            "rationale",
          ],
        },
      },
      estimatedCPM: { type: "number" },
      estimatedReach: { type: "number" },
    },
    required: ["brief", "suggestedCreators", "estimatedCPM", "estimatedReach"],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseOutput(value: unknown, budgetARS: number): AnthropicBriefOutput | null {
  if (!isRecord(value)) return null;

  const rawBrief = value.brief;
  const rawCreators = value.suggestedCreators;
  if (!isRecord(rawBrief) || !Array.isArray(rawCreators)) return null;

  const campaignTitle = requiredString(rawBrief.campaignTitle, "campaignTitle");
  const targetAudience = requiredString(rawBrief.targetAudience, "targetAudience");
  const scriptHook = requiredString(rawBrief.scriptHook, "scriptHook");
  const cta = requiredString(rawBrief.cta, "cta");

  if (![campaignTitle, targetAudience, scriptHook, cta].every(Boolean)) return null;

  const kpiTargets: KpiTarget[] = [];
  if (!Array.isArray(rawBrief.kpiTargets)) return null;
  for (const rawKpi of rawBrief.kpiTargets) {
    if (!isRecord(rawKpi)) return null;
    const metric = requiredString(rawKpi.metric, "metric");
    const target = requiredString(rawKpi.target, "target");
    const timeframe = requiredString(rawKpi.timeframe, "timeframe");
    if (!metric || !target || !timeframe) return null;
    kpiTargets.push({ metric, target, timeframe });
  }
  if (kpiTargets.length === 0) return null;

  const budgetAllocation: BudgetAllocation[] = [];
  if (!Array.isArray(rawBrief.budgetAllocation)) return null;
  for (const rawAllocation of rawBrief.budgetAllocation) {
    if (!isRecord(rawAllocation)) return null;
    const category = requiredString(rawAllocation.category, "category");
    const rationale = requiredString(rawAllocation.rationale, "rationale");
    const amountARS = Number(rawAllocation.amountARS);
    const percentage = Number(rawAllocation.percentage);
    if (
      !category || !rationale || !Number.isFinite(amountARS) || amountARS < 0 ||
      !Number.isFinite(percentage) || percentage < 0 || percentage > 100
    ) return null;
    budgetAllocation.push({ category, amountARS, percentage, rationale });
  }

  const allocatedAmount = budgetAllocation.reduce((sum, item) => sum + item.amountARS, 0);
  const allocatedPercentage = budgetAllocation.reduce((sum, item) => sum + item.percentage, 0);
  if (
    budgetAllocation.length === 0 ||
    Math.abs(allocatedAmount - budgetARS) > Math.max(1, budgetARS * 0.01) ||
    Math.abs(allocatedPercentage - 100) > 0.5
  ) return null;

  const suggestedCreators: SuggestedCreator[] = [];
  for (const rawCreator of rawCreators) {
    if (!isRecord(rawCreator)) return null;
    const tier = requiredString(rawCreator.tier, "tier");
    const creatorProfile = requiredString(rawCreator.creatorProfile, "creatorProfile");
    const audienceFit = requiredString(rawCreator.audienceFit, "audienceFit");
    const rationale = requiredString(rawCreator.rationale, "rationale");
    const recommendedCount = Number(rawCreator.recommendedCount);
    if (
      !tier || !creatorProfile || !audienceFit || !rationale ||
      !Number.isFinite(recommendedCount) || recommendedCount <= 0
    ) return null;
    suggestedCreators.push({
      tier,
      creatorProfile,
      recommendedCount,
      audienceFit,
      rationale,
    });
  }
  if (suggestedCreators.length === 0) return null;

  const estimatedCPM = Number(value.estimatedCPM);
  const estimatedReach = Number(value.estimatedReach);
  if (
    !Number.isFinite(estimatedCPM) || estimatedCPM <= 0 ||
    !Number.isFinite(estimatedReach) || estimatedReach <= 0
  ) return null;

  return {
    brief: {
      campaignTitle,
      targetAudience,
      scriptHook,
      cta,
      kpiTargets,
      budgetAllocation,
    },
    suggestedCreators,
    estimatedCPM,
    estimatedReach,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  let body: CampaignBriefRequest;
  try {
    body = await req.json() as CampaignBriefRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: "Request body must be an object" }, 400);
  }
  if (["prompt", "systemPrompt", "instructions"].some(key => key in body)) {
    return jsonResponse({ error: "Enviá sólo los datos de la campaña" }, 400);
  }

  const orgId = requiredString(body.orgId, "orgId");
  const productName = requiredString(body.productName, "productName");
  const objective = requiredString(body.objective, "objective");
  const channel = requiredString(body.channel, "channel");
  const influencerTier = requiredString(body.influencerTier, "influencerTier");
  const budgetARS = Number(body.budgetARS);

  if (
    !orgId || !productName || !objective || !channel || !influencerTier ||
    !Number.isFinite(budgetARS) || budgetARS <= 0 || productName.length > 300 ||
    objective.length > 2000 || channel.length > 80 || influencerTier.length > 80
  ) {
    return jsonResponse({
      error: "orgId, productName, objective, budgetARS, channel and influencerTier are required",
    }, 400);
  }

  const sinPlan = await exigirBeneficio(req, orgId, "ia", corsHeaders);
  if (sinPlan) return sinPlan;
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    return jsonResponse({ error: "La generación de campañas no está disponible. Intentá más tarde." }, 503);
  }
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const systemPrompt = `Sos un estratega de marketing senior para comercios en Argentina.
Generá un brief accionable usando EXCLUSIVAMENTE los datos declarados en el request.

REGLAS:
- No inventes nombres de creadores, handles, audiencias históricas ni resultados comprobados.
- suggestedCreators son arquetipos de creadores por tier, no personas reales o ficticias.
- estimatedCPM y estimatedReach son estimaciones de planificación, no garantías.
- No asignes más del presupuesto informado y no afirmes benchmarks externos sin fuente.`;

  const userPrompt = `Generá el brief para esta campaña:
- orgId: ${orgId}
- Producto: ${productName}
- Objetivo: ${objective}
- Presupuesto: $${budgetARS.toLocaleString("es-AR")} ARS
- Canal: ${channel}
- Tier de influencer: ${influencerTier}

Incluí título, audiencia, hook, CTA, KPIs SMART, asignación presupuestaria que sume exactamente el presupuesto, perfiles de creadores por tier, CPM estimado en ARS y alcance estimado.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1800,
      temperature: 0.4,
      tools: [campaignBriefTool] as any,
      tool_choice: { type: "tool", name: "emit_campaign_brief" } as any,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    await registrarConsumoIA({
      orgId, userId: auth.user.id, model: message.model,
      input: message.usage?.input_tokens, output: message.usage?.output_tokens,
    });
    const toolBlock = message.content.find(
      (block) => block.type === "tool_use",
    );
    if (toolBlock?.type !== "tool_use" || toolBlock.name !== "emit_campaign_brief") {
      throw new Error("Anthropic did not return the campaign brief tool");
    }

    const output = parseOutput(toolBlock.input, budgetARS);
    if (!output) {
      throw new Error("Anthropic returned an invalid campaign brief");
    }

    return jsonResponse(output);
  } catch (error) {
    console.error("ai-brief-generator Anthropic error:", error);
    return jsonResponse({ error: "No pudimos generar la campaña. Intentá de nuevo." }, 502);
  }
});

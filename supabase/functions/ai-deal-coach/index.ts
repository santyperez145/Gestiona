/**
 * ai-deal-coach — Per-deal next-best-action advisor.
 *
 * POST body: { deal_id: string }
 *
 * Pulls:
 *   - The deal (stage, value, age, customer, assigned seller, win_loss_reason)
 *   - Recent activities (last 20 from deal_activities)
 *   - Org win-rate history from deal_outcomes (last 180 days)
 *   - Customer's prior deal outcomes (if linked by name)
 *   - Top loss reasons in the org
 *
 * Returns structured JSON:
 *   {
 *     win_probability: number,        // 0–100
 *     urgency: "hot" | "warm" | "cold",
 *     next_action: { action, why, when, owner_role },
 *     talking_points: string[],       // 3–5 key things to say
 *     risk_factors:   string[],       // 2–4 risks to mitigate
 *     similar_wins:   { count, avg_days, dominant_reason } | null,
 *     coach_note:     string          // free-form 1–2 sentence summary in es-AR
 *   }
 *
 * Uses Anthropic Claude Haiku 4.5 with ephemeral cache on the system prompt.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio, registrarConsumoIA } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM_PROMPT = `Sos un Sales Coach senior con 15 años de experiencia en B2B y retail en Argentina.

REGLAS NO NEGOCIABLES:
- Respondés EXCLUSIVAMENTE en español rioplatense, directo y profesional, sin clichés.
- Tu output es SIEMPRE un único objeto JSON válido — sin texto antes ni después, sin markdown, sin code fences.
- NO inventes datos. Si la información es insuficiente, marcalo en risk_factors y dejá win_probability moderado.
- Las recomendaciones deben ser ESPECÍFICAS y EJECUTABLES esta semana — nunca consejos genéricos tipo "hacé seguimiento".
- Usá los datos reales provistos (nombres, valores, días).
- Win probability calibrada: deals en "lead" raramente >40%, "negociación" rara vez <40% si están vivos.

ESQUEMA DE OUTPUT (JSON):
{
  "win_probability": number,                // 0-100
  "urgency": "hot" | "warm" | "cold",
  "next_action": {
    "action": string,                       // 1 imperativa, <80 chars, ej. "Llamar al decisor financiero y pedir signoff sobre la propuesta del 12/05"
    "why":    string,                       // 1 oración explicando POR QUÉ ahora
    "when":   string,                       // "hoy" | "esta semana" | "<fecha específica>"
    "owner_role": "vendedor" | "admin"      // quién debe hacerlo
  },
  "talking_points": string[],               // 3-5 bullets — cosas concretas para mencionar/preguntar
  "risk_factors":   string[],               // 2-4 riesgos específicos para mitigar
  "similar_wins":   null | {
    "count": number,
    "avg_days": number,
    "dominant_reason": string               // "Precio competitivo" | etc
  },
  "coach_note": string                      // 1-2 oraciones — resumen ejecutivo del estado del deal
}`;

interface Deal {
  id: string;
  title: string;
  stage: string;
  amount?: number;
  value_ars?: number;
  customer_name: string | null;
  customer_id: string | null;
  assigned_name: string | null;
  win_loss_reason: string | null;
  notes: string | null;
  expected_close: string | null;
  created_at: string;
  updated_at: string;
}

interface DealOutcome {
  outcome: "won" | "lost";
  reason: string | null;
  deal_value: number;
  customer_name: string | null;
  stage_at_close: string | null;
  days_in_pipeline: number | null;
  closed_at: string;
}

interface Activity {
  type: string;
  content: string;
  created_at: string;
}

interface CoachContext {
  deal: Deal;
  daysSinceCreated: number;
  daysSinceUpdated: number;
  activities: Activity[];
  orgStats: {
    totalClosed: number;
    winRatePct: number;
    avgWinDays: number | null;
    topLossReasons: string[];
  };
  customerHistory: { wins: number; losses: number; avgDaysWon: number | null } | null;
  similarWins: { count: number; avgDays: number; dominantReason: string } | null;
}

// El SDK se importa desde esm.sh y cambia sus genéricos entre versiones. Este
// copiloto sólo necesita iniciar consultas por relación; tipar ese límite evita
// acoplar la lógica de negocio a un schema generado que no se distribuye a Deno.
type ContextClient = {
  // deno-lint-ignore no-explicit-any
  from: (relation: string) => any;
};

function dayDiff(from: string): number {
  return Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000);
}

async function buildContext(sb: ContextClient, dealId: string): Promise<CoachContext> {
  // 1. Deal
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .maybeSingle();
  if (dealErr || !deal) throw new Error("Deal no encontrado");
  const d = deal as unknown as Deal;

  // 2. Activities (last 20)
  const { data: acts } = await sb
    .from("deal_activities")
    .select("type, content, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(20);

  // 3. Org-wide outcome stats (last 180 days)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);
  // deal can have either org_id field — use the deal's value
  const orgId = (d as { org_id?: string }).org_id;
  const { data: outcomes } = await sb
    .from("deal_outcomes")
    .select("outcome, reason, deal_value, customer_name, stage_at_close, days_in_pipeline, closed_at")
    .eq("org_id", orgId ?? "")
    .gte("closed_at", sixMonthsAgo.toISOString());

  const outcomesList = (outcomes ?? []) as DealOutcome[];
  const won = outcomesList.filter(o => o.outcome === "won");
  const lost = outcomesList.filter(o => o.outcome === "lost");
  const total = outcomesList.length;
  const winRatePct = total > 0 ? Math.round((won.length / total) * 100) : 0;

  const winDays = won.filter(o => o.days_in_pipeline != null).map(o => o.days_in_pipeline as number);
  const avgWinDays = winDays.length > 0
    ? Math.round(winDays.reduce((s, n) => s + n, 0) / winDays.length)
    : null;

  // Top loss reasons
  const reasonCount: Record<string, number> = {};
  lost.forEach(o => {
    const r = o.reason || "Sin registrar";
    reasonCount[r] = (reasonCount[r] || 0) + 1;
  });
  const topLossReasons = Object.entries(reasonCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  // 4. Customer-specific history (match by name)
  let customerHistory: CoachContext["customerHistory"] = null;
  let similarWins: CoachContext["similarWins"] = null;
  if (d.customer_name) {
    const custKey = d.customer_name.trim().toLowerCase();
    const custOutcomes = outcomesList.filter(o =>
      (o.customer_name ?? "").trim().toLowerCase() === custKey
    );
    if (custOutcomes.length > 0) {
      const cwons = custOutcomes.filter(o => o.outcome === "won");
      const closs = custOutcomes.filter(o => o.outcome === "lost");
      const cwDays = cwons.filter(o => o.days_in_pipeline != null).map(o => o.days_in_pipeline as number);
      customerHistory = {
        wins: cwons.length,
        losses: closs.length,
        avgDaysWon: cwDays.length > 0 ? Math.round(cwDays.reduce((s, n) => s + n, 0) / cwDays.length) : null,
      };
    }
  }

  // 5. Similar wins (deals in same value bucket that won)
  const dealValue = (d.value_ars ?? d.amount ?? 0) as number;
  if (dealValue > 0 && won.length >= 3) {
    const sameRange = won.filter(o =>
      o.deal_value >= dealValue * 0.5 && o.deal_value <= dealValue * 2,
    );
    if (sameRange.length >= 3) {
      const days = sameRange.filter(o => o.days_in_pipeline != null).map(o => o.days_in_pipeline as number);
      const avgDays = days.length > 0 ? Math.round(days.reduce((s, n) => s + n, 0) / days.length) : 0;
      const reasonMap: Record<string, number> = {};
      sameRange.forEach(o => {
        const r = o.reason || "Sin registrar";
        reasonMap[r] = (reasonMap[r] || 0) + 1;
      });
      const dominant = Object.entries(reasonMap).sort((a, b) => b[1] - a[1])[0]?.[0] || "Sin registrar";
      similarWins = { count: sameRange.length, avgDays, dominantReason: dominant };
    }
  }

  return {
    deal: d,
    daysSinceCreated: dayDiff(d.created_at),
    daysSinceUpdated: dayDiff(d.updated_at),
    activities: (acts ?? []) as Activity[],
    orgStats: { totalClosed: total, winRatePct, avgWinDays, topLossReasons },
    customerHistory,
    similarWins,
  };
}

function buildUserPrompt(ctx: CoachContext): string {
  const { deal, daysSinceCreated, daysSinceUpdated, activities, orgStats, customerHistory, similarWins } = ctx;
  const value = deal.value_ars ?? deal.amount ?? 0;

  return `Analizá este deal y devolvé el JSON exacto del esquema.

═══ DEAL ═══
Título:           ${deal.title}
Cliente:          ${deal.customer_name ?? "—"}
Etapa actual:     ${deal.stage}
Valor:            $${value.toLocaleString("es-AR")} ARS
Vendedor:         ${deal.assigned_name ?? "Sin asignar"}
Días en pipeline: ${daysSinceCreated}
Días sin tocar:   ${daysSinceUpdated}
Cierre esperado:  ${deal.expected_close ?? "no definido"}
Notas:            ${deal.notes ? deal.notes.slice(0, 300) : "(ninguna)"}
${deal.win_loss_reason ? `Razón W/L previa: ${deal.win_loss_reason}` : ""}

═══ ÚLTIMAS ACTIVIDADES (max 20) ═══
${activities.length === 0 ? "Sin actividades registradas." :
  activities.slice(0, 12).map(a => `[${new Date(a.created_at).toLocaleDateString("es-AR")}] ${a.type}: ${a.content.slice(0, 140)}`).join("\n")}

═══ CONTEXTO DE LA ORG (últimos 180 días) ═══
Deals cerrados:     ${orgStats.totalClosed}
Win-rate global:    ${orgStats.winRatePct}%
Días promedio ganar: ${orgStats.avgWinDays ?? "n/d"}
Razones de pérdida más frecuentes: ${orgStats.topLossReasons.length > 0 ? orgStats.topLossReasons.join(", ") : "(sin datos)"}

═══ HISTORIAL DEL CLIENTE ═══
${customerHistory
    ? `${customerHistory.wins} ganados / ${customerHistory.losses} perdidos${customerHistory.avgDaysWon != null ? ` · cierre promedio ${customerHistory.avgDaysWon} días` : ""}`
    : "Cliente sin historial registrado."}

═══ DEALS SIMILARES GANADOS ═══
${similarWins
    ? `${similarWins.count} deals ganados en rango de valor parecido. Cierre promedio: ${similarWins.avgDays} días. Razón dominante: "${similarWins.dominantReason}".`
    : "No hay deals similares ganados suficientes para comparar."}

═══════════════════════════════════════
Devolvé ÚNICAMENTE el JSON. No agregues explicaciones.`;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  // Strip code fences if model added them despite instructions
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "ai-deal-coach", { max: 30, windowMs: 60_000 })) return rateLimitResponse();

  // JWT auth
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
    const { deal_id } = await req.json();
    if (!deal_id || typeof deal_id !== "string") {
      throw new Error("deal_id requerido");
    }

    // El plan cubre la IA, o acá se corta.
    //
    // ⚠️ La organización sale del deal, no del cuerpo del request: dejar que el
    // cliente mande un `org_id` junto al deal de otra organización sería
    // dejarlo elegir con qué plan se paga el análisis. La lectura va con el
    // cliente del usuario, así que la RLS ya filtra los deals ajenos.
    const { data: dealOrg } = await sb
      .from("deals").select("org_id").eq("id", deal_id).maybeSingle();
    const sinPlan = await exigirBeneficio(req, dealOrg?.org_id, "ia", corsHeaders);
    if (sinPlan) return sinPlan;

    // ⚠️ La configuración se chequea DESPUÉS del plan. Al revés, un comercio
    // sin IA recibía el nombre de un secreto —algo que no puede arreglar— en
    // lugar de lo único accionable para él. Encontrado en producción el
    // 2026-08-27 en `ai-analysis`, y estaba igual acá.
    //
    // 📌 Y el nombre del secreto no sale a pantalla: al log sí.
    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      console.error("ANTHROPIC_API_KEY no está configurada en el entorno");
      throw new Error("El copiloto no está disponible en este momento. Probá más tarde.");
    }

    const context = await buildContext(sb, deal_id);
    const userPrompt = buildUserPrompt(context);

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // @ts-ignore: cache_control supported at runtime
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    // El consumo se registra recién acá: Claude ya contestó. Registrar antes
    // le gastaría al comercio una acción que falló.
    await registrarConsumoIA({
      // La misma organización que pagó el gate, no la del cuerpo del request.
      orgId: dealOrg?.org_id, userId: userRes.user.id, model: response.model,
      input: response.usage?.input_tokens, output: response.usage?.output_tokens,
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = tryParseJson(raw);

    if (!parsed) {
      // Fallback: wrap raw text in a minimal coach_note shape so UI doesn't break
      return new Response(JSON.stringify({
        win_probability: 50,
        urgency: "warm",
        next_action: {
          action: "Revisar el deal manualmente — el coach no pudo estructurar la recomendación",
          why: "Respuesta del modelo no era JSON válido",
          when: "hoy",
          owner_role: "admin",
        },
        talking_points: [],
        risk_factors: ["Respuesta del coach no estructurada — revisá los datos del deal"],
        similar_wins: null,
        coach_note: raw.slice(0, 280) || "Sin respuesta del coach.",
        _parse_error: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-deal-coach error:", e);
    const msg = e instanceof Error ? e.message : "Error desconocido";
    const status = msg.includes("rate") ? 429
                  : msg.includes("credit") ? 402
                  : msg.includes("encontrado") ? 404
                  : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

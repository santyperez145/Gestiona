/**
 * Auto-categorización de gastos con IA (Anthropic).
 * Acepta descripción, monto y tipo; devuelve categoría + confidence_score.
 * Usa `ANTHROPIC_API_KEY`; protegido con `requireUser` y `exigirBeneficio("ia")`.
 * Guarda la categoría en `expenses` cuando se envía `expense_id`.
 * Errores en español rioplatense (ej: "Error clasificando gasto").
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { exigirBeneficio } from "../_shared/entitlements.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;
  const user = auth.user;

  const orgId = req.headers.get("x-org-id") ?? "";
  const sinPlan = await exigirBeneficio(req, orgId, "ia", corsHeaders);
  if (sinPlan) return sinPlan;

  let body: any;
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return new Response(JSON.stringify({ error: "Cuerpo JSON inválido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { description, amount, type, expense_id } = body;
  if (!description || !amount || !type) {
    return new Response(JSON.stringify({ error: "Faltan descripción, monto o tipo" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Servicio de IA no disponible" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt =
    "Eres un clasificador de gastos para comerciantes latinoamericanos. " +
    "Tus categorías son: alquiler, servicios, personal, marketing, mantenimiento, fletes, impuestos, bancarios, insumos, otros. " +
    "Responde SOLO con JSON válido: {\"categoria\": \"<categoría>\", \"confidence_score\": <0-1>}. " +
    "No añadas texto extra.";

  const userPrompt =
    `Clasifica el gasto:\nDescripción: "${description}"\nMonto: $${Number(amount).toFixed(2)} (${type})\nDevuelve categoría y confidence_score.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0,
      system: [{ type: "text", text: systemPrompt }],
      messages: [{ role: "user", content: userPrompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return new Response(JSON.stringify({ error: "Respuesta inesperada del servicio de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { categoria: string; confidence_score: number };
    try {
      parsed = JSON.parse(content.text);
    } catch {
      const lines = content.text.split("\n");
      let cat = "otros";
      let conf = 0.3;
      for (const line of lines) {
        const lower = line.toLowerCase().trim();
        if (lower.includes("categoria")) cat = lower.split(/[:，,]/)[1]?.replace(/"/g, "").trim() ?? "otros";
        if (lower.includes("confidence_score") || lower.includes("confidence")) {
          const n = parseFloat(lower.split(/[:，,]/)[1]);
          if (!Number.isNaN(n)) conf = n;
        }
      }
      parsed = { categoria: cat, confidence_score: Math.max(0, Math.min(1, conf)) };
    }

    parsed.confidence_score = Math.round(parsed.confidence_score * 100) / 100;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (expense_id) {
      const { error: updErr } = await supabase
        .from("expenses")
        .update({ category: parsed.categoria, updated_at: new Date().toISOString() })
        .eq("id", expense_id);
      if (updErr) console.error("finance-auto-categorize update:", updErr);
    }

    return new Response(
      JSON.stringify({ categoria: parsed.categoria, confidence_score: parsed.confidence_score }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("finance-auto-categorize error:", e.message);
    return new Response(JSON.stringify({ error: e.message || "Error clasificando gasto" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
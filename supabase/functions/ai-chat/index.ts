// Edge function: ai-chat
// Conversational AI assistant that answers questions about the user's business data.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM_PROMPT = `Sos el asistente de negocios de Gestiona, un ERP para comercios en Argentina.
Tu especialidad es responder preguntas sobre los datos reales del negocio del usuario: ventas, stock, ganancias, clientes, gastos y tendencias.

REGLAS:
- Respondé siempre en español rioplatense, directo y profesional.
- Usá EXCLUSIVAMENTE los datos del contexto del negocio que te proveen. No inventes datos.
- Si el usuario pregunta algo que no está en los datos disponibles, decilo claramente.
- Sé conciso: máximo 3-4 párrafos o una lista de bullets. Sin relleno.
- Incluí números concretos cuando sea posible (ARS, USD, unidades, porcentajes).
- Si la pregunta es ambigua, respondé lo más útil que puedas con los datos disponibles.
- Para análisis de tendencias, usá los últimos 30 días de ventas.
- Emojis solo para secciones, no en exceso.
- Si no hay datos suficientes para responder, decí "No tengo suficientes datos para responder esto todavía — seguí registrando ventas y volvé a consultar en unos días."`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "ai-chat", { max: 30, windowMs: 60_000 })) return rateLimitResponse();

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await sb.auth.getUser();
    if (!userRes?.user?.id) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const { message, history, orgId } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "Mensaje requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load business context from Supabase using service role
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [
      { data: products },
      { data: sales },
      { data: debts },
      { data: expenses },
      { data: settings },
    ] = await Promise.all([
      admin.from("products").select("name, category, stock, sale_price_ars, total_cost_usd, profit_per_unit_ars").eq("org_id", orgId).limit(50),
      admin.from("sales").select("product_name, total_ars, profit_ars, quantity, date, customer_name, payment_method").eq("org_id", orgId).order("date", { ascending: false }).limit(100),
      admin.from("debts").select("customer_name, remaining_ars, due_date, status").eq("org_id", orgId).eq("status", "pending").limit(20),
      admin.from("expenses").select("description, amount_ars, category, date").eq("org_id", orgId).order("date", { ascending: false }).limit(30),
      admin.from("settings").select("exchange_rate, business_name, tax_enabled").eq("org_id", orgId).maybeSingle(),
    ]);

    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const recentSales = (sales || []).filter((s: any) => s.date >= thirtyDaysAgo);
    const totalSalesARS = recentSales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const totalProfitARS = recentSales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const margin = totalSalesARS > 0 ? ((totalProfitARS / totalSalesARS) * 100).toFixed(1) : "0";

    const lowStock = (products || []).filter((p: any) => Number(p.stock) <= 3);
    const outOfStock = (products || []).filter((p: any) => Number(p.stock) <= 0);
    const totalDebt = (debts || []).reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
    const totalExpenses = (expenses || []).filter((e: any) => e.date >= thirtyDaysAgo).reduce((s: number, e: any) => s + Number(e.amount_ars), 0);

    const businessContext = `
CONTEXTO DEL NEGOCIO — ${(settings as any)?.business_name || "Tu negocio"} (últimos 30 días):

VENTAS (${recentSales.length} operaciones):
- Total facturado: $${Math.round(totalSalesARS).toLocaleString("es-AR")} ARS
- Ganancia bruta: $${Math.round(totalProfitARS).toLocaleString("es-AR")} ARS (margen ${margin}%)
- TC actual: $${(settings as any)?.exchange_rate || "N/A"}

PRODUCTOS (top por ventas recientes):
${recentSales.slice(0, 10).map((s: any) => `• ${s.product_name}: ${s.quantity} u. / $${Math.round(Number(s.total_ars)).toLocaleString("es-AR")}`).join("\n")}

STOCK (${(products || []).length} productos):
- Con stock bajo (≤3 u.): ${lowStock.length} productos
- Sin stock: ${outOfStock.length} productos
${lowStock.slice(0, 5).map((p: any) => `• ${p.name}: ${p.stock} u.`).join("\n")}

DEUDAS DE CLIENTES: $${Math.round(totalDebt).toLocaleString("es-AR")} ARS pendientes (${(debts || []).length} clientes)

GASTOS DEL MES: $${Math.round(totalExpenses).toLocaleString("es-AR")} ARS

TOP CLIENTES (mes):
${(() => {
  const custMap: Record<string, number> = {};
  recentSales.forEach((s: any) => {
    if (s.customer_name) custMap[s.customer_name] = (custMap[s.customer_name] || 0) + Number(s.total_ars);
  });
  return Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => `• ${name}: $${Math.round(total).toLocaleString("es-AR")}`).join("\n");
})()}
`;

    // Build message history for Claude
    const messages: Anthropic.MessageParam[] = [
      ...((history || []) as Array<{ role: "user" | "assistant"; content: string }>).slice(-10).map((h) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: "user",
        content: `${businessContext}\n\nPREGUNTA DEL USUARIO: ${message}`,
      },
    ];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = (response.content[0] as any).text || "";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e.message || "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

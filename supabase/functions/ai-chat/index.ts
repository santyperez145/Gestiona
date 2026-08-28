/**
 * ai-chat — Conversational AI assistant with streaming support (SSE).
 *
 * Returns text/event-stream so the client can display tokens as they arrive.
 * Events:
 *   data: {"delta":"text"}\n\n  — a chunk of text
 *   data: {"usage":{...}}    token counts REALES de la API, antes de [DONE]
 *   data: [DONE]\n\n           — stream finished
 *   data: {"error":"..."}\n\n  — fatal error
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio, registrarConsumoIA } from "../_shared/entitlements.ts";

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

Deno.serve(async (req) => {
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

    const { message, history, orgId, model } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "Mensaje requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify membership
    const { data: membership } = await sb.from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin acceso a esta organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // El plan cubre la IA, o acá se corta. Ser miembro no es tener el
    // beneficio: cada respuesta quema crédito de Anthropic.
    const sinPlan = await exigirBeneficio(req, orgId, "ia", corsHeaders);
    if (sinPlan) return sinPlan;

    // Load business context
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

    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth();
    const prevMonthStart = new Date(curY, curM - 1, 1).toISOString().slice(0, 10);
    const prevMonthEnd = new Date(curY, curM, 0).toISOString().slice(0, 10);
    const thisMonthStart = new Date(curY, curM, 1).toISOString().slice(0, 10);
    const prevMonthSales = (sales || []).filter((s: any) => s.date >= prevMonthStart && s.date <= prevMonthEnd);
    const thisMonthSales = (sales || []).filter((s: any) => s.date >= thisMonthStart);
    const prevMonthRev = prevMonthSales.reduce((a: number, s: any) => a + Number(s.total_ars), 0);
    const thisMonthRev = thisMonthSales.reduce((a: number, s: any) => a + Number(s.total_ars), 0);
    const prevMonthProfit = prevMonthSales.reduce((a: number, s: any) => a + Number(s.profit_ars), 0);
    const thisMonthProfit = thisMonthSales.reduce((a: number, s: any) => a + Number(s.profit_ars), 0);
    const growthPct = prevMonthRev > 0 ? (((thisMonthRev - prevMonthRev) / prevMonthRev) * 100).toFixed(1) : "N/A";

    const topProdMap: Record<string, { rev: number; qty: number; profit: number }> = {};
    thisMonthSales.forEach((s: any) => {
      const k = s.product_name || "?";
      if (!topProdMap[k]) topProdMap[k] = { rev: 0, qty: 0, profit: 0 };
      topProdMap[k].rev += Number(s.total_ars);
      topProdMap[k].qty += Number(s.quantity);
      topProdMap[k].profit += Number(s.profit_ars);
    });
    const topProds = Object.entries(topProdMap).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5);

    const highMarginProds = (products || [])
      .filter((p: any) => Number(p.sale_price_ars) > 0)
      .map((p: any) => ({ name: p.name, margin: (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100 }))
      .sort((a, b) => b.margin - a.margin).slice(0, 3);

    const businessContext = `
CONTEXTO DEL NEGOCIO — ${(settings as any)?.business_name || "Tu negocio"}
TC actual: $${(settings as any)?.exchange_rate || "N/A"} ARS/USD

MES ACTUAL vs MES ANTERIOR:
- Mes anterior: $${Math.round(prevMonthRev).toLocaleString("es-AR")} ARS / $${Math.round(prevMonthProfit).toLocaleString("es-AR")} ganancia
- Mes actual (hasta hoy): $${Math.round(thisMonthRev).toLocaleString("es-AR")} ARS / $${Math.round(thisMonthProfit).toLocaleString("es-AR")} ganancia
- Variación: ${growthPct}%

ÚLTIMOS 30 DÍAS — ${recentSales.length} ventas:
- Facturado: $${Math.round(totalSalesARS).toLocaleString("es-AR")} ARS
- Ganancia bruta: $${Math.round(totalProfitARS).toLocaleString("es-AR")} ARS (margen ${margin}%)

TOP PRODUCTOS este mes:
${topProds.map(([name, d]) => `• ${name}: ${d.qty} u. / $${Math.round(d.rev).toLocaleString("es-AR")} / margen ${d.rev > 0 ? ((d.profit / d.rev) * 100).toFixed(0) : 0}%`).join("\n") || "Sin ventas este mes"}

PRODUCTOS CON MAYOR MARGEN:
${highMarginProds.map(p => `• ${p.name}: ${p.margin.toFixed(0)}% margen`).join("\n")}

STOCK (${(products || []).length} productos):
- Con stock bajo (≤3 u.): ${lowStock.length} productos
- Sin stock: ${outOfStock.length} productos
${lowStock.slice(0, 5).map((p: any) => `• ${p.name}: ${p.stock} u.`).join("\n")}

DEUDAS: $${Math.round(totalDebt).toLocaleString("es-AR")} ARS (${(debts || []).length} clientes)
GASTOS ÚLTIMOS 30D: $${Math.round(totalExpenses).toLocaleString("es-AR")} ARS

TOP CLIENTES (últimos 30d):
${(() => {
  const custMap: Record<string, number> = {};
  recentSales.forEach((s: any) => {
    if (s.customer_name) custMap[s.customer_name] = (custMap[s.customer_name] || 0) + Number(s.total_ars);
  });
  return Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => `• ${name}: $${Math.round(total).toLocaleString("es-AR")}`).join("\n") || "Sin datos de clientes";
})()}
`;

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

    // ── Streaming response (SSE) ─────────────────────────────────────────────
    const encoder = new TextEncoder();

    // Lista blanca de modelos. El navegador puede PEDIR el modelo, no elegir
    // cualquiera: un string libre desde el cliente es una via para pedir el
    // mas caro que exista, y lo paga la plataforma.
    //
    // Un valor desconocido cae al default en vez de rechazarse: que el chat
    // siga andando vale mas que ser estricto con algo que el usuario no
    // escribio a mano.
    const MODELOS: Record<string, string> = {
      "claude-opus-5": "claude-opus-5",
      "claude-sonnet-5": "claude-sonnet-5",
      "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    };
    const modeloElegido = MODELOS[String(model ?? "")] ?? "claude-sonnet-5";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const claudeStream = anthropic.messages.stream({
            model: modeloElegido,
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages,
          });

          for await (const event of claudeStream) {
            if (
              event.type === "content_block_delta" &&
              (event.delta as any).type === "text_delta"
            ) {
              const chunk = `data: ${JSON.stringify({ delta: (event.delta as any).text })}\n\n`;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          // El uso REAL, del mensaje final de la API. Si no viene, no se
          // manda el evento y la pantalla guarda null, que significa "no lo
          // se". Inventarlo es exactamente lo que habia antes.
          try {
            const final = await claudeStream.finalMessage();
            if (final?.usage) {
              // Y se registra del lado del servidor: el navegador lo recibe
              // para mostrarlo, pero el cupo no lo puede llevar el cliente.
              await registrarConsumoIA({
                orgId, userId, model: final.model ?? modeloElegido,
                input: final.usage.input_tokens, output: final.usage.output_tokens,
              });
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ usage: {
                  input_tokens: final.usage.input_tokens ?? null,
                  output_tokens: final.usage.output_tokens ?? null,
                  model: modeloElegido,
                } })}

`));
            }
          } catch {
            // Que no se pueda leer el uso no puede tumbar una respuesta que ya
            // se entrego entera.
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const errChunk = `data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Error" })}\n\n`;
          controller.enqueue(encoder.encode(errChunk));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: any) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e.message || "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

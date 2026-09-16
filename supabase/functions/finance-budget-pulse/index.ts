import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// GET /?org_id=xxx&year=2026&month=9 → presupuestos vs gastos reales
// POST / → POST { org_id, year, month, category_key, threshold_pct } → alerta
/**
 * Budget Pulse — Edge Function para alertas de presupuesto.
 * Usa tablas existentes: `get_expense_budgets` (RPC) y `expenses`.
 * GET: devuelve comparación presupuesto vs gasto real por mes.
 * POST: genera alertas cuando el gasto supera el 80 % del presupuesto.
 * Usa Supabase Realtime (`finance-budget-alerts`) para notificar.
 * Errores en español rioplatense (ej: "No pudimos leer los presupuestos").
 * Requiere `requireUser`; valida `org_id`; no inventa datos.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;
  const user = auth.user;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id");
    const year = parseInt(url.searchParams.get("year") ?? "", 10);
    const month = parseInt(url.searchParams.get("month") ?? "", 10);

    if (!orgId || !year || !month) {
      return json({ error: "Faltan org_id, year o month" }, 400);
    }

    // 1) Presupuestos
    const { data: budgets, error: budgetsErr } = await supabase.rpc("get_expense_budgets", {
      p_org_id: orgId,
      p_year: year,
      p_month: month,
    });
    if (budgetsErr) {
      console.error("budget-pulse get_expense_budgets:", budgetsErr);
      return json({ error: "No pudimos leer los presupuestos" }, 500);
    }

    // 2) Gastos reales del mismo período
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data: expenses, error: expensesErr } = await supabase
      .from("expenses")
      .select("category, amount_ars, date")
      .eq("org_id", orgId)
      .gte("date", start)
      .lte("date", end);
    if (expensesErr) {
      console.error("budget-pulse expenses:", expensesErr);
      return json({ error: "No pudimos leer los gastos" }, 500);
    }

    // Gasto acumulado por categoría
    const spentByCat: Record<string, number> = {};
    for (const e of expenses ?? []) {
      const cat = e.category ?? "otros";
      spentByCat[cat] = (spentByCat[cat] ?? 0) + Number(e.amount_ars ?? 0);
    }

    const rows = (budgets ?? []).map((b: any) => {
      const spent = spentByCat[b.category_key] ?? 0;
      const pct = Number(b.amount) > 0 ? (spent / Number(b.amount)) * 100 : 0;
      return {
        category_key: b.category_key,
        category_name: b.category_name,
        budget: Number(b.amount),
        spent,
        pct,
        alert: pct >= 80,
        exceeded: pct >= 100,
      };
    });

    return json({ period: { year, month }, rows });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const orgId = body?.org_id;
      const year = parseInt(body?.year, 10);
      const month = parseInt(body?.month, 10);
      const thresholdPct = Math.min(100, Math.max(0, Number(body?.threshold_pct) || 80));

      if (!orgId || !year || !month) {
        return json({ error: "Faltan org_id, year o month" }, 400);
      }

      // Reusar la misma query del GET para no duplicar lógica
      const { data: budgets, error: budgetsErr } = await supabase.rpc("get_expense_budgets", {
        p_org_id: orgId,
        p_year: year,
        p_month: month,
      });
      if (budgetsErr) {
        console.error("budget-pulse POST get_expense_budgets:", budgetsErr);
        return json({ error: "No pudimos leer los presupuestos" }, 500);
      }

      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const { data: expenses } = await supabase
        .from("expenses")
        .select("category, amount_ars")
        .eq("org_id", orgId)
        .gte("date", start)
        .lte("date", end);

      const spentByCat: Record<string, number> = {};
      for (const e of expenses ?? []) {
        const cat = e.category ?? "otros";
        spentByCat[cat] = (spentByCat[cat] ?? 0) + Number(e.amount_ars ?? 0);
      }

      const alerts = [];
      for (const b of budgets ?? []) {
        const spent = spentByCat[b.category_key] ?? 0;
        const pct = Number(b.amount) > 0 ? (spent / Number(b.amount)) * 100 : 0;
        if (pct >= thresholdPct) {
          alerts.push({
            category_key: b.category_key,
            category_name: b.category_name,
            budget: Number(b.amount),
            spent,
            pct: Math.round(pct * 100) / 100,
            threshold_pct: thresholdPct,
          });
        }
      }

      // Persistir alertas en tabla (inserta si no existe)
      for (const alert of alerts) {
        try {
          await supabase.from("finance_budget_alerts").upsert({
            org_id: orgId,
            user_id: user.id,
            year,
            month,
            category_key: alert.category_key,
            budget: alert.budget,
            spent: alert.spent,
            pct: alert.pct,
            threshold_pct: alert.threshold_pct,
          }, { onConflict: "org_id,year,month,category_key" });
        } catch (e) {
          console.error("budget-pulse alert insert:", e);
        }
      }

      // Notificar por realtime (postgres channel)
      try {
        const realtimeClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const channel = realtimeClient.channel("finance-budget-alerts");
        await channel.send({
          type: "broadcast",
          event: "budget.alert",
          payload: { org_id: orgId, year, month, alerts, user_id: user.id },
        });
        await channel.unsubscribe();
      } catch (rtErr) {
        console.error("budget-pulse realtime:", rtErr);
      }

      return json({ inserted: alerts.length, alerts });
    } catch (e) {
      console.error("budget-pulse POST error:", e);
      return json({ error: "No pudimos generar las alertas" }, 500);
    }
  }

  return json({ error: "Método no permitido" }, 405);
});
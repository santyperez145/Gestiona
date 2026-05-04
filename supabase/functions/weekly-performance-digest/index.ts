/**
 * Weekly performance digest — runs every Monday 9 AM UTC.
 * Sends an in-app notification summarizing the previous week's KPIs per org.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setHours(0, 0, 0, 0);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 7);

  const wStartStr = weekStart.toISOString().slice(0, 10);
  const wEndStr = weekEnd.toISOString().slice(0, 10);

  // Get all active orgs
  const { data: orgs } = await supabase.from("organizations").select("id, name");
  if (!orgs?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });

  let sent = 0;

  for (const org of orgs) {
    // Sales for the week
    const { data: sales } = await supabase
      .from("sales")
      .select("total_ars, profit_ars, customer_name")
      .eq("org_id", org.id)
      .gte("date", wStartStr)
      .lt("date", wEndStr);

    if (!sales?.length) continue;

    const totalRevenue = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const totalProfit = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const saleCount = sales.length;
    const uniqueCustomers = new Set(sales.map((s: any) => s.customer_name).filter(Boolean)).size;
    const avgTicket = saleCount > 0 ? totalRevenue / saleCount : 0;
    const marginPct = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : "0";

    // Same week last year for comparison
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekEnd); prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
    const { data: prevSales } = await supabase
      .from("sales")
      .select("total_ars")
      .eq("org_id", org.id)
      .gte("date", prevWeekStart.toISOString().slice(0, 10))
      .lt("date", prevWeekEnd.toISOString().slice(0, 10));

    const prevRevenue = (prevSales || []).reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const growthPct = prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : null;

    // Get admin/owner members to notify
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("org_id", org.id)
      .in("role", ["owner", "admin"]);

    const growthLine = growthPct
      ? ` (${Number(growthPct) >= 0 ? "+" : ""}${growthPct}% vs semana anterior)`
      : "";

    const title = `📊 Resumen semanal — ${wStartStr} al ${wEndStr}`;
    const message = [
      `💰 Ingresos: $${Math.round(totalRevenue).toLocaleString("es-AR")}${growthLine}`,
      `📈 Ganancia: $${Math.round(totalProfit).toLocaleString("es-AR")} (${marginPct}%)`,
      `🛍️ Ventas: ${saleCount} · Ticket prom: $${Math.round(avgTicket).toLocaleString("es-AR")}`,
      `👥 Clientes únicos: ${uniqueCustomers}`,
    ].join("\n");

    // Deduplication: check if we already sent this week's digest
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("org_id", org.id)
      .eq("type", "weekly_digest")
      .gte("created_at", weekEnd.toISOString())
      .maybeSingle();

    if (existing) continue;

    for (const mb of members || []) {
      await supabase.from("notifications").insert({
        user_id: mb.user_id,
        org_id: org.id,
        type: "weekly_digest",
        title,
        message,
        read: false,
      });
    }

    sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});

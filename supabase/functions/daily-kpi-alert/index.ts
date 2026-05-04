// Edge function: daily-kpi-alert
// Runs nightly via pg_cron. Sends a daily performance summary notification
// and alerts if key metrics (sales, margin) are below configured thresholds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Get all orgs with their settings
    const { data: allSettings } = await supabase
      .from("settings")
      .select("org_id, daily_sales_alert_threshold, daily_margin_alert_threshold");

    if (!allSettings?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    let alertsSent = 0;

    for (const setting of allSettings) {
      const orgId = setting.org_id;

      // Get yesterday's sales for this org
      const { data: sales } = await supabase
        .from("sales")
        .select("total_ars, profit_ars")
        .eq("org_id", orgId)
        .gte("date", `${yesterday}T00:00:00`)
        .lt("date", `${today}T00:00:00`);

      if (!sales?.length) continue;

      const totalSales = sales.reduce((s, r) => s + Number(r.total_ars || 0), 0);
      const totalProfit = sales.reduce((s, r) => s + Number(r.profit_ars || 0), 0);
      const marginPct = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
      const salesCount = sales.length;

      // Check thresholds
      const salesThreshold = Number(setting.daily_sales_alert_threshold) || 0;
      const marginThreshold = Number(setting.daily_margin_alert_threshold) || 0;

      const salesBelowThreshold = salesThreshold > 0 && totalSales < salesThreshold;
      const marginBelowThreshold = marginThreshold > 0 && marginPct < marginThreshold;

      // Build notification message
      let title: string;
      let body: string;

      if (salesBelowThreshold || marginBelowThreshold) {
        title = "⚠️ Alerta KPI: métricas por debajo del umbral";
        const warnings: string[] = [];
        if (salesBelowThreshold) warnings.push(`ventas (${fmt(totalSales)}) < umbral ${fmt(salesThreshold)}`);
        if (marginBelowThreshold) warnings.push(`margen (${marginPct.toFixed(1)}%) < umbral ${marginThreshold}%`);
        body = `Ayer: ${salesCount} ventas por ${fmt(totalSales)} — margen ${marginPct.toFixed(1)}%. Alertas: ${warnings.join(", ")}.`;
      } else {
        // Only send summary if there were sales (avoid spam on no-sales days)
        if (totalSales === 0) continue;
        title = `Resumen del día: ${fmt(totalSales)}`;
        body = `${salesCount} venta${salesCount !== 1 ? "s" : ""} · Ganancia ${fmt(totalProfit)} · Margen ${marginPct.toFixed(1)}%`;
      }

      // Find admin/owner users for this org
      const { data: admins } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["admin", "owner"]);

      if (!admins?.length) continue;

      // Deduplicate: only one daily KPI notification per org per day
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("org_id", orgId)
        .eq("type", "daily_kpi")
        .gte("created_at", `${today}T00:00:00`)
        .limit(1);

      if (existing?.length) continue;

      // Insert notification for each admin
      for (const admin of admins) {
        await supabase.from("notifications").insert({
          user_id: admin.user_id,
          org_id: orgId,
          type: "daily_kpi",
          title,
          body,
          read: false,
        });
      }

      alertsSent++;
    }

    return new Response(JSON.stringify({ ok: true, alertsSent }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

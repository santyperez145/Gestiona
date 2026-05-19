/**
 * check-alerts — Alertas inteligentes por organización
 *
 * Runs daily (or on-demand from UI). For each org with enabled alert rules:
 *   stock_low        → products with stock <= threshold_value
 *   low_margin       → products where margin% < threshold_value
 *   debt_overdue     → debts overdue by > threshold_days days
 *   customer_inactive → customers with no sales in > threshold_days days
 *   high_expense     → total expenses this month > threshold_value (ARS)
 *
 * Creates notifications for each org admin. Deduplicates within 24h per entity.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    // Get all orgs with at least one enabled alert rule
    const { data: rules, error: rulesErr } = await supabase
      .from("alert_rules")
      .select("*")
      .eq("enabled", true);

    if (rulesErr) throw rulesErr;

    const orgIds = [...new Set((rules ?? []).map((r: any) => r.org_id))];
    let totalAlerts = 0;
    const now = new Date();

    for (const orgId of orgIds) {
      const orgRules: any[] = (rules ?? []).filter((r: any) => r.org_id === orgId);
      const alerts: { type: string; title: string; message: string; entityKey: string }[] = [];

      for (const rule of orgRules) {
        if (rule.type === "stock_low") {
          // Products with stock <= threshold_value
          const { data: prods } = await supabase
            .from("products")
            .select("id, name, stock")
            .eq("org_id", orgId)
            .lte("stock", rule.threshold_value)
            .gt("stock", -1)
            .limit(20);

          for (const p of prods ?? []) {
            alerts.push({
              type: "stock_bajo",
              title: `Stock bajo: ${p.name}`,
              message: `Quedan ${p.stock} unidades (umbral: ${rule.threshold_value}).`,
              entityKey: `stock_low:${p.id}`,
            });
          }
        }

        if (rule.type === "low_margin") {
          // Products where (sale_price_ars - cost_usd * dolar) / sale_price_ars < threshold_value%
          // Approximation: profit_per_unit_ars / sale_price_ars * 100 < threshold_value
          const { data: prods } = await supabase
            .from("products")
            .select("id, name, sale_price_ars, profit_per_unit_ars")
            .eq("org_id", orgId)
            .gt("sale_price_ars", 0)
            .limit(200);

          for (const p of prods ?? []) {
            const margin = ((p.profit_per_unit_ars ?? 0) / p.sale_price_ars) * 100;
            if (margin < rule.threshold_value) {
              alerts.push({
                type: "sistema",
                title: `Margen bajo: ${p.name}`,
                message: `Margen actual ${margin.toFixed(1)}% (umbral: ${rule.threshold_value}%).`,
                entityKey: `low_margin:${p.id}`,
              });
            }
          }
        }

        if (rule.type === "debt_overdue") {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - rule.threshold_days);

          const { data: debts } = await supabase
            .from("debts")
            .select("id, customer_name, amount, due_date")
            .eq("org_id", orgId)
            .eq("paid", false)
            .lte("due_date", cutoff.toISOString().slice(0, 10))
            .limit(20);

          for (const d of debts ?? []) {
            const days = Math.floor(
              (now.getTime() - new Date(d.due_date).getTime()) / 86400000
            );
            alerts.push({
              type: "deuda_vencida",
              title: `Deuda vencida: ${d.customer_name}`,
              message: `$${Number(d.amount).toLocaleString("es-AR")} — vencida hace ${days} días.`,
              entityKey: `debt_overdue:${d.id}`,
            });
          }
        }

        if (rule.type === "customer_inactive") {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - rule.threshold_days);

          // Get distinct customers from recent sales, then find those without recent sales
          const { data: recentBuyers } = await supabase
            .from("sales")
            .select("customer_name")
            .eq("org_id", orgId)
            .gte("created_at", cutoff.toISOString());

          const activeBuyers = new Set(
            (recentBuyers ?? []).map((s: any) => s.customer_name).filter(Boolean)
          );

          // Get all customers
          const { data: customers } = await supabase
            .from("customers")
            .select("id, name")
            .eq("org_id", orgId)
            .limit(200);

          for (const c of customers ?? []) {
            if (!activeBuyers.has(c.name)) {
              alerts.push({
                type: "sistema",
                title: `Cliente inactivo: ${c.name}`,
                message: `Sin compras en los últimos ${rule.threshold_days} días.`,
                entityKey: `customer_inactive:${c.id}`,
              });
            }
          }
        }

        if (rule.type === "high_expense") {
          const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const { data: expenses } = await supabase
            .from("expenses")
            .select("amount_ars")
            .eq("org_id", orgId)
            .gte("date", firstOfMonth);

          const total = (expenses ?? []).reduce(
            (s: number, e: any) => s + Number(e.amount_ars || 0), 0
          );

          if (total > rule.threshold_value) {
            alerts.push({
              type: "sistema",
              title: "Gastos elevados este mes",
              message: `Total gastos: $${total.toLocaleString("es-AR")} (umbral: $${Number(rule.threshold_value).toLocaleString("es-AR")}).`,
              entityKey: `high_expense:${orgId}:${now.getFullYear()}-${now.getMonth()}`,
            });
          }
        }

        if (rule.type === "product_expiry") {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() + rule.threshold_days);
          const todayStr = now.toISOString().slice(0, 10);
          const cutoffStr = cutoffDate.toISOString().slice(0, 10);

          const { data: prods } = await supabase
            .from("products")
            .select("id, name, expiry_date, stock")
            .eq("org_id", orgId)
            .gt("stock", 0)
            .not("expiry_date", "is", null)
            .lte("expiry_date", cutoffStr)
            .limit(20);

          for (const p of prods ?? []) {
            const daysLeft = Math.ceil(
              (new Date(p.expiry_date).getTime() - now.getTime()) / 86400000
            );
            const expired = daysLeft < 0;
            alerts.push({
              type: "sistema",
              title: expired
                ? `Vencido: ${p.name}`
                : `Por vencer: ${p.name}`,
              message: expired
                ? `Venció hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) !== 1 ? 's' : ''} — ${p.stock} unidades en stock.`
                : `Vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''} (${p.expiry_date}) — ${p.stock} unidades.`,
              entityKey: `product_expiry:${p.id}:${todayStr}`,
            });
          }
        }

        // Update last_run_at for the rule
        await supabase
          .from("alert_rules")
          .update({ last_run_at: now.toISOString() })
          .eq("id", rule.id);
      }

      if (alerts.length === 0) continue;

      // Get admin users of this org to notify
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("role", "admin");

      const adminIds = (members ?? []).map((m: any) => m.user_id);
      if (adminIds.length === 0) continue;

      // Dedup: don't re-create the same alert notification within 24h
      const cutoff24h = new Date(now.getTime() - 86400000).toISOString();
      const { data: recentNotifs } = await supabase
        .from("notifications")
        .select("message")
        .in("user_id", adminIds)
        .gte("created_at", cutoff24h);

      const recentMessages = new Set((recentNotifs ?? []).map((n: any) => n.message));

      const toInsert: any[] = [];
      for (const adminId of adminIds) {
        for (const alert of alerts) {
          // Dedup by entity key embedded in message
          if (recentMessages.has(alert.message)) continue;
          toInsert.push({
            user_id: adminId,
            type: alert.type,
            title: alert.title,
            message: alert.message,
            read: false,
          });
        }
      }

      if (toInsert.length > 0) {
        await supabase.from("notifications").insert(toInsert);
        totalAlerts += toInsert.length;

        // Update last_triggered_at for org's rules that fired
        await supabase
          .from("alert_rules")
          .update({ last_triggered_at: now.toISOString() })
          .eq("org_id", orgId)
          .eq("enabled", true);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, notifications_created: totalAlerts, orgs_checked: orgIds.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("check-alerts error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

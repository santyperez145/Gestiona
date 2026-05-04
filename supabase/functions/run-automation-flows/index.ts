// Edge function: run-automation-flows
// Evaluates all active automation flows and executes their configured actions.
// Called daily by pg_cron at 11:00 AM UTC.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Load all active flows
    const { data: flows } = await supabase
      .from("automation_flows")
      .select("*")
      .eq("active", true);

    if (!flows?.length) {
      return json({ ok: true, processed: 0 });
    }

    let processed = 0;
    let actions = 0;

    for (const flow of flows) {
      try {
        const triggered = await evaluateFlow(flow, today);
        if (triggered > 0) {
          await supabase
            .from("automation_flows")
            .update({ last_run_at: new Date().toISOString() })
            .eq("id", flow.id);
          actions += triggered;
        }
        processed++;
      } catch (e) {
        console.error(`Flow ${flow.id} error:`, e);
      }
    }

    return json({ ok: true, flows: processed, actions });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

async function evaluateFlow(flow: any, today: string): Promise<number> {
  const { trigger_type, trigger_config, action_type, action_config, org_id } = flow;

  switch (trigger_type) {
    case "customer_inactive": {
      const days = Number(trigger_config?.days ?? 30);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      // Get customers who last purchased before cutoff
      const { data: sales } = await supabase
        .from("sales")
        .select("customer_name, date")
        .eq("org_id", org_id)
        .not("customer_name", "is", null)
        .order("date", { ascending: false });

      if (!sales?.length) return 0;

      const lastPurchase: Record<string, string> = {};
      for (const s of sales) {
        if (!lastPurchase[s.customer_name]) lastPurchase[s.customer_name] = s.date.slice(0, 10);
      }

      const inactiveCustomers = Object.entries(lastPurchase)
        .filter(([, d]) => d < cutoffStr)
        .map(([name]) => name);

      if (!inactiveCustomers.length) return 0;

      if (action_type === "notification") {
        return await sendOrgNotification(org_id, today, flow.id, {
          type: "automatizacion",
          title: `${inactiveCustomers.length} cliente${inactiveCustomers.length !== 1 ? "s" : ""} inactivo${inactiveCustomers.length !== 1 ? "s" : ""}`,
          message: action_config?.message ||
            `No compraron en más de ${days} días: ${inactiveCustomers.slice(0, 3).join(", ")}${inactiveCustomers.length > 3 ? ` y ${inactiveCustomers.length - 3} más` : ""}`,
        });
      }
      return inactiveCustomers.length;
    }

    case "debt_overdue": {
      const daysOverdue = Number(trigger_config?.days_overdue ?? 0);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysOverdue);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const { data: debts } = await supabase
        .from("debts")
        .select("customer_name, remaining_ars, due_date")
        .eq("org_id", org_id)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .lt("due_date", cutoffStr);

      if (!debts?.length) return 0;

      if (action_type === "notification") {
        const totalARS = debts.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
        return await sendOrgNotification(org_id, today, flow.id, {
          type: "automatizacion",
          title: `${debts.length} deuda${debts.length !== 1 ? "s" : ""} vencida${debts.length !== 1 ? "s" : ""} (>${daysOverdue}d)`,
          message: action_config?.message ||
            `Total: $${Math.round(totalARS).toLocaleString("es-AR")} — ${debts.slice(0, 3).map((d: any) => d.customer_name).join(", ")}`,
        });
      }
      return debts.length;
    }

    case "low_stock": {
      const threshold = Number(trigger_config?.threshold ?? 3);

      const { data: products } = await supabase
        .from("products")
        .select("name, stock")
        .eq("org_id", org_id)
        .lte("stock", threshold)
        .gt("stock", 0);

      if (!products?.length) return 0;

      if (action_type === "notification") {
        return await sendOrgNotification(org_id, today, flow.id, {
          type: "automatizacion",
          title: `${products.length} producto${products.length !== 1 ? "s" : ""} con stock ≤ ${threshold}`,
          message: action_config?.message ||
            products.slice(0, 5).map((p: any) => `${p.name} (${p.stock} u.)`).join(", "),
        });
      }
      return products.length;
    }

    case "birthday": {
      const today = new Date();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");

      const { data: customers } = await supabase
        .from("customers")
        .select("name, phone, birthday")
        .eq("org_id", org_id)
        .not("birthday", "is", null);

      if (!customers?.length) return 0;

      const birthdayToday = customers.filter((c: any) => {
        const b = c.birthday as string;
        return b?.slice(5, 7) === mm && b?.slice(8, 10) === dd;
      });

      if (!birthdayToday.length) return 0;

      if (action_type === "notification") {
        return await sendOrgNotification(org_id, today.toISOString().slice(0, 10), flow.id, {
          type: "automatizacion",
          title: `🎂 ${birthdayToday.length} cumpleaño${birthdayToday.length !== 1 ? "s" : ""} hoy`,
          message: action_config?.message ||
            `¡Felicitá a: ${birthdayToday.map((c: any) => c.name).join(", ")}!`,
        });
      }
      return birthdayToday.length;
    }

    default:
      return 0;
  }
}

async function sendOrgNotification(
  orgId: string,
  today: string,
  flowId: string,
  notification: { type: string; title: string; message: string },
): Promise<number> {
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"]);

  if (!members?.length) return 0;

  let sent = 0;
  for (const m of members) {
    // Dedup: one notification per flow per day per user
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", m.user_id)
      .eq("type", notification.type)
      .gte("created_at", `${today}T00:00:00`)
      .eq("org_id", orgId)
      .limit(1);

    if (existing?.length) continue;

    await supabase.from("notifications").insert({
      user_id: m.user_id,
      org_id: orgId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      read: false,
    });
    sent++;
  }
  return sent;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

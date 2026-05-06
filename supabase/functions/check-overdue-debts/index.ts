// Edge function: check-overdue-debts
// Runs daily via pg_cron. Finds unpaid debts past their due date and notifies admins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get all unpaid debts with overdue due_date
    const { data: debts } = await supabase
      .from("debts")
      .select("id, customer_name, remaining_ars, due_date, org_id")
      .eq("status", "pending")
      .not("due_date", "is", null)
      .lt("due_date", today);

    if (!debts?.length) {
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Group by org
    const byOrg: Record<string, typeof debts> = {};
    debts.forEach((d) => {
      if (!byOrg[d.org_id]) byOrg[d.org_id] = [];
      byOrg[d.org_id].push(d);
    });

    let total = 0;
    for (const [orgId, orgDebts] of Object.entries(byOrg)) {
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin"]);

      if (!members?.length) continue;

      for (const member of members) {
        // One notification per org per day
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", member.user_id)
          .eq("type", "deuda_vencida")
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (existing?.length) continue;

        const totalARS = orgDebts.reduce((s, d) => s + Number(d.remaining_ars), 0);
        const names = orgDebts.slice(0, 3).map((d) => d.customer_name).join(", ");
        const extra = orgDebts.length > 3 ? ` y ${orgDebts.length - 3} más` : "";

        await supabase.from("notifications").insert({
          user_id: member.user_id,
          org_id: orgId,
          type: "deuda_vencida",
          title: `${orgDebts.length} deuda${orgDebts.length !== 1 ? "s" : ""} vencida${orgDebts.length !== 1 ? "s" : ""}`,
          message: `${names}${extra} — Total: $${Math.round(totalARS).toLocaleString("es-AR")}`,
          read: false,
        });
        total++;
      }
    }

    return new Response(JSON.stringify({ ok: true, alerts: total }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

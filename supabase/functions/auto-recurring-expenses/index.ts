// Auto-creates recurring expenses when their next_due_date is today or earlier.
// Called by pg_cron daily at 6 AM (runs fast — typically under 100ms).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function addPeriod(date: Date, freq: string): Date {
  const d = new Date(date);
  switch (freq) {
    case "daily":   d.setDate(d.getDate() + 1); break;
    case "weekly":  d.setDate(d.getDate() + 7); break;
    case "yearly":  d.setFullYear(d.getFullYear() + 1); break;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + 1);
      // Clamp to end of month (e.g. Jan 31 + 1 month → Feb 28)
      if (d.getDate() < new Date(date).getDate()) {
        d.setDate(0); // last day of previous month
      }
  }
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

    // Find all recurring expenses whose next_due_date is today or earlier
    const { data: due, error } = await admin
      .from("expenses")
      .select("id, org_id, user_id, amount_ars, category, description, recurring_frequency, recurring_next_date")
      .eq("recurring", true)
      .lte("recurring_next_date", todayStr)
      .not("recurring_next_date", "is", null);

    if (error) throw error;

    let created = 0;
    const orgNotifyMap: Record<string, number> = {};

    for (const exp of due || []) {
      const freq = exp.recurring_frequency || "monthly";
      const nextDate = new Date(exp.recurring_next_date);

      // Dedup: check if we already created one for this exact next_date
      const { data: exists } = await admin
        .from("expenses")
        .select("id")
        .eq("org_id", exp.org_id)
        .eq("category", exp.category)
        .eq("description", exp.description || "")
        .eq("date", nextDate.toISOString().slice(0, 10))
        .eq("recurring", false) // auto-created ones are NOT recurring (they're leaf entries)
        .limit(1);

      if (!exists || exists.length === 0) {
        // Create the expense for this period
        const { error: insErr } = await admin.from("expenses").insert({
          org_id:      exp.org_id,
          user_id:     exp.user_id,
          amount_ars:  exp.amount_ars,
          category:    exp.category,
          description: exp.description,
          date:        nextDate.toISOString().slice(0, 10),
          recurring:   false, // This is the generated copy — not a template
        });
        if (!insErr) {
          created++;
          orgNotifyMap[exp.org_id] = (orgNotifyMap[exp.org_id] || 0) + 1;
        }
      }

      // Advance the next_date regardless (even if entry already existed)
      const newNextDate = addPeriod(nextDate, freq);
      await admin
        .from("expenses")
        .update({
          recurring_next_date:  newNextDate.toISOString().slice(0, 10),
          last_auto_created_at: today.toISOString(),
        })
        .eq("id", exp.id);
    }

    // Notify one admin per org
    for (const [orgId, count] of Object.entries(orgNotifyMap)) {
      const { data: members } = await admin
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("role", "admin")
        .limit(1);

      if (members && members.length > 0) {
        const { error: errNotificacion } = await admin
          .from("notifications").insert({
          user_id: members[0].user_id,
          org_id:  orgId,
          title: "Gastos recurrentes generados",
          message: `Se crearon automáticamente ${count} gasto${count !== 1 ? "s" : ""} recurrente${count !== 1 ? "s" : ""}`,
          type: "sistema",
        });
        // Un insert sin mirar `.error` convierte «no se guardó» en «listo»:
        // es lo que escondió durante meses que check-alerts no guardaba nada.
        if (errNotificacion) console.error("auto-recurring-expenses: no se pudo notificar", errNotificacion);
      }
    }

    console.log(`auto-recurring-expenses: ${created} created across ${Object.keys(orgNotifyMap).length} orgs`);
    return new Response(JSON.stringify({ created, orgs: Object.keys(orgNotifyMap).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-recurring-expenses error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

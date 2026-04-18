// Replicates recurring expenses for the current month for every user. Triggered via pg_cron monthly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Avoid duplicates: skip if already created this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: recurring, error } = await admin.from("expenses")
      .select("*")
      .eq("recurring", true)
      .gte("date", prevMonth.toISOString())
      .lte("date", prevMonthEnd.toISOString());

    if (error) throw error;

    let created = 0;
    const byUser: Record<string, number> = {};
    for (const exp of recurring || []) {
      // Check if same description+category+user already exists for this month
      const { data: dupes } = await admin.from("expenses").select("id")
        .eq("user_id", exp.user_id)
        .eq("category", exp.category)
        .eq("description", exp.description || "")
        .gte("date", startOfMonth)
        .limit(1);
      if (dupes && dupes.length > 0) continue;

      const newDate = new Date(now.getFullYear(), now.getMonth(), Math.min(new Date(exp.date).getDate(), 28), 12, 0, 0);
      const { error: insErr } = await admin.from("expenses").insert({
        user_id: exp.user_id,
        amount_ars: exp.amount_ars,
        category: exp.category,
        description: exp.description,
        date: newDate.toISOString(),
        recurring: true,
      });
      if (!insErr) {
        created++;
        byUser[exp.user_id] = (byUser[exp.user_id] || 0) + 1;
      }
    }

    // Notify each user
    for (const [uid, count] of Object.entries(byUser)) {
      await admin.from("notifications").insert({
        user_id: uid,
        title: "Gastos recurrentes replicados",
        message: `Se crearon ${count} gastos recurrentes para este mes`,
        type: "sistema",
      });
    }

    return new Response(JSON.stringify({ created, users: Object.keys(byUser).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-recurring-expenses error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

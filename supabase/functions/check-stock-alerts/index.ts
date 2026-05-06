// Edge function: check-stock-alerts
// Runs daily via pg_cron. Finds products below threshold and creates notifications.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  try {
    // Get all orgs that have products with low stock
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, stock, org_id, low_stock_threshold")
      .gt("low_stock_threshold", 0)
      .filter("stock", "lte", supabase.rpc("low_stock_threshold")); // fallback handled below

    // Simpler approach: get all products and filter in JS
    const { data: allProducts } = await supabase
      .from("products")
      .select("id, name, stock, org_id, low_stock_threshold");

    const lowStock = (allProducts || []).filter((p: any) => {
      const threshold = p.low_stock_threshold ?? 3;
      return p.stock <= threshold && p.stock >= 0;
    });

    if (lowStock.length === 0) {
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Group by org
    const byOrg: Record<string, any[]> = {};
    lowStock.forEach((p: any) => {
      if (!byOrg[p.org_id]) byOrg[p.org_id] = [];
      byOrg[p.org_id].push(p);
    });

    // For each org, get the owner's user_id and send notification
    let total = 0;
    for (const [orgId, prods] of Object.entries(byOrg)) {
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin"]);

      if (!members?.length) continue;

      const today = new Date().toISOString().slice(0, 10);

      for (const member of members) {
        // Check if we already sent a stock alert today
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", member.user_id)
          .eq("type", "stock_bajo")
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (existing?.length) continue;

        const names = prods.slice(0, 5).map((p: any) => `${p.name} (${p.stock} en stock)`).join(", ");
        const extra = prods.length > 5 ? ` y ${prods.length - 5} más` : "";

        await supabase.from("notifications").insert({
          user_id: member.user_id,
          org_id: orgId,
          type: "stock_bajo",
          title: `${prods.length} producto${prods.length !== 1 ? "s" : ""} con stock bajo`,
          message: names + extra,
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

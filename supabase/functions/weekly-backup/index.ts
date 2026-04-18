// Weekly backup: dump full per-user data as JSON to Storage bucket "backups".
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

    // Only backup admin users
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const userIds = (admins || []).map(r => r.user_id);

    let success = 0;
    const stamp = new Date().toISOString().slice(0, 10);

    for (const uid of userIds) {
      const tables = ["products", "sales", "purchases", "debts", "expenses", "settings", "customer_notes", "product_variants", "coupons", "marketing_posts", "influencer_exchanges", "seller_goals"];
      const dump: Record<string, any> = { generated_at: new Date().toISOString(), user_id: uid };
      for (const t of tables) {
        const { data } = await admin.from(t as any).select("*").eq("user_id", uid);
        dump[t] = data || [];
      }
      const path = `${uid}/backup-${stamp}.json`;
      const body = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const { error: upErr } = await admin.storage.from("backups").upload(path, body, {
        contentType: "application/json", upsert: true,
      });
      if (!upErr) {
        success++;
        await admin.from("notifications").insert({
          user_id: uid, title: "Backup semanal completado",
          message: `Se generó respaldo ${stamp}`, type: "sistema",
        });
      } else {
        console.error("backup upload err", uid, upErr);
      }
    }

    return new Response(JSON.stringify({ success, total: userIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("weekly-backup error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

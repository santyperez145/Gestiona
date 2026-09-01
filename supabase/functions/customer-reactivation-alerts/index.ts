/**
 * customer-reactivation-alerts
 *
 * Triggered via pg_cron (daily) or manually.
 * Finds customers who haven't purchased in configurable windows and
 * inserts a notification for each org member with admin/owner role.
 *
 * Thresholds:
 *   30d  → "En riesgo"
 *   60d  → "Dormido"
 *   90d  → "Perdido"
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { mensajeDeError } from "../_shared/errorMessage.ts";
import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const today = new Date();
    const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
    const d90 = new Date(today); d90.setDate(d90.getDate() - 90);

    // Get all orgs
    const { data: orgs } = await supabase.from("organizations").select("id, name");
    if (!orgs?.length) return new Response(JSON.stringify({ ok: true, orgsProcessed: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let totalNotifications = 0;

    for (const org of orgs) {
      // Get last purchase date per customer for this org
      const { data: salesRaw } = await supabase
        .from("sales")
        .select("customer_name, date")
        .eq("org_id", org.id)
        .order("date", { ascending: false });

      if (!salesRaw?.length) continue;

      // Build last purchase map
      const lastPurchase: Record<string, Date> = {};
      for (const s of salesRaw) {
        if (!s.customer_name) continue;
        const d = new Date(s.date);
        if (!lastPurchase[s.customer_name] || d > lastPurchase[s.customer_name]) {
          lastPurchase[s.customer_name] = d;
        }
      }

      // Find at-risk customers (30–60d), dormant (60–90d), lost (90+d)
      const atRisk: string[] = [];
      const dormant: string[] = [];

      for (const [name, lastDate] of Object.entries(lastPurchase)) {
        const daysSince = (today.getTime() - lastDate.getTime()) / 86_400_000;
        if (daysSince >= 30 && daysSince < 60) atRisk.push(name);
        else if (daysSince >= 60 && daysSince < 90) dormant.push(name);
      }

      if (atRisk.length === 0 && dormant.length === 0) continue;

      // Get admin/owner members for this org
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", org.id)
        .in("role", ["owner", "admin"]);

      if (!members?.length) continue;

      const notifications: any[] = [];

      if (atRisk.length > 0) {
        const preview = atRisk.slice(0, 3).join(", ") + (atRisk.length > 3 ? ` y ${atRisk.length - 3} más` : "");
        for (const m of members) {
          notifications.push({
            user_id: m.user_id,
            org_id: org.id,
            type: "clientes_riesgo",
            title: `${atRisk.length} cliente(s) en riesgo`,
            message: `${preview} no compraron en 30–60 días. ¡Momento de reactivarlos!`,
            read: false,
          });
        }
      }

      if (dormant.length > 0) {
        const preview = dormant.slice(0, 3).join(", ") + (dormant.length > 3 ? ` y ${dormant.length - 3} más` : "");
        for (const m of members) {
          notifications.push({
            user_id: m.user_id,
            org_id: org.id,
            type: "clientes_dormidos",
            title: `${dormant.length} cliente(s) dormido(s)`,
            message: `${preview} no compraron en 60–90 días. Enviá una oferta personalizada.`,
            read: false,
          });
        }
      }

      if (notifications.length > 0) {
        // Avoid duplicate notifications today
        const todayStr = today.toISOString().slice(0, 10);
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("org_id", org.id)
          .in("type", ["clientes_riesgo", "clientes_dormidos"])
          .gte("created_at", todayStr + "T00:00:00");

        if (!existing?.length) {
          const { error: errNotificacion } = await supabase
            .from("notifications").insert(notifications);
          // Un insert sin mirar `.error` convierte «no se guardó» en «listo»:
          // es lo que escondió durante meses que check-alerts no guardaba nada.
          if (errNotificacion) console.error("customer-reactivation-alerts: no se pudo notificar", errNotificacion);
          totalNotifications += notifications.length;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, notifications: totalNotifications }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: mensajeDeError(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

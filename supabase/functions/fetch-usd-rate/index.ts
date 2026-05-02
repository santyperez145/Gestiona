// Fetch live USD-ARS rates from public dolarapi.com (no API key needed) and persist to settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve the user's active org for multi-tenant isolation
    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const orgId = membership?.org_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Sin organización activa" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch live rates from public API (free, no key)
    const [oficialR, blueR, mepR] = await Promise.all([
      fetch("https://dolarapi.com/v1/dolares/oficial").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("https://dolarapi.com/v1/dolares/blue").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("https://dolarapi.com/v1/dolares/bolsa").then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const rates = {
      oficial: oficialR?.venta ?? null,
      blue: blueR?.venta ?? null,
      mep: mepR?.venta ?? null,
      updatedAt: new Date().toISOString(),
    };

    if (!rates.oficial && !rates.blue) {
      return new Response(JSON.stringify({ error: "No se pudo obtener cotización" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Upsert settings scoped to the user's org (creates row if it doesn't exist yet)
    await supabase.from("settings").upsert({
      org_id: orgId,
      usd_rate_oficial: rates.oficial,
      usd_rate_blue: rates.blue,
      usd_rate_mep: rates.mep,
      usd_rate_updated_at: rates.updatedAt,
    }, { onConflict: "org_id" });

    return new Response(JSON.stringify(rates), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-usd-rate error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

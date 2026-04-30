// Exchange Tiendanube OAuth authorization code for access token and persist the connection.
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
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, orgId } = await req.json();
    if (!code || !orgId) {
      return new Response(JSON.stringify({ error: "code y orgId son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("TIENDANUBE_CLIENT_ID");
    const clientSecret = Deno.env.get("TIENDANUBE_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Integración Tiendanube no configurada en el servidor." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange authorization code for access token
    const tokenRes = await fetch("https://www.tiendanube.com/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Tiendanube token error:", tokenRes.status, err);
      return new Response(JSON.stringify({ error: "Error al obtener token de Tiendanube" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { access_token, user_id: storeId } = await tokenRes.json();
    if (!access_token || !storeId) {
      return new Response(JSON.stringify({ error: "Respuesta inesperada de Tiendanube" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch store details
    const storeRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/store`, {
      headers: {
        Authentication: `bearer ${access_token}`,
        "User-Agent": "Gestiona (soporte@gestiona.app)",
      },
    });

    let storeName = `Tienda #${storeId}`;
    let storeUrl = "";
    if (storeRes.ok) {
      const storeData = await storeRes.json();
      storeName = storeData.name?.es || storeData.name?.pt || storeData.name?.en || storeName;
      storeUrl = storeData.main_domain || storeData.domains?.[0] || "";
    }

    // Upsert connection (one connection per org+store)
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: upsertErr } = await admin.from("tiendanube_connections").upsert({
      org_id: orgId,
      store_id: String(storeId),
      access_token,
      store_name: storeName,
      store_url: storeUrl,
      connected_at: new Date().toISOString(),
    }, { onConflict: "org_id,store_id" });

    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ ok: true, storeName, storeUrl, storeId: String(storeId) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tiendanube-oauth error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

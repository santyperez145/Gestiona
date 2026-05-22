/**
 * evolution-qr — Proxy seguro para Evolution API: obtiene QR, estado y crea instancia.
 *
 * Endpoints que maneja (action en body):
 *   - "status"  → GET /instance/connectionState/{instance}
 *   - "qr"      → GET /instance/connect/{instance}   (retorna qrcode en base64)
 *   - "create"  → POST /instance/create              (crea instancia nueva)
 *   - "logout"  → DELETE /instance/logout/{instance}
 *
 * Las credenciales se leen de la tabla settings de la org.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sbAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes } = await sbAuth.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { orgId, action } = await req.json() as { orgId: string; action: string };

    if (!orgId || !action) {
      return new Response(JSON.stringify({ error: "orgId y action requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify membership
    const { data: member } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userRes.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: "Solo admins pueden gestionar la conexión WA" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load credentials from settings
    const { data: settings } = await admin
      .from("settings")
      .select("evolution_api_url, evolution_api_key, evolution_instance")
      .eq("org_id", orgId)
      .maybeSingle();

    const baseUrl  = settings?.evolution_api_url  || Deno.env.get("EVOLUTION_API_URL")  || "";
    const apiKey   = settings?.evolution_api_key   || Deno.env.get("EVOLUTION_API_KEY")  || "";
    const instance = settings?.evolution_instance  || Deno.env.get("EVOLUTION_INSTANCE") || "gestiona";

    if (!baseUrl || !apiKey) {
      return new Response(JSON.stringify({ error: "Evolution API no configurada" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base = baseUrl.replace(/\/$/, "");
    const headers = { apikey: apiKey, "Content-Type": "application/json" };

    let result: Response;

    if (action === "status") {
      result = await fetch(`${base}/instance/connectionState/${encodeURIComponent(instance)}`, { headers });

    } else if (action === "qr") {
      // Connect / get QR
      result = await fetch(`${base}/instance/connect/${encodeURIComponent(instance)}`, { headers });

    } else if (action === "create") {
      result = await fetch(`${base}/instance/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          instanceName: instance,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });

    } else if (action === "logout") {
      result = await fetch(`${base}/instance/logout/${encodeURIComponent(instance)}`, {
        method: "DELETE",
        headers,
      });

    } else {
      return new Response(JSON.stringify({ error: `Acción desconocida: ${action}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await result.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("evolution-qr error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

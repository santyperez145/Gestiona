// Creates a Mercado Pago payment preference and returns the checkout URL.
// The org admin must save their MP access token in Settings → Integraciones.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user?.id) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orgId, title, total, externalRef } = await req.json();
    if (!orgId || !total) {
      return new Response(JSON.stringify({ error: "orgId y total son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get MP access token from org settings
    const admin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: settings } = await admin
      .from("settings")
      .select("mp_access_token, mp_enabled")
      .eq("org_id", orgId)
      .maybeSingle();

    if (!settings?.mp_enabled || !settings?.mp_access_token) {
      return new Response(JSON.stringify({
        error: "Mercado Pago no configurado. Ingresá tu Access Token en Ajustes → Integraciones.",
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create MP payment preference
    const payload: any = {
      items: [{
        title: title || "Venta",
        quantity: 1,
        unit_price: Math.round(Number(total) * 100) / 100,
        currency_id: "ARS",
      }],
      auto_return: "approved",
    };
    if (externalRef) payload.external_reference = String(externalRef);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.mp_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!mpRes.ok) {
      const err = await mpRes.json().catch(() => ({}));
      console.error("MP API error:", mpRes.status, err);
      const msg = (err as any)?.message || "Error al crear el link de pago";
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mpData = await mpRes.json();
    return new Response(JSON.stringify({
      url: mpData.init_point,
      sandboxUrl: mpData.sandbox_init_point,
      preferenceId: mpData.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("mercadopago-link error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

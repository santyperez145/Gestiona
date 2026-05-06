// Registers Gestiona's webhook URL with the connected Tiendanube store.
// Must be called once after OAuth connection, or when the webhook URL changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WEBHOOK_EVENTS = [
  "orders/created",
  "orders/paid",
  "orders/fulfilled",
  "products/created",
  "products/updated",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user?.id) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orgId } = await req.json();
    if (!orgId) {
      return new Response(JSON.stringify({ error: "orgId requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: conn } = await admin
      .from("tiendanube_connections")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: "Tiendanube no conectado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/tiendanube-webhook`;
    const registered: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const event of WEBHOOK_EVENTS) {
      // Check if already registered for this event + URL
      const listRes = await fetch(
        `https://api.tiendanube.com/v1/${conn.store_id}/webhooks?event=${encodeURIComponent(event)}`,
        {
          headers: {
            Authentication: `bearer ${conn.access_token}`,
            "User-Agent": "Gestiona (soporte@gestiona.app)",
          },
        }
      );
      if (listRes.ok) {
        const existing = await listRes.json().catch(() => []);
        if (Array.isArray(existing) && existing.some((w: any) => w.url === webhookUrl)) {
          skipped.push(event);
          continue;
        }
      }

      const res = await fetch(`https://api.tiendanube.com/v1/${conn.store_id}/webhooks`, {
        method: "POST",
        headers: {
          Authentication: `bearer ${conn.access_token}`,
          "User-Agent": "Gestiona (soporte@gestiona.app)",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event, url: webhookUrl }),
      });

      if (res.ok) {
        registered.push(event);
      } else {
        const err = await res.json().catch(() => ({}));
        errors.push(`${event}: ${(err as any)?.description || res.status}`);
      }
    }

    // Mark webhooks as registered in the connection record
    if (registered.length > 0 || skipped.length === WEBHOOK_EVENTS.length) {
      await admin
        .from("tiendanube_connections")
        .update({ webhook_id: "registered" })
        .eq("id", conn.id);
    }

    return new Response(JSON.stringify({ ok: errors.length === 0, registered, skipped, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("register-webhooks error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

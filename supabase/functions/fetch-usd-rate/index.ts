// Fetch live USD-ARS rates from public dolarapi.com (no API key needed) and
// persist only the reference quotes. The operational exchange_rate remains a
// merchant decision.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { esLlamadaDeCron, exigirCronOUsuario } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QuoteResult {
  value: number | null;
  error?: string;
}

async function fetchQuote(kind: "oficial" | "blue" | "bolsa"): Promise<QuoteResult> {
  try {
    const response = await fetch(`https://dolarapi.com/v1/dolares/${kind}`, {
      signal: AbortSignal.timeout(7_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { value: null, error: `${kind}: HTTP ${response.status}` };
    const body = await response.json();
    const value = Number(body?.venta);
    if (!Number.isFinite(value) || value <= 0) {
      return { value: null, error: `${kind}: venta inválida` };
    }
    return { value };
  } catch (error) {
    return {
      value: null,
      error: `${kind}: ${error instanceof Error ? error.message : "error de red"}`,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base o una persona con sesión real.
  const noEsCron = await exigirCronOUsuario(req, corsHeaders);
  if (noEsCron) return noEsCron;
  const cron = esLlamadaDeCron(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const [oficialResult, blueResult, mepResult] = await Promise.all([
      fetchQuote("oficial"),
      fetchQuote("blue"),
      fetchQuote("bolsa"),
    ]);

    const rates = {
      oficial: oficialResult.value,
      blue: blueResult.value,
      mep: mepResult.value,
      updatedAt: new Date().toISOString(),
    };
    const sourceErrors = [oficialResult.error, blueResult.error, mepResult.error].filter(Boolean);

    if (!rates.oficial && !rates.blue) {
      return new Response(
        JSON.stringify({ error: "No se pudo obtener cotización", sources: sourceErrors }),
        { status: 502, headers: jsonHeaders },
      );
    }

    // Una fuente parcial no borra la última referencia sana de esa fuente.
    const update: Record<string, number | string> = {
      usd_rate_updated_at: rates.updatedAt,
    };
    if (rates.oficial) update.usd_rate_oficial = rates.oficial;
    if (rates.blue) update.usd_rate_blue = rates.blue;
    if (rates.mep) update.usd_rate_mep = rates.mep;

    if (cron) {
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRole) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
      const admin = createClient(supabaseUrl, serviceRole);
      const { data: updated, error } = await admin
        .from("settings")
        .update(update)
        .not("org_id", "is", null)
        .select("org_id");
      if (error) throw error;
      return new Response(
        JSON.stringify({ ...rates, mode: "cron", organizationsUpdated: updated?.length ?? 0, sourceErrors }),
        { headers: jsonHeaders },
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userError } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (userError || !userId) {
      return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401, headers: jsonHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const orgId = typeof body?.org_id === "string" ? body.org_id : "";
    if (!UUID.test(orgId)) {
      return new Response(JSON.stringify({ error: "Falta la organización activa" }), { status: 400, headers: jsonHeaders });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      return new Response(JSON.stringify({ error: "No pertenecés a la organización" }), { status: 403, headers: jsonHeaders });
    }

    const { data: updated, error: updateError } = await supabase
      .from("settings")
      .update(update)
      .eq("org_id", orgId)
      .select("org_id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return new Response(JSON.stringify({ error: "La organización todavía no completó su perfil" }), { status: 409, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ ...rates, mode: "user", sourceErrors }), { headers: jsonHeaders });
  } catch (e) {
    console.error("fetch-usd-rate error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: jsonHeaders,
    });
  }
});

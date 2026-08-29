/**
 * Crea una preferencia de Checkout Pro para un cobro operado desde Gestiona.
 *
 * La organización enviada por el navegador nunca es autoridad: se exige una
 * sesión real y `sales.create` dentro de ese tenant. El monto se valida en el
 * servidor y el access token sale únicamente de la conexión OAuth privada.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function publicReturnBase(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const orgId = cleanText(body.orgId, 80);
    const title = cleanText(body.title, 120) ?? "Cobro de Gestiona";
    const externalRef = cleanText(body.externalRef, 180);
    const total = Number(body.total);
    // Un link de Checkout Pro es un cobro online aunque se haya iniciado desde
    // el mostrador. El cliente no elige el canal que determina la comisión.
    const channel = "online";

    if (!orgId || !UUID_RE.test(orgId)) return json({ error: "Organización inválida" }, 400);
    if (!Number.isFinite(total) || total <= 0 || total > 999_999_999_999.99) {
      return json({ error: "El monto del cobro no es válido" }, 400);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: canCreate, error: permissionError } = await userClient.rpc("has_permission", {
      p_org_id: orgId,
      p_module: "sales",
      p_action: "create",
    });
    if (permissionError) {
      console.error("mercadopago-link permission:", permissionError);
      return json({ error: "No se pudo verificar el permiso de venta" }, 500);
    }
    if (canCreate !== true) return json({ error: "No tenés permiso para crear cobros" }, 403);

    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const credentials = await getMpCredentials(admin, orgId);
    if (!credentials) {
      return json({ error: "Conectá la cuenta de Mercado Pago desde Integraciones para cobrar" }, 422);
    }

    const { data: commission, error: commissionError } = await admin.rpc("platform_commission_amount", {
      p_org_id: orgId,
      p_gross: total,
      p_channel: channel,
    });
    if (commissionError) {
      console.error("mercadopago-link commission:", commissionError);
      return json({ error: "No se pudo calcular la comisión del cobro" }, 500);
    }
    const marketplaceFee = Number(commission ?? 0);
    if (!Number.isFinite(marketplaceFee) || marketplaceFee < 0 || marketplaceFee > total) {
      console.error("mercadopago-link invalid commission:", { orgId, total, marketplaceFee });
      return json({ error: "La comisión calculada para el cobro no es válida" }, 500);
    }
    const returnBase = publicReturnBase(Deno.env.get("PUBLIC_BASE_URL"));

    const payload = {
      items: [{
        id: `gestiona-${crypto.randomUUID()}`,
        title,
        quantity: 1,
        unit_price: Math.round(total * 100) / 100,
        currency_id: "ARS",
      }],
      ...(externalRef ? { external_reference: externalRef } : {}),
      ...(marketplaceFee > 0 ? { marketplace_fee: marketplaceFee } : {}),
      ...(returnBase ? {
        back_urls: { success: returnBase, pending: returnBase, failure: returnBase },
        auto_return: "approved",
      } : {}),
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?org_id=${orgId}`,
      metadata: { channel },
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const mpData = await mpRes.json().catch(() => null) as Record<string, unknown> | null;
    const url = cleanText(mpData?.init_point, 2_000);
    if (!mpRes.ok || !url) {
      console.error("mercadopago-link provider:", mpRes.status, mpData);
      return json({ error: "Mercado Pago no pudo crear el link de cobro" }, 502);
    }

    return json({
      url,
      sandboxUrl: cleanText(mpData?.sandbox_init_point, 2_000),
      preferenceId: cleanText(mpData?.id, 180),
      commissionApplied: marketplaceFee,
    });
  } catch (error) {
    console.error("mercadopago-link error:", error);
    return json({ error: "No se pudo generar el link de cobro" }, 500);
  }
});

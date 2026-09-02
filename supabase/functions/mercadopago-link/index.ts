/**
 * Crea una preferencia de Checkout Pro para un cobro operado desde Gestiona.
 *
 * La organización enviada por el navegador nunca es autoridad: se exige una
 * sesión real y `sales.create` dentro de ese tenant. El monto, cuando el cobro
 * apunta a `payment_links` o `quotes`, se lee del Core — no del body.
 * Sin fuente durable (POS ad-hoc) se admite el total del cajero.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import {
  parseLinkExternalRef,
  parseQuoteExternalRef,
  pickCanonicalTotal,
  type MpLinkAmountSource,
} from "../_shared/mpLinkAmount.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const paymentLinkId = cleanText(body.paymentLinkId, 80);
    const clientTotal = body.total != null ? Number(body.total) : null;
    // Un link de Checkout Pro es un cobro online aunque se haya iniciado desde
    // el mostrador. El cliente no elige el canal que determina la comisión.
    const channel = "online";

    if (!orgId || !UUID_RE.test(orgId)) return json({ error: "Organización inválida" }, 400);

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

    let coreTotal: number | null = null;
    let source: MpLinkAmountSource = { kind: "client_ad_hoc" };

    const quoteId = parseQuoteExternalRef(externalRef);
    const linkIdFromRef = parseLinkExternalRef(externalRef);
    const linkId = (paymentLinkId && UUID_RE.test(paymentLinkId))
      ? paymentLinkId
      : linkIdFromRef;

    if (quoteId) {
      const { data: quote, error } = await admin
        .from("quotes")
        .select("id, total, org_id, status")
        .eq("id", quoteId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) {
        console.error("mercadopago-link quote:", error);
        return json({ error: "No se pudo leer el presupuesto" }, 500);
      }
      if (!quote) return json({ error: "Presupuesto no encontrado" }, 404);
      coreTotal = Number(quote.total);
      source = { kind: "quote", id: quote.id };
    } else if (linkId || externalRef) {
      let q = admin
        .from("payment_links")
        .select("id, total_ars, status, org_id")
        .eq("org_id", orgId);
      if (linkId) q = q.eq("id", linkId);
      else q = q.eq("external_ref", externalRef!);
      const { data: link, error } = await q.maybeSingle();
      if (error) {
        console.error("mercadopago-link payment_link:", error);
        return json({ error: "No se pudo leer el link de pago" }, 500);
      }
      if (linkId || (externalRef && link)) {
        if (!link) return json({ error: "Link de pago no encontrado" }, 404);
        if (link.status === "paid" || link.status === "cancelled") {
          return json({ error: "Ese link ya no admite cobro" }, 422);
        }
        coreTotal = Number(link.total_ars);
        source = { kind: "payment_link", id: link.id };
      }
    }

    const amount = pickCanonicalTotal({ coreTotal, clientTotal, source });
    if (!amount.ok) return json({ error: amount.error }, amount.status);
    const total = amount.total;

    if (
      source.kind !== "client_ad_hoc"
      && clientTotal != null
      && Number.isFinite(clientTotal)
      && Math.abs(clientTotal - total) > 0.02
    ) {
      console.warn("mercadopago-link: client total ignored in favor of Core", {
        orgId,
        source,
        clientTotal,
        total,
      });
    }

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
        unit_price: total,
        currency_id: "ARS",
      }],
      ...(externalRef ? { external_reference: externalRef } : {}),
      ...(marketplaceFee > 0 ? { marketplace_fee: marketplaceFee } : {}),
      ...(returnBase ? {
        back_urls: { success: returnBase, pending: returnBase, failure: returnBase },
        auto_return: "approved",
      } : {}),
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?org_id=${orgId}`,
      metadata: { channel, amount_source: source.kind },
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
      amountSource: source.kind,
      total,
    });
  } catch (error) {
    console.error("mercadopago-link error:", error);
    return json({ error: "No se pudo generar el link de cobro" }, 500);
  }
});

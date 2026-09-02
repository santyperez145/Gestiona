/**
 * send-whatsapp — campañas de WhatsApp desde el número de la plataforma (Meta Cloud).
 *
 * El navegador elige un segmento para la UX, pero el servidor vuelve a leer
 * los destinatarios consentidos y el texto del borrador. Nunca acepta una lista
 * de teléfonos ni un mensaje arbitrario: eso permitiría saltear una baja.
 *
 * Evolution API quedó fuera: Meta bloquea números no oficiales. La puerta es
 * `whatsapp_listo` de `mensajeria_de_plataforma`, no una instancia por comercio.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Recipient { id: string; phone: string; name: string; }
interface SendRequest {
  orgId: string;
  recipientIds: string[];
  campaignId: string;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-whatsapp", { max: 5, windowMs: 60_000 })) return rateLimitResponse();

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
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: SendRequest = await req.json();
    const { orgId, recipientIds, campaignId } = body;

    if (!orgId || !campaignId || !recipientIds?.length) {
      return new Response(JSON.stringify({ error: "orgId, campaignId y recipientIds son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (recipientIds.length > 500) {
      return new Response(JSON.stringify({ error: "Máximo 500 destinatarios por llamada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userRes.user.id)
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Necesitás ser administrador de esta organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Puerta del canal oficial: sin Meta listo no se crean tokens de baja ni
    // se marca la campaña como enviada.
    const { data: mensajeria, error: mensajeriaError } = await admin.rpc("mensajeria_de_plataforma");
    if (mensajeriaError) throw mensajeriaError;
    const cfg = mensajeria as { whatsapp_listo?: boolean; whatsapp_proveedor?: string | null } | null;
    if (!cfg?.whatsapp_listo) {
      return new Response(JSON.stringify({
        error: "WhatsApp de la plataforma todavía no está listo. Escribínos y lo configuramos — no es Evolution ni un QR por comercio.",
        code: "whatsapp_not_ready",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: campaign, error: campaignError } = await admin
      .from("whatsapp_campaigns")
      .select("id, message, status")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaña no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (campaign.status === "sent") {
      return new Response(JSON.stringify({ error: "Esta campaña ya fue enviada" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniqueRecipientIds = [...new Set(recipientIds)].slice(0, 500);
    const { data: consentedRecipients, error: recipientsError } = await admin
      .from("customers")
      .select("id, name, phone")
      .eq("org_id", orgId)
      .in("id", uniqueRecipientIds)
      .not("marketing_consent_at", "is", null)
      .is("marketing_opt_out_at", null);
    if (recipientsError) throw recipientsError;

    const recipients = ((consentedRecipients ?? []) as Recipient[])
      .filter((recipient) => (recipient.phone ?? "").replace(/\D/g, "").length >= 8);
    const skipped = uniqueRecipientIds.length - recipients.length;
    if (!recipients.length) {
      await admin.from("whatsapp_campaigns").update({ status: "failed", sent_count: 0, failed_count: 0 })
        .eq("id", campaignId).eq("org_id", orgId);
      return new Response(JSON.stringify({ error: "No hay destinatarios con consentimiento vigente", skipped }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings, error: settingsError } = await admin
      .from("settings")
      .select("business_name")
      .eq("org_id", orgId)
      .maybeSingle();
    if (settingsError) throw settingsError;

    const businessName = settings?.business_name?.trim() || "este comercio";
    const unsubscribeBaseUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/whatsapp-unsubscribe`;

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    const BATCH = 3;
    const DELAY_MS = 1000;

    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);

      await Promise.all(batch.map(async (r) => {
        const unsubscribeToken = crypto.randomUUID();
        const { error: tokenError } = await admin.from("whatsapp_unsubscribe_tokens").insert({
          token: unsubscribeToken,
          org_id: orgId,
          customer_id: r.id,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (tokenError) {
          failed++;
          errors.push(`${r.id}: no se pudo generar el enlace de baja`);
          console.error("No se pudo crear token de baja de WhatsApp:", tokenError.message);
          return;
        }

        const personalizedMsg = campaign.message
          .replace(/\{\{nombre\}\}/gi, r.name.split(" ")[0])
          .replace(/\{\{name\}\}/gi, r.name.split(" ")[0])
          + `\n\nPara dejar de recibir promociones de ${businessName}: ${unsubscribeBaseUrl}?token=${unsubscribeToken}`;

        const result = await enviarWhatsApp(r.phone, personalizedMsg);

        if (result.ok) {
          sent++;
        } else {
          failed++;
          const phone = normalizePhone(r.phone);
          errors.push(`${phone}: ${result.error ?? "rechazado"}`);
          console.warn(`WhatsApp failed for ${phone}:`, result.error);
        }
      }));

      if (i + BATCH < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    // Cero entregas no es "enviado": el comercio no debe ver un éxito vacío.
    const status = sent === 0 ? "failed" : "sent";
    await admin.from("whatsapp_campaigns").update({
      status,
      sent_count: sent,
      failed_count: failed,
      sent_at: sent > 0 ? new Date().toISOString() : null,
    }).eq("id", campaignId).eq("org_id", orgId);

    console.log(`send-whatsapp (meta): org=${orgId} sent=${sent} failed=${failed} status=${status}`);

    if (sent === 0) {
      return new Response(JSON.stringify({
        error: "Ningún mensaje se entregó. Revisá el canal de WhatsApp de la plataforma o los números de los destinatarios.",
        sent,
        failed,
        skipped,
        errors: errors.slice(0, 10),
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent, failed, skipped, errors: errors.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-whatsapp error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

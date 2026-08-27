/**
 * send-whatsapp — Envía mensajes de WhatsApp via Evolution API.
 *
 * Evolution API es open-source y self-hosted.
 * Deploy gratuito en Railway / Render / VPS.
 * Repositorio: https://github.com/EvolutionAPI/evolution-api
 *
 * Variables de entorno (configuradas en Supabase secrets o en settings):
 *   EVOLUTION_API_URL      — URL base, ej: https://mi-evolution.railway.app
 *   EVOLUTION_API_KEY      — Global API key (o instance key)
 *   EVOLUTION_INSTANCE     — Nombre de la instancia conectada (ej: "gestiona")
 *
 * Si no hay configuración global, se usa la conexión privada de la
 * organización; ninguna credencial se lee desde `settings` ni el navegador.
 *
 * Request body:
 *   { orgId, recipientIds: [customerId], campaignId }
 *
 * El navegador elige un segmento para la UX, pero el servidor vuelve a leer
 * los destinatarios consentidos y el texto del borrador. Nunca acepta una lista
 * de teléfonos ni un mensaje arbitrario: eso permitiría saltear una baja.
 *
 * Formato de teléfono esperado: +54911xxxxxxxx  o  54911xxxxxxxx
 * Evolution API acepta: "5491112345678" (sin + ni espacios)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { getEvolutionCredentials } from "../_shared/evolutionConnection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Recipient { id: string; phone: string; name: string; }
interface SendRequest {
  orgId: string;
  recipientIds: string[];
  campaignId: string;
}

/** Normaliza teléfono al formato de Evolution API: solo dígitos, sin + */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Envía un único mensaje via Evolution API */
/**
 * ⚠️ Acá había un `fetch` a Evolution API — el puente no oficial que enlaza un
 * teléfono escaneando un QR, como WhatsApp Web. Meta bloquea los números que
 * detecta usando un cliente no oficial, sin aviso, y el número que se pierde es
 * el del comercio.
 *
 * Ahora delega en `_shared/whatsapp.ts`, que manda por la API oficial de Meta
 * desde el número de la plataforma. Se conserva la firma y la forma del
 * resultado para no tocar los llamados; los argumentos de Evolution quedaron
 * sin uso.
 */
async function sendViaEvolution(
  _baseUrl: string,
  _apiKey: string,
  _instance: string,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await enviarWhatsApp(phone, text);
  if (r.ok) return { ok: true };
  return {
    ok: false,
    // «Sin WhatsApp configurado» no es un fallo del envío: es que todavía no se
    // dio de alta el número en Plataforma → Mensajería.
    error: r.configurado
      ? (r.error ?? "El proveedor rechazó el mensaje")
      : "Todavía no hay un número de WhatsApp configurado en la plataforma",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-whatsapp", { max: 5, windowMs: 60_000 })) return rateLimitResponse();

  // ── Auth check ───────────────────────────────────────────────────────────────
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

    // Mandar una campaña es una acción administrativa y usa una credencial del
    // comercio. La barrera de navegación no basta: la Function se puede llamar
    // sin abrir la pantalla.
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

    // La lista del cliente sólo son ids. La fuente de verdad de consentimiento y
    // teléfono se resuelve ahora, justo antes de gastar mensajes en Evolution.
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

    // ── Resolver credenciales Evolution API ─────────────────────────────────────
    const evolution = await getEvolutionCredentials(admin, orgId);
    const { data: settings, error: settingsError } = await admin
      .from("settings")
      .select("business_name")
      .eq("org_id", orgId)
      .maybeSingle();
    if (settingsError) throw settingsError;

    if (!evolution) {
      return new Response(JSON.stringify({
        error: "Evolution API no configurada. Ingresá las credenciales en Ajustes → Integraciones.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Envío en batches ──────────────────────────────────────────────────────────
    const businessName = settings?.business_name?.trim() || "este comercio";
    const unsubscribeBaseUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/whatsapp-unsubscribe`;

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Evolution API recomienda no más de 3-5 mensajes simultáneos para no ser bloqueado
    const BATCH = 3;
    const DELAY_MS = 1000; // 1s entre batches (comportamiento humano)

    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);

      await Promise.all(batch.map(async (r) => {
        // El token va antes del envío: no se manda una promoción sin salida de
        // baja. Si no se pudo guardar, se cuenta como fallido y no se llama a
        // Evolution API para ese contacto.
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
          .replace(/\{\{name\}\}/gi,   r.name.split(" ")[0])
          + `\n\nPara dejar de recibir promociones de ${businessName}: ${unsubscribeBaseUrl}?token=${unsubscribeToken}`;

        const result = await sendViaEvolution(
          evolution.apiUrl, evolution.apiKey, evolution.instance,
          r.phone, personalizedMsg,
        );

        if (result.ok) {
          sent++;
        } else {
          failed++;
          const phone = normalizePhone(r.phone);
          errors.push(`${phone}: ${result.error}`);
          console.warn(`Evolution API failed for ${phone}:`, result.error);
        }
      }));

      if (i + BATCH < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    // ── Actualizar stats de campaña ───────────────────────────────────────────────
    if (campaignId) {
      await admin.from("whatsapp_campaigns").update({
        status: failed === recipients.length ? "failed" : "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      }).eq("id", campaignId).eq("org_id", orgId);
    }

    console.log(`send-whatsapp (Evolution): org=${orgId} sent=${sent} failed=${failed}`);

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

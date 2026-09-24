/**
 * send-email-campaign — Sends an email marketing campaign.
 *
 * Email provider priority:
 *   1. Own SMTP  — if the organization connected its private credential
 *   2. Resend    — if RESEND_API_KEY env var is set
 *   3. Error     — no provider configured
 *
 * ── La audiencia la resuelve el servidor ────────────────────────────────────
 * El navegador ya no manda `recipients` ni contenido: manda el id de la
 * campaña y opcionalmente el segmento. El servidor lee asunto y cuerpo de la
 * fila guardada y calcula los destinatarios aplicando segmento, consentimiento
 * vigente (opt-in sin opt-out posterior) y baja explícita. El navegador no
 * decide a quién se le escribe ni qué contenido sale.
 *
 * ── Quién puede llamar ────────────────────────────────────────────────────
 * Dos audiencias: una persona con sesión y rol owner/admin (botón Enviar del
 * panel) o el worker de programados (cron con x-cron-secret). La anon key
 * sola no pasa: la anon key es pública.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import { emailFailure } from "../_shared/emailErrors.ts";
import { mensajeDeError } from "../_shared/errorMessage.ts";
import { esLlamadaDeCron } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Recipient { email: string; name: string; }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-email-campaign", { max: 5, windowMs: 60_000 })) return rateLimitResponse();

  // ── Quién llama ────────────────────────────────────────────────────────────
  const esCron = esLlamadaDeCron(req);
  const authHeader = req.headers.get("Authorization");
  if (!esCron && !authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (!esCron) {
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { data: userRes } = await sbAuth.auth.getUser();
    if (!userRes?.user?.id) {
      return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = userRes.user.id;
    userEmail = userRes.user?.email ?? null;
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Los links de baja son públicos y estables: el dominio canónico es la URL
  // del proyecto, no el dominio del comercio, para que ningún proxy de tienda
  // la rompa.
  const SUPABASE_URL_BASE = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");

  try {
    // El navegador sólo propone: id de campaña y segmento. `recipients`,
    // `subject` y `bodyHtml` dejaron de ser input — salen de la fila guardada.
    const { campaignId, segment: segmentFromBody, testOnly } = await req.json() as {
      campaignId: string;
      segment?: string;
      testOnly?: boolean;
    };

    if (!campaignId) {
      return new Response(JSON.stringify({ error: "Falta el identificador de la campaña", code: "INVALID_CAMPAIGN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── La fila guardada es la autoridad de contenido ─────────────────────────
    const { data: campRow } = await supabase
      .from("email_campaigns")
      .select("id, org_id, subject, body_html, segment")
      .eq("id", campaignId)
      .single();
    const orgId: string = campRow?.org_id ?? "";

    // ── Autorización: owner/admin del tenant ──────────────────────────────────
    if (!esCron) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId ?? "")
        .maybeSingle();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Sin permisos para esta organización" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const subject = String(campRow?.subject ?? "").trim();
    const bodyHtml = String(campRow?.body_html ?? "").trim();
    if (!subject || !bodyHtml) {
      return new Response(JSON.stringify({ error: "La campaña no tiene asunto o contenido guardado", code: "EMPTY_CAMPAIGN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Proveedor ──────────────────────────────────────────────────────────────
    const smtpCfg = await smtpDeOrganizacion(orgId);
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = (await remitenteDe("marketing")).from;

    // ── Prueba: sólo a la persona que la pide ──────────────────────────────────
    if (testOnly) {
      const testEmail = String(userEmail ?? "").toLowerCase();
      if (!EMAIL.test(testEmail)) {
        return new Response(JSON.stringify({ error: "Tu cuenta no tiene email para recibir la prueba" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await sendEmail(
        smtpCfg,
        resendKey,
        resendFrom,
        { to: testEmail, subject: `[PRUEBA] ${subject.slice(0, 170)}`, html: bodyHtml },
        { campaign_id: campaignId, org_id: orgId, message_type: "campaign_test" },
        { idempotencyKey: `campaign-test/${campaignId}/${testEmail}` },
      );
      if (!result.ok) {
        return new Response(JSON.stringify(emailFailure(result, "merchant", "send-email-campaign-test")), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ sent: 1, failed: 0, test: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── La audiencia la calcula el servidor ──────────────────────────────────
    const segment = typeof segmentFromBody === "string" && segmentFromBody
      ? segmentFromBody
      : String(campRow?.segment ?? "all");

    const { data: customerRows, error: customerError } = await supabase
      .from("customers")
      .select("name, email, birthday, marketing_consent_at, marketing_opt_out_at")
      .eq("org_id", orgId)
      .not("email", "is", null);
    if (customerError) throw customerError;

    const { data: salesRows, error: salesError } = await supabase
      .from("sales")
      .select("customer_name, date")
      .eq("org_id", orgId)
      .gte("date", new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10));
    if (salesError) throw salesError;

    const lastPurchase: Record<string, number> = {};
    for (const s of salesRows ?? []) {
      const name = String(s.customer_name ?? "");
      if (!name) continue;
      const ms = new Date(s.date).getTime();
      if (!lastPurchase[name] || ms > lastPurchase[name]) lastPurchase[name] = ms;
    }

    // Bajas históricas registradas desde el link del pie de email.
    const { data: blockedRows } = await supabase
      .from("email_unsubscribes")
      .select("email")
      .eq("org_id", orgId);
    const blocked = new Set((blockedRows ?? []).map((row) => String(row.email ?? "").toLowerCase()));

    const ahora = new Date();
    const nowMs = Date.now();
    const dedupe = new Map<string, Recipient>();
    for (const row of customerRows ?? []) {
      const email = String(row.email ?? "").trim().toLowerCase();
      const name = String(row.name ?? "").trim().slice(0, 120);
      if (!email || !EMAIL.test(email)) continue;
      if (blocked.has(email)) continue;
      // Consentimiento vigente: opt-in presente; un opt-out posterior lo anula.
      if (!row.marketing_consent_at) continue;
      if (row.marketing_opt_out_at && new Date(row.marketing_opt_out_at).getTime() > new Date(row.marketing_consent_at).getTime()) continue;

      const daysSince = lastPurchase[name] ? (nowMs - lastPurchase[name]) / 86_400_000 : Infinity;
      let include = false;
      if (segment === "all") include = true;
      else if (segment === "vip") include = daysSince <= 30;
      else if (segment === "at_risk") include = daysSince > 30 && daysSince <= 60;
      else if (segment === "dormant") include = daysSince > 60 && daysSince <= 90;
      else if (segment === "lost") include = daysSince > 90;
      else if (segment === "never_bought") include = !lastPurchase[name];
      else if (segment === "birthday") {
        const bm = parseInt(String(row.birthday ?? "").split("-")[1] || "0", 10);
        include = bm === ahora.getMonth() + 1;
      }
      if (!include) continue;
      // Deduplicación por email case-insensitive.
      dedupe.set(email, { email, name: name || "Cliente" });
    }

    const allowed = [...dedupe.values()];
    if (!allowed.length) {
      return new Response(JSON.stringify({ error: "No hay destinatarios con consentimiento vigente para este segmento", code: "NO_ELIGIBLE_RECIPIENTS" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    let firstFailure: Awaited<ReturnType<typeof sendEmail>> | null = null;

    // ── Baja uno-clic (CAN-SPAM / RFC 8058) ────────────────────────────────
    //
    // El footer del comercio trae `{{unsubscribe_url}}`; antes salía el
    // placeholder literal y el contacto no tenía cómo darse de baja. Ahora cada
    // destinatario recibe un token de un solo uso; el link procesa la baja y
    // agrega el email a `email_unsubscribes` para las campañas siguientes.
    const baseBaja = `${SUPABASE_URL_BASE}/functions/v1/email-campaign-unsubscribe`;

    // Resend admite 5 solicitudes por segundo por defecto. El ritmo deliberado
    // evita 429 y la clave idempotente hace seguro reintentar la campaña.
    for (let i = 0; i < allowed.length; i++) {
      const recipient = allowed[i];
      const firstName = recipient.name.split(" ")[0].replace(/[&<>"']/g, "");
      const tokenBaja = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const urlBaja = `${baseBaja}?token=${encodeURIComponent(tokenBaja)}`;
      // Guardar el token antes de enviar: si el envío falla igual queda válida
      // la baja para el próximo intento (idempotente por campaña+email).
      await supabase.from("email_campaign_unsubscribe_tokens").upsert({
        token: tokenBaja,
        campaign_id: campaignId,
        org_id: orgId,
        email: recipient.email,
      }, { onConflict: "campaign_id,email" });
      const personalizedHtml = bodyHtml
        .replace(/\{\{nombre\}\}/gi, firstName)
        .replace(/\{\{unsubscribe_url\}\}/gi, urlBaja);
      const result = await sendEmail(
        smtpCfg,
        resendKey,
        resendFrom,
        { to: recipient.email, subject: subject.slice(0, 180), html: personalizedHtml },
        { campaign_id: campaignId, org_id: orgId, message_type: "campaign" },
        { idempotencyKey: `campaign/${campaignId}/${recipient.email}` },
      );
      if (result.ok) sent++;
      else {
        failed++;
        firstFailure ??= result;
      }
      if (!smtpCfg && i + 1 < allowed.length) await new Promise((resolve) => setTimeout(resolve, 220));
    }

    // ── Estado final de la campaña ─────────────────────────────────────────────
    await supabase.from("email_campaigns").update({
      status: sent === 0 && failed > 0 ? "failed" : "sent",
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    }).eq("id", campaignId);

    console.log(`send-email-campaign: org=${orgId} sent=${sent} failed=${failed} provider=${smtpCfg ? "smtp" : resendKey ? "resend" : "none"}`);

    if (sent === 0 && firstFailure) {
      return new Response(JSON.stringify(emailFailure(firstFailure, "merchant", "send-email-campaign")), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      sent,
      failed,
      audience: allowed.length,
      ...(firstFailure ? { warning: emailFailure(firstFailure, "merchant", "send-email-campaign-partial") } : {}),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // El detalle queda disponible para operaciones sin filtrarse al cartel del comercio.
    console.error("send-email-campaign:", mensajeDeError(err));
    return new Response(JSON.stringify({ error: "No se pudo preparar la campaña. Revisá los destinatarios e intentá nuevamente.", code: "CAMPAIGN_PREPARATION_FAILED" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
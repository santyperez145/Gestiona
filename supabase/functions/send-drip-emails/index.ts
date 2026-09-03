/**
 * send-drip-emails — Cron job that sends pending drip sequence emails.
 *
 * Runs every 30 minutes. For each active enrollment where next_send_at <= now():
 *   1. Skip if recipient is on the org's suppression list
 *   2. Load the current step's subject + body_html
 *   3. Generate fresh unsubscribe token (90-day expiry)
 *   4. Substitute template variables ({{name}} and {name} both supported)
 *   5. Append unsubscribe footer + set List-Unsubscribe headers
 *   6. Send via SMTP → Resend fallback
 *   7. Log send result. Only advance enrollment on success (idempotent retry)
 *   8. On final step → mark completed; else schedule next step
 *
 * Template variables supported:
 *   {{name}} / {nombre}       → customer_name
 *   {{business}} / {negocio}  → org business_name
 *   {{sequence}}              → sequence.name
 *   {{step}}                  → current step number (1-based)
 *   {{unsubscribe_url}}       → auto-injected unsubscribe link
 *
 * Schedule example (pg_cron):
 *   select cron.schedule('send-drip-emails','30 minutes',
 *     $$select net.http_post('https://<project>.functions.supabase.co/send-drip-emails',
 *       '{}'::jsonb, '{}'::jsonb,
 *       '{"Authorization":"Bearer <service-role>"}'::jsonb)$$);
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion, type EmailPayload } from "../_shared/smtpSender.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const PUBLIC_BASE_URL      = Deno.env.get("PUBLIC_BASE_URL") ?? SUPABASE_URL;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a URL-safe random token (32 chars hex). */
function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Apply template variables — supports both {{var}} and {var} syntax. */
function applyTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const safe = String(value ?? "");
    // {{key}}
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), safe);
    // {key}
    out = out.replace(new RegExp(`(?<![{])\\{\\s*${key}\\s*\\}(?![}])`, "gi"), safe);
  }
  return out;
}

/** Wrap the body HTML with an unsubscribe footer. */
function withUnsubscribeFooter(html: string, unsubscribeUrl: string, businessName: string): string {
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;text-align:center;font-family:-apple-system,sans-serif;line-height:1.5">
  <p style="margin:0 0 6px">Recibís este email porque estás suscripto a una campaña de ${businessName}.</p>
  <p style="margin:0"><a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline">Cancelar suscripción</a></p>
</div>`.trim();
  // If body already contains </body>, inject before it; otherwise append
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return html + footer;
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // 1. Pull due enrollments
    const { data: due, error: dueErr } = await sb
      .from("drip_enrollments")
      .select(`
        id, sequence_id, org_id, customer_email, customer_name, customer_id,
        current_step, total_steps, status, next_send_at,
        drip_sequences!inner(
          id, name, active, org_id,
          drip_sequence_steps(id, step_order, day_offset, subject, body_html)
        )
      `)
      .eq("status", "active")
      .lte("next_send_at", new Date().toISOString())
      .limit(100);

    if (dueErr) throw dueErr;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const resendFrom = (await remitenteDe("marketing")).from;

    for (const enrollment of due) {
      try {
        // deno-lint-ignore no-explicit-any
        const seq: any = enrollment.drip_sequences;
        if (!seq?.active) { skipped++; continue; }

        // Suppression check
        const { data: suppressed } = await sb.rpc("is_email_suppressed", {
          p_org_id: enrollment.org_id,
          p_email: enrollment.customer_email,
        });
        if (suppressed === true) {
          // Mark as unsubscribed so we don't keep checking
          await sb.from("drip_enrollments").update({
            status: "unsubscribed",
            completed_at: new Date().toISOString(),
            next_send_at: null,
          }).eq("id", enrollment.id);
          skipped++;
          continue;
        }

        // deno-lint-ignore no-explicit-any
        const steps: any[] = (seq.drip_sequence_steps || [])
          .sort((a: { step_order: number }, b: { step_order: number }) => a.step_order - b.step_order);

        const nextStepIdx = enrollment.current_step ?? 0;

        if (nextStepIdx >= steps.length) {
          // Already past last step — reconcile status
          await sb.from("drip_enrollments").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            next_send_at: null,
          }).eq("id", enrollment.id);
          skipped++;
          continue;
        }

        const step = steps[nextStepIdx];

        // 2. Load public business identity and private SMTP independently.
        const { data: settings } = await sb
          .from("settings")
          .select("business_name")
          .eq("org_id", enrollment.org_id)
          .maybeSingle();
        const smtpCfg = await smtpDeOrganizacion(enrollment.org_id);
        const businessName: string = settings?.business_name || seq.name || "Nerqia";

        // 3. Generate unsubscribe token
        const unsubToken = generateToken();
        const { error: tokenErr } = await sb.from("drip_unsubscribe_tokens").insert({
          token: unsubToken,
          enrollment_id: enrollment.id,
          org_id: enrollment.org_id,
          customer_email: enrollment.customer_email,
        });
        if (tokenErr) {
          console.error("Unsubscribe token insert failed:", tokenErr);
          // Fall through — sending without unsubscribe is illegal; we abort
          await sb.from("drip_send_log").insert({
            enrollment_id: enrollment.id, step_id: step.id, status: "bounced",
          });
          failed++;
          errors.push(`${enrollment.customer_email}: failed to generate unsubscribe token`);
          continue;
        }

        const unsubscribeUrl = `${PUBLIC_BASE_URL}/functions/v1/drip-unsubscribe?token=${unsubToken}`;

        // 4. Apply template variables
        const vars = {
          name:            enrollment.customer_name || "",
          nombre:          enrollment.customer_name || "",
          business:        businessName,
          negocio:         businessName,
          sequence:        seq.name || "",
          step:            String(nextStepIdx + 1),
          unsubscribe_url: unsubscribeUrl,
        };
        const subject = applyTemplate(step.subject as string, vars);
        const bodyRaw = applyTemplate(step.body_html as string, vars);
        const bodyWithFooter = withUnsubscribeFooter(bodyRaw, unsubscribeUrl, businessName);

        // 5. Send
        const payload: EmailPayload = {
          to: enrollment.customer_email,
          subject,
          html: bodyWithFooter,
          // RFC 8058 one-click + RFC 2369 List-Unsubscribe headers
          // are exposed by setting custom headers in the SMTP/Resend layer.
          // For now we include them as a fallback via a metadata tag on Resend.
        };

        const result = await sendEmail(smtpCfg, RESEND_API_KEY, resendFrom, payload, {
          drip_enrollment_id: enrollment.id,
          drip_step_id: step.id,
          drip_sequence_id: seq.id,
        });

        // 6. Log + advance ONLY on success
        if (result.ok) {
          await sb.from("drip_send_log").insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            sent_at: new Date().toISOString(),
            status: "sent",
          });

          const nextIdx = nextStepIdx + 1;
          if (nextIdx >= steps.length) {
            await sb.from("drip_enrollments").update({
              current_step: nextIdx,
              status: "completed",
              completed_at: new Date().toISOString(),
              next_send_at: null,
            }).eq("id", enrollment.id);
          } else {
            const nextStep = steps[nextIdx];
            const nextSend = new Date(Date.now() + (nextStep.day_offset || 1) * 86_400_000).toISOString();
            await sb.from("drip_enrollments").update({
              current_step: nextIdx,
              next_send_at: nextSend,
            }).eq("id", enrollment.id);
          }
          sent++;
        } else {
          // Send failed — log but don't advance, so next cron retries
          await sb.from("drip_send_log").insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            status: "bounced",
          });
          failed++;
          errors.push(`${enrollment.customer_email}: ${result.error || "send failed"}`);

          // Bump next_send_at by 1 hour so we don't hammer on persistent failures
          await sb.from("drip_enrollments").update({
            next_send_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          }).eq("id", enrollment.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${enrollment.customer_email}: ${msg}`);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ sent, skipped, failed, errors: errors.slice(0, 20) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-drip-emails fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

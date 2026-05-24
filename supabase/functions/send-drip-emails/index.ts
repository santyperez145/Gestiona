/**
 * send-drip-emails — Cron job that sends pending drip sequence emails.
 *
 * Runs every 30 minutes. For each active enrollment where next_send_at <= now():
 * 1. Loads the current step's subject + body_html
 * 2. Sends via SMTP → Resend fallback
 * 3. Advances current_step or marks completed
 * 4. Sets next_send_at for the following step (or null if done)
 *
 * Variables in body_html: {nombre} → customer_name, {negocio} → org name
 *
 * Schedule (add to pg_cron):
 *   select cron.schedule('send-drip-emails','30 minutes',$$select net.http_post(...)$$);
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendEmail, parseSmtpConfig } from "../_shared/smtpSender.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Load all active enrollments due for sending
    const { data: due, error: dueErr } = await sb
      .from("drip_enrollments")
      .select(`
        *,
        drip_sequences!inner(id, active, org_id, name,
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
    const errors: string[] = [];

    for (const enrollment of due) {
      try {
        const seq = enrollment.drip_sequences as any;
        if (!seq?.active) { skipped++; continue; }

        const steps: any[] = (seq.drip_sequence_steps || [])
          .sort((a: any, b: any) => a.step_order - b.step_order);
        const nextStepIdx = enrollment.current_step;  // 0-based index of step to send

        if (nextStepIdx >= steps.length) {
          // Already completed — fix status
          await sb.from("drip_enrollments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", enrollment.id);
          continue;
        }

        const step = steps[nextStepIdx];

        // Load org settings for SMTP
        const { data: settings } = await sb.from("settings").select("*").eq("org_id", seq.org_id).maybeSingle();
        const smtpCfg = settings ? parseSmtpConfig(settings) : null;
        const orgName = settings?.business_name || seq.name || "Gestiona";

        // Personalize content
        const body = (step.body_html as string)
          .replace(/\{nombre\}/gi, enrollment.customer_name)
          .replace(/\{negocio\}/gi, orgName);
        const subject = (step.subject as string)
          .replace(/\{nombre\}/gi, enrollment.customer_name)
          .replace(/\{negocio\}/gi, orgName);

        // Send email
        await sendEmail(smtpCfg, {
          to: [{ email: enrollment.customer_email, name: enrollment.customer_name }],
          subject,
          html: body,
          fromName: orgName,
          fromEmail: settings?.from_email || settings?.smtp_user || "noreply@gestiona.app",
        });

        // Log send
        await sb.from("drip_send_log").insert({
          enrollment_id: enrollment.id,
          step_id: step.id,
          sent_at: new Date().toISOString(),
          status: "sent",
        });

        // Advance or complete
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
          const nextSend = new Date(Date.now() + (nextStep.day_offset || 1) * 86400000).toISOString();
          await sb.from("drip_enrollments").update({
            current_step: nextIdx,
            next_send_at: nextSend,
          }).eq("id", enrollment.id);
        }

        sent++;
      } catch (e: any) {
        errors.push(`${enrollment.customer_email}: ${e.message}`);
        skipped++;
      }
    }

    return new Response(JSON.stringify({ sent, skipped, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
